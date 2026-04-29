/* eslint-disable @typescript-eslint/no-explicit-any */
import { MemorySaver } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { AzureOpenAiChatClient } from '@sap-ai-sdk/langchain';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { makeE2BTools } from './e2b-tools';
import { createSystemPrompt } from './nextjs-agent-prompt';
import { createPlaywrightMCPTools, createNextJsDocsMCPTools } from './mcp-client';
import { memoryTools } from './agent-memory';

// ─── Model ───────────────────────────────────────────────────────────────────

const model = new AzureOpenAiChatClient({
  modelName: 'gpt-5',
  modelVersion: '2025-08-07',
  temperature: 1,
});

// ─── MCP Tool Cache ──────────────────────────────────────────────────────────

let nextjsDocsToolsCache: any[] | null = null;
let playwrightToolsCache: any[] | null = null;
let mcpToolsInitialized = false;

async function initializeMCPTools() {
  if (mcpToolsInitialized) return;
  try {
    const startTime = Date.now();
    const [nextjsTools, playwrightTools] = await Promise.all([
      createNextJsDocsMCPTools().catch(err => {
        console.error('[MCP] Next.js docs init failed:', err.message);
        return [];
      }),
      createPlaywrightMCPTools().catch(err => {
        console.error('[MCP] Playwright init failed:', err.message);
        return [];
      })
    ]);
    nextjsDocsToolsCache = nextjsTools;
    playwrightToolsCache = playwrightTools;
    mcpToolsInitialized = true;
    console.log(`[MCP] ${nextjsTools.length + playwrightTools.length} tools ready in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error('[MCP] Init failed:', error);
    mcpToolsInitialized = true;
  }
}

// ─── Agent Factory ───────────────────────────────────────────────────────────

// Cache for the no-sandbox agent (tools are stable)
let textAgentCache: any = null;

function buildTools(sbxId?: string, sessionId?: string): any[] {
  const tools: any[] = [...memoryTools];
  if (nextjsDocsToolsCache) tools.push(...nextjsDocsToolsCache);
  if (sbxId) tools.push(...makeE2BTools(sbxId, sessionId));
  if (playwrightToolsCache) tools.push(...playwrightToolsCache);
  return tools;
}

async function createAgentWorkflow(sbxId?: string, _enableMCP: boolean = true, sessionId?: string, _sandboxUrl?: string) {
  await initializeMCPTools();

  // Sandbox agents must be rebuilt (E2B tools capture sessionId in closures)
  if (sbxId) {
    const tools = buildTools(sbxId, sessionId);
    return createReactAgent({
      llm: model,
      tools,
      checkpointer: new MemorySaver(),
    });
  }

  // Text-only agent is cached
  if (textAgentCache) return textAgentCache;

  const tools = buildTools();
  textAgentCache = createReactAgent({
    llm: model,
    tools,
    checkpointer: new MemorySaver(),
  });
  return textAgentCache;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type MessageArray = (SystemMessage | HumanMessage | AIMessage | ToolMessage)[];

type StreamResponse = {
  content: string;
  type: 'partial' | 'complete' | 'error' | 'tool_call';
  tool_call_output?: any;
};

// ─── Message Compaction ──────────────────────────────────────────────────────

function compactPrevMessages(prevMessages: MessageArray = []): MessageArray {
  const maxMessages = 10;
  const maxContentLen = 1500;
  if (!prevMessages.length) return prevMessages;

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

  const summaryParts = older
    .filter((m) => m instanceof HumanMessage || m instanceof AIMessage)
    .map((m) => {
      const role = m instanceof HumanMessage ? 'User' : 'AI';
      const anyMsg = m as any;
      const text = typeof anyMsg.content === 'string' ? anyMsg.content : '';
      return `- ${role}: ${text.slice(0, 200).replaceAll(/\s+/g, ' ').trim()}`;
    });

  return [new SystemMessage(`Context (${older.length} prior messages):\n${summaryParts.join('\n')}`), ...recent];
}

// ─── Stream Processing ───────────────────────────────────────────────────────

async function* processStreamChunk(chunk: any, toolCallArgsMap: Map<string, any>): AsyncGenerator<StreamResponse, void, unknown> {
  // createReactAgent streams as { agent: { messages }, tools: { messages } }
  const nodeNames = Object.keys(chunk);

  for (const nodeName of nodeNames) {
    const nodeData = chunk[nodeName];
    if (!nodeData?.messages) continue;

    const messages = Array.isArray(nodeData.messages) ? nodeData.messages : [nodeData.messages];

    for (const msg of messages) {
      if (msg instanceof ToolMessage) {
        const toolName = msg.name || 'unknown_tool';
        const toolContent = typeof msg.content === 'string'
          ? msg.content.slice(0, 200)
          : JSON.stringify(msg.content).slice(0, 200);

        const toolCallId = msg.tool_call_id || toolName;
        const originalArgs = toolCallArgsMap.get(toolCallId);

        yield {
          content: toolName,
          type: 'tool_call',
          tool_call_output: { tool: toolName, args: originalArgs, result: toolContent, status: 'complete' }
        };
        toolCallArgsMap.delete(toolCallId);
      } else if (msg instanceof AIMessage) {
        const content = typeof msg.content === 'string' ? msg.content : '';

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const toolCall of msg.tool_calls) {
            const toolCallId = toolCall.id || toolCall.name;
            toolCallArgsMap.set(toolCallId, toolCall.args);
            yield {
              content: `Using tool: ${toolCall.name}`,
              tool_call_output: { tool: toolCall.name, args: toolCall.args, status: 'running' },
              type: 'tool_call'
            };
          }
        } else if (content.trim()) {
          yield { content, type: 'partial' };
        }
      }
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function invokeNextJsAgent(
  userPrompt: string,
  sbxId?: string,
  prevMessages: MessageArray = [],
  enableMCP: boolean = false,
  sandboxUrl?: string
): Promise<{ response: string; messages: MessageArray }> {
  if (!userPrompt) throw new Error('User prompt cannot be empty');

  const app = await createAgentWorkflow(sbxId, enableMCP, undefined, sandboxUrl);
  const config = {
    configurable: { thread_id: sbxId ? `session-${sbxId}` : 'text-session' },
    recursionLimit: 40,
  };

  const systemPrompt = createSystemPrompt(sbxId, sandboxUrl);
  const compactedPrev = compactPrevMessages(prevMessages);
  const messages = [systemPrompt, ...compactedPrev, new HumanMessage(userPrompt)];

  try {
    const response = await app.invoke({ messages }, config);
    const lastAI = (response.messages || [])
      .filter((msg: any) => msg instanceof AIMessage)
      .pop();

    return {
      response: lastAI && typeof lastAI.content === 'string' ? lastAI.content : 'No response content',
      messages: response.messages as MessageArray,
    };
  } catch (error) {
    console.error('[Agent] invoke error:', error);
    if (error instanceof Error && (error.message.includes('Recursion limit') || (error as any).lc_error_code === 'GRAPH_RECURSION_LIMIT')) {
      return { response: 'Task completed. Make a new request for additional changes.', messages };
    }
    return { response: 'Error processing request. Please try again.', messages };
  }
}

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
    const app = await createAgentWorkflow(sbxId, enableMCP, sessionId, sandboxUrl);
    const config = {
      configurable: { thread_id: sbxId ? `session-${sbxId}` : 'text-session' },
      recursionLimit: 40,
    };

    const systemPrompt = createSystemPrompt(sbxId, sandboxUrl);
    const compactedPrev = compactPrevMessages(prevMessages);
    const messages = [systemPrompt, ...compactedPrev, new HumanMessage(userPrompt)];

    const toolCallArgsMap = new Map<string, any>();
    const stream = await app.stream({ messages }, config);

    for await (const chunk of stream) {
      yield* processStreamChunk(chunk, toolCallArgsMap);
    }

    yield { content: '', type: 'complete' };
  } catch (error) {
    console.error('[Agent] stream error:', error);
    if (error instanceof Error && (error.message.includes('Recursion limit') || (error as any).lc_error_code === 'GRAPH_RECURSION_LIMIT')) {
      yield { content: 'Task completed. Make a new request for additional changes.', type: 'complete' };
    } else {
      yield { content: 'Error processing request. Please try again.', type: 'error' };
    }
  }
}

export { createAgentWorkflow };
