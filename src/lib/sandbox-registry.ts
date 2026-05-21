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
  sandboxId: string;
  sandboxUrl: string;
  templateType: TemplateType;
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
  getSandboxRegistry().set(threadId, { sandboxId, sandboxUrl, templateType });
}

export function getThreadSandbox(threadId: string): SandboxRegistryEntry | null {
  return getSandboxRegistry().get(threadId) ?? null;
}
