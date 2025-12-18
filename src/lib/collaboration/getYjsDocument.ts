import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:1234';

/**
 * Get content from a Yjs document (read-only)
 * This connects temporarily to read the current state
 */
export async function getYjsDocument(roomId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log('[getYjsDocument] Connecting to room:', roomId);
    
    // Create a temporary Y.Doc and provider to read the document
    const doc = new Y.Doc();
    const yText = doc.getText('monaco');
    
    const provider = new HocuspocusProvider({
      url: WS_URL,
      name: roomId,
      document: doc,
      onSynced: () => {
        console.log('[getYjsDocument] Provider synced, reading content');
        
        try {
          const content = yText.toJSON();
          console.log('[getYjsDocument] Content read successfully, length:', content.length);
          
          // Cleanup
          provider.destroy();
          resolve(content);
        } catch (error) {
          console.error('[getYjsDocument] Error reading content:', error);
          provider.destroy();
          reject(error);
        }
      },
      onClose: () => {
        console.log('[getYjsDocument] Provider closed');
      },
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      if (provider.synced === false) {
        console.error('[getYjsDocument] Timeout waiting for sync');
        provider.destroy();
        reject(new Error('Timeout waiting for Yjs sync'));
      }
    }, 5000);
  });
}
