import {
  createAgent,
  createMiddleware,
  dynamicSystemPromptMiddleware,
  humanInTheLoopMiddleware,
  summarizationMiddleware,
  tool,
} from 'langchain';
import { ChatBedrockConverse } from '@langchain/aws';
import { z } from 'zod';
import { e2bTools } from './e2b-tools';
import { createN8nMCPTools } from './mcp-client';
import {
  buildUserMcpToolsFromConfigs,
  type UserMcpServerConfig,
} from './agent-only/user-mcp-tools';
import { createSystemPrompt as createNextjsPrompt } from './nextjs-agent-prompt';
import { createSystemPrompt as createN8nPrompt } from './n8n-agent-prompt';
import { createChatPrompt } from './chat-agent-prompt';
import { createDispatcherPrompt } from './dispatcher-agent-prompt';
import {
  getThreadSandbox,
  hydrateThreadTemplate,
  resolveTemplateType,
  setThreadTemplate,
  type TemplateType,
} from './sandbox-registry';
import { usageTrackingMiddleware } from './usage-tracking';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';

// ─── Model ───────────────────────────────────────────────────────────────────

// Kimi K2.5 (Moonshot) via AWS Bedrock. Strong tool-use training makes it the
// best price/quality point on Bedrock for codevibe's agent workload — ~6×
// cheaper than Claude Sonnet 4.5 with quality that's close enough for the
// launch phase. Indian payment-instrument restrictions on AWS Marketplace
// don't affect Moonshot models, so this works on the existing $179 of credits
// where Anthropic models don't.
//
// Cost-tuned defaults:
//   - maxTokens: 4000 — typical agent turns generate 200–2000 output tokens.
//   - recursionLimit: 60 (set on the agent below) — guards against the
//     occasional tool-call loop. Kimi loops less than DeepSeek but still
//     occasionally over-fetches; recursion cap is the safety net.
//   - summarization trigger: 50000 — compact context before the prompt prefix
//     grows unbounded across long sessions.
const model = new ChatBedrockConverse({
  model: process.env.BEDROCK_MODEL_ID ?? 'moonshotai.kimi-k2.5',
  region: process.env.AWS_REGION ?? 'ap-south-1',
  maxTokens: 4000
});

// ─── Set Template Tool (HITL-gated dispatcher decision) ────────────────────

const setTemplateTool = tool(
  async (
    { templateType, reasoning }: { templateType: TemplateType; reasoning?: string },
    config: LangGraphRunnableConfig,
  ) => {
    const threadId = config.configurable?.thread_id as string | undefined;
    const resolved = resolveTemplateType(templateType);

    if (threadId) {
      setThreadTemplate(threadId, resolved);
    }

    config.writer?.({ type: 'templateDecided', templateType: resolved, reasoning });

    return `Template set to "${resolved}". Now switch to building per the ${resolved} system prompt.`;
  },
  {
    name: 'set_template',
    description: 'Pick the sandbox template for this session. Call exactly once on the first turn after classifying the user request. The user must confirm before this takes effect.',
    schema: z.object({
      templateType: z
        .enum(['nextjs', 'n8n', 'chat'])
        .describe('"nextjs" for web apps/UIs; "n8n" for workflow automations; "chat" for pure Q&A / lookup with no sandbox.'),
      reasoning: z
        .string()
        .optional()
        .describe('One short sentence explaining the classification.'),
    }),
  },
);

// ─── Dynamic System Prompt ──────────────────────────────────────────────────

// Inject the calling user's MCP tools at model-call time. Server configs
// arrive from Next.js via config.configurable.userMcpServers (no secrets);
// the agent fetches access tokens from Next.js's internal credentials route
// when actually invoking a tool. Cached per (userId, signature) for 5min.
async function loadUserToolsFromRuntime(
  cfg: Record<string, unknown> | undefined,
): Promise<unknown[]> {
  const userId = cfg?.userId as string | undefined;
  const userMcpServers = (cfg?.userMcpServers ?? []) as UserMcpServerConfig[];
  if (!userId || userMcpServers.length === 0) return [];
  const appUrl =
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://host.docker.internal:3000';
  const internalSecret = process.env.INTERNAL_AGENT_SECRET;
  if (!internalSecret) {
    console.error('[userMcpTools] INTERNAL_AGENT_SECRET is not set; skipping user MCP tools');
    return [];
  }
  try {
    return await buildUserMcpToolsFromConfigs(userMcpServers, {
      userId,
      appUrl,
      internalSecret,
    });
  } catch (err) {
    console.error('[userMcpTools] failed to load user tools:', err);
    return [];
  }
}

const userMcpToolsMiddleware = createMiddleware({
  name: 'userMcpTools',
  wrapModelCall: async (request, handler) => {
    const cfg = request.runtime?.configurable as Record<string, unknown> | undefined;
    const userTools = await loadUserToolsFromRuntime(cfg);
    if (userTools.length === 0) return handler(request);
    return handler({ ...request, tools: [...request.tools, ...userTools] as typeof request.tools });
  },
  // Required when wrapModelCall introduces new tools that aren't part of the
  // agent's static `tools` list. The framework can't resolve them by name on
  // its own, so we supply the matching tool object here.
  wrapToolCall: async (request, handler) => {
    if (request.tool) return handler(request);
    const cfg = request.runtime?.configurable as Record<string, unknown> | undefined;
    const userTools = await loadUserToolsFromRuntime(cfg);
    const match = (userTools as Array<{ name: string }>).find(
      (t) => t.name === request.toolCall.name,
    );
    if (!match) return handler(request);
    return handler({ ...request, tool: match as unknown as NonNullable<typeof request.tool> });
  },
});

