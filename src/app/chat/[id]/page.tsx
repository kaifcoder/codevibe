"use client";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatPanel, ChatMessage, ChatMessageStep } from "@/components/ChatPanel";
import { ShareButton } from "@/components/ShareButton";
import { DownloadButton } from "@/components/DownloadButton";
import { DeployButton } from "@/components/DeployButton";
import { TemplateApprovalCard } from "@/components/TemplateApprovalCard";
import { Users } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { MobileChatLayout } from "@/components/MobileChatLayout";
import { DesktopChatLayout } from "@/components/DesktopChatLayout";
import { PreviewShimmer } from "@/components/ui/shimmer";
import { ChatProvider, useChat } from "@/contexts/chat-context";
import { NamePromptDialog } from "@/components/NamePromptDialog";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";

const SANDBOX_EXPIRY_MS = 25 * 60 * 1000;

// Derive a chat title from the first user message — trimmed to ~50 chars on a word boundary.
function generateTitle(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 50) return trimmed;
  const sliced = trimmed.slice(0, 50);
  const lastSpace = sliced.lastIndexOf(" ");
  return (lastSpace > 30 ? sliced.slice(0, lastSpace) : sliced) + "…";
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function Page({ params }: PageProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    params.then(({ id }) => setSessionId(id));
  }, [params]);

  if (!sessionId) return null;

  // key={sessionId} forces full remount on session change — resets all useState
  // and useStream's internal thread state cleanly.
  return (
    <ChatProvider key={sessionId} sessionId={sessionId}>
      <ChatPage />
    </ChatProvider>
  );
}

// Build a snapshot string used to skip re-deriving messages when nothing changed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function snapshotStream(messages: any[], toolCalls: any[] | undefined, isLoading: boolean): string {
  const toolSnapshot = toolCalls
    ? toolCalls.map((tc) => `${tc.call?.id}:${tc.state}`).join(",")
    : "";
  return (
    messages
      .map((msg) => {
        const c = msg.content;
        let len = 0;
        if (typeof c === "string") {
          len = c.length;
        } else if (Array.isArray(c)) {
          for (const block of c) {
            if (block.type === "text") len += block.text?.length || 0;
            else if (block.type === "thinking" || block.type === "reasoning")
              len += block.thinking?.length || block.reasoning?.length || 0;
            else len += 1;
          }
        }
        return `${msg.id ?? ""}:${len}`;
      })
      .join("|") + `|loading:${isLoading}|tc:${toolSnapshot}`
  );
}

// Module-level per-session timestamp cache. Survives chat navigation
// (refs/state are wiped on remount, but this Map outlives them). Lost on
// full page reload, which is acceptable — we'd otherwise need DB persistence.
const timestampCachesBySession = new Map<string, Map<string, number>>();

function getTimestampCache(sessionId: string): Map<string, number> {
  let cache = timestampCachesBySession.get(sessionId);
  if (!cache) {
    cache = new Map();
    timestampCachesBySession.set(sessionId, cache);
  }
  return cache;
}

