"use client";

import { useStream } from "@langchain/langgraph-sdk/react";
import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useChat } from "@/contexts/chat-context";
import type { FileNode } from "@/contexts/chat-context";
import { useSessionBroadcast } from "@/hooks/use-session-broadcast";
import type { MessageQueue } from "@/components/QueueList";

const AGENT_URL = process.env.NEXT_PUBLIC_LANGGRAPH_URL || "http://localhost:2024";

interface FileTreeSyncEvent {
  type: "fileTreeSync";
  fileTree: FileNode[];
}

interface FileCreatedEvent {
  type: "fileCreated";
  filePath: string;
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

interface TemplateDecidedEvent {
  type: "templateDecided";
  templateType: "nextjs" | "n8n" | "chat";
  reasoning?: string;
}

interface WorkflowReadyEvent {
  type: "workflowReady";
  workflowId: string;
  workflowName?: string;
}

interface RequiresMcpAuthEvent {
  type: "requiresMcpAuth";
  server: string;
  authUrl: string;
}

interface TokenUsageEvent {
  type: "tokenUsage";
  threadId: string;
  callCostUsd: number;
  threadTotalUsd: number;
  threadCalls: number;
  inputTokens: number;
  outputTokens: number;
}

type CustomEvent =
  | FileTreeSyncEvent
  | FileCreatedEvent
  | SandboxCreatedEvent
  | SandboxExpiredEvent
  | ToolProgressEvent
  | ToolResultEvent
  | TemplateDecidedEvent
  | WorkflowReadyEvent
  | RequiresMcpAuthEvent
  | TokenUsageEvent;

function findFileInTree(nodes: FileNode[], path: string): boolean {
  for (const node of nodes) {
    if (node.type === "file" && node.path === path) return true;
    if (node.type === "folder" && node.children && findFileInTree(node.children, path)) return true;
  }
  return false;
}

function addFileToTree(
  nodes: FileNode[],
  filePath: string,
  content: string,
  parentPath = "",
): FileNode[] {
  const segments = filePath.split("/");
  const fullPath = parentPath ? `${parentPath}/${filePath}` : filePath;

  if (segments.length === 1) {
    if (nodes.some((n) => n.type === "file" && n.name === segments[0])) {
      return nodes.map((n) =>
        n.type === "file" && n.name === segments[0] ? { ...n, path: fullPath, content } : n,
      );
    }
    return [...nodes, { name: segments[0], path: fullPath, type: "file" as const, content }];
  }

  const folderName = segments[0];
  const remainingPath = segments.slice(1).join("/");
  const folderFullPath = parentPath ? `${parentPath}/${folderName}` : folderName;
  const existing = nodes.find((n) => n.type === "folder" && n.name === folderName);

  if (existing && existing.children) {
    return nodes.map((n) => {
      if (n === existing) {
        return {
          ...n,
          children: addFileToTree(n.children!, remainingPath, content, folderFullPath),
        };
      }
      return n;
    });
  }

  const newFolder: FileNode = {
    name: folderName,
    path: folderFullPath,
    type: "folder",
    children: addFileToTree([], remainingPath, content, folderFullPath),
  };
  return [...nodes, newFolder];
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

  // Clerk session JWT — fetched on demand and forwarded to every request the
  // SDK makes to the LangGraph server (Render). The agent server's auth.ts
  // verifies it via `verifyToken` before any /runs or /threads call lands.
  // We use a custom fetch (not defaultHeaders) because session tokens rotate;
  // re-evaluating getToken() per request keeps a long-lived stream from
  // sending an expired token after Clerk silently refreshes.
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const authedFetch = useMemo<typeof fetch>(() => {
    return async (input, init) => {
      const token = await getTokenRef.current?.().catch(() => null);
      const headers = new Headers(init?.headers);
      if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      return fetch(input, { ...init, headers });
    };
  }, []);

  // Session-wide Yjs Y.Map used to mirror the active runId between browsers
  // collaborating on this chat — see joinStream effect below.
  const { broadcast } = useSessionBroadcast(sessionId);
  const broadcastRef = useRef(broadcast);
  broadcastRef.current = broadcast;

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

  // Tracks the runId this browser last broadcasted, so onFinish only clears
  // the slot if it still holds *our* run (a peer may have started a newer run
  // after ours finished and we don't want to wipe theirs).
  const broadcastedRunIdRef = useRef<string | null>(null);

  const handleCustomEvent = useCallback((event: CustomEvent) => {
    const c = ctxRef.current;
    if (!mountedRef.current) return;

    switch (event.type) {
      case "sandboxCreated": {
        // Always update id/url so a fresh tab learns about the live sandbox.
        c.setSandboxId(event.sandboxId);
        c.setSandboxUrl(event.sandboxUrl);
        c.setShowSecondPanel(true);
        c.setIsSandboxExpired(false);

        // The "real" creation events should reset the expiry timer, switch
        // to the preview tab, and start the iframe loader. Reattach events
        // (isNew=false) just tell us the existing sandbox is still alive —
        // don't yank the user's tab or flicker the iframe.
        if (event.isNew) {
          c.setSandboxCreatedAt(Date.now());
          c.setActiveTab("live preview");
          c.setIframeLoading(true);
        }
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

      case "fileCreated": {
        const { filePath } = event;
        if (!filePath) break;
        // Add to tree, but don't yank the user off whatever file they're
        // currently looking at. Auto-select only on first file.
        const isFirst = !c.selectedFile;
        c.setFileTree((prev) =>
          findFileInTree(prev, filePath) ? prev : addFileToTree(prev, filePath, ""),
        );
        if (isFirst) {
          c.setSelectedFile(filePath);
          c.setOpenFiles((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
        }
        break;
      }

      case "tool_progress":
      case "tool_result":
        // Handled natively by useStream's toolCalls
        break;

      case "templateDecided": {
        c.setTemplateType(event.templateType);
        c.setTemplateDecided(true);
        // Persist to DB so re-opens skip the dispatcher.
        const sid = sessionIdRef.current;
        if (sid) {
          const token = c.shareToken;
          const url = `/api/session/${sid}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
          fetch(url, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ templateType: event.templateType, templateDecided: true }),
          }).catch(() => {});
        }
        break;
      }

      case "workflowReady": {
        // Agent imported a workflow — deep-link the iframe to it so the user
        // sees the canvas the agent just built. The page wires this id into
        // the iframe src as `${proxyUrl}/workflow/${id}`.
        c.setN8nWorkflowId(event.workflowId);
        c.setActiveTab("live preview");
        c.setIframeLoading(true);
        break;
      }

      case "requiresMcpAuth": {
        toast.message(`${event.server} authorization required`, {
          description: "Sign in once to let the agent access your data.",
          duration: Infinity,
          id: `mcp-auth-${event.server}`,
          action: {
            label: `Connect ${event.server}`,
            onClick: () => {
              window.open(event.authUrl, "_blank", "noopener,noreferrer");
            },
          },
        });
        break;
      }

      case "tokenUsage": {
        // Per-thread running totals — already aggregated server-side, just
        // mirror the latest snapshot. UI components read this from context
        // to render a running cost indicator.
        c.setTokenUsage({
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          threadCalls: event.threadCalls,
          threadTotalUsd: event.threadTotalUsd,
        });
        break;
      }
    }
  }, []);

  const stream = useStream({
    apiUrl: AGENT_URL,
    callerOptions: { fetch: authedFetch },
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
        const token = ctxRef.current.shareToken;
        const url = `/api/session/${currentSessionId}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
        fetch(url, {
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
      // Mirror the runId to peers so they can joinStream and watch live.
      try {
        broadcastedRunIdRef.current = run.run_id;
        broadcastRef.current?.set("runId", run.run_id);
      } catch (err) {
        console.error("[useStream] broadcast set failed:", err);
      }
    },
    onFinish: () => {
      if (!mountedRef.current) return;
      ctxRef.current.setRunId(null);
      try {
        const ours = broadcastedRunIdRef.current;
        const current = broadcastRef.current?.get("runId");
        if (ours && current === ours) {
          broadcastRef.current?.delete("runId");
        }
        broadcastedRunIdRef.current = null;
      } catch (err) {
        console.error("[useStream] broadcast clear failed:", err);
      }
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

  // Keep joinStream callable from inside the broadcast observer without
  // re-binding the observer every render (joinStream's identity changes).
  const joinStreamRef = useRef<((runId: string) => void) | null>(null);
  joinStreamRef.current = s.joinStream ?? null;

  // Observe peer runIds: when another browser broadcasts a runId and we're
  // not currently running anything ourselves, attach to their stream so the
  // agent's reply appears live in this tab too.
  useEffect(() => {
    if (!broadcast) return;
    const tryJoin = (runId: unknown) => {
      if (typeof runId !== "string" || !runId) return;
      if (broadcastedRunIdRef.current === runId) return; // it's our own run
      if (ctxRef.current.runId) return; // already running our own
      const join = joinStreamRef.current;
      if (!join) return;
      try {
        join(runId);
      } catch (err) {
        console.error("[useStream] joinStream(remote) failed:", err);
      }
    };

    // Catch a runId already in the map when we attach.
    tryJoin(broadcast.get("runId"));

    const handler = (event: import("yjs").YMapEvent<unknown>) => {
      if (!event.changes.keys.has("runId")) return;
      tryJoin(broadcast.get("runId"));
    };
    broadcast.observe(handler);
    return () => {
      broadcast.unobserve(handler);
    };
  }, [broadcast]);

  // ─── Local message queue ──────────────────────────────────────────────
  // The legacy useStream (useStreamLGP) we depend on does NOT expose a
  // `queue` field — it just forwards multitaskStrategy to the server, with
  // no client-side tracker. So <QueueList> never had data to render. Keep
  // our own queue: when the user submits while a run is active, hold the
  // submission locally; drain it the moment isLoading flips false.
  type SubmitArgs = Parameters<typeof s.submit>;
  type QueueItem = { id: string; values: SubmitArgs[0]; options: SubmitArgs[1] };
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);

  const isLoading: boolean = s.isLoading;
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  const queueItemsRef = useRef(queueItems);
  queueItemsRef.current = queueItems;
  const rawSubmitRef = useRef(s.submit);
  rawSubmitRef.current = s.submit;

  const wrappedSubmit = useCallback((values: SubmitArgs[0], options?: SubmitArgs[1]) => {
    if (isLoadingRef.current || queueItemsRef.current.length > 0) {
      // Stream is busy (or earlier-queued items still draining) — hold this
      // one until the active run finishes. Server-side multitaskStrategy is
      // ignored for the queued items because we're submitting one at a time.
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setQueueItems((prev) => [...prev, { id, values, options }]);
      return;
    }
    rawSubmitRef.current(values, options);
  }, []);

  // Drain one item per isLoading→false transition. Submitting flips
  // isLoading back to true, which prevents this effect from re-firing
  // until the next idle moment.
  useEffect(() => {
    if (isLoading || queueItems.length === 0) return;
    const [next, ...rest] = queueItems;
    setQueueItems(rest);
    rawSubmitRef.current(next.values, next.options);
  }, [isLoading, queueItems]);

  const queue: MessageQueue = useMemo(
    () => ({
      size: queueItems.length,
      entries: queueItems.map((q) => {
        const msgs = (q.values as { messages?: unknown } | null | undefined)?.messages;
        if (Array.isArray(msgs)) {
          return { id: q.id, values: { messages: msgs as Array<{ type: string; content: string }> } };
        }
        if (msgs && typeof msgs === "object") {
          return { id: q.id, values: { messages: msgs as { text?: string; content?: string } } };
        }
        return { id: q.id, values: undefined };
      }),
      clear: async () => {
        setQueueItems([]);
      },
      cancel: async (id: string) => {
        setQueueItems((prev) => prev.filter((q) => q.id !== id));
      },
    }),
    [queueItems],
  );

  return {
    messages: s.messages,
    toolCalls: s.toolCalls,
    isLoading: s.isLoading,
    stop: s.stop,
    joinStream: s.joinStream,
    queue,
    switchThread: s.switchThread,
    submit: wrappedSubmit,
    interrupt: s.interrupt,
  };
}
