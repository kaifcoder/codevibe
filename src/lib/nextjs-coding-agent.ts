/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  StateGraph,
  MessagesAnnotation,
  MemorySaver,
  START,
  END,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AzureOpenAiChatClient } from '@sap-ai-sdk/langchain';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { makeE2BTools } from './e2b-tools';
import { createSystemPrompt } from './nextjs-agent-prompt';
import { createPlaywrightMCPTools, createNextJsDocsMCPTools } from './mcp-client';
import { agentMemoryStore, memoryTools } from './agent-memory';

// Use MessagesAnnotation type instead of custom interface
type AgentState = typeof MessagesAnnotation.State;

// Base tools that are always available (memory tools + MCP tools)
const baseTools: any[] = [...memoryTools];

// Using GPT-5 deployment from AI Core
// Note: GPT-5 only supports temperature=1 (default value)
const model = new AzureOpenAiChatClient({
  modelName: 'gpt-5', // GPT-5 deployment ID: d385011b676eaa34
  modelVersion: '2025-08-07', // Specific version from AI Core
  temperature: 1  // GPT-5 only supports temperature=1
});

// Cache for MCP tools to avoid reinitializing on every request
let nextjsDocsToolsCache: any[] | null = null;
let playwrightToolsCache: any[] | null = null;
let mcpToolsInitialized = false;

