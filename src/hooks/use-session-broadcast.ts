"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type * as Y from "yjs";
import type { CollaborationSession } from "@/lib/collaboration";
import { useChat } from "@/contexts/chat-context";

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
  const { getToken, isSignedIn } = useAuth();
  const { shareToken } = useChat();

  useEffect(() => {
    if (!sessionId) {
      setBroadcast(null);
      return;
    }

    let cancelled = false;
    let session: CollaborationSession | null = null;

    // Same auth story as useCollaboration — see comments there.
    const yjsAuth = isSignedIn
      ? ({ kind: "clerk" as const, getToken: async () => (await getToken()) ?? null })
      : shareToken
      ? ({ kind: "share" as const, sessionId, shareToken })
      : undefined;

    if (!yjsAuth) {
      // No credentials — skip; the room would be rejected server-side.
      setBroadcast(null);
      return;
    }

    (async () => {
      const { initCollaboration } = await import("@/lib/collaboration");
      if (cancelled) return;
      session = initCollaboration({ roomId: `${sessionId}-__session`, auth: yjsAuth });
      setBroadcast(session.ydoc.getMap("broadcast"));
    })();

    return () => {
      cancelled = true;
      if (session) session.disconnect();
      setBroadcast(null);
    };
  }, [sessionId, isSignedIn, getToken, shareToken]);

  return { broadcast };
}
