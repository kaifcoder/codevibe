"use client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useState, useCallback, useRef, useMemo, type Dispatch, type SetStateAction } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatPanel, ChatMessage } from "@/components/ChatPanel";
import { ShareButton } from "@/components/ShareButton";
import { Users, Unplug, Plug } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { MobileChatLayout } from "@/components/MobileChatLayout";
import { DesktopChatLayout } from "@/components/DesktopChatLayout";
import { PreviewShimmer } from "@/components/ui/shimmer";
import { useChatStore } from "@/stores/chat-store";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";

// Sandbox expiration constant
const SANDBOX_EXPIRY_MS = 25 * 60 * 1000;

interface PageProps {
  params: Promise<{ id: string }>;
}

function Page({ params }: PageProps) {
  const trpc = useTRPC();
  const searchParams = useSearchParams();
  const shareToken = searchParams.get('token');
  const isSharedAccess = !!shareToken;

  const [isMounted, setIsMounted] = useState(false);
  const [shouldAutoSend, setShouldAutoSend] = useState(false);
  const [isCheckingExpiration, setIsCheckingExpiration] = useState(false);
  const hasAutoSent = useRef(false);
  const sessionCheckRef = useRef<Set<string>>(new Set());
  const sessionExistsRef = useRef(false);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef<Record<string, string>>({});
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const guestCredentials = useMemo(() => {
    if (!isSharedAccess) return null;
    const randomId = Math.floor(Math.random() * 10000);
    return { username: `Guest-${randomId}`, userId: `guest-${Date.now()}-${randomId}` };
  }, [isSharedAccess]);

  const isMobile = useIsMobile();

  // --- Zustand store ---
  const sessionId = useChatStore(s => s.sessionId);
  const setSessionId = useChatStore(s => s.setSessionId);
  const threadId = useChatStore(s => s.threadId);
  const messages = useChatStore(s => s.messages);
  const setMessages = useChatStore(s => s.setMessages);
  const message = useChatStore(s => s.message);
  const setMessage = useChatStore(s => s.setMessage);
  const isStreaming = useChatStore(s => s.isStreaming);
  const fileTree = useChatStore(s => s.fileTree);
  const setFileTree = useChatStore(s => s.setFileTree);
  const sandboxId = useChatStore(s => s.sandboxId);
  const setSandboxId = useChatStore(s => s.setSandboxId);
  const sandboxUrl = useChatStore(s => s.sandboxUrl);
  const setSandboxUrl = useChatStore(s => s.setSandboxUrl);
  const sandboxCreatedAt = useChatStore(s => s.sandboxCreatedAt);
  const setSandboxCreatedAt = useChatStore(s => s.setSandboxCreatedAt);
  const isSandboxExpired = useChatStore(s => s.isSandboxExpired);
  const setIsSandboxExpired = useChatStore(s => s.setIsSandboxExpired);
  const activeTab = useChatStore(s => s.activeTab);
  const setActiveTab = useChatStore(s => s.setActiveTab);
  const showSecondPanel = useChatStore(s => s.showSecondPanel);
  const setShowSecondPanel = useChatStore(s => s.setShowSecondPanel);
  const mobileActivePanel = useChatStore(s => s.mobileActivePanel);
  const setMobileActivePanel = useChatStore(s => s.setMobileActivePanel);
  const setIsSyncingFilesystem = useChatStore(s => s.setIsSyncingFilesystem);
  const iframeLoading = useChatStore(s => s.iframeLoading);
  const setIframeLoading = useChatStore(s => s.setIframeLoading);
  const connectedUsers = useChatStore(s => s.connectedUsers);
  const runId = useChatStore(s => s.runId);

  // --- useStream hook (replaces tRPC + SSE) ---
  const stream = useAgentStream(threadId);

  // --- Sync stream.messages → Zustand store (ChatMessage format) ---
  const prevSnapshotRef = useRef('');

  useEffect(() => {
    if (!stream.messages || stream.messages.length === 0) return;

    // Build a lightweight snapshot to detect real changes
    // Include content length within array blocks to catch streaming token updates
    const toolSnapshot = stream.toolCalls
      ? stream.toolCalls.map((tc: any) => `${tc.call?.id}:${tc.state}`).join(',')
      : '';
    const snapshot = stream.messages.map((msg: any) => {
      const c = msg.content;
      let len = 0;
      if (typeof c === 'string') {
        len = c.length;
      } else if (Array.isArray(c)) {
        for (const block of c) {
          if (block.type === 'text') len += (block.text?.length || 0);
          else if (block.type === 'thinking' || block.type === 'reasoning') len += (block.thinking?.length || block.reasoning?.length || 0);
          else len += 1;
        }
      }
      return `${msg.id ?? ''}:${len}`;
    }).join('|') + `|loading:${stream.isLoading}|tc:${toolSnapshot}`;

    if (snapshot === prevSnapshotRef.current) return;
    prevSnapshotRef.current = snapshot;

    // Build consolidated messages: merge consecutive AI messages into single turns
    const mapped: ChatMessage[] = [];
    let currentAiTurn: { content: string; reasoning: string; toolCalls: NonNullable<ChatMessage['toolCalls']>; id: string; lastIndex: number } | null = null;

    const flushAiTurn = () => {
      if (!currentAiTurn) return;
      const isLast = currentAiTurn.lastIndex === stream.messages.length - 1;
      mapped.push({
        role: 'ai',
        content: currentAiTurn.content,
        reasoning: currentAiTurn.reasoning || undefined,
        timestamp: Date.now() - (stream.messages.length - currentAiTurn.lastIndex) * 1000,
        id: currentAiTurn.id,
        status: (stream.isLoading && isLast) ? 'streaming' : 'complete',
        toolCalls: currentAiTurn.toolCalls.length > 0 ? currentAiTurn.toolCalls : undefined,
      });
      currentAiTurn = null;
    };

    for (let i = 0; i < stream.messages.length; i++) {
      const msg = stream.messages[i] as any;
      const msgType = msg.type as string;

      if (msgType === 'tool') continue;

      if (msgType === 'human') {
        flushAiTurn();
        let content = '';
        if (typeof msg.content === 'string') {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content as any[]) {
            if (block.type === 'text') content += block.text || '';
          }
        }
        if (content) {
          mapped.push({
            role: 'user',
            content,
            timestamp: Date.now() - (stream.messages.length - i) * 1000,
            id: msg.id || `msg-${i}`,
            status: 'complete',
          });
        }
        continue;
      }

      if (msgType === 'ai') {
        if (!currentAiTurn) {
          currentAiTurn = { content: '', reasoning: '', toolCalls: [], id: msg.id || `msg-${i}`, lastIndex: i };
        }
        currentAiTurn.lastIndex = i;

        // Extract text and reasoning
        if (typeof msg.content === 'string') {
          if (msg.content) currentAiTurn.content += (currentAiTurn.content ? '\n\n' : '') + msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content as any[]) {
            if (block.type === 'text' && block.text) {
              currentAiTurn.content += (currentAiTurn.content ? '\n\n' : '') + block.text;
            }
            if (block.type === 'thinking' || block.type === 'reasoning') {
              currentAiTurn.reasoning += (block.thinking || block.reasoning || '');
            }
          }
        }

        // Collect tool calls
        if (stream.toolCalls) {
          const msgToolCalls = msg.tool_calls as Array<{ id?: string; name: string; args: Record<string, unknown> }> | undefined;
          if (msgToolCalls) {
            for (const tc of msgToolCalls) {
              const match = stream.toolCalls.find((stc: any) => stc.call.id === tc.id);
              currentAiTurn.toolCalls.push({
                tool: tc.name,
                args: tc.args,
                result: match?.result?.content as string | undefined,
                status: match?.state === 'pending' ? 'running' : match?.state === 'error' ? 'error' : match?.state === 'completed' ? 'complete' : 'running',
              });
            }
          }
        }
        continue;
      }
    }

    flushAiTurn();

    // Filter out empty AI messages and summary messages from summarization middleware
    const filtered = mapped.filter((msg: ChatMessage) => {
      if (msg.role === 'ai' && !msg.content && !msg.toolCalls?.length && !msg.reasoning && msg.status !== 'streaming') {
        return false;
      }
      // Filter out summarization middleware output
      if (msg.role === 'ai' && msg.content && msg.content.startsWith('Here is a summary of the conversation')) {
        return false;
      }
      return true;
    });

    // Merge with existing messages: keep old messages, append only genuinely new ones
    const existingMessages = useChatStore.getState().messages;
    if (existingMessages.length > 0 && filtered.length > 0) {
      // Find the last user message ID in filtered to anchor the merge
      const lastExistingUserMsg = [...existingMessages].reverse().find(m => m.role === 'user');
      const lastFilteredUserMsg = [...filtered].reverse().find(m => m.role === 'user');

      // If the stream still has the same recent user message, merge properly
      if (lastExistingUserMsg && lastFilteredUserMsg && lastExistingUserMsg.content === lastFilteredUserMsg.content) {
        // Find where this user message is in filtered
        const anchorIdx = filtered.findLastIndex(m => m.role === 'user' && m.content === lastExistingUserMsg.content);
        const anchorIdxExisting = existingMessages.findLastIndex(m => m.role === 'user' && m.content === lastExistingUserMsg.content);

        if (anchorIdx >= 0 && anchorIdxExisting >= 0) {
          // Keep all existing messages up to (but not including) the anchor's AI response,
          // then take anchor + everything after from filtered (which has the latest streaming state)
          const preserved = existingMessages.slice(0, anchorIdxExisting);
          const fromStream = filtered.slice(anchorIdx);
          const merged = [...preserved, ...fromStream];
          useChatStore.getState().setMessages(merged);
          return;
        }
      }

      // If filtered has fewer messages than existing (summarization happened),
      // keep old messages and only update/append the tail
      if (filtered.length < existingMessages.length) {
        // Find new messages not in existing (by matching last few)
        const lastExisting = existingMessages[existingMessages.length - 1];
        const lastFiltered = filtered[filtered.length - 1];
        if (lastFiltered && lastExisting &&
            lastFiltered.role === lastExisting.role &&
            lastFiltered.content === lastExisting.content) {
          // Same last message — just update status of last AI message
          const updated = [...existingMessages];
          updated[updated.length - 1] = { ...lastFiltered, timestamp: lastExisting.timestamp };
          useChatStore.getState().setMessages(updated);
          return;
        }
        // New AI response after summarization — append it
        const newMessages = filtered.filter(fm =>
          !existingMessages.some(em => em.role === fm.role && em.content === fm.content)
        );
        if (newMessages.length > 0) {
          useChatStore.getState().setMessages([...existingMessages, ...newMessages]);
          return;
        }
        // Fallback: keep existing (don't shrink)
        return;
      }
    }

    useChatStore.getState().setMessages(filtered);
  }, [stream.messages, stream.toolCalls, stream.isLoading]);

  // --- DB session creation ---
  const createDbSession = useMutation(
    trpc.session.createSession.mutationOptions({
      onSuccess: (data) => {
        sessionExistsRef.current = true;
        console.log('[DB] Session created:', data.id);
      },
      onError: (error) => { console.error('[DB] Failed to create session:', error); },
    })
  );
  const createDbSessionRef = useRef(createDbSession);
  createDbSessionRef.current = createDbSession;

  // Extract chat ID from params
  useEffect(() => {
    let mounted = true;
    params.then(async ({ id }) => {
      if (!mounted) return;

      const currentId = useChatStore.getState().sessionId;
      // Only reset if navigating to a genuinely different session
      // (empty string means store hasn't hydrated yet — don't reset)
      if (currentId && currentId !== id) {
        useChatStore.getState().reset(id);
      }
      setSessionId(id);

      if (sessionCheckRef.current.has(id)) return;
      sessionCheckRef.current.add(id);

      try {
        const response = await fetch(`/api/session/${id}`);
        if (!mounted) return;
        if (response.status === 404) {
          createDbSessionRef.current.mutate({ id, title: `Chat ${new Date().toLocaleString()}` });
        } else if (response.ok) {
          sessionExistsRef.current = true;
        }
      } catch (error) {
        console.error('[DB] Error checking session:', error);
        sessionCheckRef.current.delete(id);
      }

      if (typeof globalThis !== 'undefined') {
        const initialPrompt = sessionStorage.getItem(`chat_${id}_initial`);
        if (initialPrompt) {
          useChatStore.getState().setMessage(initialPrompt);
          setShouldAutoSend(true);
          sessionStorage.removeItem(`chat_${id}_initial`);
        }
      }
    });
    return () => { mounted = false; };
  }, [params, setSessionId]);

  // Load session data from database
  useEffect(() => {
    if (!sessionId) return;

    const loadSession = async () => {
      try {
        const response = await fetch(`/api/session/${sessionId}`);
        if (response.ok) {
          const session = await response.json();
          sessionExistsRef.current = true;

          if (session.fileTree && Array.isArray(session.fileTree)) {
            setFileTree(session.fileTree);
          }

          if (session.sandboxId) {
            setSandboxId(session.sandboxId);
            setIsSyncingFilesystem(true);
            setTimeout(async () => {
              try {
                const res = await fetch('/api/sync-filesystem', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sandboxId: session.sandboxId, sessionId }),
                });
                if (res.ok) {
                  const data = await res.json();
                  if (data.fileTree) {
                    useChatStore.getState().setFileTree(data.fileTree);
                  }
                }
              } catch (err) {
                console.error('[Sync] Auto-sync failed:', err);
              } finally {
                useChatStore.getState().setIsSyncingFilesystem(false);
              }
            }, 1000);
          }

          if (session.sandboxUrl) {
            setSandboxUrl(session.sandboxUrl);
            setShowSecondPanel(true);
            if (session.sandboxCreatedAt) {
              setIsCheckingExpiration(true);
              const createdTime = new Date(session.sandboxCreatedAt).getTime();
              setSandboxCreatedAt(createdTime);
              const elapsed = Date.now() - createdTime;
              setTimeout(() => {
                if (elapsed >= SANDBOX_EXPIRY_MS) {
                  useChatStore.getState().setIsSandboxExpired(true);
                }
                setIsCheckingExpiration(false);
              }, 500);
            } else {
              setSandboxCreatedAt(Date.now());
            }
          }
        }
      } catch (error) {
        console.error('[DB] Failed to load session:', error);
      }
    };
    loadSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => { setIsMounted(true); }, []);

  // --- Send message via useStream ---
  const handleSend = useCallback(() => {
    const { message: msg } = useChatStore.getState();
    if (!msg.trim()) return;

    useChatStore.getState().setMessage("");

    stream.submit(
      { messages: [{ type: "human", content: msg.trim() }] },
      {
        onDisconnect: "continue",
        streamResumable: true,
      }
    );
  }, [stream]);

  // --- Disconnect / Rejoin ---
  const handleDisconnect = useCallback(() => {
    if (stream.stop) {
      stream.stop();
    }
  }, [stream]);

  const handleRejoin = useCallback(() => {
    const { runId: rid } = useChatStore.getState();
    if (rid && stream.joinStream) {
      stream.joinStream(rid);
    }
  }, [stream]);

  // Auto-send initial message
  useEffect(() => {
    if (shouldAutoSend && message.trim() && !hasAutoSent.current && messages.length <= 1) {
      hasAutoSent.current = true;
      setShouldAutoSend(false);
      setTimeout(() => handleSend(), 100);
    }
  }, [shouldAutoSend, message, messages.length, handleSend]);

  // --- Code editor changes ---
  const handleCodeChange = useCallback((val: string | undefined) => {
    const { selectedFile: file, sandboxId: sbx, isStreaming: streaming, updateFileContent } = useChatStore.getState();
    const newContent = val ?? "";
    updateFileContent(file, newContent);

    if (sbx && file && !streaming) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (lastSavedContentRef.current[file] === newContent) return;

      saveTimeoutRef.current = setTimeout(async () => {
        try {
          useChatStore.getState().setIsSyncingToE2B(true);
          lastSavedContentRef.current[file] = newContent;
          await fetch('/api/write-to-sandbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sandboxId: sbx, filePath: file, content: newContent }),
          });
        } catch (error) {
          console.error('[Sync] Error writing to e2b:', error);
        } finally {
          useChatStore.getState().setIsSyncingToE2B(false);
        }
      }, 1000);
    }
  }, []);

  // Check sandbox expiration
  useEffect(() => {
    if (!sandboxCreatedAt || !sandboxUrl) return;
    const checkExpiration = () => {
      if (Date.now() - sandboxCreatedAt >= SANDBOX_EXPIRY_MS) setIsSandboxExpired(true);
    };
    checkExpiration();
    const interval = setInterval(checkExpiration, 60000);
    return () => clearInterval(interval);
  }, [sandboxCreatedAt, sandboxUrl, setIsSandboxExpired]);

  useEffect(() => {
    if (isSandboxExpired) setActiveTab('code');
  }, [isSandboxExpired, setActiveTab]);

  // Auto-save session to database (file tree + sandbox state + threadId)
  useEffect(() => {
    if (!sessionId || !sessionExistsRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const currentThreadId = useChatStore.getState().threadId;
      fetch(`/api/session/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: currentThreadId || undefined,
          fileTree: fileTree.length > 0 ? fileTree : undefined,
          sandboxId: sandboxId || undefined,
          sandboxUrl: sandboxUrl || undefined,
          sandboxCreatedAt: sandboxCreatedAt ? new Date(sandboxCreatedAt).toISOString() : undefined,
        }),
      }).catch(err => console.error('[DB] Failed to save session:', err));
    }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [sessionId, fileTree, sandboxId, sandboxUrl, sandboxCreatedAt]);

  // Notify sidebar
  useEffect(() => {
    if (messages.some(m => m.role === 'user') && typeof globalThis !== 'undefined') {
      globalThis.dispatchEvent(new CustomEvent('chatUpdated'));
    }
  }, [messages]);

  // --- Render ---
  const renderPreview = () => {
    if (isCheckingExpiration) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="animate-spin rounded-full border-4 border-gray-300 border-t-primary h-16 w-16" />
          <p className="text-sm text-muted-foreground">Checking sandbox status...</p>
        </div>
      );
    }

    if (sandboxUrl && !isSandboxExpired) {
      return (
        <div className="relative w-full h-full flex flex-col bg-background">
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
            <div className="flex items-center gap-1 mr-2">
              <button
                type="button"
                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setIframeLoading(true);
                  const iframe = document.querySelector('iframe[title="Sandbox Preview"]') as HTMLIFrameElement;
                  if (iframe) { const s = iframe.src; iframe.src = ''; setTimeout(() => { iframe.src = s; }, 0); }
                }}
                title="Refresh"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
            <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-background rounded-md border text-sm">
              <svg className="w-3.5 h-3.5 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              <span className="text-muted-foreground truncate font-mono text-xs">{sandboxUrl}</span>
              <button
                type="button"
                className="ml-auto p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => { navigator.clipboard.writeText(sandboxUrl); toast.success('URL copied'); }}
                title="Copy URL"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              onClick={() => globalThis.open(sandboxUrl, '_blank')}
              title="Open in new tab"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          </div>
          <div className="relative flex-1 min-h-0">
            {iframeLoading && <div className="absolute inset-0 z-10"><PreviewShimmer /></div>}
            <iframe
              src={sandboxUrl}
              className={`w-full h-full border-0 transition-opacity duration-300 ${iframeLoading ? 'opacity-0' : 'opacity-100'}`}
              onLoad={() => setIframeLoading(false)}
              title="Sandbox Preview"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              allow="clipboard-write; clipboard-read; microphone; camera; accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            />
          </div>
        </div>
      );
    }

    if (isSandboxExpired) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="text-6xl">⏱️</div>
          <div className="space-y-3">
            <h3 className="text-xl font-semibold text-foreground">Sandbox Expired</h3>
            <p className="text-sm text-muted-foreground max-w-md">This sandbox has expired after 25 minutes of inactivity.</p>
          </div>
        </div>
      );
    }

    return null;
  };

  const renderMainContent = () => {
    if (!showSecondPanel) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="max-w-4xl w-full px-4 sm:px-6 lg:px-8 h-full flex flex-col">
            <ChatPanel
              messages={messages}
              message={message}
              setMessage={setMessage as Dispatch<SetStateAction<string>>}
              onSend={handleSend}
              isLoading={stream.isLoading}
              isStreaming={isStreaming}
              queue={stream.queue}
            />
          </div>
        </div>
      );
    }

    if (isMobile) {
      return (
        <MobileChatLayout
          mobileActivePanel={mobileActivePanel}
          setMobileActivePanel={setMobileActivePanel}
          messages={messages}
          message={message}
          setMessage={setMessage as Dispatch<SetStateAction<string>>}
          handleSend={handleSend}
          isLoading={stream.isLoading}
          isStreaming={isStreaming}
          renderPreview={renderPreview}
          handleCodeChange={handleCodeChange}
          guestCredentials={guestCredentials}
          queue={stream.queue}
        />
      );
    }

    return (
      <DesktopChatLayout
        messages={messages}
        message={message}
        setMessage={setMessage as Dispatch<SetStateAction<string>>}
        handleSend={handleSend}
        isLoading={stream.isLoading}
        isStreaming={isStreaming}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        handleCodeChange={handleCodeChange}
        guestCredentials={guestCredentials}
        renderPreview={renderPreview}
        queue={stream.queue}
      />
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${stream.isLoading ? 'bg-green-500 animate-pulse' : runId ? 'bg-amber-500' : 'bg-muted-foreground/30'}`} />
          <span className="text-sm font-medium">
            {stream.isLoading ? 'AI is thinking...' : runId ? 'Disconnected — agent may still be running' : 'Ready'}
          </span>
          {isSharedAccess && (
            <Badge variant="secondary" className="text-xs">
              <Users className="h-3 w-3 mr-1" />
              Shared Session
            </Badge>
          )}
          {messages.length > 1 && (
            <span className="text-xs text-muted-foreground">{messages.length} messages</span>
          )}
          {sandboxUrl && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Sandbox Active
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Disconnect / Rejoin buttons */}
          {stream.isLoading && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20"
              onClick={handleDisconnect}
            >
              <Unplug className="w-3 h-3 mr-1" />
              Disconnect
            </Button>
          )}
          {!stream.isLoading && runId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/20"
              onClick={handleRejoin}
            >
              <Plug className="w-3 h-3 mr-1" />
              Rejoin
            </Button>
          )}
          {showSecondPanel && (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-7 bg-muted/50">
                <TabsTrigger value="live preview" className="text-xs h-6 px-3">Preview</TabsTrigger>
                <TabsTrigger value="code" className="text-xs h-6 px-3">Code</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {connectedUsers.length > 0 && (
            <TooltipProvider>
              <div className="flex items-center gap-1">
                {connectedUsers.map((user) => (
                  <Tooltip key={user.id}>
                    <TooltipTrigger asChild>
                      <Avatar className="h-7 w-7 border-2 -ml-2 first:ml-0" style={{ borderColor: user.color }}>
                        <AvatarFallback style={{ backgroundColor: user.color + '20', color: user.color }}>
                          {user.name.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </TooltipTrigger>
                    <TooltipContent><p className="text-xs">{user.name}</p></TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
          )}

          {isMounted && sessionId && !isSharedAccess && <ShareButton sessionId={sessionId} />}
          {messages.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                if (confirm('Clear all messages? This cannot be undone.')) {
                  const newMessages: ChatMessage[] = [{
                    role: "ai" as const,
                    content: "Chat cleared. How can I help you?",
                    timestamp: Date.now(),
                    id: 'clear-' + Date.now()
                  }];
                  setMessages(newMessages);
                  try {
                    await fetch(`/api/session/${sessionId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ messages: newMessages }),
                    });
                  } catch (error) {
                    console.error('[DB] Failed to clear messages:', error);
                  }
                }
              }}
              className="text-xs"
            >
              Clear Chat
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {renderMainContent()}
      </div>
    </div>
  );
}

export default Page;
