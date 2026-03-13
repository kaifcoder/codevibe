/**
 * Collaboration Layer - Clean exports
 * 
 * Modular architecture for real-time collaborative editing:
 * - initCollaboration: Y.Doc + HocuspocusProvider bootstrap
 * - bindMonaco: Monaco ↔ Yjs synchronization
 */

export { initCollaboration } from './initCollaboration';
export type { CollaborationConfig, CollaborationSession } from './initCollaboration';

export { bindMonaco } from './bindMonaco';
export type { BindMonacoConfig } from './bindMonaco';

export { updateYjsDocument } from './updateYjsDocument';
