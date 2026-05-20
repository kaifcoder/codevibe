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

export async function bindMonaco(config: BindMonacoConfig): Promise<MonacoBinding> {
  const { editor, yText, awareness } = config;

  const model = editor.getModel();
  if (!model) {
    throw new Error('[Monaco Binding] No model attached to editor');
  }

  const { MonacoBinding: MonacoBindingClass } = await import('y-monaco');

  return new MonacoBindingClass(yText, model, new Set([editor]), awareness);
}
