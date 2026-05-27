/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  createAgent,
  createMiddleware,
  dynamicSystemPromptMiddleware,
  humanInTheLoopMiddleware,
  summarizationMiddleware,
  tool,
} from 'langchain';
import { ChatAnthropic } from '@langchain/anthropic';
import { Sandbox } from '@e2b/code-interpreter';
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
import { getSandbox } from './sandbox-utils';
import {
  registerSandbox,
  getThreadSandbox,
  hydrateThreadTemplate,
  resolveTemplateType,
  setThreadTemplate,
  TEMPLATE_CONFIG,
  type TemplateType,
} from './sandbox-registry';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';

// ─── Model ───────────────────────────────────────────────────────────────────

// Proxy that brokers LLM calls. Resolution order:
//   1. LLM_PROXY_URL env (production / Render — set per-deployment)
//   2. host.docker.internal when running inside docker-compose locally
//   3. 0.0.0.0 for bare-metal local dev
const llmProxyBaseURL =
  process.env.LLM_PROXY_URL ??
  (process.env.DOCKER_CONTAINER === 'true'
    ? 'http://host.docker.internal:3030'
    : 'http://0.0.0.0:3030');

const model = new ChatAnthropic({
  model: 'claude-sonnet-4-5',
  apiKey: process.env.LLM_PROXY_API_KEY ?? 'test-key-1',
  clientOptions: {
    baseURL: llmProxyBaseURL,
  },
  maxTokens: 16000,
  thinking: {
    type: 'enabled',
    budget_tokens: 5000,
  },
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

// ─── Create Sandbox Tool (legacy - sandbox auto-creates via e2b tools) ─────

const createSandboxTool = tool(
  async (
    { templateType }: { templateType?: TemplateType },
    config: LangGraphRunnableConfig,
  ) => {
    const threadId = config.configurable?.thread_id as string;
    const requested = resolveTemplateType(
      templateType ?? config.configurable?.templateType,
    );
    if (requested === 'chat') {
      return 'Chat mode has no sandbox. Skip create_sandbox and answer the user directly using your other tools.';
    }

    const existing = getThreadSandbox(threadId);
    if (existing?.sandboxId) {
      const sbx = await getSandbox(existing.sandboxId);
      if (sbx) {
        config.writer?.({ type: 'sandboxCreated', sandboxId: existing.sandboxId, sandboxUrl: existing.sandboxUrl, isNew: false });
        return `Sandbox already exists: ${existing.sandboxId} at ${existing.sandboxUrl} (template: ${existing.templateType}). Use e2b tools directly.`;
      }
    }

    const cfg = TEMPLATE_CONFIG[requested as Exclude<TemplateType, 'chat'>];
    const sbx = await Sandbox.create(cfg.alias, { timeoutMs: 25 * 60 * 1000 });
    const host = sbx.getHost(cfg.port);
    const sandboxUrl = `https://${host}`;

    registerSandbox(threadId, sbx.sandboxId, sandboxUrl, requested);

    config.writer?.({ type: 'sandboxCreated', sandboxId: sbx.sandboxId, sandboxUrl, isNew: true });

    return `Sandbox created: ${sbx.sandboxId} at ${sandboxUrl} (template: ${requested}). You can now use e2b tools to write files.`;
  },
  {
    name: 'create_sandbox',
    description: 'You do NOT need to call this — sandboxes are created automatically by e2b tools. Only use if explicitly asked to reset or swap the sandbox template.',
    schema: z.object({
      templateType: z
        .enum(['nextjs', 'n8n', 'chat'])
        .optional()
        .describe('Which sandbox image to provision. Defaults to the session\'s configured template. "chat" mode has no sandbox.'),
    }),
  }
);

// ─── loopback server Connect Tool (OAuth bootstrap) ───────────────────────────────

const LOOPBACK_MCP_URL = '';

const loopbackConnectTool = tool(
  async (_input: Record<string, never>, config: LangGraphRunnableConfig) => {
    const userId = config.configurable?.userId as string | undefined;
    if (!userId) {
      return 'Cannot start loopback server connection: user is not signed in.';
    }
    const userServers = (config.configurable?.userMcpServers ?? []) as UserMcpServerConfig[];
    const loopbackServer = userServers.find((s) => s.url === LOOPBACK_MCP_URL);
    if (!loopbackServer) {
      return 'loopback server is not provisioned for this user yet. Ask the user to open Settings → Apps once so it can be seeded.';
    }
    const authUrl = `/api/mcp/servers/${loopbackServer.id}/auth`;
    config.writer?.({ type: 'requiresMcpAuth', server: 'loopback-mcp', authUrl });
    return 'loopback server is not connected yet. Tell the user to click the "Connect Jira" button shown in the chat to authorize, then ask them to retry their request.';
  },
  {
    name: 'loopback_mcp_connect',
    description: 'Initiate the loopback server OAuth flow when the user asks for Jira data but no loopback_mcp_* tools are available yet. Emits a UI prompt asking the user to authorize. Call once, then stop and wait for the user to retry.',
    schema: z.object({}).describe('No arguments.'),
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

const LOOPBACK_MCP_TOOL_HINT = `

## loopback server Tools

If the user asks about Jira issues / Jira tickets / sprints / boards and you do NOT see any tool names containing \`jira\` (e.g. \`Jira__jira_*\`) in your toolset, the user has not connected loopback server yet. Call \`loopback_mcp_connect\` once, then stop and wait — a "Connect Jira" button will appear in the UI for them to authorize. Do not retry until they confirm they've connected.`;

function buildPrompt(templateType: TemplateType, sbxId?: string, sandboxUrl?: string): string {
  if (templateType === 'chat') {
    // chat-agent-prompt already includes the loopback server hint, so no append.
    return createChatPrompt();
  }
  const base = templateType === 'n8n'
    ? createN8nPrompt(sbxId, sandboxUrl)
    : createNextjsPrompt(sbxId, sandboxUrl);
  return base + LOOPBACK_MCP_TOOL_HINT;
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

// Load n8n-mcp tools at module init. Failure returns []; the n8n flow degrades
// to plain curl-via-shell rather than crashing the whole agent server.
const n8nMcpTools = await createN8nMCPTools();

export const agent = createAgent({
  model,
  tools: [setTemplateTool, createSandboxTool, loopbackConnectTool, ...e2bTools, ...n8nMcpTools],
  middleware: [
    sandboxAwarePrompt,
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
      trigger: { tokens: 80000 },
      keep: { messages: 12 },
    }),
  ],
  version: 'v1',
}).withConfig({ recursionLimit: 200 });
