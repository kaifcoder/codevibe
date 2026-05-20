"use client";

import { useStream } from "@langchain/langgraph-sdk/react";
import { useCallback, useEffect, useRef } from "react";
import { useChat } from "@/contexts/chat-context";
import type { FileNode } from "@/contexts/chat-context";

const AGENT_URL = process.env.NEXT_PUBLIC_LANGGRAPH_URL || "http://localhost:2024";

interface CodePatchEvent {
  type: "codePatch";
  filePath: string;
  content?: string;
  action: "streaming_start" | "streaming_chunk" | "streaming_end";
}

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
  | CodePatchEvent
  | FileTreeSyncEvent
  | SandboxCreatedEvent
  | SandboxExpiredEvent
  | ToolProgressEvent
  | ToolResultEvent;

function findFileInTree(nodes: FileNode[], path: string): boolean {
  for (const node of nodes) {
    if (node.type === "file" && node.path === path) return true;
    if (node.type === "folder" && node.children && findFileInTree(node.children, path)) return true;
  }
  return false;
}

function addFileToTree(nodes: FileNode[], filePath: string, content: string): FileNode[] {
  const segments = filePath.split("/");
  if (segments.length === 1) {
    if (nodes.some((n) => n.type === "file" && n.name === segments[0])) {
      return nodes.map((n) =>
        n.type === "file" && n.name === segments[0] ? { ...n, content } : n,
      );
    }
    return [...nodes, { name: segments[0], path: filePath, type: "file" as const, content }];
  }

  const folderName = segments[0];
  const remainingPath = segments.slice(1).join("/");
  const existing = nodes.find((n) => n.type === "folder" && n.name === folderName);

  if (existing && existing.children) {
    return nodes.map((n) => {
      if (n === existing) {
        return { ...n, children: addFileToTree(n.children!, remainingPath, content) };
      }
      return n;
    });
  }

  const folderPath = segments.slice(0, segments.length - 1).join("/");
  const newFolder: FileNode = {
    name: folderName,
    path: folderPath.includes("/") ? folderPath : folderName,
    type: "folder",
    children: addFileToTree([], remainingPath, content),
  };
  return [...nodes, newFolder];
}

function updateFileInTree(
  nodes: FileNode[],
  path: string,
  updater: (existing: string | undefined) => string,
): FileNode[] {
  return nodes.map((node) => {
    if (node.type === "file" && node.path === path) {
      return { ...node, content: updater(node.content) };
    }
    if (node.type === "folder" && node.children) {
      return { ...node, children: updateFileInTree(node.children, path, updater) };
    }
    return node;
  });
}

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

  const streamingLengthRef = useRef<Record<string, number>>({});
  const yjsFlushTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
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

      case "codePatch": {
        const { filePath, content, action } = event;
        if (!filePath) break;

        if (action === "streaming_start") {
          streamingLengthRef.current[filePath] = 0;
          c.setStreamingFiles((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
          c.setSelectedFile(filePath);
          c.setOpenFiles((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
          c.setFileTree((prev) =>
            findFileInTree(prev, filePath) ? prev : addFileToTree(prev, filePath, ""),
          );
          const roomId = `${sessionIdRef.current}-${filePath}`;
          import("@/lib/collaboration").then(({ getExistingYText }) => {
            const yText = getExistingYText(roomId);
            if (yText && yText.length > 0) {
              yText.doc!.transact(() => {
                yText.delete(0, yText.length);
              });
            }
          });
        } else if (action === "streaming_chunk") {
          if (content) {
            c.setFileTree((prev) => updateFileInTree(prev, filePath, () => content));
            const prevLength = streamingLengthRef.current[filePath] || 0;
            const delta = content.slice(prevLength);
            streamingLengthRef.current[filePath] = content.length;

            if (delta.length > 0) {
              if (yjsFlushTimerRef.current[filePath]) {
                clearTimeout(yjsFlushTimerRef.current[filePath]);
              }
              const capturedContent = content;
              const capturedPrevLength = prevLength;
              yjsFlushTimerRef.current[filePath] = setTimeout(() => {
                delete yjsFlushTimerRef.current[filePath];
                const roomId = `${sessionIdRef.current}-${filePath}`;
                import("@/lib/collaboration").then(({ getExistingYText }) => {
                  const yText = getExistingYText(roomId);
                  if (yText) {
                    const appendDelta = capturedContent.slice(capturedPrevLength);
                    if (appendDelta.length > 0) {
                      yText.doc!.transact(() => {
                        yText.insert(yText.length, appendDelta);
                      });
                    }
                  }
                });
              }, 50);
            }
          }
        } else if (action === "streaming_end") {
          c.setStreamingFiles((prev) => prev.filter((f) => f !== filePath));
          delete streamingLengthRef.current[filePath];
          if (yjsFlushTimerRef.current[filePath]) {
            clearTimeout(yjsFlushTimerRef.current[filePath]);
            delete yjsFlushTimerRef.current[filePath];
          }
          if (content) {
            c.setFileTree((prev) =>
              findFileInTree(prev, filePath)
                ? updateFileInTree(prev, filePath, () => content)
                : addFileToTree(prev, filePath, content),
            );
            const roomId = `${sessionIdRef.current}-${filePath}`;
            import("@/lib/collaboration/updateYjsDocument").then(({ updateYjsDocument }) => {
              updateYjsDocument(roomId, content).catch((err) =>
                console.warn("[Yjs] Failed to sync file content:", err),
              );
            });
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
