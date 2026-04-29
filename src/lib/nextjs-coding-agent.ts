/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  StateGraph,
  MessagesAnnotation,
  MemorySaver,
  Command,
  START,
  END,
  Annotation,
} from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { AzureOpenAiChatClient } from '@sap-ai-sdk/langchain';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage, BaseMessage } from '@langchain/core/messages';
import { makeE2BTools } from './e2b-tools';
import { createSystemPrompt } from './nextjs-agent-prompt';
import { createPlaywrightMCPTools, createNextJsDocsMCPTools } from './mcp-client';
import { memoryTools } from './agent-memory';

// ─── Model Setup ─────────────────────────────────────────────────────────────

const model = new AzureOpenAiChatClient({
  modelName: 'gpt-5',
  modelVersion: '2025-08-07',
  temperature: 1,
});

// ─── MCP Tool Initialization ─────────────────────────────────────────────────

let nextjsDocsToolsCache: any[] | null = null;
let playwrightToolsCache: any[] | null = null;
let mcpToolsInitialized = false;

async function initializeMCPTools() {
  if (mcpToolsInitialized) return;

  try {
    const startTime = Date.now();
    const [nextjsTools, playwrightTools] = await Promise.all([
      createNextJsDocsMCPTools().catch(err => {
        console.error('[MCP] Failed to init Next.js docs:', err.message);
        return [];
      }),
      createPlaywrightMCPTools().catch(err => {
        console.error('[MCP] Failed to init Playwright:', err.message);
        return [];
      })
    ]);

    nextjsDocsToolsCache = nextjsTools;
    playwrightToolsCache = playwrightTools;
    mcpToolsInitialized = true;
    console.log(`[MCP] Initialized ${nextjsTools.length + playwrightTools.length} tools in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error('[MCP] Initialization failed:', error);
    mcpToolsInitialized = true;
  }
}

// ─── Multi-Agent State ───────────────────────────────────────────────────────

const MultiAgentState = Annotation.Root({
  messages: MessagesAnnotation.spec.messages,
  nextAgent: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  iterationCount: Annotation<number>({ reducer: (_, v) => v, default: () => 0 }),
});

type MultiAgentStateType = typeof MultiAgentState.State;

// ─── Agent Builders ──────────────────────────────────────────────────────────

function buildCoderAgent(sbxId: string, sessionId?: string) {
  const tools = makeE2BTools(sbxId, sessionId);
  return createReactAgent({
    llm: model,
    tools,
    prompt: `You are the Coder agent. Your job is to write, read, and modify files in the sandbox.

Rules:
- Write complete file contents (no partial patches)
- Read a file before modifying it to avoid losing existing code
- Use relative paths: app/page.tsx, components/Header.tsx, lib/utils.ts
- NEVER use absolute paths like /home/user/app/...
- Add "use client" directive if using React hooks
- Import Shadcn components from their individual files: import { Button } from "@/components/ui/button"
- Use Tailwind CSS for all styling
- After writing files, respond with a brief summary of what you did`,
  });
}

function buildBrowserAgent() {
  const tools = playwrightToolsCache || [];
  if (tools.length === 0) return null;

  return createReactAgent({
    llm: model,
    tools,
    prompt: `You are the Browser agent. Your job is to test and debug web pages using Playwright.

Rules:
- Navigate to the provided sandbox URL to test the app
- Take screenshots to verify the UI renders correctly
- If you find errors (blank page, console errors, broken layout), describe them clearly
- Click elements to test interactivity when relevant
- Never mention to the user that you are using Playwright or a browser — just report findings
- Keep responses brief: what worked, what's broken, suggested fix`,
  });
}

function buildResearcherAgent() {
  const tools = [
    ...(nextjsDocsToolsCache || []),
    ...memoryTools,
  ];

  return createReactAgent({
    llm: model,
    tools,
    prompt: `You are the Researcher agent. Your job is to look up documentation and manage session memory.

Rules:
- Use Next.js docs tools to find accurate API usage, component patterns, and configuration
- Save useful context to session memory for future reference
- When looking up docs, provide the specific code pattern or configuration needed
- Keep responses concise and code-focused — no lengthy explanations
- If you can answer from general knowledge without docs lookup, do so briefly`,
  });
}

