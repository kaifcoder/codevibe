/**
 * Monaco Editor binding to Yjs
 *
 * Connects Monaco's text model to Yjs Y.Text for real-time sync.
 * Uses y-monaco library for bidirectional CRDT synchronization.
 *
 * We ALSO attach our own remote-cursor renderer on top of y-monaco. Reason:
 * y-monaco's built-in `_rerenderDecorations` calls `editor.deltaDecorations`
 * (deprecated) and its RelativePosition resolution occasionally snaps
 * remote carets to column 1 of the correct line — we observed the caret
 * following the line change but not the column. The custom renderer
 * (remoteCursorRenderer.ts) uses `createDecorationsCollection` and computes
 * positions directly from the Y.Text index, which gives us pixel-accurate
 * tracking. y-monaco still handles text sync and *publishing* the local
 * selection into awareness — we only replace the reading side.
 */

import * as monaco from 'monaco-editor';
import type { MonacoBinding } from 'y-monaco';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { attachRemoteCursorRenderer } from './remoteCursorRenderer';

export interface BindMonacoConfig {
  editor: monaco.editor.IStandaloneCodeEditor;
  yText: Y.Text;
  awareness: Awareness | null;
}

export interface BoundMonaco {
  binding: MonacoBinding;
  destroy: () => void;
}

export async function bindMonaco(config: BindMonacoConfig): Promise<BoundMonaco> {
  const { editor, yText, awareness } = config;

  const model = editor.getModel();
  if (!model) {
    throw new Error('[Monaco Binding] No model attached to editor');
  }

  const { MonacoBinding: MonacoBindingClass } = await import('y-monaco');

  const binding = new MonacoBindingClass(yText, model, new Set([editor]), awareness);

  // Attach our custom renderer AFTER the binding is constructed. It reads
  // `state.selection` published by y-monaco's own `onDidChangeCursorSelection`
  // handler — so we get the publishing for free — and renders it ourselves.
  let detachRenderer: (() => void) | null = null;
  if (awareness) {
    detachRenderer = attachRemoteCursorRenderer(editor, binding, awareness);
  }

  return {
    binding,
    destroy: () => {
      if (detachRenderer) detachRenderer();
      binding.destroy();
    },
  };
}
