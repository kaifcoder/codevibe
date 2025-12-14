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
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { makeE2BTools } from './e2b-tools';
import { createSystemPrompt } from './nextjs-agent-prompt';

// Use MessagesAnnotation type instead of custom interface
type AgentState = typeof MessagesAnnotation.State;

// Simple in-memory cache for docs lookups
const docsCache = new Map<string, { fetchedAt: number; content: string }>();
const CACHE_TTL_MS = 1000 * 60 * 10; // 10 minutes

// Mapping of common Next.js topics to canonical doc URLs (extendable)
const NEXT_DOCS_INDEX: Array<{
  keywords: string[];
  url: string;
  title: string;
  summary?: string;
}> = [
  { keywords: ['app router', 'app directory', 'routing', 'route segment'], url: 'https://nextjs.org/docs/app', title: 'App Router' },
  { keywords: ['pages router', 'pages directory'], url: 'https://nextjs.org/docs/pages', title: 'Pages Router' },
  { keywords: ['data fetching', 'fetch', 'fetching'], url: 'https://nextjs.org/docs/app/building-your-application/data-fetching/fetching', title: 'Data Fetching (fetch API)' },
  { keywords: ['server actions', 'actions'], url: 'https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions', title: 'Server Actions' },
  { keywords: ['api routes', 'api route', 'route handlers', 'route handler'], url: 'https://nextjs.org/docs/app/building-your-application/routing/route-handlers', title: 'Route Handlers (API)' },
  { keywords: ['middleware'], url: 'https://nextjs.org/docs/app/building-your-application/routing/middleware', title: 'Middleware' },
  { keywords: ['metadata', 'head'], url: 'https://nextjs.org/docs/app/building-your-application/optimizing/metadata', title: 'Metadata API' },
  { keywords: ['image', 'next/image'], url: 'https://nextjs.org/docs/app/building-your-application/optimizing/images', title: 'Image Optimization' },
  { keywords: ['link', 'next/link'], url: 'https://nextjs.org/docs/app/building-your-application/routing/linking-and-navigating', title: 'Linking & Navigating' },
  { keywords: ['static generation', 'ssg'], url: 'https://nextjs.org/docs/app/building-your-application/rendering/static-and-dynamic-rendering', title: 'Static & Dynamic Rendering' },
  { keywords: ['incremental static regeneration', 'isr'], url: 'https://nextjs.org/docs/app/building-your-application/caching#revalidating-data', title: 'Revalidation (ISR)' },
  { keywords: ['dynamic rendering', 'streaming', 'rsc'], url: 'https://nextjs.org/docs/app/building-your-application/rendering/server-components', title: 'React Server Components' },
  { keywords: ['env', 'environment variables'], url: 'https://nextjs.org/docs/app/building-your-application/configuring/environment-variables', title: 'Environment Variables' },
  { keywords: ['next config', 'next.config.js', 'configuration'], url: 'https://nextjs.org/docs/app/api-reference/next-config-js', title: 'next.config.js' },
  { keywords: ['deployment', 'vercel deploy'], url: 'https://nextjs.org/docs/app/building-your-application/deploying', title: 'Deployment' },
];

function resolveNextDocsTopic(raw: string): { url: string; title: string } | null {
  const topic = raw.toLowerCase().trim();
  // Exact keyword match first
  for (const entry of NEXT_DOCS_INDEX) {
    if (entry.keywords.some(k => k === topic)) return { url: entry.url, title: entry.title };
  }
  // Fallback substring containment
  for (const entry of NEXT_DOCS_INDEX) {
    if (entry.keywords.some(k => topic.includes(k))) return { url: entry.url, title: entry.title };
  }
  return null;
}

function stripHtml(html: string): string {
  // Remove script & style blocks
  const noScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  // Replace <br> and block tags with newlines
  const blockSpaced = noScripts.replace(/<(p|div|h[1-6]|section|article|ul|ol|li|pre|code|blockquote)[^>]*>/gi, '\n$&');
  // Remove all tags
  const text = blockSpaced.replace(/<[^>]+>/g, '');
  // Decode a few common entities
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n');
}

async function fetchNextDocsPage(url: string): Promise<string> {
  const cached = docsCache.get(url);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.content;
  }
  const res = await fetch(url, { headers: { 'User-Agent': 'CodeVibe-Agent/1.0 (+docs-tool)' } });
  if (!res.ok) throw new Error(`Failed to fetch docs (${res.status})`);
  const html = await res.text();
  const text = stripHtml(html);
  // Heuristic: capture first ~1600 chars for brevity
  const truncated = text.length > 1600 ? text.slice(0, 1600) + '\n… (truncated)' : text;
  docsCache.set(url, { fetchedAt: now, content: truncated });
  return truncated;
}

