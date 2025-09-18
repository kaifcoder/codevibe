// Simple in-memory session message store.
// NOTE: This is ephemeral and will reset on server restart or across serverless instances.
// For production, replace with a persistent store (DB, Redis, KV, etc.).

export type StoredChatMessage = {
  role: 'user' | 'ai';
  content: string;
  ts: number;
};

const store = new Map<string, StoredChatMessage[]>();
const MAX_MESSAGES = 40; // cap per session to avoid unbounded memory

export function getSessionMessages(sessionId: string): StoredChatMessage[] {
  return store.get(sessionId) || [];
}

export function appendSessionMessages(sessionId: string, newMessages: StoredChatMessage[]) {
  if (!sessionId) return;
  const existing = store.get(sessionId) || [];
  const merged = [...existing, ...newMessages];
  // Trim oldest if exceeding cap
  const trimmed = merged.slice(-MAX_MESSAGES);
  store.set(sessionId, trimmed);
}

export function resetSession(sessionId: string) {
  store.delete(sessionId);
}

export function clearAllSessions() {
  store.clear();
}
