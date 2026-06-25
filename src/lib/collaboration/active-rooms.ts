/**
 * Module-level registry of currently-bound Yjs rooms.
 *
 * `useCollaboration` registers `${sessionId}-${filePath}` → Y.Text when it
 * connects to a room, and unregisters on disconnect. The agent stream handler
 * (`use-agent-stream`) looks up rooms here so a `codePatch` custom event can
 * be applied directly to the editor's Y.Text — a fallback used when the
 * server-side Yjs mirror (writeToYjsRoom) failed silently (misconfigured
 * YJS_WS_URL in prod, transient WS hiccup, etc.).
 *
 * The transaction origin is set to `agent-codepatch` so the E2B-sync observer
 * in `useCollaboration` skips bouncing the update back through
 * /api/write-to-sandbox.
 */

import type * as Y from "yjs";

const activeRooms = new Map<string, Y.Text>();

export function registerActiveRoom(roomId: string, yText: Y.Text): void {
  activeRooms.set(roomId, yText);
}

export function unregisterActiveRoom(roomId: string, yText: Y.Text): void {
  // Only unregister if the registered Y.Text is still this one — avoids a
  // late teardown clobbering a freshly-registered binding for the same room.
  if (activeRooms.get(roomId) === yText) {
    activeRooms.delete(roomId);
  }
}

export function applyCodePatchToActiveRoom(roomId: string, content: string): boolean {
  const yText = activeRooms.get(roomId);
  if (!yText) return false;
  const doc = yText.doc;
  if (!doc) return false;
  const current = yText.toString();
  if (current === content) return true;
  doc.transact(() => {
    if (yText.length > 0) yText.delete(0, yText.length);
    if (content.length > 0) yText.insert(0, content);
  }, "agent-codepatch");
  return true;
}
