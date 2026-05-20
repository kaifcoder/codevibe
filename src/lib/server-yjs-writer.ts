/**
 * Server-side Yjs writer used by the agent (Node).
 *
 * Connects as a Hocuspocus peer to the Yjs WebSocket server, replaces the
 * room's text with the given content in a single transaction, and disconnects.
 *
 * Set YJS_WS_URL when the agent runs in a container that can't reach the host
 * via "ws://localhost:1234" (e.g. ws://host.docker.internal:1234).
 */

import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

const WS_URL = process.env.YJS_WS_URL || 'ws://localhost:1234';
const SYNC_TIMEOUT_MS = 5000;
const FLUSH_DELAY_MS = 150;

export async function writeToYjsRoom(roomId: string, content: string): Promise<void> {
  const doc = new Y.Doc();
  const yText = doc.getText('monaco');

  const provider = new HocuspocusProvider({
    url: WS_URL,
    name: roomId,
    document: doc,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const onSynced = () => {
        if (settled) return;
        settled = true;
        provider.off('synced', onSynced);
        resolve();
      };
      provider.on('synced', onSynced);
      setTimeout(() => {
        if (settled) return;
        settled = true;
        provider.off('synced', onSynced);
        reject(new Error(`Yjs sync timeout for room ${roomId}`));
      }, SYNC_TIMEOUT_MS);
    });

    doc.transact(() => {
      if (yText.length > 0) yText.delete(0, yText.length);
      if (content.length > 0) yText.insert(0, content);
    });

    // Give the provider a moment to flush the update over the wire before tearing down.
    await new Promise((r) => setTimeout(r, FLUSH_DELAY_MS));
  } finally {
    provider.destroy();
    doc.destroy();
  }
}
