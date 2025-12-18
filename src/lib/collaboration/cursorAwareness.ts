/**
 * Cursor position awareness broadcasting
 * 
 * Tracks local cursor position and broadcasts it via Yjs awareness.
 * Single responsibility: tracking only, no rendering.
 */

import * as monaco from 'monaco-editor';
import type { Awareness } from 'y-protocols/awareness';

export interface CursorTrackingCleanup {
  dispose: () => void;
}

/**
 * Attach cursor position tracking to Monaco editor
 * 
 * Broadcasts cursor position changes to awareness state for other clients to see.
 * Returns cleanup function to dispose listeners.
 */
export function attachCursorTracking(
  editor: monaco.editor.IStandaloneCodeEditor,
  awareness: Awareness | null
): CursorTrackingCleanup {
  if (!awareness) {
    console.warn('[Cursor Tracking] No awareness provided, skipping');
    return { dispose: () => {} };
  }

  console.log('[Cursor Tracking] Attaching cursor position broadcaster');

  // Broadcast local cursor position to awareness state
  const updateCursorPosition = () => {
    const model = editor.getModel();
    if (!model) return;
    
    const position = editor.getPosition();
    if (!position) return;
    
    const index = model.getOffsetAt(position);
    
    // Set awareness field with cursor anchor index
    awareness.setLocalStateField('selection', {
      anchor: { index },
    });
  };

  // Update on cursor position changes
  const cursorDisposable = editor.onDidChangeCursorPosition(updateCursorPosition);
  
  // Update immediately when content changes (user is typing)
  const contentDisposable = editor.onDidChangeModelContent(() => {
    updateCursorPosition();
  });

  console.log('[Cursor Tracking] Cursor tracking attached');

  return {
    dispose: () => {
      cursorDisposable.dispose();
      contentDisposable.dispose();
      console.log('[Cursor Tracking] Disposed');
    },
  };
}