// Enhanced Next.js docs tool
const getNextJsDocsTool = tool(
  async ({ topic, query }) => {
    if (!topic) throw new Error('Topic cannot be empty');
    const resolved = resolveNextDocsTopic(topic);
    if (!resolved) {
      return `No direct match found for "${topic}". Try a more specific Next.js concept (e.g. "app router", "middleware", "server actions").`;
    }
    let content: string;
    try {
      content = await fetchNextDocsPage(resolved.url);
    } catch (err) {
      return `Failed retrieving Next.js docs for ${resolved.title} (${resolved.url}): ${(err as Error).message}`;
    }
    // Optional simple query filter: highlight lines containing query
    if (query) {
      const lines = content.split('\n');
      const q = query.toLowerCase();
      const matched = lines.filter(l => l.toLowerCase().includes(q));
      if (matched.length) {
        const preview = matched.slice(0, 8).join('\n');
        return `Next.js Docs: ${resolved.title}\nSource: ${resolved.url}\nQuery: ${query}\n--- Filtered Matches ---\n${preview}`;
      }
    }
    return `Next.js Docs: ${resolved.title}\nSource: ${resolved.url}\n--- Excerpt ---\n${content}`;
  },
  {
    name: 'get_nextjs_docs',
    description: 'Fetch and summarize official Next.js documentation for a topic; optional query filters lines containing a term.',
    schema: z.object({
      topic: z.string().min(1).describe('The Next.js topic or API (e.g. "app router", "middleware", "next/image")'),
      query: z.string().min(2).optional().describe('Optional term to filter relevant lines within the doc excerpt'),
    }),
  }
);

// Base tools that are always available
const baseTools = [getNextJsDocsTool];

const model = new AzureOpenAiChatClient({
  modelName: 'gpt-4.1',
  temperature: 0.3
});

// Create a factory function to build the workflow with dynamic tools
function createAgentWorkflow(sbxId?: string) {
  // Combine base tools with E2B tools if sbxId is provided
  const allTools = sbxId ? [...baseTools, ...makeE2BTools(sbxId)] : baseTools;
  const toolNode = new ToolNode(allTools);
  const modelWithTools = model.bindTools(allTools);

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
    return 'auditor';
  }

  // Count how many audit attempts have been made
  function countAuditAttempts(messages: any[]): number {
    return messages.filter(msg => 
      msg instanceof AIMessage && 
      typeof msg.content === 'string' && 
      msg.content.startsWith('Audit:')
    ).length;
  }

  // Auditor should modify state, not return routing decision
  async function auditorAgent(state: AgentState): Promise<Partial<AgentState>> {
    const lastMessage = state.messages[state.messages.length - 1];
    if (!(lastMessage instanceof AIMessage)) {
      return {};
    }

    function stringifyMessageContent(content: any): string {
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .map(part => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object') {
              const maybe: any = part;
              if (typeof maybe.text === 'string') return maybe.text;
              if (typeof maybe.content === 'string') return maybe.content;
            }
            try { return JSON.stringify(part); } catch { return String(part); }
          })
          .join(' ');
      }
      if (content && typeof content === 'object') {
        const maybe: any = content;
        if (typeof maybe.text === 'string') return maybe.text;
        if (typeof maybe.content === 'string') return maybe.content;
        try { return JSON.stringify(content); } catch { return String(content); }
      }
      return String(content ?? '');
    }

    // Check if we've exceeded the maximum audit attempts
    const auditAttempts = countAuditAttempts(state.messages);
    const MAX_AUDIT_ATTEMPTS = 3;

    if (auditAttempts >= MAX_AUDIT_ATTEMPTS) {
      // Force a PASS after max attempts to prevent infinite loops
      const forcePassMessage = new AIMessage(`Audit: PASS (Maximum audit attempts reached: ${MAX_AUDIT_ATTEMPTS})`);
      return { messages: [forcePassMessage] };
    }

    try {
      const auditResult = await model.invoke([
        new SystemMessage(
          `You are an auditor for a Next.js coding assistant. This is audit attempt ${auditAttempts + 1} of ${MAX_AUDIT_ATTEMPTS}.
          Respond with exactly "PASS" if the assistant output is acceptable, or "RETRY" if there are significant issues that need fixing.
          Be more lenient on later attempts - minor issues should result in PASS to avoid infinite loops.`
        ),
        new HumanMessage(`Assistant output: "${stringifyMessageContent(lastMessage.content)}"`),
      ]);

      // Add audit result as a message for context
      const auditMessage = new AIMessage(`Audit: ${stringifyMessageContent(auditResult.content)}`);
      return { messages: [auditMessage] };
    } catch (error) {
      console.error('Error in auditorAgent:', error);
      // On error, force a PASS to avoid getting stuck
      const errorPassMessage = new AIMessage('Audit: PASS (Audit error occurred)');
      return { messages: [errorPassMessage] };
    }
  }

  // Separate routing function for auditor decisions
  async function auditRouting(state: AgentState): Promise<string> {
    const messages = state.messages;
    // Look for the most recent audit message
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message instanceof AIMessage && 
          typeof message.content === 'string' && 
          message.content.startsWith('Audit:')) {
        return message.content.includes('PASS') ? END : 'agent';
      }
    }
    // Default to END if no audit found to prevent infinite loops
    return END;
  }

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', toolNode)
    .addNode('auditor', auditorAgent)
    .addConditionalEdges('agent', shouldContinue, ['tools', 'auditor'])
    .addConditionalEdges('auditor', auditRouting, ['agent', END])
    .addEdge('tools', 'agent')
    .addEdge(START, 'agent');

  // Compile with recursion limit and other safety configurations
  return workflow.compile({ 
    checkpointer: new MemorySaver()
  });
}

