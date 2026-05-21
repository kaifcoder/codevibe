/* eslint-disable @typescript-eslint/no-explicit-any */

export type TemplateType = 'nextjs' | 'n8n';

// E2B template alias + the port the dev/admin server listens on. Keep in sync
// with `sandbox-templates/*/build.ts`.
export const TEMPLATE_CONFIG: Record<TemplateType, { alias: string; port: number }> = {
  nextjs: { alias: 'codevibe-test', port: 3000 },
  n8n: { alias: 'n8n-codevibe', port: 5678 },
};

export function isTemplateType(v: unknown): v is TemplateType {
  return v === 'nextjs' || v === 'n8n';
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