// ─── Supervisor Node ─────────────────────────────────────────────────────────

const SUPERVISOR_PROMPT = `You are the Supervisor agent coordinating a team of specialists:

**coder** — Writes, reads, and modifies files in the sandbox. Use for any code generation or editing.
**browser** — Tests the running app via Playwright. Use to verify UI renders correctly or debug visual issues.
**researcher** — Looks up Next.js documentation and manages memory. Use when you need API references.
**FINISH** — The task is complete. Use when the user's request has been fully addressed.

Your job:
1. Analyze the user's request and conversation history
2. Decide which agent to delegate to next (or FINISH if done)
3. Provide clear instructions to the chosen agent

Routing rules:
- For code generation/editing tasks: route to "coder"
- After coder writes code, if user mentioned testing or there might be issues: route to "browser"
- For API questions or "how to" queries where docs would help: route to "researcher"
- For simple text questions (explain, what is, why): respond directly and route to "FINISH"
- If the last agent completed its task successfully: route to "FINISH"
- Maximum 5 iterations before forcing FINISH

Respond with EXACTLY this format:
NEXT: <agent_name>
INSTRUCTION: <what the agent should do>

Or for direct responses:
NEXT: FINISH
RESPONSE: <your direct answer to the user>`;

function parseSupervisorResponse(content: string): { next: string; instruction: string } {
  const nextMatch = content.match(/NEXT:\s*(coder|browser|researcher|FINISH)/i);
  const instructionMatch = content.match(/INSTRUCTION:\s*([\s\S]*?)(?:$|\nNEXT:)/i);
  const responseMatch = content.match(/RESPONSE:\s*([\s\S]*?)$/i);

  const next = nextMatch?.[1]?.toLowerCase() || 'FINISH';
  const instruction = instructionMatch?.[1]?.trim() || responseMatch?.[1]?.trim() || '';

  return { next, instruction };
}

// ─── Multi-Agent Graph Compilation ───────────────────────────────────────────