function buildPrompt(templateType: TemplateType, sbxId?: string, sandboxUrl?: string): string {
  if (templateType === 'chat') {
    return createChatPrompt();
  }
  return templateType === 'n8n'
    ? createN8nPrompt(sbxId, sandboxUrl)
    : createNextjsPrompt(sbxId, sandboxUrl);
}

const sandboxAwarePrompt = dynamicSystemPromptMiddleware(
  (_state, runtime) => {
    const threadId = runtime.configurable?.thread_id as string | undefined;
    const configTemplate = resolveTemplateType(runtime.configurable?.templateType);
    const configDecided = Boolean(runtime.configurable?.templateDecided);

    // Hydrate registry from session row on first tool call after process restart
    if (threadId && !getThreadSandbox(threadId)) {
      hydrateThreadTemplate(threadId, configTemplate, configDecided);
    }

    const entry = threadId ? getThreadSandbox(threadId) : null;
    const decided = entry ? entry.templateDecided : configDecided;
    const templateType = entry?.templateType ?? configTemplate;

    if (!decided) {
      return createDispatcherPrompt();
    }

    return buildPrompt(templateType, entry?.sandboxId, entry?.sandboxUrl);
  }
);

// ─── Default exported agent (for langgraph.json) ────────────────────────────

// Lazy-load n8n-mcp tools on first use instead of at module init. The n8n-mcp
// stdio subprocess does a SQLite warmup that can stall graph resolution past
// langgraph's startup window — blocking the JS process from reporting ready,
// which makes Render's port detector kill the container. Loading on first
// model call defers that work until after the server is healthy.
//
// We DO kick off the load asynchronously at module init (without awaiting)
// so the first n8n turn doesn't pay the 3-5s SQLite warmup at user wait time.
// The eager call hits getN8nTools()'s in-flight promise; lazy callers either
// resolve immediately (warm) or await the same promise (still warming).
let n8nToolsPromise: Promise<unknown[]> | null = null;
function getN8nTools(): Promise<unknown[]> {
  if (!n8nToolsPromise) {
    n8nToolsPromise = createN8nMCPTools().catch((err) => {
      console.error('[n8nMcpTools] load failed; n8n flow degrades to shell:', err);
      n8nToolsPromise = null;
      return [];
    }) as Promise<unknown[]>;
  }
  return n8nToolsPromise;
}

// Fire-and-forget pre-warm. Schedules the n8n-mcp stdio subprocess to spin up
// shortly after the agent server reports ready — so the first n8n turn finds
// tools already loaded instead of paying the warmup cost at the user's wait.
// setTimeout(0) defers past the langgraph startup health check.
setTimeout(() => {
  getN8nTools().catch(() => {
    /* error already logged inside getN8nTools */
  });
}, 0);

const n8nMcpToolsMiddleware = createMiddleware({
  name: 'n8nMcpTools',
  wrapModelCall: async (request, handler) => {
    const tools = await getN8nTools();
    if (tools.length === 0) return handler(request);
    return handler({ ...request, tools: [...request.tools, ...tools] as typeof request.tools });
  },
  wrapToolCall: async (request, handler) => {
    if (request.tool) return handler(request);
    const tools = (await getN8nTools()) as Array<{ name: string }>;
    const match = tools.find((t) => t.name === request.toolCall.name);
    if (!match) return handler(request);
    return handler({ ...request, tool: match as unknown as NonNullable<typeof request.tool> });
  },
});

export const agent = createAgent({
  model,
  // create_sandbox is intentionally not exposed: resolveSandbox() in e2b-tools
  // auto-provisions on the first e2b_* call AND adopts the frontend-forwarded
  // sandboxId from rewarm. Exposing it lets the model spin up a duplicate
  // sandbox even though prompts say "NEVER call create_sandbox".
  tools: [setTemplateTool, ...e2bTools],
  middleware: [
    sandboxAwarePrompt,
    usageTrackingMiddleware,
    n8nMcpToolsMiddleware,
    userMcpToolsMiddleware,
    humanInTheLoopMiddleware({
      interruptOn: {
        set_template: {
          allowedDecisions: ['approve', 'edit'],
          description: (toolCall) => {
            const args = toolCall.args as { templateType?: string; reasoning?: string };
            const pick = args.templateType ?? 'nextjs';
            const why = args.reasoning ? ` — ${args.reasoning}` : '';
            const label =
              pick === 'n8n'
                ? '**n8n** workflow'
                : pick === 'chat'
                  ? '**chat** (Q&A only, no sandbox)'
                  : '**nextjs** web app';
            return `I'll handle this as ${label}${why}. Approve to proceed, or edit to switch modes.`;
          },
        },
      },
    }),
    summarizationMiddleware({
      model,
      trigger: { tokens: 50000 },
      keep: { messages: 12 },
    }),
  ],
  version: 'v1',
}).withConfig({ recursionLimit: 60 });