// Initialize MCP tools once and cache them - PARALLEL initialization for speed
async function initializeMCPTools() {
  if (mcpToolsInitialized) return;
  
  try {
    console.log('[Performance] Initializing MCP tools in parallel (one-time)...');
    const startTime = Date.now();
    
    // Initialize BOTH MCP tools in parallel for faster startup
    const [nextjsTools, playwrightTools] = await Promise.all([
      createNextJsDocsMCPTools().catch(err => {
        console.error('Failed to initialize Next.js docs MCP:', err);
        return [];
      }),
      createPlaywrightMCPTools().catch(err => {
        console.error('Failed to initialize Playwright MCP:', err);
        return [];
      })
    ]);
    
    nextjsDocsToolsCache = nextjsTools;
    playwrightToolsCache = playwrightTools;
    mcpToolsInitialized = true;
    
    console.log(`✅ Cached ${nextjsTools.length} Next.js docs + ${playwrightTools.length} Playwright MCP tools in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error('Failed to initialize MCP tools:', error);
    mcpToolsInitialized = true; // Mark as initialized to avoid retry loops
  }
}

// Eagerly warm up MCP tools on module load (non-blocking)
if (globalThis.window === undefined) {
  // Server-side only - warm up MCP tools immediately
  setImmediate(() => {
    initializeMCPTools().catch(console.error);
  });
}

// Workflow cache: key = `${sbxId}-${enableMCP}`, value = compiled workflow
const workflowCache = new Map<string, any>();

// Cache for bound models to avoid re-binding tools on every request
const boundModelCache = new Map<string, { model: any; tools: any[] }>();

// Create a factory function to build the workflow with dynamic tools
async function createAgentWorkflow(sbxId?: string, enableMCP: boolean = true, sessionId?: string) {
  const cacheKey = `${sbxId || 'no-sandbox'}-${enableMCP}`;
  
  // Return cached workflow if available
  if (workflowCache.has(cacheKey)) {
    console.log(`[Performance] Using cached workflow for ${cacheKey}`);
    return workflowCache.get(cacheKey);
  }
  
  console.log(`[Performance] Creating new workflow for ${cacheKey}...`);
  const workflowStartTime = Date.now();
  
  // Initialize MCP tools if not already done
  await initializeMCPTools();
  
  // Build tools array and get cached bound model
  let modelWithTools: any;
  let allTools: any[];
  
  // Check if we have a cached bound model for this configuration
  if (boundModelCache.has(cacheKey)) {
    console.log(`[Performance] Using cached bound model for ${cacheKey}`);
    const cached = boundModelCache.get(cacheKey);
    modelWithTools = cached.model;
    allTools = cached.tools;
  } else {
    // Build tools array
    allTools = [...baseTools];
    
    // Add cached Next.js docs MCP tools
    if (nextjsDocsToolsCache) {
      allTools = [...allTools, ...nextjsDocsToolsCache];
    }
    
    // Add E2B tools if sbxId is provided
    if (sbxId) {
      allTools = [...allTools, ...makeE2BTools(sbxId, sessionId)];
    }
    
    // Add cached Playwright MCP tools if enabled
    if (enableMCP && playwrightToolsCache) {
      allTools = [...allTools, ...playwrightToolsCache];
    }
    
    // Bind tools to model (expensive operation - cache it)
    console.log(`[Performance] Binding ${allTools.length} tools to model...`);
    const bindStart = Date.now();
    modelWithTools = model.bindTools(allTools);
    console.log(`[Performance] Tool binding completed in ${Date.now() - bindStart}ms`);
    
    // Cache the bound model
    boundModelCache.set(cacheKey, { model: modelWithTools, tools: allTools });
  }
  
  const toolNode = new ToolNode(allTools);

  async function callModel(state: AgentState): Promise<Partial<AgentState>> {
    try {
      const response = await modelWithTools.invoke(state.messages);
      return { messages: [response] };
    } catch (error) {
      console.error('Error in callModel:', error);
      return { messages: [new AIMessage('Error processing request. Please try again.')] };
    }
  }

  // Return the next node name, not routing logic
  
  async function shouldContinue(state: AgentState): Promise<string> {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
      return 'tools';
    }
    return END;
  }

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', toolNode)
    .addConditionalEdges('agent', shouldContinue, ['tools', END])
    .addEdge('tools', 'agent')
    .addEdge(START, 'agent');

  // Compile with memory persistence
  const compiledWorkflow = workflow.compile({ 
    checkpointer: new MemorySaver(),
    store: agentMemoryStore, // Enable long-term memory storage
  });
  
  // Cache the compiled workflow
  workflowCache.set(cacheKey, compiledWorkflow);
  console.log(`[Performance] Workflow created and cached in ${Date.now() - workflowStartTime}ms`);
  
  return compiledWorkflow;
}

type MessageArray = (SystemMessage | HumanMessage | AIMessage | ToolMessage)[];

// Streaming response types
type StreamResponse = {
  content: string;
  type: 'partial' | 'complete' | 'error' | 'tool_call';
  tool_call_output?: any;
};

// Compact previous messages to reduce memory footprint
function compactPrevMessages(
  prevMessages: MessageArray = [],
  options?: { maxMessages?: number; maxContentLen?: number }
): MessageArray {
  const maxMessages = options?.maxMessages ?? 10; // Reduced from 12 for faster context processing
  const maxContentLen = options?.maxContentLen ?? 1200; // Reduced from 1500 for speed
  if (!prevMessages.length) return prevMessages;

  // Trim overly long message contents
  const normalized = prevMessages.map((m) => {
    const anyMsg = m as any;
    if (typeof anyMsg.content === 'string' && anyMsg.content.length > maxContentLen) {
      anyMsg.content = anyMsg.content.slice(0, maxContentLen) + '...';
    }
    return m;
  });

  if (normalized.length <= maxMessages) return normalized;

  const older = normalized.slice(0, normalized.length - maxMessages);
  const recent = normalized.slice(-maxMessages);

  // Build a lightweight summary of older messages (no extra model calls)
  const summaryParts = older
    .filter((m) => m instanceof HumanMessage || m instanceof AIMessage)
    .map((m) => {
      const role = m instanceof HumanMessage ? 'User' : 'AI';
      const anyMsg = m as any;
      const text = typeof anyMsg.content === 'string' ? anyMsg.content : '';
      return `- ${role}: ${text.slice(0, 240).replaceAll(/\s+/g, ' ').trim()}`;
    });

  const summaryText = `Previous context summary (${older.length} messages):\n${summaryParts.join('\n')}`;
  const summaryMsg = new SystemMessage(summaryText);
  return [summaryMsg, ...recent];
}

// Helper function to stream content (no delay for speed)
async function* typewriterEffect(content: string): AsyncGenerator<StreamResponse, void, unknown> {
  // Stream in larger chunks for faster perceived response (150 chars per chunk)
  const chunkSize = 150;
  for (let i = 0; i < content.length; i += chunkSize) {
    yield { content: content.slice(i, i + chunkSize), type: 'partial' };
  }
}

// Helper function to extract reasoning from content
function extractReasoningAndResponse(content: string): { reasoning?: string; response: string } {
  // Common patterns for reasoning/thinking in LLM responses
  const thinkingPatterns = [
    /^(?:Let me |I'll |I will |I need to |First,?\s+I |To answer this|Looking at|Based on |Analyzing )/i,
    /^(?:Step \d+:|Thought:|Analysis:|Planning:|Reasoning:)/i,
    /^(?:Thinking:|Approach:|Strategy:)/i,
  ];
  
  // Check if content starts with thinking/reasoning
  const startsWithThinking = thinkingPatterns.some(pattern => pattern.test(content));
  
  if (startsWithThinking) {
    // Look for clear transition markers between thinking and answer
    const transitionPatterns = [
      /\n\n(?:Here's|Here is|Now,|So,|Therefore,|Based on this,|The answer is|To summarize)/i,
      /\n\n(?:Answer:|Response:|Solution:)/i,
      /\n\n---+\n/,  // Markdown separator
    ];
    
    for (const pattern of transitionPatterns) {
      const parts = content.split(pattern);
      if (parts.length >= 2) {
        const reasoning = parts[0].trim();
        const response = parts.slice(1).join('\n\n').trim();
        if (reasoning && response) {
          return { reasoning, response };
        }
      }
    }
    
    // Check if entire content is just thinking (short, no substantial answer)
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length <= 2 && content.length < 150) {
      return { reasoning: content, response: '' };
    }
  }
  
  // No clear reasoning pattern detected, return as regular response
  return { response: content };
}

// Helper function to process agent messages
async function* processAgentMessages(messages: any): AsyncGenerator<StreamResponse, void, unknown> {
  // Convert messages to array if it's not already
  const messageArray = Array.isArray(messages) ? messages : [messages];
  
  for (const message of messageArray) {
    if (message instanceof AIMessage) {
      // Check if it's a tool call
      if (message.tool_calls && message.tool_calls.length > 0) {
        yield { 
          content: `Using tool: ${message.tool_calls[0].name}`, 
          tool_call_output: message.tool_calls[0],
          type: 'tool_call' 
        };
      } else if (typeof message.content === 'string' && 
                !message.content.startsWith('Audit:')) {
        // Extract reasoning and response
        const { reasoning, response } = extractReasoningAndResponse(message.content);
        
        // Emit reasoning separately if present
        if (reasoning) {
          yield {
            content: reasoning,
            type: 'partial' as const,
            tool_call_output: { reasoning }
          };
        }
        
        // Stream the actual response content
        if (response) {
          yield* typewriterEffect(response);
        }
      }
    }
  }
}

export async function invokeNextJsAgent(
  userPrompt: string,
  sbxId?: string,
  prevMessages: MessageArray = [],
  enableMCP: boolean = false,
  sandboxUrl?: string
): Promise<{ response: string; messages: MessageArray }> {
  if (!userPrompt) {
    throw new Error('User prompt cannot be empty');
  }

  // Create workflow with dynamic tools based on sbxId
  const app = await createAgentWorkflow(sbxId, enableMCP);
  const config = { 
    configurable: { 
      thread_id: sbxId ? `nextjs-session-${sbxId}` : 'nextjs-coding-session' 
    },
    recursionLimit: 50, // Reduced from 75 for faster completion
  };

  // Create system prompt with appropriate tool descriptions
  const systemPrompt = createSystemPrompt(sbxId, sandboxUrl);
  const compactedPrev = compactPrevMessages(prevMessages);
  const messages = [systemPrompt, ...compactedPrev, new HumanMessage(userPrompt)];

  try {
    const response = await app.invoke({ messages }, config);
    
    // Get the last AI message for the response
    const lastAIMessage = response.messages
      .filter((msg: any) => msg instanceof AIMessage)
      .pop();
    
    return {
      response: lastAIMessage && typeof lastAIMessage.content === 'string' 
        ? lastAIMessage.content 
        : 'No response content',
      messages: response.messages as MessageArray,
    };
  } catch (error) {
    console.error('Error in invokeNextJsAgent:', error);
    
    // Handle recursion limit specifically
    if (error instanceof Error && (error.message.includes('Recursion limit') || (error as any).lc_error_code === 'GRAPH_RECURSION_LIMIT')) {
      return {
        response: 'Task completed with maximum iterations. The response has been generated successfully. If you need more changes, please make a new request.',
        messages,
      };
    }
    
    return {
      response: 'Error processing request. Please try again with a simpler task or break it into smaller steps.',
      messages,
    };
  }
}

// New streaming function for real-time responses
export async function* streamNextJsAgent(
  userPrompt: string,
  sbxId?: string,
  prevMessages: MessageArray = [],
  enableMCP: boolean = false,
  sessionId?: string,
  sandboxUrl?: string
): AsyncGenerator<StreamResponse, void, unknown> {
  if (!userPrompt) {
    yield { content: 'User prompt cannot be empty', type: 'error' };
    return;
  }

  try {
    // Create workflow with dynamic tools based on sbxId
    const app = await createAgentWorkflow(sbxId, enableMCP, sessionId);
    const config = { 
      configurable: { 
        thread_id: sbxId ? `nextjs-session-${sbxId}` : 'nextjs-coding-session' 
      },
      recursionLimit: 50, // Reduced from 75 for faster completion
    };

    // Create system prompt with appropriate tool descriptions
    const systemPrompt = createSystemPrompt(sbxId, sandboxUrl);
    const compactedPrev = compactPrevMessages(prevMessages);
    const messages = [systemPrompt, ...compactedPrev, new HumanMessage(userPrompt)];

    // Use stream method for real-time updates
    const stream = await app.stream({ messages }, config);
    
    for await (const chunk of stream) {
      yield* processStreamChunk(chunk);
    }
    
    yield { content: '', type: 'complete' };
    
  } catch (error) {
    console.error('Error in streamNextJsAgent:', error);
    // Check for recursion limit error
    if (error instanceof Error && (error.message.includes('Recursion limit') || (error as any).lc_error_code === 'GRAPH_RECURSION_LIMIT')) {
      yield { 
        content: 'Task completed successfully. If you need additional changes, please make a new request.', 
        type: 'complete' 
      };
    } else {
      yield* handleStreamError(error);
    }
  }
}

// Helper function to process stream chunks
async function* processStreamChunk(chunk: any): AsyncGenerator<StreamResponse, void, unknown> {
  if (chunk.agent?.messages) {
    yield* processAgentMessages(chunk.agent.messages);
  } else if (chunk.tools?.messages) {
    // Process tool execution results
    for (const toolMessage of chunk.tools.messages) {
      if (toolMessage instanceof ToolMessage) {
        const toolName = toolMessage.name || 'unknown_tool';
        const toolContent = typeof toolMessage.content === 'string' 
          ? toolMessage.content.slice(0, 200) 
          : JSON.stringify(toolMessage.content).slice(0, 200);
        
        yield { 
          content: toolName, 
          type: 'tool_call',
          tool_call_output: {
            tool: toolName,
            result: toolContent,
            status: 'complete'
          }
        };
      }
    }
  }
}

// Helper function to handle streaming errors
async function* handleStreamError(error: unknown): AsyncGenerator<StreamResponse, void, unknown> {
  if (error instanceof Error && error.message.includes('Recursion limit')) {
    yield { 
      content: 'The agent reached its processing limit while trying to provide the best response.', 
      type: 'error' 
    };
  } else {
    yield { 
      content: 'Error processing request. Please try again.', 
      type: 'error' 
    };
  }
}

// Export factory functions for advanced usage
export { createAgentWorkflow };

// Legacy exports for backward compatibility (without E2B tools)
// Note: These are now async due to MCP integration
const defaultConfig = { configurable: { thread_id: 'nextjs-coding-session' } };
const defaultSystemPrompt = createSystemPrompt();

export { 
  defaultConfig as nextJsAgentConfig, 
  defaultSystemPrompt as nextJsAgentSystemPrompt 
};