function compileMultiAgentGraph(sbxId: string, sessionId?: string, sandboxUrl?: string) {
  const coderAgent = buildCoderAgent(sbxId, sessionId);
  const browserAgent = buildBrowserAgent();
  const researcherAgent = buildResearcherAgent();

  const MAX_ITERATIONS = 8;

  // Supervisor node: routes to the appropriate specialist
  async function supervisor(state: MultiAgentStateType): Promise<Command> {
    const iteration = state.iterationCount;

    if (iteration >= MAX_ITERATIONS) {
      return new Command({
        update: {
          messages: [new AIMessage('Task completed.')],
          nextAgent: 'FINISH',
          iterationCount: iteration,
        },
        goto: END,
      });
    }

    const supervisorMessages = [
      new SystemMessage(SUPERVISOR_PROMPT),
      ...state.messages,
    ];

    try {
      const response = await model.invoke(supervisorMessages);
      const content = typeof response.content === 'string' ? response.content : '';
      const { next, instruction } = parseSupervisorResponse(content);

      if (next === 'finish' || next === 'FINISH') {
        // Supervisor is responding directly
        const finalResponse = instruction || content.replace(/NEXT:\s*FINISH\s*/i, '').replace(/RESPONSE:\s*/i, '').trim();
        return new Command({
          update: {
            messages: finalResponse ? [new AIMessage(finalResponse)] : [],
            nextAgent: 'FINISH',
            iterationCount: iteration + 1,
          },
          goto: END,
        });
      }

      // Route to specialist with instruction
      const routeMessage = instruction
        ? new HumanMessage(`[Supervisor instruction]: ${instruction}`)
        : undefined;

      return new Command({
        update: {
          messages: routeMessage ? [routeMessage] : [],
          nextAgent: next,
          iterationCount: iteration + 1,
        },
        goto: next,
      });
    } catch (error) {
      console.error('[Supervisor] Error:', error);
      return new Command({
        update: {
          messages: [new AIMessage('Error in routing. Completing task.')],
          nextAgent: 'FINISH',
          iterationCount: iteration + 1,
        },
        goto: END,
      });
    }
  }

  // Specialist node wrapper: runs the sub-agent and returns to supervisor
  function makeSpecialistNode(agent: any, name: string) {
    return async (state: MultiAgentStateType): Promise<Command> => {
      try {
        // Build input messages: system prompt + conversation + last instruction
        const systemPrompt = createSystemPrompt(sbxId, sandboxUrl);
        const input = { messages: [systemPrompt, ...state.messages] };
        const config = { recursionLimit: 25 };

        const result = await agent.invoke(input, config);

        // Extract the final AI response from the sub-agent
        const agentMessages: BaseMessage[] = result.messages || [];
        const lastAI = agentMessages
          .filter((m: BaseMessage) => m instanceof AIMessage)
          .pop();

        const responseMsg = lastAI
          ? new AIMessage({ content: lastAI.content, name })
          : new AIMessage({ content: `${name} completed without output.`, name });

        return new Command({
          update: { messages: [responseMsg] },
          goto: 'supervisor',
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[${name}] Error:`, errMsg);

        // On recursion limit, treat as success with partial result
        if (errMsg.includes('Recursion limit') || (error as any)?.lc_error_code === 'GRAPH_RECURSION_LIMIT') {
          return new Command({
            update: {
              messages: [new AIMessage({ content: `${name} completed its work.`, name })],
            },
            goto: 'supervisor',
          });
        }

        return new Command({
          update: {
            messages: [new AIMessage({ content: `${name} encountered an error: ${errMsg}`, name })],
          },
          goto: 'supervisor',
        });
      }
    };
  }

  // Build the graph
  const builder = new StateGraph(MultiAgentState)
    .addNode('supervisor', supervisor, { ends: ['coder', 'browser', 'researcher', END] })
    .addNode('coder', makeSpecialistNode(coderAgent, 'coder'), { ends: ['supervisor'] })
    .addNode('researcher', makeSpecialistNode(researcherAgent, 'researcher'), { ends: ['supervisor'] })
    .addEdge(START, 'supervisor');

  // Only add browser node if Playwright tools are available
  if (browserAgent) {
    builder.addNode('browser', makeSpecialistNode(browserAgent, 'browser'), { ends: ['supervisor'] });
  }

  return builder.compile({ checkpointer: new MemorySaver() });
}

// ─── Single-Agent Fallback (no sandbox) ──────────────────────────────────────

function compileSingleAgentGraph(enableMCP: boolean) {
  const tools: any[] = [...memoryTools];
  if (nextjsDocsToolsCache) tools.push(...nextjsDocsToolsCache);
  if (enableMCP && playwrightToolsCache) tools.push(...playwrightToolsCache);

  return createReactAgent({
    llm: model,
    tools,
    prompt: `You are an expert Next.js coding assistant. Answer questions concisely.
For informational queries (what/why/how/explain), respond with text only.
For code questions, provide brief code examples.
Use session memory tools to remember context across messages.`,
    checkpointer: new MemorySaver(),
  });
}

// ─── Workflow Factory ────────────────────────────────────────────────────────

let singleAgentCache: { graph: any; enableMCP: boolean } | null = null;

async function createAgentWorkflow(sbxId?: string, enableMCP: boolean = true, sessionId?: string, sandboxUrl?: string) {
  await initializeMCPTools();

  // Multi-agent for sandbox sessions
  if (sbxId) {
    return compileMultiAgentGraph(sbxId, sessionId, sandboxUrl);
  }

  // Single-agent for text-only sessions (cached)
  if (singleAgentCache && singleAgentCache.enableMCP === enableMCP) {
    return singleAgentCache.graph;
  }

  const graph = compileSingleAgentGraph(enableMCP);
  singleAgentCache = { graph, enableMCP };
  return graph;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type MessageArray = (SystemMessage | HumanMessage | AIMessage | ToolMessage)[];

type StreamResponse = {
  content: string;
  type: 'partial' | 'complete' | 'error' | 'tool_call';
  tool_call_output?: any;
};

// ─── Message Compaction ──────────────────────────────────────────────────────

function compactPrevMessages(
  prevMessages: MessageArray = [],
  options?: { maxMessages?: number; maxContentLen?: number }
): MessageArray {
  const maxMessages = options?.maxMessages ?? 10;
  const maxContentLen = options?.maxContentLen ?? 1200;
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
      return `- ${role}: ${text.slice(0, 240).replaceAll(/\s+/g, ' ').trim()}`;
    });

  const summaryText = `Previous context summary (${older.length} messages):\n${summaryParts.join('\n')}`;
  return [new SystemMessage(summaryText), ...recent];
}

// ─── Stream Helpers ──────────────────────────────────────────────────────────

async function* typewriterEffect(content: string): AsyncGenerator<StreamResponse, void, unknown> {
  const chunkSize = 150;
  for (let i = 0; i < content.length; i += chunkSize) {
    yield { content: content.slice(i, i + chunkSize), type: 'partial' };
  }
}

function extractReasoningAndResponse(content: string): { reasoning?: string; response: string } {
  const thinkingPatterns = [
    /^(?:Let me |I'll |I will |I need to |First,?\s+I |To answer this|Looking at|Based on |Analyzing )/i,
    /^(?:Step \d+:|Thought:|Analysis:|Planning:|Reasoning:)/i,
    /^(?:Thinking:|Approach:|Strategy:)/i,
  ];

  if (!thinkingPatterns.some(p => p.test(content))) {
    return { response: content };
  }

  const transitionPatterns = [
    /\n\n(?:Here's|Here is|Now,|So,|Therefore,|Based on this,|The answer is|To summarize)/i,
    /\n\n(?:Answer:|Response:|Solution:)/i,
    /\n\n---+\n/,
  ];

  for (const pattern of transitionPatterns) {
    const parts = content.split(pattern);
    if (parts.length >= 2) {
      const reasoning = parts[0].trim();
      const response = parts.slice(1).join('\n\n').trim();
      if (reasoning && response) return { reasoning, response };
    }
  }

  return { response: content };
}

async function* processAgentMessages(messages: any, toolCallArgsMap: Map<string, any>): AsyncGenerator<StreamResponse, void, unknown> {
  const messageArray = Array.isArray(messages) ? messages : [messages];

  for (const message of messageArray) {
    if (message instanceof AIMessage) {
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          const toolCallId = toolCall.id || toolCall.name;
          toolCallArgsMap.set(toolCallId, toolCall.args);
          yield {
            content: `Using tool: ${toolCall.name}`,
            tool_call_output: { tool: toolCall.name, args: toolCall.args, status: 'running' },
            type: 'tool_call'
          };
        }
      } else if (typeof message.content === 'string' && !message.content.startsWith('Audit:')) {
        const { reasoning, response } = extractReasoningAndResponse(message.content);
        if (reasoning) {
          yield { content: reasoning, type: 'partial' as const, tool_call_output: { reasoning } };
        }
        if (response) {
          yield* typewriterEffect(response);
        }
      }
    }
  }
}

async function* processStreamChunk(chunk: any, toolCallArgsMap: Map<string, any>): AsyncGenerator<StreamResponse, void, unknown> {
  // Multi-agent chunks come as { supervisor: ..., coder: ..., browser: ..., researcher: ... }
  // Single-agent chunks come as { agent: ..., tools: ... }
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
        // Skip supervisor routing messages (NEXT: coder, etc.)
        const content = typeof msg.content === 'string' ? msg.content : '';
        if (content.match(/^NEXT:\s*(coder|browser|researcher|FINISH)/i)) continue;
        // Skip internal instruction messages
        if (content.startsWith('[Supervisor instruction]')) continue;
        // Skip empty messages
        if (!content.trim()) continue;

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
        } else {
          const { reasoning, response } = extractReasoningAndResponse(content);
          if (reasoning) {
            yield { content: reasoning, type: 'partial' as const, tool_call_output: { reasoning } };
          }
          if (response) {
            yield* typewriterEffect(response);
          }
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
    recursionLimit: 60,
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
    console.error('[Agent] invokeNextJsAgent error:', error);
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
      recursionLimit: 60,
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
    console.error('[Agent] streamNextJsAgent error:', error);
    if (error instanceof Error && (error.message.includes('Recursion limit') || (error as any).lc_error_code === 'GRAPH_RECURSION_LIMIT')) {
      yield { content: 'Task completed. Make a new request for additional changes.', type: 'complete' };
    } else {
      yield { content: 'Error processing request. Please try again.', type: 'error' };
    }
  }
}

export { createAgentWorkflow };
