/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  createAgent,
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
import { createSystemPrompt as createNextjsPrompt } from './nextjs-agent-prompt';
import { createSystemPrompt as createN8nPrompt } from './n8n-agent-prompt';
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

const model = new ChatAnthropic({
  model: 'claude-sonnet-4-5',
  apiKey: 'test-key-1',
  clientOptions: {
    baseURL: 'http://0.0.0.0:3030',
  ...(process.env.DOCKER_CONTAINER === 'true'
    ? { baseURL: 'http://host.docker.internal:3030' }
    : {}),
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
        .enum(['nextjs', 'n8n'])
        .describe('"nextjs" for web apps/UIs; "n8n" for workflow automations.'),
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

    const existing = getThreadSandbox(threadId);
    if (existing?.sandboxId) {
      const sbx = await getSandbox(existing.sandboxId);
      if (sbx) {
        config.writer?.({ type: 'sandboxCreated', sandboxId: existing.sandboxId, sandboxUrl: existing.sandboxUrl, isNew: false });
        return `Sandbox already exists: ${existing.sandboxId} at ${existing.sandboxUrl} (template: ${existing.templateType}). Use e2b tools directly.`;
      }
    }

    const cfg = TEMPLATE_CONFIG[requested];
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
        .enum(['nextjs', 'n8n'])
        .optional()
        .describe('Which sandbox image to provision. Defaults to the session\'s configured template.'),
    }),
  }
);

// ─── Dynamic System Prompt ──────────────────────────────────────────────────

function buildPrompt(templateType: TemplateType, sbxId?: string, sandboxUrl?: string): string {
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

// Load n8n-mcp tools at module init. Failure returns []; the n8n flow degrades
// to plain curl-via-shell rather than crashing the whole agent server.
const n8nMcpTools = await createN8nMCPTools();

export const agent = createAgent({
  model,
  tools: [setTemplateTool, createSandboxTool, ...e2bTools, ...n8nMcpTools],
  middleware: [
    sandboxAwarePrompt,
    humanInTheLoopMiddleware({
      interruptOn: {
        set_template: {
          allowedDecisions: ['approve', 'edit'],
          description: (toolCall) => {
            const args = toolCall.args as { templateType?: string; reasoning?: string };
            const pick = args.templateType ?? 'nextjs';
            const why = args.reasoning ? ` — ${args.reasoning}` : '';
            return `I'll build this as a **${pick}** ${pick === 'n8n' ? 'workflow' : 'web app'}${why}. Approve to proceed, or edit to switch templates.`;
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
