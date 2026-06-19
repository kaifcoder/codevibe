/* eslint-disable @typescript-eslint/no-explicit-any */

export type TemplateType = 'nextjs' | 'n8n' | 'chat';

// E2B template alias + the port the dev/admin server listens on. Keep in sync
// with `sandbox-templates/*/build.ts`. `chat` has no sandbox — it's a pure
// Q&A / MCP-tool-only mode.
export const TEMPLATE_CONFIG: Record<Exclude<TemplateType, 'chat'>, { alias: string; port: number }> = {
  nextjs: { alias: 'codevibe-test', port: 3000 },
  n8n: { alias: 'n8n-codevibe', port: 5678 },
};

export function isTemplateType(v: unknown): v is TemplateType {
  return v === 'nextjs' || v === 'n8n' || v === 'chat';
}

export function resolveTemplateType(v: unknown): TemplateType {
  return isTemplateType(v) ? v : 'nextjs';
}

interface SandboxRegistryEntry {
  sandboxId?: string;
  sandboxUrl?: string;
  templateType: TemplateType;
  templateDecided: boolean;
}

const SANDBOX_REGISTRY_KEY = Symbol.for('codevibe.sandboxRegistry');

function getSandboxRegistry(): Map<string, SandboxRegistryEntry> {
  if (!(globalThis as any)[SANDBOX_REGISTRY_KEY]) {
    (globalThis as any)[SANDBOX_REGISTRY_KEY] = new Map();
  }
  return (globalThis as any)[SANDBOX_REGISTRY_KEY];
}

export function registerSandbox(
  threadId: string,
  sandboxId: string,
  sandboxUrl: string,
  templateType: TemplateType,
) {
  const reg = getSandboxRegistry();
  const prev = reg.get(threadId);
  reg.set(threadId, {
    sandboxId,
    sandboxUrl,
    templateType,
    templateDecided: prev?.templateDecided ?? true,
  });
}

// Set the template decision for a thread. Called by the `set_template` tool
// after HITL classification on the first prompt. Sandbox fields are preserved
// if a sandbox is already attached.
export function setThreadTemplate(
  threadId: string,
  templateType: TemplateType,
): SandboxRegistryEntry {
  const reg = getSandboxRegistry();
  const prev = reg.get(threadId);
  const next: SandboxRegistryEntry = {
    sandboxId: prev?.sandboxId,
    sandboxUrl: prev?.sandboxUrl,
    templateType,
    templateDecided: true,
  };
  reg.set(threadId, next);
  return next;
}

// Seed the registry from the persisted session row when an agent run starts on
// a thread we haven't seen since process restart. Without this, the dispatcher
// flow would re-run on every reload of an already-decided session.
export function hydrateThreadTemplate(
  threadId: string,
  templateType: TemplateType,
  templateDecided: boolean,
) {
  const reg = getSandboxRegistry();
  if (reg.has(threadId)) return;
  reg.set(threadId, { templateType, templateDecided });
}

export function getThreadSandbox(threadId: string): SandboxRegistryEntry | null {
  return getSandboxRegistry().get(threadId) ?? null;
}

// ─── In-flight provisioning de-dupe ─────────────────────────────────────────
//
// Holds a promise for the currently-running Sandbox.create() per thread, so
// concurrent tool calls (e.g. four parallel e2b_write_file in one turn)
// share one provision instead of each spinning up a separate sandbox. The
// promise is cleared the moment it settles, so a later expired-sandbox
// respawn can run cleanly.

const INFLIGHT_PROVISION_KEY = Symbol.for('codevibe.inflightProvision');

function getInflightMap(): Map<string, Promise<unknown>> {
  if (!(globalThis as any)[INFLIGHT_PROVISION_KEY]) {
    (globalThis as any)[INFLIGHT_PROVISION_KEY] = new Map();
  }
  return (globalThis as any)[INFLIGHT_PROVISION_KEY];
}

export function getInflightProvision<T = unknown>(threadId: string): Promise<T> | null {
  return (getInflightMap().get(threadId) as Promise<T> | undefined) ?? null;
}

export function setInflightProvision<T>(threadId: string, p: Promise<T>): void {
  getInflightMap().set(threadId, p as Promise<unknown>);
}

export function clearInflightProvision(threadId: string): void {
  getInflightMap().delete(threadId);
}
