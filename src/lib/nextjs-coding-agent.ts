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


// Workflow cache: key = `${sbxId}-${enableMCP}`, value = compiled workflow
const workflowCache = new Map<string, any>();

// Cache for bound models to avoid re-binding tools on every request
const boundModelCache = new Map<string, { model: any; tools: any[] }>();

/** Assembles the full tools array from base tools, MCP caches, and E2B tools. */
function buildToolsArray(sbxId?: string, sessionId?: string, enableMCP: boolean = true): any[] {
  const tools = [...baseTools];

  if (nextjsDocsToolsCache) {
    tools.push(...nextjsDocsToolsCache);
  }
  if (sbxId) {
    tools.push(...makeE2BTools(sbxId, sessionId));
  }
  if (enableMCP && playwrightToolsCache) {
    tools.push(...playwrightToolsCache);
  }

  return tools;
}

/** Returns a cached bound model + tools, or builds and caches a fresh one. */
function getOrBindModel(
  cacheKey: string,
  sbxId?: string,
  sessionId?: string,
  enableMCP: boolean = true
): { boundModel: any; tools: any[] } {
  const cached = boundModelCache.get(cacheKey);
  if (cached) {
    console.log(`[Performance] Using cached bound model for ${cacheKey}`);
    return { boundModel: cached.model, tools: cached.tools };
  }

  const tools = buildToolsArray(sbxId, sessionId, enableMCP);

  console.log(`[Performance] Binding ${tools.length} tools to model...`);
  const bindStart = Date.now();
  const boundModel = model.bindTools(tools);
  console.log(`[Performance] Tool binding completed in ${Date.now() - bindStart}ms`);

  boundModelCache.set(cacheKey, { model: boundModel, tools });
  return { boundModel, tools };
}

/** Constructs and compiles the LangGraph state graph for the agent. */
function compileAgentGraph(boundModel: any, tools: any[]) {
  const callModel = async (state: AgentState): Promise<Partial<AgentState>> => {
    try {
      const response = await boundModel.invoke(state.messages);
      return { messages: [response] };
    } catch (error) {
      console.error('Error in callModel:', error);
      return { messages: [new AIMessage('Error processing request. Please try again.')] };
    }
  };

  const shouldContinue = async (state: AgentState): Promise<string> => {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
      return 'tools';
    }
    return END;
  };

  return new StateGraph(MessagesAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', new ToolNode(tools))
    .addConditionalEdges('agent', shouldContinue, ['tools', END])
    .addEdge('tools', 'agent')
    .addEdge(START, 'agent')
    .compile({
      checkpointer: new MemorySaver(),
      store: agentMemoryStore,
    });
}

/** Factory: returns a cached compiled workflow, or creates + caches a new one. */
async function createAgentWorkflow(sbxId?: string, enableMCP: boolean = true, sessionId?: string) {
  const cacheKey = `${sbxId || 'no-sandbox'}-${enableMCP}`;

  if (workflowCache.has(cacheKey)) {
    console.log(`[Performance] Using cached workflow for ${cacheKey}`);
    return workflowCache.get(cacheKey);
  }

  console.log(`[Performance] Creating new workflow for ${cacheKey}...`);
  const startTime = Date.now();

  await initializeMCPTools();

  const { boundModel, tools } = getOrBindModel(cacheKey, sbxId, sessionId, enableMCP);
  const compiledWorkflow = compileAgentGraph(boundModel, tools);

  workflowCache.set(cacheKey, compiledWorkflow);
  console.log(`[Performance] Workflow created and cached in ${Date.now() - startTime}ms`);

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
async function* processAgentMessages(messages: any, toolCallArgsMap: Map<string, any>): AsyncGenerator<StreamResponse, void, unknown> {
  // Convert messages to array if it's not already
  const messageArray = Array.isArray(messages) ? messages : [messages];

  for (const message of messageArray) {
    if (message instanceof AIMessage) {
      // Check if it's a tool call
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          // Store args in the map for later retrieval
          const toolCallId = toolCall.id || toolCall.name;
          toolCallArgsMap.set(toolCallId, toolCall.args);

          yield {
            content: `Using tool: ${toolCall.name}`,
            tool_call_output: {
              tool: toolCall.name,
              args: toolCall.args,
              status: 'running'
            },
            type: 'tool_call'
          };
        }
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

    // Track tool call args for completion events
    const toolCallArgsMap = new Map<string, any>();

    // Use stream method for real-time updates
    const stream = await app.stream({ messages }, config);

    for await (const chunk of stream) {
      yield* processStreamChunk(chunk, toolCallArgsMap);
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
async function* processStreamChunk(chunk: any, toolCallArgsMap: Map<string, any>): AsyncGenerator<StreamResponse, void, unknown> {
  if (chunk.agent?.messages) {
    yield* processAgentMessages(chunk.agent.messages, toolCallArgsMap);
  } else if (chunk.tools?.messages) {
    // Process tool execution results
    for (const toolMessage of chunk.tools.messages) {
      if (toolMessage instanceof ToolMessage) {
        const toolName = toolMessage.name || 'unknown_tool';
        const toolContent = typeof toolMessage.content === 'string'
          ? toolMessage.content.slice(0, 200)
          : JSON.stringify(toolMessage.content).slice(0, 200);

        // Retrieve original args from map
        const toolCallId = toolMessage.tool_call_id || toolName;
        const originalArgs = toolCallArgsMap.get(toolCallId);

        yield {
          content: toolName,
          type: 'tool_call',
          tool_call_output: {
            tool: toolName,
            args: originalArgs, // Include the original args
            result: toolContent,
            status: 'complete'
          }
        };

        // Clean up the map entry
        toolCallArgsMap.delete(toolCallId);
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