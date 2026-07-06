"use client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useSettings } from "@/contexts/settings-context";
import { toast } from "sonner";
import { RefreshCw, Copy, ExternalLink } from "lucide-react";
import { ChatPanel, ChatMessage, ChatMessageStep } from "@/components/ChatPanel";
import { ShareButton } from "@/components/ShareButton";
import { DownloadButton } from "@/components/DownloadButton";
import { DeployButton } from "@/components/DeployButton";
import { GithubButton } from "@/components/GithubButton";
import { TemplateApprovalCard } from "@/components/TemplateApprovalCard";
import { SandboxExpiredPanel } from "@/components/SandboxExpiredPanel";
import { BackendWarmingBanner } from "@/components/BackendWarmingBanner";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { useAgentReady } from "@/hooks/use-agent-ready";
import { MobileChatLayout } from "@/components/MobileChatLayout";
import { DesktopChatLayout } from "@/components/DesktopChatLayout";
import { PreviewShimmer } from "@/components/ui/shimmer";
import { ChatProvider, useChat } from "@/contexts/chat-context";
import { NamePromptDialog } from "@/components/NamePromptDialog";
import { ChatTopBar } from "@/components/ChatTopBar";
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
      // Suppress summarizationMiddleware's synthetic summary messages.
      // LangChain emits them as type:'human' so the agent treats the summary
      // as user-supplied context, but rendering them in chat as a 'You'
      // bubble looks like the user's prompt was replaced. Skip them — the
      // agent uses the summary internally; the chat doesn't need to show it.
      if (
        content.startsWith("Here is a summary of the conversation to date:") ||
        (msg.additional_kwargs as { summary?: unknown } | undefined)?.summary !== undefined
      ) {
        continue;
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
            // If the run has stopped streaming and a tool still has no
            // resolved state, treat it as errored — otherwise it stays in
            // the "running" branch forever and the UI spinner never clears.
            const stalled = !isLoading && !match?.state;
            const toolEntry = {
              tool: tc.name,
              args: tc.args,
              result: match?.result?.content as string | undefined,
              status:
                match?.state === "pending"
                  ? ("running" as const)
                  : match?.state === "error" || stalled
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
  const importRepoParam = searchParams.get("importRepo");
  const isSharedAccess = !!shareToken;

  const ctx = useChat();
  const { sessionId } = ctx;

  const stream = useAgentStream();
  const agentReady = useAgentReady();

  // --- Local UI state ---
  const [isMounted, setIsMounted] = useState(false);
  const [message, setMessage] = useState("");
  const [isCheckingExpiration, setIsCheckingExpiration] = useState(false);
  // Holds the repo full-name (owner/name) while a GitHub repo handed off from
  // the home screen (?importRepo=) is being cloned into a fresh sandbox. Non-null
  // drives the "Importing…" preview panel; cleared once the sandbox is ready.
  const [importingRepoName, setImportingRepoName] = useState<string | null>(null);
  // For n8n sandboxes: URL of the codevibe-side reverse proxy. Iframes load
  // from here instead of the e2b URL so the n8n auth cookie lands first-party
  // (browsers block third-party cookies in iframes even with SameSite=None).
  const [n8nClaimUrl, setN8nClaimUrl] = useState<string | null>(null);

  // --- Refs for one-shot effects ---
  const didInitRef = useRef(false);
  const sessionExistsRef = useRef(false);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasAutoSentRef = useRef(false);
  const didImportRepoRef = useRef(false);
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
  const { user } = useUser();
  const userId = user?.id;
  const { changeTick: settingsChangeTick } = useSettings();

  // Fetch the user's MCP server list. Re-fetched whenever the settings modal
  // closes (via settingsChangeTick) so adding a new server in Settings → Apps
  // takes effect on the next agent message without a page refresh.
  const [userMcpServers, setUserMcpServers] = useState<
    Array<{ id: string; name: string; url: string; authType: string }>
  >([]);
  useEffect(() => {
    if (!userId) {
      setUserMcpServers([]);
      return;
    }
    let cancelled = false;
    fetch("/api/mcp/servers/for-agent")
      .then((r) => (r.ok ? r.json() : { servers: [] }))
      .then((d) => { if (!cancelled) setUserMcpServers(d.servers ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, sessionId, settingsChangeTick]);

  const handleSend = useCallback(() => {
    const text = message.trim();
    if (!text) return;
    setMessage("");
    hasUserInteractedRef.current = true;

    const submitConfig = {
      onDisconnect: "continue" as const,
      streamResumable: true,
      // Tell the server to enqueue this run if one is already in flight
      // (instead of the default reject/replace). useStream then surfaces
      // pending entries via stream.queue, which <QueueList> renders.
      multitaskStrategy: "enqueue" as const,
      config: {
        configurable: {
          sessionId,
          userId,
          userMcpServers,
          templateType: ctx.templateType,
          templateDecided: ctx.templateDecided,
          // Forward the sandboxId we currently consider canonical (e.g.
          // freshly provisioned by the rewarm flow). resolveSandbox in the
          // agent will adopt it instead of trying its stale registry entry.
          sandboxId: ctx.sandboxId,
        },
      },
    };

    // Cold-start guard for new users on a sleeping Render dyno. If the agent
    // already reported ready (cached for the session), submit immediately —
    // no UX cost on warm visits. Otherwise wait up to 90s for the dyno to
    // wake; on submit failure that *looks* like a cold start, retry once
    // after re-probing readiness instead of leaving the thread silently stuck.
    const submitWithGuard = async () => {
      if (!agentReady.ready) {
        const ok = await agentReady.waitUntilReady(90_000);
        if (!ok) {
          toast.error("Backend is taking longer than expected to wake up. Please try again.");
          setMessage(text); // restore so the user doesn't lose their prompt
          return;
        }
      }
      try {
        stream.submit(
          { messages: [{ type: "human", content: text }] },
          submitConfig as Record<string, unknown>,
        );
      } catch (err) {
        console.warn("[handleSend] submit failed, re-probing agent and retrying:", err);
        agentReady.invalidate();
        const ok = await agentReady.waitUntilReady(60_000);
        if (!ok) {
          toast.error("Couldn't reach the backend. Please refresh and try again.");
          setMessage(text);
          return;
        }
        stream.submit(
          { messages: [{ type: "human", content: text }] },
          submitConfig as Record<string, unknown>,
        );
      }
    };

    void submitWithGuard();
  }, [message, stream, sessionId, userId, userMcpServers, ctx.templateType, ctx.templateDecided, ctx.sandboxId, agentReady]);

  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  // Cancel the active run on the agent server. Best-effort: if stop()
  // throws (e.g. server unreachable) we still surface a toast so the user
  // knows. The server already releases the run lock asynchronously, so a
  // failed stop() won't leave anything wedged.
  const handleStop = useCallback(() => {
    if (!stream.stop) return;
    Promise.resolve(stream.stop())
      .then(() => toast.success("Run stopped"))
      .catch((err) => {
        console.error("[handleStop] failed:", err);
        toast.error("Couldn't stop the run", {
          description: err instanceof Error ? err.message.slice(0, 200) : undefined,
        });
      });
  }, [stream]);

  // --- HITL approval handlers (resume the run with approve / edit) ---
  const resumeWithDecision = useCallback(
    (decision: { type: "approve" } | { type: "edit"; editedAction: { name: string; args: Record<string, unknown> } }) => {
      stream.submit(null, {
        config: {
          configurable: {
            sessionId,
            userId,
            userMcpServers,
            templateType: ctx.templateType,
            templateDecided: ctx.templateDecided,
            sandboxId: ctx.sandboxId,
          },
        },
        command: { resume: { decisions: [decision] } },
      } as Record<string, unknown>);
    },
    [stream, sessionId, userId, userMcpServers, ctx.templateType, ctx.templateDecided, ctx.sandboxId],
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
        console.info("[DB] createSession OK", data?.id);
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
        // Quota trips are terminal — don't retry, boot the user home with a
        // toast so they can delete a chat and try again.
        const msg = error?.message ?? "";
        if (msg.startsWith("QUOTA_EXCEEDED")) {
          toast.error(msg.replace(/^QUOTA_EXCEEDED:\s*/, ""));
          router.replace("/");
          return;
        }
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
        console.info("[DB] init: GET session", sessionId);
        const response = await fetch(
          `/api/session/${sessionId}${shareToken ? `?token=${encodeURIComponent(shareToken)}` : ""}`,
        );
        console.info("[DB] init: GET status", response.status);
        if (response.status === 404) {
          console.info("[DB] init: no row, calling createSession mutation");
          const mutation = createDbSessionRef.current;
          if (!mutation || typeof mutation.mutate !== "function") {
            console.error("[DB] init: mutation ref is not ready — falling back to REST create");
            // Fallback: hit a REST endpoint or just retry after React commits.
            // In practice we just wait for the tRPC hook to be assigned.
            await new Promise((r) => setTimeout(r, 100));
            createDbSessionRef.current?.mutate?.({
              id: sessionId,
              title: `Chat ${new Date().toLocaleString()}`,
            });
          } else {
            mutation.mutate({ id: sessionId, title: `Chat ${new Date().toLocaleString()}` });
          }
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

        // GitHub link state — controls whether the GitHub button shows
        // "Connect" vs "Push commit" mode without an extra round-trip.
        if (typeof session.githubRepo === "string" || session.githubRepo === null) {
          ctx.setGithubRepo(session.githubRepo ?? null);
        }
        if (typeof session.githubBranch === "string" || session.githubBranch === null) {
          ctx.setGithubBranch(session.githubBranch ?? null);
        }

        if (session.fileTree && Array.isArray(session.fileTree)) {
          ctx.setFileTree(session.fileTree);
        }

        if (session.sandboxId) {
          ctx.setSandboxId(session.sandboxId);
          // Only run a full rescan when we don't already have a tree from the
          // DB row. The agent emits `fileCreated` events on every write while
          // it's running, so an existing tree stays fresh without a tar+extract
          // round-trip that competes with `next dev` for sandbox I/O.
          // Manual refresh button (DesktopChatLayout sidebar) still triggers
          // the full rescan when the user wants it.
          const hasCachedTree =
            Array.isArray(session.fileTree) && session.fileTree.length > 0;
          if (!hasCachedTree) {
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

  // --- Import a GitHub repo handed off from the home screen (?importRepo=) ---
  // Mirrors GithubButton's "Import existing" flow: provision a fresh sandbox,
  // clone the repo, npm install, boot the dev server, then adopt the sandbox.
  //
  // NOTE: this effect must survive StrictMode's mount → unmount → mount cycle
  // in dev. `didImportRepoRef` is the one-shot guard so the second mount
  // doesn't re-fire the API call. We deliberately do NOT `cancelled = true`
  // in cleanup for the async work itself — cancelling it would abort the
  // first mount's runImport() the moment StrictMode unmounts, and since the
  // ref already blocks the second mount from starting a new one, the whole
  // flow would silently die. Instead we let `runImport` complete and only
  // skip setState calls after unmount via `mountedRef`.
  const importMountedRef = useRef(true);
  useEffect(() => {
    importMountedRef.current = true;
    return () => {
      importMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (didImportRepoRef.current) return;
    if (!importRepoParam) return;
    // Collaborators (share-link visitors) can't provision sandboxes.
    if (isSharedAccess) return;
    didImportRepoRef.current = true;

    const repo = importRepoParam;
    console.info("[import] starting flow for", repo, "session=", sessionId);

    // Reveal the preview panel so the "Importing…" state is visible right away.
    setImportingRepoName(repo);
    ctx.setShowSecondPanel(true);
    ctx.setActiveTab("live preview");
    ctx.setMobileActivePanel("preview");
    ctx.setIframeLoading(true);

    const runImport = async () => {
      // The import API is owner-gated and 404s without the session row (created
      // by the init effect above). Wait for it to land before cloning.
      const deadline = Date.now() + 20_000;
      while (!sessionExistsRef.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!sessionExistsRef.current) {
        console.error("[import] session row never appeared for", sessionId);
        toast.error("Session setup timed out. Refresh and try again.");
        if (importMountedRef.current) setImportingRepoName(null);
        return;
      }
      console.info("[import] session ready, proceeding to API call");

      // Strip the param NOW that we know we're proceeding — earlier we did
      // this synchronously in the effect body, which caused a re-render that
      // could interact badly with StrictMode's double-invoke.
      router.replace(`/chat/${sessionId}`, { scroll: false });

      const t = toast.loading(`Importing ${repo} into a fresh sandbox…`);
      try {
        console.info("[import] POST /api/github/import");
        const res = await fetch("/api/github/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, repo }),
        });
        const data = await res.json().catch(() => ({}));
        console.info("[import] response", res.status, data);
        if (!res.ok || !data.ok) {
          throw new Error(data?.error || data?.details || `Import failed (${res.status})`);
        }

        // Adopt the new sandbox — the next agent run forwards this id via
        // configurable.sandboxId so resolveSandbox reuses it.
        //
        // Withhold the sandbox URL until the dev server actually answers,
        // otherwise the iframe races the install and shows E2B's
        // "Connection refused" interstitial. If devReady === 'ready' the
        // server-side poll already confirmed the port is up — swap the URL
        // in immediately. Otherwise keep the shimmer and poll from here.
        ctx.setSandboxId(data.sandboxId);
        ctx.setSandboxCreatedAt(Date.now());
        ctx.setIsSandboxExpired(false);
        ctx.setIframeLoading(true);
        ctx.setGithubRepo(data.repo);
        ctx.setGithubBranch(data.branch);
        // Skip the agent's HITL template-picker on the first prompt —
        // importing a repo is itself the template decision. The API also
        // persists this to the session row so a refresh keeps it decided.
        ctx.setTemplateType(data.templateType);
        ctx.setTemplateDecided(true);

        if (data.devReady === "ready") {
          ctx.setSandboxUrl(data.sandboxUrl);
          setImportingRepoName(null);
        } else {
          // Keep the "Importing…" shimmer visible until we can actually
          // reach the sandbox. Poll from the browser (no CORS issue —
          // opaque no-cors fetch is enough to prove the socket answered).
          const pollUrl = data.sandboxUrl as string;
          const startedAt = Date.now();
          const MAX_MS = 120_000;
          const tick = async () => {
            if (!importMountedRef.current) return;
            try {
              // `no-cors` returns opaque even on 404, but a "connection
              // refused" TCP failure rejects the promise — which is what
              // we're actually checking for.
              await fetch(pollUrl, { mode: "no-cors", cache: "no-store" });
              // Success (any HTTP response counts): hand it to the iframe.
              ctx.setSandboxUrl(pollUrl);
              setImportingRepoName(null);
              return;
            } catch {
              if (Date.now() - startedAt > MAX_MS) {
                // Give up gracefully — user can refresh the preview panel.
                console.warn("[import] dev server never answered on", pollUrl);
                ctx.setSandboxUrl(pollUrl);
                setImportingRepoName(null);
                toast.error(
                  `${data.repo} imported, but the dev server didn't answer. Try refreshing the preview.`,
                  { duration: 8_000 },
                );
                return;
              }
              setTimeout(tick, 1500);
            }
          };
          void tick();
        }

        // Name the session after the repo so the sidebar isn't a bare "Chat …".
        titleSetRef.current = true;
        fetch(`/api/session/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: repo }),
        })
          .then(() => globalThis.dispatchEvent(new CustomEvent("chatUpdated")))
          .catch(() => {});

        // Populate the file tree from the freshly cloned sandbox.
        fetch("/api/sync-filesystem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sandboxId: data.sandboxId, sessionId }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d?.fileTree) ctx.setFileTree(d.fileTree);
          })
          .catch(() => {});

        toast.success(
          data.devReady === "booting"
            ? `Imported ${data.repo} — dev server booting`
            : data.devReady === "ready"
              ? `Imported ${data.repo}`
              : `Imported ${data.repo} — dev server slow to boot`,
          { id: t, duration: 6_000 },
        );
      } catch (err) {
        console.error("[import] failed:", err);
        toast.error(err instanceof Error ? err.message : "Import failed", { id: t });
        // Only clear the shimmer on error. In the success path, the "ready"
        // branch clears it inline and the "booting" branch clears it after
        // the poller resolves — clearing here would flash the iframe with
        // "Connection refused" before the dev server is up.
        if (importMountedRef.current) setImportingRepoName(null);
      }
    };
    void runImport();
    // No cleanup — see NOTE above. The one-shot ref prevents duplicate runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importRepoParam]);

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

  // --- Sandbox liveness poll ---
  // The expiry timer above only catches the 25-min idle case. A sandbox can
  // also die earlier (manual kill from the e2b dashboard, agent crash, etc.).
  // Without this poll the iframe just renders e2b's "Sandbox Not Found" page
  // forever and the user has no way to recover unless they trigger an agent
  // run. Probe every 60s when we're not already showing the expired panel.
  useEffect(() => {
    if (!ctx.sandboxId || ctx.isSandboxExpired) return;
    let cancelled = false;
    const probe = async () => {
      try {
        const params = new URLSearchParams({ sessionId });
        if (ctx.shareToken) params.set("token", ctx.shareToken);
        const res = await fetch(`/api/sandbox-health?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { alive: boolean; sandboxId: string | null };
        // Only act on the response if it's still about the sandbox we're
        // currently displaying — a concurrent rewarm could swap ctx.sandboxId
        // mid-flight and we don't want to clobber the new one.
        if (cancelled) return;
        if (data.sandboxId === ctx.sandboxId && !data.alive) {
          ctx.setIsSandboxExpired(true);
        }
      } catch {
        // Network blip — no-op; next interval will retry.
      }
    };
    probe();
    const interval = setInterval(probe, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.sandboxId, ctx.isSandboxExpired, sessionId, ctx.shareToken]);

  // n8n sessions have no code panel — pin the preview tab so the iframe stays
  // visible even if some other effect tried to flip to "code".
  useEffect(() => {
    if (ctx.templateType === "n8n" && ctx.activeTab !== "live preview") {
      ctx.setActiveTab("live preview");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.templateType, ctx.activeTab]);

  // n8n iframe routes through codevibe's reverse proxy so its auth cookie
  // is first-party. Register {sessionId, sandboxUrl} with the proxy whenever
  // the sandbox changes; the iframe loads the returned claimUrl which sets
  // a session-scoped routing cookie before redirecting into n8n. Clears when
  // the template isn't n8n so the nextjs iframe just uses ctx.sandboxUrl.
  useEffect(() => {
    if (ctx.templateType !== "n8n" || !ctx.sandboxUrl || !sessionId) {
      setN8nClaimUrl(null);
      return;
    }
    let cancelled = false;
    fetch("/api/n8n-proxy/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, sandboxUrl: ctx.sandboxUrl }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.claimUrl) {
          setN8nClaimUrl(data.claimUrl);
        } else {
          console.error("[n8n-proxy] register failed:", data?.error);
          setN8nClaimUrl(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[n8n-proxy] register threw:", err);
        setN8nClaimUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.templateType, ctx.sandboxUrl, sessionId]);

  // --- Auto-save session state to DB ---
  // The `fileTree` and `sandbox*` fields are agent-driven artifacts: the agent
  // creates files, the rewarm flow swaps sandboxes — none of these require the
  // user to type or click. Persisting them on every change keeps the session
  // row in sync with what the user actually has, so:
  //   - reloading the tab brings back the file tree the agent built
  //   - rewarming reseeds from a populated `session.fileTree` (was failing
  //     when a passive viewer never typed and the tree was never persisted)
  //   - share-link visitors see the latest project state
  //
  // We deliberately do NOT gate this on `hasUserInteractedRef` — that gate was
  // there to prevent a passive open from bumping `updatedAt` and re-ordering
  // the sidebar, but the agent doing real work is also a legitimate reason to
  // persist. The title-setting effect below keeps the user-interaction gate
  // because that one really should only fire on user-initiated turns.
  useEffect(() => {
    if (!sessionId || !sessionExistsRef.current) return;
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
    if (importingRepoName && !ctx.sandboxUrl) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="animate-spin rounded-full border-4 border-muted border-t-primary h-16 w-16" />
          <div className="space-y-1.5 max-w-sm">
            <p className="text-sm font-medium">
              Importing <span className="font-mono">{importingRepoName}</span>…
            </p>
            <p className="text-xs text-muted-foreground">
              Cloning the repo into a fresh sandbox, installing dependencies, and
              starting the dev server. This can take a minute.
            </p>
          </div>
        </div>
      );
    }

    if (isCheckingExpiration) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="animate-spin rounded-full border-4 border-muted border-t-primary h-16 w-16" />
          <p className="text-sm text-muted-foreground">Checking sandbox status...</p>
        </div>
      );
    }

    if (ctx.sandboxUrl && !ctx.isSandboxExpired) {
      // The URL bar lives inside the preview panel itself (desktop only). On
      // mobile the sandbox URL is surfaced via the "Live" pill in ChatTopBar.
      const refreshPreview = () => {
        ctx.setIframeLoading(true);
        const iframe = document.querySelector(
          'iframe[title="Sandbox Preview"]',
        ) as HTMLIFrameElement | null;
        if (iframe) {
          const src = iframe.src;
          iframe.src = "";
          setTimeout(() => {
            iframe.src = src;
          }, 0);
        }
      };

      return (
        <div className="relative w-full h-full flex flex-col bg-background">
          {!isMobile && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/40 shrink-0">
              <button
                type="button"
                onClick={refreshPreview}
                className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
                title="Refresh preview"
                aria-label="Refresh preview"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <div className="flex-1 min-w-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 bg-background/70 text-sm">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                <span className="flex-1 min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {ctx.sandboxUrl}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(ctx.sandboxUrl!);
                    toast.success("URL copied");
                  }}
                  className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
                  title="Copy URL"
                  aria-label="Copy URL"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => globalThis.open(ctx.sandboxUrl!, "_blank")}
                className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
                title="Open in new tab"
                aria-label="Open in new tab"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="relative flex-1 min-h-0">
            {ctx.iframeLoading && (
              <div className="absolute inset-0 z-10">
                <PreviewShimmer />
              </div>
            )}
            <iframe
              key={`${sessionId}-${ctx.sandboxUrl}-${n8nClaimUrl ?? ""}-${ctx.n8nWorkflowId ?? ""}`}
              src={
                ctx.templateType === "n8n" && n8nClaimUrl
                  ? `${n8nClaimUrl}${ctx.n8nWorkflowId ? `/workflow/${ctx.n8nWorkflowId}` : ""}`
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
      return <SandboxExpiredPanel />;
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
              onStop={handleStop}
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
          handleStop={handleStop}
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
        handleStop={handleStop}
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

      <ChatTopBar
        sessionId={sessionId}
        isSharedAccess={isSharedAccess}
        isMounted={isMounted}
        // Share is the most-used primary action — keep it visible on mobile.
        primaryActions={
          isMounted && sessionId && !isSharedAccess ? (
            <ShareButton sessionId={sessionId} />
          ) : null
        }
        // The rest are secondary on mobile (overflow menu) and inline on desktop.
        overflowActions={
          <>
            {isMounted && sessionId && <DownloadButton sessionId={sessionId} />}
            {isMounted && sessionId && ctx.templateType !== "n8n" && !isSharedAccess && (
              <GithubButton sessionId={sessionId} />
            )}
            {isMounted && sessionId && ctx.templateType !== "n8n" && (
              <DeployButton sessionId={sessionId} />
            )}
          </>
        }
      />

      <BackendWarmingBanner warming={agentReady.warming} />
      <div className="flex-1 min-h-0 overflow-hidden">{renderMainContent()}</div>
    </div>
  );
}
