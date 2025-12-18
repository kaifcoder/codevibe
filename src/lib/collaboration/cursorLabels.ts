/**
 * Cursor label visualization using Monaco ContentWidgets
 * 
 * Renders username labels and cursor lines for remote users.
 * Responds to awareness state changes to update widget positions.
 */

import * as monaco from 'monaco-editor';
import type { Awareness } from 'y-protocols/awareness';

export interface CursorLabelsCleanup {
  dispose: () => void;
}

/**
 * Attach cursor label widgets to Monaco editor
 * 
 * Creates ContentWidgets for each remote user's cursor with:
 * - Username label (colored, positioned above cursor)
 * - Cursor line (animated blinking indicator)
 * 
 * Returns cleanup function to remove widgets and dispose listeners.
 */
export function attachCursorLabels(
  editor: monaco.editor.IStandaloneCodeEditor,
  awareness: Awareness | null
): CursorLabelsCleanup {
  if (!awareness) {
    console.warn('[Cursor Labels] No awareness provided, skipping');
    return { dispose: () => {} };
  }

  console.log('[Cursor Labels] Attaching cursor label widgets');

  // Track active widgets by client ID
  const cursorWidgets = new Map<number, monaco.editor.IContentWidget>();
  
  // CRITICAL: Capture local client ID immediately to prevent rendering own cursor
  const localClientId = awareness.clientID;
  console.log('[Cursor Labels] Local client ID captured:', localClientId);

  // Debounce label updates to reduce flickering
  let updateTimeout: NodeJS.Timeout | null = null;

  // Helper to create cursor widget DOM
  const createCursorWidget = (
    clientId: number,
    userName: string,
    userColor: string,
    position: monaco.Position
  ): monaco.editor.IContentWidget => {
    // Create widget container
    const container = document.createElement('div');
    container.className = 'yjs-cursor-container';
    container.style.position = 'relative';
    container.style.pointerEvents = 'none';
    container.style.height = '0';
    container.style.width = '0';

    // Create username label
    const labelNode = document.createElement('div');
    labelNode.className = 'yjs-cursor-label';
    labelNode.textContent = userName;
    labelNode.style.backgroundColor = userColor;
    labelNode.style.color = '#ffffff';
    labelNode.style.padding = '2px 6px';
    labelNode.style.borderRadius = '3px';
    labelNode.style.fontSize = '11px';
    labelNode.style.fontWeight = '600';
    labelNode.style.whiteSpace = 'nowrap';
    labelNode.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
    labelNode.style.position = 'absolute';
    labelNode.style.bottom = '4px';
    labelNode.style.left = '0';
    labelNode.style.transform = 'translateY(-100%)';

    // Create cursor line
    const cursorLine = document.createElement('div');
    cursorLine.className = 'yjs-cursor-line-visible';
    cursorLine.style.position = 'absolute';
    cursorLine.style.left = '0';
    cursorLine.style.top = '0';
    cursorLine.style.width = '2px';
    cursorLine.style.height = '19px';
    cursorLine.style.backgroundColor = userColor;
    cursorLine.style.borderRadius = '1px';
    cursorLine.style.animation = 'cursorBlink 1s infinite';

    container.appendChild(labelNode);
    container.appendChild(cursorLine);

    return {
      getId: () => `yjs-cursor-${clientId}`,
      getDomNode: () => container,
      getPosition: () => ({
        position,
        preference: [0] as unknown as monaco.editor.ContentWidgetPositionPreference[],
      }),
    };
  };

  const updateCursorLabels = () => {
    if (updateTimeout) {
      clearTimeout(updateTimeout);
    }

    updateTimeout = setTimeout(() => {
      const model = editor.getModel();
      const disposed = (model as unknown as { isDisposed?: () => boolean }).isDisposed?.() === true;
      
      if (!model || disposed) {
        console.warn('[Cursor Labels] Model not available or disposed');
        return;
      }

      const seen = new Set<number>();
      console.log('[Cursor Labels] Updating cursors - Local ID:', localClientId, 'Total states:', awareness.getStates().size);

      // Process each remote user's cursor
      awareness.getStates().forEach((state: unknown, clientId: number) => {
        // CRITICAL: Skip local user to prevent rendering own cursor
        if (clientId === localClientId) {
          console.log('[Cursor Labels] Skipping local user:', clientId);
          return;
        }

        const userState = state as {
          user?: { name?: string; color?: string };
          selection?: { anchor?: { index?: number } };
        };

        const userName = userState.user?.name;
        const userColor = userState.user?.color || '#4ECDC4';
        const anchorIndex = userState.selection?.anchor?.index;

        if (!userName || typeof anchorIndex !== 'number') {
          console.log('[Cursor Labels] Skipping - missing data for client:', clientId, { userName, anchorIndex });
          return;
        }

        console.log('[Cursor Labels] Rendering cursor for remote user:', { clientId, userName, userColor, anchorIndex });
        const position = model.getPositionAt(anchorIndex);
        const widget = createCursorWidget(clientId, userName, userColor, position);

        const existing = cursorWidgets.get(clientId);
        if (existing) {
          editor.removeContentWidget(existing);
        }
        editor.addContentWidget(widget);
        cursorWidgets.set(clientId, widget);
        seen.add(clientId);
      });

      // Remove widgets for clients no longer present
      for (const clientId of Array.from(cursorWidgets.keys())) {
        if (!seen.has(clientId)) {
          const widget = cursorWidgets.get(clientId);
          if (widget) {
            editor.removeContentWidget(widget);
          }
          cursorWidgets.delete(clientId);
        }
      }
    }, 50);
  };

  // Listen to awareness changes
  awareness.on('change', updateCursorLabels);

  console.log('[Cursor Labels] Cursor labels attached');

  return {
    dispose: () => {
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }

      // Remove all cursor widgets
      for (const widget of cursorWidgets.values()) {
        editor.removeContentWidget(widget);
      }
      cursorWidgets.clear();

      // Remove awareness listener
      awareness.off('change', updateCursorLabels);

      console.log('[Cursor Labels] Disposed');
    },
  };
}
