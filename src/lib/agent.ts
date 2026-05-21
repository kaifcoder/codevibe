/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAgent, dynamicSystemPromptMiddleware, summarizationMiddleware, tool } from 'langchain';
import { ChatAnthropic } from '@langchain/anthropic';
import { Sandbox } from '@e2b/code-interpreter';
import { z } from 'zod';
import { e2bTools } from './e2b-tools';
import { createSystemPrompt as createNextjsPrompt } from './nextjs-agent-prompt';
import { createSystemPrompt as createN8nPrompt } from './n8n-agent-prompt';
import { getSandbox } from './sandbox-utils';
import {
  registerSandbox,
  getThreadSandbox,
  resolveTemplateType,
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
    if (existing) {
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
    const sessionTemplate = resolveTemplateType(runtime.configurable?.templateType);

    if (threadId) {
      const existing = getThreadSandbox(threadId);
      if (existing) {
        return buildPrompt(existing.templateType, existing.sandboxId, existing.sandboxUrl);
      }
    }
    return buildPrompt(sessionTemplate);
  }
);

// ─── Default exported agent (for langgraph.json) ────────────────────────────

export const agent = createAgent({
  model,
  tools: [createSandboxTool, ...e2bTools],
  middleware: [
    sandboxAwarePrompt,
    summarizationMiddleware({
      model,
      trigger: { tokens: 80000 },
      keep: { messages: 12 },
    }),
  ],
  version: 'v1',
}).withConfig({ recursionLimit: 80 });
