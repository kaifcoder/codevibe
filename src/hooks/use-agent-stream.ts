"use client";

import { useStream } from "@langchain/langgraph-sdk/react";
import { useCallback, useEffect, useRef } from "react";
import { useChat } from "@/contexts/chat-context";
import type { FileNode } from "@/contexts/chat-context";

const AGENT_URL = process.env.NEXT_PUBLIC_LANGGRAPH_URL || "http://localhost:2024";

interface FileTreeSyncEvent {
  type: "fileTreeSync";
  fileTree: FileNode[];
}

interface SandboxCreatedEvent {
  type: "sandboxCreated";
  sandboxId: string;
  sandboxUrl: string;
  isNew: boolean;
}

interface SandboxExpiredEvent {
  type: "sandboxExpired";
  sandboxId: string;
}

interface ToolProgressEvent {
  type: "tool_progress";
  tool: string;
  args?: Record<string, unknown>;
  message: string;
  status: string;
}

interface ToolResultEvent {
  type: "tool_result";
  tool: string;
  args?: Record<string, unknown>;
  result: string;
}

type CustomEvent =
  | FileTreeSyncEvent
  | SandboxCreatedEvent
  | SandboxExpiredEvent
  | ToolProgressEvent
  | ToolResultEvent;

function findFirstFile(nodes: FileNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "file") return node.path;
    if (node.type === "folder" && node.children) {
      const found = findFirstFile(node.children);
      if (found) return found;
    }
  }
  return null;
}

export function useAgentStream() {
  const ctx = useChat();
  const { sessionId, threadId } = ctx;

  // Latest-context ref so async callbacks always see fresh setters/values
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Tracks the threadId we've already persisted for this session so we don't
  // re-PATCH (and bump updatedAt) when useStream emits onThreadId with the
  // same id on every revisit. Updated synchronously in render to mirror the
  // value loaded into context from the DB.
  const savedThreadIdRef = useRef<string | null>(threadId ?? null);
  savedThreadIdRef.current = threadId ?? savedThreadIdRef.current;

  const handleCustomEvent = useCallback((event: CustomEvent) => {
    const c = ctxRef.current;
    if (!mountedRef.current) return;

    switch (event.type) {
      case "sandboxCreated": {
        c.setSandboxId(event.sandboxId);
        c.setSandboxUrl(event.sandboxUrl);
        c.setShowSecondPanel(true);
        c.setSandboxCreatedAt(Date.now());
        c.setIsSandboxExpired(false);
        c.setActiveTab("live preview");
        c.setIframeLoading(true);
        break;
      }

      case "sandboxExpired": {
        c.setIsSandboxExpired(true);
        break;
      }

      case "fileTreeSync": {
        if (event.fileTree && Array.isArray(event.fileTree)) {
          c.setFileTree(event.fileTree);
          const firstFile = findFirstFile(event.fileTree);
          if (firstFile && !c.selectedFile) {
            c.setSelectedFile(firstFile);
            c.setOpenFiles([firstFile]);
          }
        }
        break;
      }

      case "tool_progress":
      case "tool_result":
        // Handled natively by useStream's toolCalls
        break;
    }
  }, []);

  const stream = useStream({
    apiUrl: AGENT_URL,
    assistantId: "agent",
    threadId: threadId ?? undefined,
    onThreadId: (id: string) => {
      if (!mountedRef.current) return;
      ctxRef.current.setThreadId(id);

      const currentSessionId = sessionIdRef.current;
      if (!currentSessionId) return;

      // Skip if this is the same id we already have persisted — useStream
      // emits onThreadId on every attach, and re-saving an unchanged value
      // still bumps updatedAt and re-orders the sidebar.
      if (savedThreadIdRef.current === id) return;
      savedThreadIdRef.current = id;

      const saveThreadId = (retries = 3) => {
        if (!mountedRef.current || sessionIdRef.current !== currentSessionId) return;
        fetch(`/api/session/${currentSessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId: id }),
        })
          .then((res) => {
            if (!res.ok && retries > 0) {
              setTimeout(() => saveThreadId(retries - 1), 1000);
            }
          })
          .catch(() => {
            if (retries > 0) setTimeout(() => saveThreadId(retries - 1), 1000);
          });
      };
      saveThreadId();
    },
    onCustomEvent: (data: unknown) => {
      handleCustomEvent(data as CustomEvent);
    },
    onCreated: (run: { run_id: string }) => {
      if (!mountedRef.current) return;
      ctxRef.current.setRunId(run.run_id);
    },
    onFinish: () => {
      if (!mountedRef.current) return;
      ctxRef.current.setRunId(null);
    },
    onError: (error: unknown) => {
      console.error("[useStream] Error:", error);
    },
  });

  // Attempt to rejoin a running stream on mount (page refresh)
  const rejoinAttemptedRef = useRef(false);
  useEffect(() => {
    if (rejoinAttemptedRef.current) return;
    rejoinAttemptedRef.current = true;
    const rid = ctxRef.current.runId;
    if (rid && stream.joinStream) {
      stream.joinStream(rid);
    }
  }, [stream]);

  // Auto-rejoin when tab becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const rid = ctxRef.current.runId;
      if (rid && !stream.isLoading && stream.joinStream) {
        stream.joinStream(rid);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [stream]);

  // useStream's exact return type varies by generic params; access dynamic
  // fields (toolCalls, joinStream, switchThread) through an `any` cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = stream as any;

  return {
    messages: s.messages,
    toolCalls: s.toolCalls,
    isLoading: s.isLoading,
    stop: s.stop,
    joinStream: s.joinStream,
    queue: s.queue,
    switchThread: s.switchThread,
    submit: s.submit,
  };
}
