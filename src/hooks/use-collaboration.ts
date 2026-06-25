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
    getFileContent,
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
  const getFileContentRef = useRef(getFileContent);
  getFileContentRef.current = getFileContent;

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
    const unregisterFnRef: { current: (() => void) | null } = { current: null };

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

      // Register this room as "active" so the agent stream handler can apply
      // codePatch events directly into the bound Y.Text when the server-side
      // Yjs mirror failed silently. Imported lazily to keep the SSR path free
      // of yjs internals.
      const { registerActiveRoom, unregisterActiveRoom } = await import(
        "@/lib/collaboration/active-rooms"
      );
      if (cancelled) {
        session.disconnect();
        return;
      }
      registerActiveRoom(roomId, session.yText);
      const registeredYText = session.yText;

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

      // Once Hocuspocus reports the room as synced, decide whether we still
      // need to fetch content from the sandbox. Three cases:
      //   1. yText already has bytes → another client / agent already wrote
      //      them; do nothing.
      //   2. yText is empty AND the in-memory tree has cached content for
      //      this path → CodeEditor will seed from initialContent below.
      //   3. yText is empty AND no cached content → fetch from the live
      //      sandbox so the editor doesn't render an empty buffer for files
      //      that exist in the agent's filesystem but haven't been touched
      //      in this browser yet.
      const ensureContent = async () => {
        if (cancelled) return;
        if (session.yText.length > 0) return;
        const cached = getFileContentRef.current(selectedFile);
        if (cached && cached.length > 0) return;
        const sbx = sandboxIdRef.current;
        if (!sbx) return;
        try {
          const res = await fetch("/api/read-from-sandbox", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sandboxId: sbx,
              filePath: selectedFile,
              sessionId,
              shareToken: shareTokenRef.current ?? undefined,
            }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as { content?: string };
          if (cancelled) return;
          // Re-check yText: another client may have populated the room
          // while the HTTP round-trip was in flight.
          if (session.yText.length > 0) {
            // Just remember the latest content for downstream consumers.
            updateFileContentRef.current(selectedFile, session.yText.toString());
            return;
          }
          const content = data.content ?? "";
          if (!content) return;
          session.yText.doc!.transact(() => {
            session.yText.insert(0, content);
          }, "local-seed");
          updateFileContentRef.current(selectedFile, content);
        } catch (err) {
          console.warn("[useCollaboration] read-from-sandbox failed:", err);
        }
      };

      if (session.provider.synced) {
        void ensureContent();
      } else {
        const onSync = () => {
          session.provider.off("synced", onSync);
          void ensureContent();
        };
        session.provider.on("synced", onSync);
      }

      // Mirror Yjs edits → file tree (for sidebar/etc) and → E2B sandbox.
      // Only push to E2B for changes the user actually typed in this browser:
      //   - remote updates from the server come from the agent (which already
      //     wrote E2B) or other clients (whose edits also already went to E2B
      //     from their own session).
      //   - seed transactions (origin "local-seed") come from CodeEditor
      //     re-applying initialContent that itself came from the agent.
      //   - codePatch transactions (origin "agent-codepatch") come from the
      //     agent stream handler applying a direct codePatch event — the
      //     content already exists on the sandbox, so don't echo it back.
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
        if (transaction.origin === "agent-codepatch") return;

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

      // Stash the unregister so the cleanup below can call it without
      // re-importing the module.
      unregisterFnRef.current = () => unregisterActiveRoom(roomId, registeredYText);
    };

    connect();

    return () => {
      cancelled = true;
      if (e2bTimer) clearTimeout(e2bTimer);
      if (unregisterFnRef.current) {
        unregisterFnRef.current();
        unregisterFnRef.current = null;
      }
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
