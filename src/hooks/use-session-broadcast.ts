"use client";

import { useEffect, useState } from "react";
import type * as Y from "yjs";
import type { CollaborationSession } from "@/lib/collaboration";

/**
 * Session-wide Yjs room used for live coordination *between* browsers
 * collaborating on the same chat (e.g. mirroring the active LangGraph run
 * id so a peer can `joinStream` and see the agent reply in real time).
 *
 * Distinct from the per-file editor rooms so it survives file switches and
 * doesn't pollute the editor's text doc.
 */
export function useSessionBroadcast(sessionId: string): {
  broadcast: Y.Map<unknown> | null;
} {
  const [broadcast, setBroadcast] = useState<Y.Map<unknown> | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setBroadcast(null);
      return;
    }

    let cancelled = false;
    let session: CollaborationSession | null = null;

    (async () => {
      const { initCollaboration } = await import("@/lib/collaboration");
      if (cancelled) return;
      session = initCollaboration({ roomId: `${sessionId}-__session` });
      setBroadcast(session.ydoc.getMap("broadcast"));
    })();

    return () => {
      cancelled = true;
      if (session) session.disconnect();
      setBroadcast(null);
    };
  }, [sessionId]);

  return { broadcast };
}
