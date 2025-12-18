/**
 * Collaboration Layer - Clean exports
 * 
 * Modular architecture for real-time collaborative editing:
 * - initCollaboration: Y.Doc + HocuspocusProvider bootstrap
 * - bindMonaco: Monaco ↔ Yjs synchronization
 * - attachCursorTracking: Cursor position broadcasting
 * - attachCursorLabels: Visual cursor widget rendering
 */

export { initCollaboration, cleanupAllSessions } from './initCollaboration';
export type { CollaborationConfig, CollaborationSession } from './initCollaboration';

export { bindMonaco } from './bindMonaco';
export type { BindMonacoConfig } from './bindMonaco';

export { attachCursorTracking } from './cursorAwareness';
export type { CursorTrackingCleanup } from './cursorAwareness';

export { attachCursorLabels } from './cursorLabels';

export { updateYjsDocument } from './updateYjsDocument';
export { getYjsDocument } from './getYjsDocument';
export type { CursorLabelsCleanup } from './cursorLabels';
