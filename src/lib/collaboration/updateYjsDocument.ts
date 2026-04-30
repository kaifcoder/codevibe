import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { getExistingYText, waitForYText } from './initCollaboration';

/**
 * Get the WebSocket URL based on current hostname
 */
function getWebSocketUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }
  if (globalThis.window === undefined) {
    return 'ws://localhost:1234';
  }
  const hostname = globalThis.window.location.hostname;
  const protocol = globalThis.window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const finalHostname = (hostname === 'localhost' || hostname === '127.0.0.1') ? 'localhost' : hostname;
  return `${protocol}//${finalHostname}:1234`;
}

/**
 * Update a Yjs document.
 *
 * Priority order:
 * 1. Reuse an already-synced session (instant)
 * 2. Wait for an existing provider that hasn't synced yet (editor just mounted)
 * 3. Fall back to a temporary provider for rooms not open in any editor
 */
export async function updateYjsDocument(roomId: string, content: string): Promise<void> {
  // Fast path: reuse existing synced session
  const existingYText = getExistingYText(roomId);
  if (existingYText) {
    existingYText.doc!.transact(() => {
      existingYText.delete(0, existingYText.length);
      existingYText.insert(0, content);
    });
    return;
  }

  // Medium path: provider exists but not synced yet (editor just opened this file)
  const pendingYText = await waitForYText(roomId, 3000);
  if (pendingYText) {
    pendingYText.doc!.transact(() => {
      pendingYText.delete(0, pendingYText.length);
      pendingYText.insert(0, content);
    });
    return;
  }

  // Slow path: create temporary provider for rooms not currently open in editor
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    const yText = doc.getText('monaco');
    let settled = false;

    const provider = new HocuspocusProvider({
      url: getWebSocketUrl(),
      name: roomId,
      document: doc,
      onSynced: () => {
        if (settled) return;
        settled = true;
        try {
          doc.transact(() => {
            yText.delete(0, yText.length);
            yText.insert(0, content);
          });
          setTimeout(() => {
            provider.destroy();
            resolve();
          }, 100);
        } catch (error) {
          provider.destroy();
          reject(error);
        }
      },
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        provider.destroy();
        reject(new Error('Timeout waiting for Yjs sync'));
      }
    }, 5000);
  });
}
