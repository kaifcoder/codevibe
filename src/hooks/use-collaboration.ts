"use client";

import { useEffect, useRef, useState } from "react";
import { useChatStore } from "@/stores/chat-store";
import type { CollaborationSession } from "@/lib/collaboration";
import type * as Y from "yjs";
import type { HocuspocusProvider } from "@hocuspocus/provider";

interface UseCollaborationReturn {
  yText: Y.Text | null;
  provider: HocuspocusProvider | null;
}

export function useCollaboration(sessionId: string, selectedFile: string): UseCollaborationReturn {
  const [yText, setYText] = useState<Y.Text | null>(null);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const sessionRef = useRef<CollaborationSession | null>(null);
  const currentRoomRef = useRef<string>("");
  const setConnectionStatus = useChatStore(s => s.setConnectionStatus);
  const setConnectedUsers = useChatStore(s => s.setConnectedUsers);

  useEffect(() => {
    if (!sessionId || !selectedFile) {
      setYText(null);
      setProvider(null);
      return;
    }

    const roomId = `${sessionId}-${selectedFile}`;

    if (roomId === currentRoomRef.current && sessionRef.current) {
      return;
    }

    // Disconnect previous room
    if (sessionRef.current) {
      sessionRef.current.disconnect();
      sessionRef.current = null;
    }

    currentRoomRef.current = roomId;
    let cancelled = false;

    const connect = async () => {
      const { initCollaboration } = await import("@/lib/collaboration");
      if (cancelled) return;

      const session = initCollaboration({ roomId });
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
    };

    connect();

    return () => {
      cancelled = true;
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
  }, [sessionId, selectedFile, setConnectionStatus, setConnectedUsers]);

  return { yText, provider };
}
