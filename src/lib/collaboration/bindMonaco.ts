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

  const binding = new MonacoBindingClass(yText, model, new Set([editor]), awareness);

  // y-monaco's internal `_rerenderDecorations` uses `editor.deltaDecorations`
  // which, in newer Monaco, is deprecated and can silently no-op when
  // called outside a Monaco microtask. That produced the "remote caret is
  // on the correct line but doesn't follow peer's movement" symptom —
  // publishing worked, but the receiving side never re-drew.
  //
  // Force a repaint on every awareness change by nudging the editor: any
  // no-op layout call is enough to flush pending decoration deltas. We
  // debounce with rAF so a burst of awareness updates (from a fast-moving
  // caret) collapses into one paint per frame.
  if (awareness) {
    let rafId: number | null = null;
    const kick = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        // A null-effect layout — Monaco recomputes decoration positions
        // on layout, so this is the cheapest way to force a re-render
        // without touching the model.
        editor.layout();
      });
    };
    awareness.on('change', kick);
    // Clean up when the binding is disposed. y-monaco doesn't expose a
    // cleanup callback on the binding object, so we monkey-patch destroy.
    const origDestroy = binding.destroy.bind(binding);
    binding.destroy = () => {
      awareness.off('change', kick);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      origDestroy();
    };
  }

  return binding;
}
