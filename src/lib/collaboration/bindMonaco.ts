/**
 * Monaco Editor binding to Yjs
 * 
 * Connects Monaco's text model to Yjs Y.Text for real-time sync.
 * Uses y-monaco library for bidirectional CRDT synchronization.
 */

import * as monaco from 'monaco-editor';
import type { MonacoBinding } from 'y-monaco';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

export interface BindMonacoConfig {
  editor: monaco.editor.IStandaloneCodeEditor;
  yText: Y.Text;
  awareness: Awareness | null;
}

/**
 * Create MonacoBinding to sync editor content with Yjs
 * 
 * Returns: MonacoBinding instance for cleanup
 */
export async function bindMonaco(config: BindMonacoConfig): Promise<MonacoBinding> {
  const { editor, yText, awareness } = config;
  
  const model = editor.getModel();
  if (!model) {
    throw new Error('[Monaco Binding] No model attached to editor');
  }
  
  // Dynamically import y-monaco to avoid SSR issues
  const { MonacoBinding: MonacoBindingClass } = await import('y-monaco');
  
  console.log('[Monaco Binding] Creating binding with awareness:', !!awareness);
  
  // Log local awareness state for debugging
  if (awareness) {
    const localState = awareness.getLocalState();
    console.log('[Monaco Binding] Local awareness state:', localState);
  }
  
  // Create binding with awareness for cursor sync
  // y-monaco handles text synchronization + selection highlights
  const binding = new MonacoBindingClass(
    yText,
    model,
    new Set([editor]),
    awareness // Enables built-in selection rendering
  );
  
  console.log('[Monaco Binding] Binding created successfully');
  
  return binding;
}
