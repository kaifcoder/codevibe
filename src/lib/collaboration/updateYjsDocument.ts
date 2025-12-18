import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:1234';

/**
 * Update a Yjs document directly from the server/agent
 * This allows pushing content updates without user interaction
 */
export async function updateYjsDocument(roomId: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('[updateYjsDocument] Connecting to room:', roomId);
    
    // Create a temporary Y.Doc and provider to update the document
    const doc = new Y.Doc();
    const yText = doc.getText('monaco');
    
    const provider = new HocuspocusProvider({
      url: WS_URL,
      name: roomId,
      document: doc,
      onSynced: () => {
        console.log('[updateYjsDocument] Provider synced, updating content');
        
        try {
          // Replace entire document content
          doc.transact(() => {
            yText.delete(0, yText.length);
            yText.insert(0, content);
          });
          
          console.log('[updateYjsDocument] Content updated successfully');
          
          // Wait a bit for sync, then cleanup
          setTimeout(() => {
            provider.destroy();
            resolve();
          }, 100);
        } catch (error) {
          console.error('[updateYjsDocument] Error updating content:', error);
          provider.destroy();
          reject(error);
        }
      },
      onClose: () => {
        console.log('[updateYjsDocument] Provider closed');
      },
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      if (provider.synced === false) {
        console.error('[updateYjsDocument] Timeout waiting for sync');
        provider.destroy();
        reject(new Error('Timeout waiting for Yjs sync'));
      }
    }, 5000);
  });
}
