/* eslint-disable @typescript-eslint/no-explicit-any */

const SANDBOX_REGISTRY_KEY = Symbol.for('codevibe.sandboxRegistry');

function getSandboxRegistry(): Map<string, { sandboxId: string; sandboxUrl: string }> {
  if (!(globalThis as any)[SANDBOX_REGISTRY_KEY]) {
    (globalThis as any)[SANDBOX_REGISTRY_KEY] = new Map();
  }
  return (globalThis as any)[SANDBOX_REGISTRY_KEY];
}

export function registerSandbox(threadId: string, sandboxId: string, sandboxUrl: string) {
  getSandboxRegistry().set(threadId, { sandboxId, sandboxUrl });
}

export function getThreadSandbox(threadId: string) {
  return getSandboxRegistry().get(threadId) ?? null;
}
