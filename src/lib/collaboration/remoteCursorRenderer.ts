/**
 * Custom remote-cursor renderer.
 *
 * Bypasses y-monaco's built-in `_rerenderDecorations` which uses the
 * deprecated `editor.deltaDecorations` and had two problems:
 *   1. Newer Monaco versions silently no-op `deltaDecorations` when called
 *      outside a Monaco microtask, so decorations went stale between paints.
 *   2. `Y.RelativePosition` sometimes resolves to a "line-start anchor"
 *      when the surrounding text has been mutated, causing every remote
 *      caret to render at column 1 of the correct line.
 *
 * This renderer reads `state.selection` off the awareness map, resolves
 * offsets ourselves, and uses `editor.createDecorationsCollection` (the
 * modern replacement) so the decoration is always up to date.
 *
 * Called from bindMonaco AFTER the y-monaco binding is constructed. y-monaco
 * still handles the text sync + local selection *publishing*; we just take
 * over the *rendering* of remote carets.
 */

import * as monaco from 'monaco-editor';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { MonacoBinding } from 'y-monaco';

interface RemoteSelectionState {
  anchor: Y.RelativePosition;
  head: Y.RelativePosition;
}

interface RemoteUser {
  name?: string;
  color?: string;
}

export function attachRemoteCursorRenderer(
  editor: monaco.editor.IStandaloneCodeEditor,
  binding: MonacoBinding,
  awareness: Awareness,
): () => void {
  const model = editor.getModel();
  if (!model) return () => {};

  const doc = binding.doc;
  const ytext = binding.ytext;

  // One decoration collection per remote client. Keeping them separate
  // means each peer's caret updates independently and we can inject
  // per-client CSS (color, label) via inline style.
  const collections = new Map<
    number,
    monaco.editor.IEditorDecorationsCollection
  >();

  // Per-client dynamic style tag so each peer's caret is drawn in their
  // own color. Monaco's decoration classes can't accept inline styles on
  // pseudo-elements, so we inject `.yRemoteSelectionHead-<id>` rules.
  const styleTag = document.createElement('style');
  styleTag.setAttribute('data-remote-cursor-styles', '');
  document.head.appendChild(styleTag);
  const styleRules = new Map<number, string>();

  function ensurePeerStyle(clientId: number, color: string) {
    const existing = styleRules.get(clientId);
    // Cache-bust when color changes.
    const rule = `
.cvRemoteSelection-${clientId} { background-color: ${color}33 !important; }
.cvRemoteSelectionHead-${clientId} { border-color: ${color} !important; color: ${color} !important; }
`;
    if (existing === rule) return;
    styleRules.set(clientId, rule);
    // Rebuild the whole tag; cheap because there are usually <10 peers.
    styleTag.textContent = Array.from(styleRules.values()).join('\n');
  }

  function render() {
    const states = awareness.getStates();
    const seen = new Set<number>();

    states.forEach((raw, clientId) => {
      if (clientId === doc.clientID) return;
      const state = raw as { selection?: RemoteSelectionState; user?: RemoteUser };
      if (!state.selection || !state.selection.anchor || !state.selection.head) return;

      const anchorAbs = Y.createAbsolutePositionFromRelativePosition(
        state.selection.anchor,
        doc,
      );
      const headAbs = Y.createAbsolutePositionFromRelativePosition(
        state.selection.head,
        doc,
      );
      if (
        !anchorAbs ||
        !headAbs ||
        anchorAbs.type !== ytext ||
        headAbs.type !== ytext
      ) {
        return;
      }

      // Use Monaco's own position resolver — it operates on model bytes,
      // which after our CRLF normalization match Y.Text 1:1.
      const anchorPos = model.getPositionAt(anchorAbs.index);
      const headPos = model.getPositionAt(headAbs.index);

      // The caret pseudo-element should sit at the HEAD end (where the
      // active cursor is). If anchor === head it's a bare caret with no
      // selection range. If they differ, we render both the range
      // (`className`) and the caret pseudo-element (`afterContentClassName`
      // for LTR / `beforeContentClassName` for RTL).
      const isLTR =
        anchorAbs.index <= headAbs.index || anchorAbs.index === headAbs.index;
      const rangeStart = isLTR ? anchorPos : headPos;
      const rangeEnd = isLTR ? headPos : anchorPos;

      const color = state.user?.color ?? '#FF6B6B';
      ensurePeerStyle(clientId, color);

      const decoration: monaco.editor.IModelDeltaDecoration = {
        range: new monaco.Range(
          rangeStart.lineNumber,
          rangeStart.column,
          rangeEnd.lineNumber,
          rangeEnd.column,
        ),
        options: {
          // Custom class names (distinct from y-monaco's built-in
          // `yRemoteSelection*`) so both renderers can coexist without
          // stacking decorations on the same character. y-monaco's own
          // classes are hidden via CSS (see globals.css).
          className: `cvRemoteSelection cvRemoteSelection-${clientId}`,
          afterContentClassName: isLTR
            ? `cvRemoteSelectionHead cvRemoteSelectionHead-${clientId}`
            : null,
          beforeContentClassName: !isLTR
            ? `cvRemoteSelectionHead cvRemoteSelectionHead-${clientId}`
            : null,
          // stickiness=1 (NeverGrowsWhenTypingAtEdges) keeps the caret
          // pinned to its character rather than growing when someone
          // types adjacent to it — closer to what feels like a real cursor.
          stickiness: 1,
        },
      };

      let collection = collections.get(clientId);
      if (!collection) {
        collection = editor.createDecorationsCollection([decoration]);
        collections.set(clientId, collection);
      } else {
        collection.set([decoration]);
      }
      seen.add(clientId);
    });

    // Clean up peers who left or dropped their selection.
    collections.forEach((collection, clientId) => {
      if (!seen.has(clientId)) {
        collection.clear();
        collections.delete(clientId);
      }
    });
  }

  // Debounce with rAF — a fast-moving caret can fire many awareness
  // updates per frame; we only need one paint per frame.
  let rafId: number | null = null;
  function scheduleRender() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      render();
    });
  }

  awareness.on('change', scheduleRender);
  awareness.on('update', scheduleRender);
  // Also render on model content change — after a Yjs update lands, the
  // stored `RelativePosition` may resolve to a new absolute index.
  const modelListener = model.onDidChangeContent(scheduleRender);
  render();

  return () => {
    awareness.off('change', scheduleRender);
    awareness.off('update', scheduleRender);
    modelListener.dispose();
    if (rafId !== null) cancelAnimationFrame(rafId);
    collections.forEach((c) => c.clear());
    collections.clear();
    styleTag.remove();
  };
}
