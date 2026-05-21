/**
 * Server-side Yjs writer used by the agent (Node).
 *
 * Connects as a Hocuspocus peer to the Yjs WebSocket server, replaces the
 * room's text with the given content in a single transaction, and disconnects.
 *
 * Writes to the same room are serialized via a per-room promise chain. Without
 * this, two writes to the same room (e.g. agent generates then patches a file)
 * can each open a provider, both observe the room's old length, both delete +
 * insert at offset 0, and Yjs CRDT-merges the two inserts into interleaved
 * content.
 *
 * Set YJS_WS_URL when the agent runs in a container that can't reach the host
 * via "ws://localhost:1234" (e.g. ws://host.docker.internal:1234).
 */

import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

const WS_URL = process.env.YJS_WS_URL || 'ws://localhost:1234';
const SYNC_TIMEOUT_MS = 5000;
const ACK_TIMEOUT_MS = 3000;

const roomQueues = new Map<string, Promise<void>>();

export async function writeToYjsRoom(roomId: string, content: string): Promise<void> {
  const previous = roomQueues.get(roomId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => doWrite(roomId, content));
  roomQueues.set(roomId, next);
  try {
    await next;
  } finally {
    if (roomQueues.get(roomId) === next) {
      roomQueues.delete(roomId);
    }
  }
}

async function doWrite(roomId: string, content: string): Promise<void> {
  const doc = new Y.Doc();
  const yText = doc.getText('monaco');

  const provider = new HocuspocusProvider({
    url: WS_URL,
    name: roomId,
    document: doc,
  });

  try {
    await waitForEvent(provider, 'synced', SYNC_TIMEOUT_MS, `sync timeout for ${roomId}`);

    doc.transact(() => {
      if (yText.length > 0) yText.delete(0, yText.length);
      if (content.length > 0) yText.insert(0, content);
    });

    await waitForAck(provider);
  } finally {
    provider.destroy();
    doc.destroy();
  }
}

// Read the current text of a Yjs room. Returns null on timeout or if the room
// has no content (e.g. never opened, no agent mirror happened). Useful as a
// fallback source of file contents after the E2B sandbox dies — Yjs persists
// across sandbox lifetimes via Hocuspocus.
export async function readFromYjsRoom(roomId: string): Promise<string | null> {
  const doc = new Y.Doc();
  const yText = doc.getText('monaco');
  const provider = new HocuspocusProvider({
    url: WS_URL,
    name: roomId,
    document: doc,
  });

  try {
    await waitForEvent(provider, 'synced', SYNC_TIMEOUT_MS, `sync timeout for ${roomId}`);
    const text = yText.toString();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    provider.destroy();
    doc.destroy();
  }
}

function waitForEvent(
  provider: HocuspocusProvider,
  event: 'synced',
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const handler = () => {
      if (settled) return;
      settled = true;
      provider.off(event, handler);
      resolve();
    };
    provider.on(event, handler);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      provider.off(event, handler);
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
}

// Resolve once the provider has no unsynced changes (server has acked our update).
// Safety timeout falls back to resolving so a stuck connection doesn't block the queue.
function waitForAck(provider: HocuspocusProvider): Promise<void> {
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = provider as unknown as { unsyncedChanges?: number; on: any; off: any };
    if (typeof p.unsyncedChanges === 'number' && p.unsyncedChanges === 0) {
      resolve();
      return;
    }
    let settled = false;
    const check = () => {
      if (settled) return;
      if (typeof p.unsyncedChanges === 'number' && p.unsyncedChanges === 0) {
        settled = true;
        p.off?.('unsyncedChanges', check);
        resolve();
      }
    };
    p.on?.('unsyncedChanges', check);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      p.off?.('unsyncedChanges', check);
      resolve();
    }, ACK_TIMEOUT_MS);
  });
}
