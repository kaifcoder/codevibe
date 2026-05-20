"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@/contexts/chat-context";
import type { CollaborationSession } from "@/lib/collaboration";
import type * as Y from "yjs";
import type { HocuspocusProvider } from "@hocuspocus/provider";

interface UseCollaborationReturn {
  yText: Y.Text | null;
  provider: HocuspocusProvider | null;
}

const E2B_SYNC_DEBOUNCE_MS = 1000;

export function useCollaboration(sessionId: string, selectedFile: string): UseCollaborationReturn {
  const [yText, setYText] = useState<Y.Text | null>(null);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const sessionRef = useRef<CollaborationSession | null>(null);
  const currentRoomRef = useRef<string>("");
  const {
    setConnectionStatus,
    setConnectedUsers,
    sandboxId,
    setIsSyncingToE2B,
    updateFileContent,
    displayName,
    shareToken,
  } = useChat();

  // Stable refs for the E2B-sync side effect — we don't want to rebind the
  // observer just because these change.
  const sandboxIdRef = useRef(sandboxId);
  sandboxIdRef.current = sandboxId;
  const setIsSyncingToE2BRef = useRef(setIsSyncingToE2B);
  setIsSyncingToE2BRef.current = setIsSyncingToE2B;
  const updateFileContentRef = useRef(updateFileContent);
  updateFileContentRef.current = updateFileContent;
  const shareTokenRef = useRef(shareToken);
  shareTokenRef.current = shareToken;

  useEffect(() => {
    if (!sessionId || !selectedFile || !displayName) {
      // Wait for an identity before joining the room — avoids broadcasting
      // an "Anonymous" awareness state and then having to overwrite it.
      setYText(null);
      setProvider(null);
      return;
    }

    const roomId = `${sessionId}-${selectedFile}`;

    if (roomId === currentRoomRef.current && sessionRef.current) {
      return;
    }

    if (sessionRef.current) {
      sessionRef.current.disconnect();
      sessionRef.current = null;
    }

    currentRoomRef.current = roomId;
    let cancelled = false;
    let e2bTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSavedContent: string | null = null;

    const connect = async () => {
      const { initCollaboration } = await import("@/lib/collaboration");
      if (cancelled) return;

      const session = initCollaboration({ roomId, username: displayName ?? "Anonymous" });
      if (cancelled) {
        session.disconnect();
        return;
      }

      sessionRef.current = session;
      setYText(session.yText);
      setProvider(session.provider);
      setConnectionStatus("connecting");

      const updateStatus = (event: { status: string }) => {
        if (cancelled) return;
        if (event.status === "connected") {
          setConnectionStatus("connected");
        } else if (event.status === "disconnected") {
          setConnectionStatus("disconnected");
        }
      };
      session.provider.on("status", updateStatus);

      const awareness = session.provider.awareness;
      if (awareness) {
        const updateUsers = () => {
          if (cancelled) return;
          const states = awareness.getStates();
          const users: { id: string; name: string; color: string }[] = [];
          states.forEach((state, clientId) => {
            if (clientId === awareness.clientID) return;
            if (state.user) {
              users.push({
                id: String(clientId),
                name: state.user.name || "Anonymous",
                color: state.user.color || "#888",
              });
            }
          });
          setConnectedUsers(users);
        };
        awareness.on("change", updateUsers);
        updateUsers();
      }

      // Mirror Yjs edits → file tree (for sidebar/etc) and → E2B sandbox.
      // Only push to E2B for changes the user actually typed in this browser:
      //   - remote updates from the server come from the agent (which already
      //     wrote E2B) or other clients (whose edits also already went to E2B
      //     from their own session).
      //   - seed transactions (origin "local-seed") come from CodeEditor
      //     re-applying initialContent that itself came from the agent.
      // Bouncing those back through /api/write-to-sandbox is at best wasted,
      // at worst stomps on a newer agent write that hasn't reached us yet.
      const observer = (
        _event: Y.YTextEvent,
        transaction: Y.Transaction,
      ) => {
        if (cancelled) return;
        const content = session.yText.toString();
        updateFileContentRef.current(selectedFile, content);

        if (!transaction.local) return;
        if (transaction.origin === "local-seed") return;

        const sbx = sandboxIdRef.current;
        if (!sbx) return;
        if (e2bTimer) clearTimeout(e2bTimer);
        e2bTimer = setTimeout(async () => {
          if (cancelled) return;
          if (lastSavedContent === content) return;
          lastSavedContent = content;
          try {
            setIsSyncingToE2BRef.current(true);
            await fetch("/api/write-to-sandbox", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sandboxId: sbx,
                filePath: selectedFile,
                content,
                sessionId,
                shareToken: shareTokenRef.current ?? undefined,
              }),
            });
          } catch (err) {
            console.error("[E2B sync] write failed:", err);
          } finally {
            if (!cancelled) setIsSyncingToE2BRef.current(false);
          }
        }, E2B_SYNC_DEBOUNCE_MS);
      };
      session.yText.observe(observer);
    };

    connect();

    return () => {
      cancelled = true;
      if (e2bTimer) clearTimeout(e2bTimer);
      if (sessionRef.current) {
        sessionRef.current.disconnect();
        sessionRef.current = null;
      }
      currentRoomRef.current = "";
      setYText(null);
      setProvider(null);
      setConnectionStatus("disconnected");
      setConnectedUsers([]);
    };
  }, [sessionId, selectedFile, displayName, setConnectionStatus, setConnectedUsers]);

  return { yText, provider };
}
