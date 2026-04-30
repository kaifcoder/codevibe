/* eslint-disable @typescript-eslint/no-explicit-any */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { createAgent, dynamicSystemPromptMiddleware, summarizationMiddleware, tool } from 'langchain';
import { ChatAnthropic } from '@langchain/anthropic';
import { Sandbox } from '@e2b/code-interpreter';
import { z } from 'zod';
import { e2bTools } from './e2b-tools';
import { createSystemPrompt } from './nextjs-agent-prompt';
import { getSandbox } from './sandbox-utils';
import { registerSandbox, getThreadSandbox } from './sandbox-registry';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';

// ─── Model ───────────────────────────────────────────────────────────────────

const model = new ChatAnthropic({
  model: 'claude-sonnet-4-5',
  apiKey: 'test-key-1',
  clientOptions: {
    baseURL: 'http://0.0.0.0:3030',
  },
  maxTokens: 16000,
  thinking: {
    type: 'enabled',
    budget_tokens: 5000,
  },
});

// ─── PostgreSQL Checkpointer (singleton) ────────────────────────────────────

const CHECKPOINTER_KEY = Symbol.for('codevibe.checkpointer');

async function getCheckpointer(): Promise<PostgresSaver> {
  if (!(globalThis as any)[CHECKPOINTER_KEY]) {
    const connectionString = process.env.DATABASE_URL!;
    const checkpointer = PostgresSaver.fromConnString(connectionString);
    await checkpointer.setup();
    (globalThis as any)[CHECKPOINTER_KEY] = checkpointer;
  }
  return (globalThis as any)[CHECKPOINTER_KEY];
}

// ─── Create Sandbox Tool (legacy - sandbox auto-creates via e2b tools) ─────

const createSandboxTool = tool(
  async (_input: Record<string, never>, config: LangGraphRunnableConfig) => {
    const threadId = config.configurable?.thread_id as string;

    const existing = getThreadSandbox(threadId);
    if (existing) {
      const sbx = await getSandbox(existing.sandboxId);
      if (sbx) {
        config.writer?.({ type: 'sandboxCreated', sandboxId: existing.sandboxId, sandboxUrl: existing.sandboxUrl, isNew: false });
        return `Sandbox already exists: ${existing.sandboxId} at ${existing.sandboxUrl}. Use e2b tools directly.`;
      }
    }

    const sbx = await Sandbox.create('codevibe-test', { timeoutMs: 25 * 60 * 1000 });
    const host = sbx.getHost(3000);
    const sandboxUrl = `https://${host}`;

    registerSandbox(threadId, sbx.sandboxId, sandboxUrl);

    config.writer?.({ type: 'sandboxCreated', sandboxId: sbx.sandboxId, sandboxUrl, isNew: true });

    return `Sandbox created: ${sbx.sandboxId} at ${sandboxUrl}. You can now use e2b tools to write files.`;
  },
  {
    name: 'create_sandbox',
    description: 'You do NOT need to call this — sandboxes are created automatically by e2b tools. Only use if explicitly asked to reset the sandbox.',
    schema: z.object({}),
  }
);

// ─── Dynamic System Prompt ──────────────────────────────────────────────────

const sandboxAwarePrompt = dynamicSystemPromptMiddleware(
  (_state, runtime) => {
    const threadId = runtime.configurable?.thread_id as string | undefined;
    if (threadId) {
      const existing = getThreadSandbox(threadId);
      if (existing) {
        return createSystemPrompt(existing.sandboxId, existing.sandboxUrl);
      }
    }
    return createSystemPrompt();
  }
);

// ─── Default exported agent (for langgraph.json) ────────────────────────────

const checkpointer = await getCheckpointer();

export const agent = createAgent({
  model,
  tools: [createSandboxTool, ...e2bTools],
  checkpointer,
  middleware: [
    sandboxAwarePrompt,
    summarizationMiddleware({
      model,
      trigger: { tokens: 12000 },
      keep: { messages: 6 },
    }),
  ],
  version: 'v1',
}).withConfig({ recursionLimit: 80 });
