import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { getExistingYText } from './initCollaboration';

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
 * If the room already has an active collaboration session (CodeEditor is open),
 * updates the existing Y.Text directly — no new connection needed.
 * 
 * Falls back to a temporary provider for rooms that aren't currently open.
 */
export async function updateYjsDocument(roomId: string, content: string): Promise<void> {
  // Fast path: reuse existing session
  const existingYText = getExistingYText(roomId);
  if (existingYText) {
    console.log('[updateYjsDocument] Reusing existing session for room:', roomId);
    existingYText.doc!.transact(() => {
      existingYText.delete(0, existingYText.length);
      existingYText.insert(0, content);
    });
    return;
  }

  // Slow path: create temporary provider for rooms not currently open in editor
  console.log('[updateYjsDocument] No existing session, creating temporary provider for:', roomId);
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    const yText = doc.getText('monaco');

    const provider = new HocuspocusProvider({
      url: getWebSocketUrl(),
      name: roomId,
      document: doc,
      onSynced: () => {
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
      if (!provider.synced) {
        provider.destroy();
        reject(new Error('Timeout waiting for Yjs sync'));
      }
    }, 5000);
  });
}