type MessageArray = (SystemMessage | HumanMessage | AIMessage | ToolMessage)[];

// Streaming response types
type StreamResponse = {
  content: string;
  type: 'partial' | 'complete' | 'error' | 'tool_call';
  tool_call_output?: any;
};

// Helper function to create typewriter effect
async function* typewriterEffect(content: string): AsyncGenerator<StreamResponse, void, unknown> {
  for (const char of content) {
    yield { content: char, type: 'partial' };
    // Add small delay for typewriter effect (optional)
    await new Promise(resolve => setTimeout(resolve, 10));
  }
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
        // Stream the content with typewriter effect
        yield* typewriterEffect(message.content);
      }
    }
  }
}

export async function invokeNextJsAgent(
  userPrompt: string,
  sbxId?: string,
  prevMessages: MessageArray = []
): Promise<{ response: string; messages: MessageArray }> {
  if (!userPrompt) {
    throw new Error('User prompt cannot be empty');
  }

  // Create workflow with dynamic tools based on sbxId
  const app = createAgentWorkflow(sbxId);
  const config = { 
    configurable: { 
      thread_id: sbxId ? `nextjs-session-${sbxId}` : 'nextjs-coding-session' 
    },
    recursionLimit: 100, // Additional safety limit at invocation level
  };

  // Create system prompt with appropriate tool descriptions
  const systemPrompt = createSystemPrompt(sbxId);
  const messages = [systemPrompt, ...prevMessages, new HumanMessage(userPrompt)];

  try {
    const response = await app.invoke({ messages }, config);
    
    // Filter out audit messages from the final response
    const filteredMessages = response.messages.filter((msg: any) => 
      !(msg instanceof AIMessage && 
        typeof msg.content === 'string' && 
        msg.content.startsWith('Audit:'))
    );
    
    // Get the last non-audit AI message for the response
    const lastAIMessage = filteredMessages
      .filter((msg: any) => msg instanceof AIMessage && 
        !(typeof msg.content === 'string' && msg.content.startsWith('Audit:')))
      .pop();
    
    return {
      response: lastAIMessage && typeof lastAIMessage.content === 'string' 
        ? lastAIMessage.content 
        : 'No response content',
      messages: filteredMessages,
    };
  } catch (error) {
    console.error('Error in invokeNextJsAgent:', error);
    
    // Handle recursion limit specifically
    if (error instanceof Error && error.message.includes('Recursion limit')) {
      return {
        response: 'The agent reached its processing limit while trying to provide the best response. The last generated response has been returned.',
        messages,
      };
    }
    
    return {
      response: 'Error processing request. Please try again.',
      messages,
    };
  }
}

// New streaming function for real-time responses
export async function* streamNextJsAgent(
  userPrompt: string,
  sbxId?: string,
  prevMessages: MessageArray = []
): AsyncGenerator<StreamResponse, void, unknown> {
  if (!userPrompt) {
    yield { content: 'User prompt cannot be empty', type: 'error' };
    return;
  }

  try {
    // Create workflow with dynamic tools based on sbxId
    const app = createAgentWorkflow(sbxId);
    const config = { 
      configurable: { 
        thread_id: sbxId ? `nextjs-session-${sbxId}` : 'nextjs-coding-session' 
      },
      recursionLimit: 100,
      
    };

    // Create system prompt with appropriate tool descriptions
    const systemPrompt = createSystemPrompt(sbxId);
    const messages = [systemPrompt, ...prevMessages, new HumanMessage(userPrompt)];

    // Use stream method for real-time updates
    const stream = await app.stream({ messages }, config);
    
    for await (const chunk of stream) {
      yield* processStreamChunk(chunk);
    }
    
    yield { content: '', type: 'complete' };
    
  } catch (error) {
    console.error('Error in streamNextJsAgent:', error);
    yield* handleStreamError(error);
  }
}

// Helper function to process stream chunks
async function* processStreamChunk(chunk: any): AsyncGenerator<StreamResponse, void, unknown> {
  if (chunk.agent?.messages) {
    yield* processAgentMessages(chunk.agent.messages);
  } else if (chunk.tools) {
    console.log('Tool calls:', chunk.tools);
    yield { content: 'Tool execution completed', type: 'tool_call' };
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
const defaultApp = createAgentWorkflow();
const defaultConfig = { configurable: { thread_id: 'nextjs-coding-session' } };
const defaultSystemPrompt = createSystemPrompt();

export { 
  defaultApp as nextJsAgentApp, 
  defaultConfig as nextJsAgentConfig, 
  defaultSystemPrompt as nextJsAgentSystemPrompt 
};