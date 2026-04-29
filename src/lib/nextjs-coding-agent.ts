/* eslint-disable @typescript-eslint/no-explicit-any */
import { MemorySaver } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { AzureOpenAiChatClient } from '@sap-ai-sdk/langchain';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage, trimMessages } from '@langchain/core/messages';
import { makeE2BTools } from './e2b-tools';
import { createSystemPrompt } from './nextjs-agent-prompt';
import { createPlaywrightMCPTools, createNextJsDocsMCPTools } from './mcp-client';
import { memoryTools } from './agent-memory';
import { globalEventEmitter } from './event-emitter';

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

let textAgentCache: any = null;

function buildTools(sbxId?: string, sessionId?: string): any[] {
  const tools: any[] = [...memoryTools];
  if (nextjsDocsToolsCache) tools.push(...nextjsDocsToolsCache);
  if (sbxId) tools.push(...makeE2BTools(sbxId, sessionId));
  if (playwrightToolsCache) tools.push(...playwrightToolsCache);
  return tools;
}

async function createAgentWorkflow(sbxId?: string, sessionId?: string, sandboxUrl?: string) {
  await initializeMCPTools();

  const prompt = (state: any) => {
    const systemMsg = createSystemPrompt(sbxId, sandboxUrl);
    return [systemMsg, ...state.messages];
  };

  if (sbxId) {
    const tools = buildTools(sbxId, sessionId);
    return createReactAgent({
      llm: model,
      tools,
      prompt,
      checkpointer: new MemorySaver(),
    });
  }

  if (textAgentCache) return textAgentCache;

  const tools = buildTools();
  textAgentCache = createReactAgent({
    llm: model,
    tools,
    prompt,
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

// ─── Token Counter ──────────────────────────────────────────────────────────

function estimateTokens(messages: any[]): number {
  let total = 0;
  for (const msg of messages) {
    const content = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content || '');
    total += Math.ceil(content.length / 4);
  }
  return total;
}

// ─── File Content Streamer ──────────────────────────────────────────────────

class FileContentStreamer {
  private activeToolCalls = new Map<string, { toolName: string; argsBuffer: string; filePath: string | null; contentStartIdx: number; lastEmittedIdx: number }>();
  private sessionId: string | undefined;

  constructor(sessionId?: string) {
    this.sessionId = sessionId;
  }

  handleToolCallChunk(chunk: { id?: string; name?: string; args?: string; index?: number }) {
    const id = chunk.id || chunk.index?.toString() || 'default';

    if (chunk.name) {
      this.activeToolCalls.set(id, {
        toolName: chunk.name,
        argsBuffer: chunk.args || '',
        filePath: null,
        contentStartIdx: -1,
        lastEmittedIdx: -1,
      });
      return;
    }

    const state = this.activeToolCalls.get(id);
    if (!state || state.toolName !== 'e2b_write_file') return;
    if (!chunk.args) return;

    state.argsBuffer += chunk.args;
    this.tryStreamContent(id, state);
  }

  private tryStreamContent(id: string, state: { argsBuffer: string; filePath: string | null; contentStartIdx: number; lastEmittedIdx: number }) {
    if (!this.sessionId) return;

    // Extract path if we haven't yet
    if (!state.filePath) {
      const pathMatch = state.argsBuffer.match(/"path"\s*:\s*"([^"]+)"/);
      if (pathMatch) {
        state.filePath = pathMatch[1];
        globalEventEmitter.emit('agent:codePatch', {
          sessionId: this.sessionId,
          filePath: state.filePath,
          action: 'streaming_start',
        });
      }
    }

    if (!state.filePath) return;

    // Find where content value starts
    if (state.contentStartIdx === -1) {
      const contentKeyMatch = state.argsBuffer.match(/"content"\s*:\s*"/);
      if (contentKeyMatch && contentKeyMatch.index !== undefined) {
        state.contentStartIdx = contentKeyMatch.index + contentKeyMatch[0].length;
        state.lastEmittedIdx = state.contentStartIdx;
      }
    }

    if (state.contentStartIdx === -1) return;

    // Extract new content since last emission (decode JSON escape sequences)
    const rawSlice = state.argsBuffer.slice(state.lastEmittedIdx);
    if (rawSlice.length < 80) return; // batch small chunks for fewer renders

    // Find a safe boundary (avoid cutting in middle of escape sequence)
    let safeEnd = rawSlice.length;
    for (let i = rawSlice.length - 1; i >= Math.max(0, rawSlice.length - 6); i--) {
      if (rawSlice[i] === '\\') {
        safeEnd = i;
        break;
      }
    }
    if (safeEnd === 0) return;

    const chunk = rawSlice.slice(0, safeEnd);
    const decoded = decodeJsonString(chunk);

    if (decoded) {
      state.lastEmittedIdx += safeEnd;
      globalEventEmitter.emit('agent:codePatch', {
        sessionId: this.sessionId,
        filePath: state.filePath,
        content: decoded,
        action: 'streaming_chunk',
      });
    }
  }

  // Flush remaining content and mark complete
  flush(id?: string) {
    if (!this.sessionId) return;

    for (const [callId, state] of this.activeToolCalls) {
      if (id && callId !== id) continue;
      if (state.toolName !== 'e2b_write_file' || !state.filePath) continue;

      // Emit any remaining buffered content
      if (state.contentStartIdx !== -1 && state.lastEmittedIdx < state.argsBuffer.length) {
        let remaining = state.argsBuffer.slice(state.lastEmittedIdx);
        // Strip trailing `"}` or `"}\n` from end of JSON
        remaining = remaining.replace(/"\s*\}\s*$/, '');
        const decoded = decodeJsonString(remaining);
        if (decoded) {
          globalEventEmitter.emit('agent:codePatch', {
            sessionId: this.sessionId,
            filePath: state.filePath,
            content: decoded,
            action: 'streaming_chunk',
          });
        }
      }

      globalEventEmitter.emit('agent:codePatch', {
        sessionId: this.sessionId,
        filePath: state.filePath,
        action: 'streaming_end',
      });
    }

    if (id) this.activeToolCalls.delete(id);
    else this.activeToolCalls.clear();
  }
}

function decodeJsonString(raw: string): string | null {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    // Fallback: basic unescape for partial strings
    return raw
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function* streamNextJsAgent(
  userPrompt: string,
  sbxId?: string,
  prevMessages: MessageArray = [],
  sessionId?: string,
  sandboxUrl?: string
): AsyncGenerator<StreamResponse, void, unknown> {
  if (!userPrompt) {
    yield { content: 'User prompt cannot be empty', type: 'error' };
    return;
  }

  try {
    const app = await createAgentWorkflow(sbxId, sessionId, sandboxUrl);
    const config = {
      configurable: { thread_id: sbxId ? `session-${sbxId}` : 'text-session' },
      recursionLimit: 40,
      streamMode: ['messages', 'custom'] as const,
    };

    const trimmed = await trimMessages(prevMessages, {
      maxTokens: 12000,
      tokenCounter: estimateTokens,
      strategy: 'last',
      startOn: 'human',
      includeSystem: true,
    });

    const messages = [...trimmed, new HumanMessage(userPrompt)];
    const stream = await app.stream({ messages }, config);
    const fileStreamer = new FileContentStreamer(sessionId);

    for await (const chunk of stream) {
      const [mode, data] = chunk as [string, any];

      if (mode === 'messages') {
        const [messageChunk, metadata] = data;

        // Stream AI text tokens
        if (
          messageChunk.content &&
          typeof messageChunk.content === 'string' &&
          metadata?.langgraph_node === 'agent'
        ) {
          yield { content: messageChunk.content, type: 'partial' };
        }

        // Process tool call chunks for progressive file streaming
        if (messageChunk.tool_call_chunks?.length > 0) {
          for (const toolChunk of messageChunk.tool_call_chunks) {
            fileStreamer.handleToolCallChunk(toolChunk);

            if (toolChunk.name) {
              yield {
                content: `Using tool: ${toolChunk.name}`,
                type: 'tool_call',
                tool_call_output: { tool: toolChunk.name, status: 'running' }
              };
            }
          }
        }

        // When tool node emits a ToolMessage, flush the file streamer
        if (metadata?.langgraph_node === 'tools' && messageChunk.name === 'e2b_write_file') {
          fileStreamer.flush();
        }
      } else if (mode === 'custom') {
        if (data?.type === 'tool_progress') {
          yield {
            content: data.tool,
            type: 'tool_call',
            tool_call_output: { tool: data.tool, args: data.args, result: data.message, status: data.status || 'running' }
          };
        } else if (data?.type === 'tool_result') {
          yield {
            content: data.tool,
            type: 'tool_call',
            tool_call_output: { tool: data.tool, args: data.args, result: data.result, status: 'complete' }
          };
        }
      }
    }

    fileStreamer.flush();
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