function deriveChatMessages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streamMessages: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolCalls: any[] | undefined,
  isLoading: boolean,
  timestampCache: Map<string, number>,
  captureNewTimestamps: boolean,
): ChatMessage[] {
  const now = Date.now();
  // Returns the persisted timestamp for an id, or — only when we're allowed
  // to capture new ones — assigns and remembers `now`. Messages loaded via
  // thread-rehydration (switchThread on revisit) are recorded with a
  // sentinel `0` so they stay timestamp-less even after the user later
  // interacts and capture is enabled.
  const getTimestamp = (id: string): number | undefined => {
    const existing = timestampCache.get(id);
    if (existing !== undefined) return existing === 0 ? undefined : existing;
    if (!captureNewTimestamps) {
      timestampCache.set(id, 0);
      return undefined;
    }
    timestampCache.set(id, now);
    return now;
  };

  const mapped: ChatMessage[] = [];
  let currentAiTurn: {
    content: string;
    reasoning: string;
    toolCalls: NonNullable<ChatMessage["toolCalls"]>;
    steps: ChatMessageStep[];
    id: string;
    lastIndex: number;
  } | null = null;

  const flushAiTurn = () => {
    if (!currentAiTurn) return;
    const isLast = currentAiTurn.lastIndex === streamMessages.length - 1;
    mapped.push({
      role: "ai",
      content: currentAiTurn.content,
      reasoning: currentAiTurn.reasoning || undefined,
      timestamp: getTimestamp(currentAiTurn.id),
      id: currentAiTurn.id,
      status: isLoading && isLast ? "streaming" : "complete",
      toolCalls: currentAiTurn.toolCalls.length > 0 ? currentAiTurn.toolCalls : undefined,
      steps: currentAiTurn.steps.length > 0 ? currentAiTurn.steps : undefined,
    });
    currentAiTurn = null;
  };

  for (let i = 0; i < streamMessages.length; i++) {
    const msg = streamMessages[i];
    const msgType = msg.type as string;

    if (msgType === "tool") continue;

    if (msgType === "human") {
      flushAiTurn();
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text") content += block.text || "";
        }
      }
      if (content) {
        const id = msg.id || `msg-${i}`;
        mapped.push({
          role: "user",
          content,
          timestamp: getTimestamp(id),
          id,
          status: "complete",
        });
      }
      continue;
    }

    if (msgType === "ai") {
      if (!currentAiTurn) {
        currentAiTurn = {
          content: "",
          reasoning: "",
          toolCalls: [],
          steps: [],
          id: msg.id || `msg-${i}`,
          lastIndex: i,
        };
      }
      currentAiTurn.lastIndex = i;

      // Per-message ordered emission: reasoning → text → tools. This
      // matches Anthropic's canonical block order within a single turn,
      // and across multi-turn agent runs it produces a properly
      // interleaved sequence (commentary BEFORE the tool calls it
      // describes, not all bunched at the end).
      if (typeof msg.content === "string") {
        if (msg.content) {
          currentAiTurn.content += (currentAiTurn.content ? "\n\n" : "") + msg.content;
          currentAiTurn.steps.push({ kind: "text", content: msg.content });
        }
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "thinking" || block.type === "reasoning") {
            const r = block.thinking || block.reasoning || "";
            if (r) {
              currentAiTurn.reasoning += r;
              currentAiTurn.steps.push({ kind: "reasoning", content: r });
            }
          }
        }
        for (const block of msg.content) {
          if (block.type === "text" && block.text) {
            currentAiTurn.content += (currentAiTurn.content ? "\n\n" : "") + block.text;
            currentAiTurn.steps.push({ kind: "text", content: block.text });
          }
        }
      }

      if (toolCalls) {
        const msgToolCalls = msg.tool_calls as
          | Array<{ id?: string; name: string; args: Record<string, unknown> }>
          | undefined;
        if (msgToolCalls) {
          for (const tc of msgToolCalls) {
            const match = toolCalls.find((stc) => stc.call.id === tc.id);
            const toolEntry = {
              tool: tc.name,
              args: tc.args,
              result: match?.result?.content as string | undefined,
              status:
                match?.state === "pending"
                  ? ("running" as const)
                  : match?.state === "error"
                    ? ("error" as const)
                    : match?.state === "completed"
                      ? ("complete" as const)
                      : ("running" as const),
            };
            currentAiTurn.toolCalls.push(toolEntry);
            currentAiTurn.steps.push({ kind: "tool", tool: toolEntry });
          }
        }
      }
      continue;
    }
  }

  flushAiTurn();

  return mapped.filter((msg) => {
    if (msg.role === "ai" && !msg.content && !msg.toolCalls?.length && !msg.reasoning && msg.status !== "streaming") {
      return false;
    }
    if (msg.role === "ai" && msg.content && msg.content.startsWith("Here is a summary of the conversation")) {
      return false;
    }
    return true;
  });
}

function ChatPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shareToken = searchParams.get("token");
  const promptParam = searchParams.get("prompt");
  const isSharedAccess = !!shareToken;

  const ctx = useChat();
  const { sessionId } = ctx;

  const stream = useAgentStream();

  // --- Local UI state ---
  const [isMounted, setIsMounted] = useState(false);
  const [message, setMessage] = useState("");
  const [isCheckingExpiration, setIsCheckingExpiration] = useState(false);
  // For n8n sandboxes: URL of the codevibe-side reverse proxy. Iframes load
  // from here instead of the e2b URL so the n8n auth cookie lands first-party
  // (browsers block third-party cookies in iframes even with SameSite=None).
  const [n8nProxyUrl, setN8nProxyUrl] = useState<string | null>(null);

  // --- Refs for one-shot effects ---
  const didInitRef = useRef(false);
  const sessionExistsRef = useRef(false);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasAutoSentRef = useRef(false);
  const switchedThreadRef = useRef(false);
  const titleSetRef = useRef(false);
  // Auto-save guard: only PATCH session data after the user has actually
  // interacted in this session — prevents a passive visit from bumping
  // updatedAt (which would re-order the sidebar).
  const hasUserInteractedRef = useRef(false);

  const guestCredentials = useMemo(() => {
    if (!isSharedAccess) return null;
    const randomId = Math.floor(Math.random() * 10000);
    return { username: `Guest-${randomId}`, userId: `guest-${Date.now()}-${randomId}` };
  }, [isSharedAccess]);
  void guestCredentials;

  const isMobile = useIsMobile();

  // --- Derive ChatMessage[] from stream.messages (single source of truth) ---
  const prevSnapshotRef = useRef("");
  const prevDerivedRef = useRef<ChatMessage[]>([]);
  const messages = useMemo(() => {
    const streamMessages = stream.messages || [];
    if (streamMessages.length === 0) return prevDerivedRef.current;
    const snapshot = snapshotStream(streamMessages, stream.toolCalls, stream.isLoading);
    if (snapshot === prevSnapshotRef.current) return prevDerivedRef.current;
    prevSnapshotRef.current = snapshot;
    const derived = deriveChatMessages(
      streamMessages,
      stream.toolCalls,
      stream.isLoading,
      getTimestampCache(sessionId),
      hasUserInteractedRef.current,
    );
    prevDerivedRef.current = derived;
    return derived;
  }, [stream.messages, stream.toolCalls, stream.isLoading, sessionId]);

  // --- Send message via useStream ---
  const handleSend = useCallback(() => {
    const text = message.trim();
    if (!text) return;
    setMessage("");
    hasUserInteractedRef.current = true;
    stream.submit(
      { messages: [{ type: "human", content: text }] },
      {
        onDisconnect: "continue",
        streamResumable: true,
        // Tell the server to enqueue this run if one is already in flight
        // (instead of the default reject/replace). useStream then surfaces
        // pending entries via stream.queue, which <QueueList> renders.
        multitaskStrategy: "enqueue",
        config: {
          configurable: {
            sessionId,
            templateType: ctx.templateType,
            templateDecided: ctx.templateDecided,
          },
        },
      } as Record<string, unknown>,
    );
  }, [message, stream, sessionId, ctx.templateType, ctx.templateDecided]);

  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  // --- HITL approval handlers (resume the run with approve / edit) ---
  const resumeWithDecision = useCallback(
    (decision: { type: "approve" } | { type: "edit"; editedAction: { name: string; args: Record<string, unknown> } }) => {
      stream.submit(null, {
        config: {
          configurable: {
            sessionId,
            templateType: ctx.templateType,
            templateDecided: ctx.templateDecided,
          },
        },
        command: { resume: { decisions: [decision] } },
      } as Record<string, unknown>);
    },
    [stream, sessionId, ctx.templateType, ctx.templateDecided],
  );

  const interruptValue = stream.interrupt?.value as
    | { actionRequests?: Array<{ name: string; args: Record<string, unknown>; description?: string }>; reviewConfigs?: Array<{ actionName: string; allowedDecisions: string[] }> }
    | undefined;
  const setTemplateRequest =
    interruptValue?.actionRequests?.find((a) => a.name === "set_template") &&
    (interruptValue as Parameters<typeof TemplateApprovalCard>[0]["request"]);

  const interruptSlot = setTemplateRequest ? (
    <TemplateApprovalCard
      request={setTemplateRequest}
      disabled={stream.isLoading}
      onApprove={() => resumeWithDecision({ type: "approve" })}
      onEdit={(templateType) =>
        resumeWithDecision({
          type: "edit",
          editedAction: {
            name: "set_template",
            args: { templateType, reasoning: "User overrode template selection." },
          },
        })
      }
    />
  ) : null;

  // --- DB session creation ---
  const createDbSession = useMutation(
    trpc.session.createSession.mutationOptions({
      onSuccess: (data) => {
        sessionExistsRef.current = true;
        globalThis.dispatchEvent(new CustomEvent("chatUpdated"));
        if (ctx.threadId) {
          fetch(`/api/session/${data.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ threadId: ctx.threadId }),
          }).catch(() => {});
        }
      },
      onError: (error) => {
        console.error("[DB] Failed to create session:", error);
        setTimeout(() => {
          createDbSessionRef.current.mutate({ id: sessionId, title: `Chat ${new Date().toLocaleString()}` });
        }, 2000);
      },
    }),
  );
  const createDbSessionRef = useRef(createDbSession);
  createDbSessionRef.current = createDbSession;

  // --- Initialize session on mount ---
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    // Pull initial prompt from URL (set by home page handoff) and clear it from the URL.
    if (promptParam) {
      setMessage(promptParam);
      router.replace(`/chat/${sessionId}`, { scroll: false });
    }

    const initSession = async () => {
      try {
        const response = await fetch(
          `/api/session/${sessionId}${shareToken ? `?token=${encodeURIComponent(shareToken)}` : ""}`,
        );
        if (response.status === 404) {
          createDbSessionRef.current.mutate({ id: sessionId, title: `Chat ${new Date().toLocaleString()}` });
        } else if (response.ok) {
          sessionExistsRef.current = true;
        }
      } catch (error) {
        console.error("[DB] Error checking session:", error);
      }
    };
    initSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Load session data from DB ---
  useEffect(() => {
    if (!sessionId) return;

    const loadSession = async () => {
      try {
        const response = await fetch(
          `/api/session/${sessionId}${shareToken ? `?token=${encodeURIComponent(shareToken)}` : ""}`,
        );
        if (!response.ok) return;

        const session = await response.json();
        sessionExistsRef.current = true;

        // If the session already has a non-default title, treat it as set so
        // we don't PATCH it again on revisit.
        if (session.title && !/^Chat \d/.test(session.title)) {
          titleSetRef.current = true;
        }

        if (session.threadId) {
          ctx.setThreadId(session.threadId);
          if (!switchedThreadRef.current && stream.switchThread) {
            switchedThreadRef.current = true;
            stream.switchThread(session.threadId);
          }
        }

        if (session.templateType === "nextjs" || session.templateType === "n8n") {
          ctx.setTemplateType(session.templateType);
        }
        if (typeof session.templateDecided === "boolean") {
          ctx.setTemplateDecided(session.templateDecided);
        }

        if (session.fileTree && Array.isArray(session.fileTree)) {
          ctx.setFileTree(session.fileTree);
        }

        if (session.sandboxId) {
          ctx.setSandboxId(session.sandboxId);
          ctx.setIsSyncingFilesystem(true);
          setTimeout(async () => {
            try {
              const res = await fetch("/api/sync-filesystem", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sandboxId: session.sandboxId, sessionId }),
              });
              if (res.ok) {
                const data = await res.json();
                if (data.fileTree) ctx.setFileTree(data.fileTree);
              }
            } catch (err) {
              console.error("[Sync] Auto-sync failed:", err);
            } finally {
              ctx.setIsSyncingFilesystem(false);
            }
          }, 1000);
        }

        if (session.sandboxUrl) {
          ctx.setSandboxUrl(session.sandboxUrl);
          ctx.setShowSecondPanel(true);
          if (session.sandboxCreatedAt) {
            setIsCheckingExpiration(true);
            const createdTime = new Date(session.sandboxCreatedAt).getTime();
            ctx.setSandboxCreatedAt(createdTime);
            const elapsed = Date.now() - createdTime;
            setTimeout(() => {
              if (elapsed >= SANDBOX_EXPIRY_MS) ctx.setIsSandboxExpired(true);
              setIsCheckingExpiration(false);
            }, 500);
          } else {
            ctx.setSandboxCreatedAt(Date.now());
          }
        }
      } catch (error) {
        console.error("[DB] Failed to load session:", error);
      }
    };
    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // --- Auto-send initial prompt from URL ---
  useEffect(() => {
    if (!promptParam || hasAutoSentRef.current) return;
    if (!message.trim()) return;
    if (messages.length > 1) return;

    hasAutoSentRef.current = true;
    const attemptSend = (retries = 3) => {
      const text = message.trim();
      if (!text) return;
      try {
        handleSendRef.current();
      } catch (e) {
        if (retries > 0) {
          setTimeout(() => attemptSend(retries - 1), 500);
        } else {
          console.error("[AutoSend] Failed after retries:", e);
        }
      }
    };
    setTimeout(() => attemptSend(), 300);
  }, [message, messages.length, promptParam]);

  // --- Code editor changes are handled inside useCollaboration via yText.observe ---

  // --- Sandbox expiration check ---
  useEffect(() => {
    const { sandboxCreatedAt, sandboxUrl } = ctx;
    if (!sandboxCreatedAt || !sandboxUrl) return;
    const checkExpiration = () => {
      if (Date.now() - sandboxCreatedAt >= SANDBOX_EXPIRY_MS) ctx.setIsSandboxExpired(true);
    };
    checkExpiration();
    const interval = setInterval(checkExpiration, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.sandboxCreatedAt, ctx.sandboxUrl]);

  // When the sandbox transitions to expired, kick the user off the preview
  // tab (it'd just show the "Expired" placeholder). Depending on `[ctx]`
  // makes this fire on every state change and stomps the "live preview"
  // setActiveTab from the next sandboxCreated event.
  useEffect(() => {
    if (ctx.isSandboxExpired) ctx.setActiveTab("code");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.isSandboxExpired]);

  // n8n sessions have no code panel — pin the preview tab so the iframe stays
  // visible even if some other effect tried to flip to "code".
  useEffect(() => {
    if (ctx.templateType === "n8n" && ctx.activeTab !== "live preview") {
      ctx.setActiveTab("live preview");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.templateType, ctx.activeTab]);

  // n8n iframe routes through codevibe's reverse proxy so its auth cookie
  // is first-party. Register the active sandbox URL with the proxy whenever
  // it changes; clear the proxy URL otherwise so the nextjs iframe just uses
  // ctx.sandboxUrl directly.
  useEffect(() => {
    if (ctx.templateType !== "n8n" || !ctx.sandboxUrl) {
      setN8nProxyUrl(null);
      return;
    }
    let cancelled = false;
    fetch("/api/n8n-proxy/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sandboxUrl: ctx.sandboxUrl }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.proxyUrl) {
          setN8nProxyUrl(data.proxyUrl);
        } else {
          console.error("[n8n-proxy] register failed:", data?.error);
          setN8nProxyUrl(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[n8n-proxy] register threw:", err);
        setN8nProxyUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.templateType, ctx.sandboxUrl]);

  // --- Auto-save session to DB ---
  useEffect(() => {
    if (!sessionId || !sessionExistsRef.current) return;
    // Skip until the user actually interacts — prevents a passive open
    // from bumping `updatedAt` and re-ordering the sidebar.
    if (!hasUserInteractedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch(`/api/session/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: ctx.threadId || undefined,
          fileTree: ctx.fileTree.length > 0 ? ctx.fileTree : undefined,
          sandboxId: ctx.sandboxId || undefined,
          sandboxUrl: ctx.sandboxUrl || undefined,
          sandboxCreatedAt: ctx.sandboxCreatedAt ? new Date(ctx.sandboxCreatedAt).toISOString() : undefined,
        }),
      }).catch((err) => console.error("[DB] Failed to save session:", err));
    }, 2000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sessionId, ctx.threadId, ctx.fileTree, ctx.sandboxId, ctx.sandboxUrl, ctx.sandboxCreatedAt]);

  // --- Notify sidebar on new user message ---
  useEffect(() => {
    if (messages.some((m) => m.role === "user") && typeof globalThis !== "undefined") {
      globalThis.dispatchEvent(new CustomEvent("chatUpdated"));
    }
  }, [messages]);

  // --- Set the session title from the first user message (once per session) ---
  useEffect(() => {
    if (titleSetRef.current) return;
    if (!sessionId || !sessionExistsRef.current) return;
    // Only set the title when this session originated user activity in this
    // visit. Without this gate, switchThread re-hydrates prior messages on
    // every open and we'd PATCH the title (and updatedAt) on each click.
    if (!hasUserInteractedRef.current) return;
    const firstUserMsg = messages.find((m) => m.role === "user" && m.content.trim());
    if (!firstUserMsg) return;

    titleSetRef.current = true;
    const title = generateTitle(firstUserMsg.content);
    fetch(`/api/session/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    })
      .then(() => {
        globalThis.dispatchEvent(new CustomEvent("chatUpdated"));
      })
      .catch((err) => console.error("[Title] Failed to set:", err));
  }, [messages, sessionId]);

  // --- Render preview ---
  const renderPreview = () => {
    if (isCheckingExpiration) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="animate-spin rounded-full border-4 border-gray-300 border-t-primary h-16 w-16" />
          <p className="text-sm text-muted-foreground">Checking sandbox status...</p>
        </div>
      );
    }

    if (ctx.sandboxUrl && !ctx.isSandboxExpired) {
      return (
        <div className="relative w-full h-full flex flex-col bg-background">
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
            <div className="flex items-center gap-1 mr-2">
              <button
                type="button"
                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                onClick={() => {
                  ctx.setIframeLoading(true);
                  const iframe = document.querySelector('iframe[title="Sandbox Preview"]') as HTMLIFrameElement;
                  if (iframe) {
                    const s = iframe.src;
                    iframe.src = "";
                    setTimeout(() => {
                      iframe.src = s;
                    }, 0);
                  }
                }}
                title="Refresh"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>
            <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-background rounded-md border text-sm">
              <svg className="w-3.5 h-3.5 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-muted-foreground truncate font-mono text-xs">{ctx.sandboxUrl}</span>
              <button
                type="button"
                className="ml-auto p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(ctx.sandboxUrl!);
                  toast.success("URL copied");
                }}
                title="Copy URL"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </button>
            </div>
            <button
              type="button"
              className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              onClick={() => globalThis.open(ctx.sandboxUrl!, "_blank")}
              title="Open in new tab"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </button>
          </div>
          <div className="relative flex-1 min-h-0">
            {ctx.iframeLoading && (
              <div className="absolute inset-0 z-10">
                <PreviewShimmer />
              </div>
            )}
            <iframe
              key={`${sessionId}-${ctx.sandboxUrl}-${n8nProxyUrl ?? ""}-${ctx.n8nWorkflowId ?? ""}`}
              src={
                ctx.templateType === "n8n" && n8nProxyUrl
                  ? `${n8nProxyUrl}${ctx.n8nWorkflowId ? `/workflow/${ctx.n8nWorkflowId}` : ""}`
                  : ctx.sandboxUrl
              }
              className={`w-full h-full border-0 transition-opacity duration-300 ${ctx.iframeLoading ? "opacity-0" : "opacity-100"}`}
              onLoad={() => ctx.setIframeLoading(false)}
              title="Sandbox Preview"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              allow="clipboard-write; clipboard-read; microphone; camera; accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            />
          </div>
        </div>
      );
    }

    if (ctx.isSandboxExpired) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="text-6xl">⏱️</div>
          <div className="space-y-3">
            <h3 className="text-xl font-semibold text-foreground">Sandbox Expired</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              This sandbox has expired after 25 minutes of inactivity.
            </p>
          </div>
        </div>
      );
    }

    return null;
  };

  const renderMainContent = () => {
    if (!ctx.showSecondPanel) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="max-w-4xl w-full px-4 sm:px-6 lg:px-8 h-full flex flex-col">
            <ChatPanel
              messages={messages}
              message={message}
              setMessage={setMessage}
              onSend={handleSend}
              isLoading={stream.isLoading}
              isStreaming={stream.isLoading}
              queue={stream.queue}
              interruptSlot={interruptSlot}
            />
          </div>
        </div>
      );
    }

    if (isMobile) {
      return (
        <MobileChatLayout
          messages={messages}
          message={message}
          setMessage={setMessage}
          handleSend={handleSend}
          isLoading={stream.isLoading}
          isStreaming={stream.isLoading}
          renderPreview={renderPreview}
          queue={stream.queue}
          interruptSlot={interruptSlot}
        />
      );
    }

    return (
      <DesktopChatLayout
        messages={messages}
        message={message}
        setMessage={setMessage}
        handleSend={handleSend}
        isLoading={stream.isLoading}
        isStreaming={stream.isLoading}
        renderPreview={renderPreview}
        queue={stream.queue}
        interruptSlot={interruptSlot}
      />
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <NamePromptDialog />
      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="flex items-center gap-3">
         
          {isSharedAccess && (
            <Badge variant="secondary" className="text-xs">
              <Users className="h-3 w-3 mr-1" />
              Shared Session
            </Badge>
          )}
  
          {ctx.sandboxUrl && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Sandbox Active
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {ctx.showSecondPanel && ctx.templateType !== "n8n" && (
            <Tabs value={ctx.activeTab} onValueChange={ctx.setActiveTab}>
              <TabsList className="h-7 bg-muted/50">
                <TabsTrigger value="live preview" className="text-xs h-6 px-3">
                  Preview
                </TabsTrigger>
                <TabsTrigger value="code" className="text-xs h-6 px-3">
                  Code
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {ctx.connectedUsers.length > 0 && (
            <TooltipProvider>
              <div className="flex items-center gap-1">
                {ctx.connectedUsers.map((user) => (
                  <Tooltip key={user.id}>
                    <TooltipTrigger asChild>
                      <Avatar
                        className="h-7 w-7 border-2 -ml-2 first:ml-0"
                        style={{ borderColor: user.color }}
                      >
                        <AvatarFallback style={{ backgroundColor: user.color + "20", color: user.color }}>
                          {user.name.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{user.name}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
          )}

          {isMounted && sessionId && <DownloadButton sessionId={sessionId} />}
          {isMounted && sessionId && ctx.templateType !== "n8n" && <DeployButton sessionId={sessionId} />}
          {isMounted && sessionId && !isSharedAccess && <ShareButton sessionId={sessionId} />}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">{renderMainContent()}</div>
    </div>
  );
}
