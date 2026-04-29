"use client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState, useCallback, useRef, useMemo, type Dispatch, type SetStateAction } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatPanel, ChatMessage } from "@/components/ChatPanel";
import { ShareButton } from "@/components/ShareButton";
import { Users } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileChatLayout } from "@/components/MobileChatLayout";
import { DesktopChatLayout } from "@/components/DesktopChatLayout";
import { PreviewShimmer } from "@/components/ui/shimmer";
import { useChatStore } from "@/stores/chat-store";
import type { FileNode } from "@/stores/chat-store";

// ─── File tree helpers ───────────────────────────────────────────────────────

function findFileInTree(nodes: FileNode[], path: string): boolean {
  for (const node of nodes) {
    if (node.type === 'file' && node.path === path) return true;
    if (node.type === 'folder' && node.children && findFileInTree(node.children, path)) return true;
  }
  return false;
}

function updateFileInTree(nodes: FileNode[], path: string, updater: (existing: string | undefined) => string): FileNode[] {
  return nodes.map(node => {
    if (node.type === 'file' && node.path === path) {
      return { ...node, content: updater(node.content) };
    }
    if (node.type === 'folder' && node.children) {
      return { ...node, children: updateFileInTree(node.children, path, updater) };
    }
    return node;
  });
}

function addFileToTree(nodes: FileNode[], filePath: string, content: string): FileNode[] {
  const segments = filePath.split('/');
  if (segments.length === 1) {
    return [...nodes, { name: segments[0], path: filePath, type: 'file' as const, content }];
  }

  const folderName = segments[0];
  const remainingPath = segments.slice(1).join('/');
  const existing = nodes.find(n => n.type === 'folder' && n.name === folderName);

  if (existing && existing.children) {
    return nodes.map(n => {
      if (n === existing) {
        return { ...n, children: addFileToTree(n.children!, remainingPath, content) };
      }
      return n;
    });
  }

  // Create folder and nest file inside it
  const newFolder: FileNode = {
    name: folderName,
    path: segments.slice(0, -1).join('/'),
    type: 'folder',
    children: addFileToTree([], remainingPath, content),
  };
  return [...nodes, newFolder];
}

// Sandbox expiration constant (outside component to avoid re-creation each render)
const SANDBOX_EXPIRY_MS = 25 * 60 * 1000; // 25 minutes

interface PageProps {
  params: Promise<{ id: string }>;
}

function Page({ params }: PageProps) {
  const trpc = useTRPC();
  const searchParams = useSearchParams();
  const shareToken = searchParams.get('token');
  const isSharedAccess = !!shareToken;

  // --- Local-only state (component-specific, not shared) ---
  const [shouldAutoSend, setShouldAutoSend] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isCheckingExpiration, setIsCheckingExpiration] = useState(false);

  // Generate stable guest credentials for shared sessions
  const guestCredentials = useMemo(() => {
    if (!isSharedAccess) return null;
    const randomId = Math.floor(Math.random() * 10000);
    return {
      username: `Guest-${randomId}`,
      userId: `guest-${Date.now()}-${randomId}`,
    };
  }, [isSharedAccess]);

  // --- Zustand store state ---
  const sessionId = useChatStore(s => s.sessionId);
  const setSessionId = useChatStore(s => s.setSessionId);
  const messages = useChatStore(s => s.messages);
  const setMessages = useChatStore(s => s.setMessages);
  const message = useChatStore(s => s.message);
  const setMessage = useChatStore(s => s.setMessage);
  const isStreaming = useChatStore(s => s.isStreaming);
  const setIsStreaming = useChatStore(s => s.setIsStreaming);
  const fileTree = useChatStore(s => s.fileTree);
  const setFileTree = useChatStore(s => s.setFileTree);
  const selectedFile = useChatStore(s => s.selectedFile);
  const setSelectedFile = useChatStore(s => s.setSelectedFile);
  const openFiles = useChatStore(s => s.openFiles);
  const setOpenFiles = useChatStore(s => s.setOpenFiles);
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
  const isSyncingToE2B = useChatStore(s => s.isSyncingToE2B);
  const setIsSyncingToE2B = useChatStore(s => s.setIsSyncingToE2B);
  const isSyncingFilesystem = useChatStore(s => s.isSyncingFilesystem);
  const setIsSyncingFilesystem = useChatStore(s => s.setIsSyncingFilesystem);
  const iframeLoading = useChatStore(s => s.iframeLoading);
  const setIframeLoading = useChatStore(s => s.setIframeLoading);
  const connectionStatus = useChatStore(s => s.connectionStatus);
  const setConnectionStatus = useChatStore(s => s.setConnectionStatus);
  const connectedUsers = useChatStore(s => s.connectedUsers);
  const setConnectedUsers = useChatStore(s => s.setConnectedUsers);

  // --- Refs (component-local concerns) ---
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const hasAutoSent = useRef(false);
  const isSending = useRef(false);
  const sessionCheckRef = useRef<Set<string>>(new Set());
  const sessionExistsRef = useRef(false);
  const mountedRef = useRef(true);
  const retriesRef = useRef(0);
  const MAX_RETRIES = 5;
  const lastSavedContentRef = useRef<{ [filePath: string]: string }>({});
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const isMobile = useIsMobile();

  // Mutation to create session in database
  const createDbSession = useMutation(
    trpc.session.createSession.mutationOptions({
      onSuccess: (data) => {
        console.log('[DB] Session created:', data.id);
      },
      onError: (error) => {
        console.error('[DB] Failed to create session:', error);
      },
    })
  );

  // Use ref for createDbSession to avoid useEffect dependency issues
  const createDbSessionRef = useRef(createDbSession);
  createDbSessionRef.current = createDbSession;

  // Extract chat ID from params
  useEffect(() => {
    let mounted = true;

    params.then(async ({ id }) => {
      if (!mounted) return;

      setSessionId(id);

      // Check if we've already processed this session ID
      if (sessionCheckRef.current.has(id)) {
        console.log('[DB] Session already processed:', id);
        return;
      }

      // Mark this session as being processed
      sessionCheckRef.current.add(id);

      // Check if session exists in database, if not create it (only once)
      try {
        const response = await fetch(`/api/session/${id}`);
        if (!mounted) return;

        if (response.status === 404) {
          // Session doesn't exist, create it with the chat ID
          console.log('[DB] Creating new session:', id);
          createDbSessionRef.current.mutate({
            id,
            title: `Chat ${new Date().toLocaleString()}`,
          });
          sessionExistsRef.current = true;
        } else {
          console.log('[DB] Session already exists:', id);
          sessionExistsRef.current = true;
        }
      } catch (error) {
        console.error('[DB] Error checking session:', error);
        // Remove from set on error so it can be retried
        sessionCheckRef.current.delete(id);
      }

      // Check for initial prompt from home page
      if (typeof globalThis !== 'undefined') {
        const initialPrompt = sessionStorage.getItem(`chat_${id}_initial`);
        if (initialPrompt) {
          useChatStore.getState().setMessage(initialPrompt);
          setShouldAutoSend(true);
          // Clean up sessionStorage
          sessionStorage.removeItem(`chat_${id}_initial`);
        }
      }
    });

    return () => {
      mounted = false;
    };
  }, [params, setSessionId]);

  // Load session data from database when sessionId changes
  useEffect(() => {
    if (!sessionId || sessionId.startsWith('session-')) return;

    const loadSession = async () => {
      try {
        console.log('[DB] Loading session data for:', sessionId);
        const response = await fetch(`/api/session/${sessionId}`);
        if (response.ok) {
          const session = await response.json();
          console.log('[DB] Session loaded:', session);

          // Mark session as existing since we successfully loaded it
          sessionExistsRef.current = true;

          // Load messages from database
          if (session.messages && Array.isArray(session.messages)) {
            setMessages(session.messages);
          }

          // Load file tree from database
          if (session.fileTree && Array.isArray(session.fileTree)) {
            setFileTree(session.fileTree);
          }

          // Load sandbox data from database
          if (session.sandboxId) {
            setSandboxId(session.sandboxId);
            console.log('[DB] Loaded sandboxId:', session.sandboxId);

            // Auto-sync filesystem when sandbox is loaded
            // Block code tab until sync completes
            setIsSyncingFilesystem(true);
            setTimeout(async () => {
              try {
                const response = await fetch('/api/sync-filesystem', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sandboxId: session.sandboxId,
                    sessionId: sessionId
                  }),
                });
                if (response.ok) {
                  console.log('[Sync] Filesystem sync completed');
                } else {
                  console.error('[Sync] Filesystem sync failed');
                }
              } catch (err) {
                console.error('[Sync] Auto-sync failed:', err);
              } finally {
                // Sync complete, unblock code tab
                useChatStore.getState().setIsSyncingFilesystem(false);
              }
            }, 1000); // Wait 1s for sandbox to be ready
          }
          if (session.sandboxUrl) {
            setSandboxUrl(session.sandboxUrl);
            setShowSecondPanel(true);
            // Load sandbox creation timestamp from database
            if (session.sandboxCreatedAt) {
              setIsCheckingExpiration(true);
              const createdTime = new Date(session.sandboxCreatedAt).getTime();
              setSandboxCreatedAt(createdTime);
              // Check if already expired
              const elapsed = Date.now() - createdTime;
              setTimeout(() => {
                if (elapsed >= SANDBOX_EXPIRY_MS) {
                  useChatStore.getState().setIsSandboxExpired(true);
                  console.log('[DB] Sandbox already expired');
                }
                setIsCheckingExpiration(false);
              }, 500); // Small delay to show loader
            } else {
              // Fallback: if no timestamp in DB, use current time (new sandbox, not expired)
              setSandboxCreatedAt(Date.now());
              setIsCheckingExpiration(false);
            }
            console.log('[DB] Loaded sandboxUrl:', session.sandboxUrl);
          }
        } else {
          console.log('[DB] Session not found, will be created');
        }
      } catch (error) {
        console.error('[DB] Failed to load session:', error);
      }
    };

    loadSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // --- tRPC Mutations ---
  const invoke = useMutation(
    trpc.invoke.mutationOptions({
      onSuccess: ({ sessionId: newSessionId }) => {
        toast.success('Agent started successfully!');
        if (newSessionId && newSessionId !== useChatStore.getState().sessionId) {
          useChatStore.getState().setSessionId(newSessionId);
        }
        isSending.current = false;
      },
      onError: (error) => {
        toast.error(`Error invoking agent: ${error.message}`);
        useChatStore.getState().setIsStreaming(false);
        isSending.current = false;
      },
      onMutate: () => {
        useChatStore.getState().setIsStreaming(true);
        toast.loading("Starting AI agent...");
      },
      onSettled: () => {
        toast.dismiss();
      }
    })
  );

  const invokeWithSandbox = useMutation(
    trpc.invokeWithSandbox.mutationOptions({
      onSuccess: ({ sessionId: newSessionId }) => {
        toast.success('Agent started with sandbox!');
        if (newSessionId && newSessionId !== useChatStore.getState().sessionId) {
          useChatStore.getState().setSessionId(newSessionId);
        }
        isSending.current = false;
      },
      onError: (error) => {
        toast.error(`Error invoking agent: ${error.message}`);
        useChatStore.getState().setIsStreaming(false);
        isSending.current = false;
      },
      onMutate: () => {
        useChatStore.getState().setIsStreaming(true);
        toast.loading("Starting AI agent with sandbox...");
      },
      onSettled: () => {
        toast.dismiss();
      }
    })
  );

  const updateSession = useMutation(
    trpc.session.updateSession.mutationOptions({
      onSuccess: () => {
        console.log('[DB] Session updated successfully');
      },
      onError: (error) => {
        console.error('[DB] Failed to update session:', error);
      }
    })
  );

  // Ref to access updateSession inside SSE callback without causing re-renders
  const updateSessionRef = useRef(updateSession);
  useEffect(() => { updateSessionRef.current = updateSession; }, [updateSession]);

  // Types for SSE payload
  type StatusData = { status?: string; message?: string; hasSandbox?: boolean };
  type PartialData = { content?: string; fullContent?: string };
  type ToolData = {
    tool?: string;
    args?: Record<string, unknown>;
    result?: string;
    status?: "pending" | "running" | "complete" | "error";
  };
  type SandboxData = { sandboxId?: string; sandboxUrl?: string; isNew?: boolean; replacedOld?: string };
  type CompleteData = { response?: string; sandboxUrl?: string; hasSandbox?: boolean };
  type ErrorData = { error?: string; sandboxUrl?: string };
  type FileUpdateData = { filePath?: string; content?: string; action?: 'start' | 'update' | 'complete' };
  type CodePatchData = { filePath?: string; content?: string; action?: 'start' | 'patch' | 'complete' };
  type FileTreeSyncData = { fileTree: FileNode[] };
  interface SSEPayloadBase { sessionId?: string }
  type SSEPayload =
    | (SSEPayloadBase & { type: 'status'; data?: StatusData })
    | (SSEPayloadBase & { type: 'partial'; data?: PartialData })
    | (SSEPayloadBase & { type: 'tool'; data?: ToolData })
    | (SSEPayloadBase & { type: 'sandbox'; data?: SandboxData })
    | (SSEPayloadBase & { type: 'complete'; data?: CompleteData })
    | (SSEPayloadBase & { type: 'error'; data?: ErrorData })
    | (SSEPayloadBase & { type: 'file_update'; data?: FileUpdateData })
    | (SSEPayloadBase & { type: 'code_patch'; data?: CodePatchData })
    | (SSEPayloadBase & { type: 'file_tree_sync'; data?: FileTreeSyncData })
    | (SSEPayloadBase & { type: 'connected'; data?: Record<string, unknown> })
    | (SSEPayloadBase & { type: 'heartbeat'; data?: Record<string, unknown> });

  useEffect(() => {
    mountedRef.current = true;
    setIsMounted(true);
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Helper to update state only if component still mounted
  const ifMounted = (fn: () => void) => { if (mountedRef.current) fn(); };

  // Start real-time subscription for agent events using Server-Sent Events with reconnection
  const startRealtimeSubscription = useCallback((sess: string) => {
    if (!sess) {
      console.warn('Attempted to start SSE without sessionId');
      return;
    }

    // Don't recreate if already connected to this session
    if (activeSessionRef.current === sess && subscriptionRef.current) {
      return;
    }

    // Close existing connection if switching sessions
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
      activeSessionRef.current = null;
    }

    try {
      const url = `/api/stream?sessionId=${encodeURIComponent(sess)}`;
      const eventSource = new EventSource(url);
      activeSessionRef.current = sess;

      subscriptionRef.current = { unsubscribe: () => eventSource.close() };

      eventSource.onopen = () => {
        retriesRef.current = 0;
      };

      eventSource.onmessage = (event) => {
        let parsed: SSEPayload | null = null;
        try {
            parsed = JSON.parse(event.data) as SSEPayload;
        } catch {
          console.warn('[SSE] Non-JSON message', event.data);
          return;
        }
        if (!parsed) return;

        // Use store.getState() inside the handler to avoid stale closures
        const store = useChatStore.getState();

        // Heartbeat / connection notifications
        if (parsed.type === 'heartbeat') return;
        if (parsed.type === 'connected') {
          return;
        }

        // Handle file tree sync from agent
        if (parsed.type === 'file_tree_sync') {
          const syncData = parsed.data as FileTreeSyncData | undefined;
          if (syncData?.fileTree && Array.isArray(syncData.fileTree)) {
            console.log('[Agent] Syncing complete file tree from e2b filesystem');
            const newFileTree = syncData.fileTree;
            ifMounted(() => {
              useChatStore.getState().setFileTree(newFileTree);
              // Auto-select first file if none selected
              const currentSelected = useChatStore.getState().selectedFile;
              const firstFile = findFirstFile(newFileTree);
              if (firstFile && !currentSelected) {
                useChatStore.getState().setSelectedFile(firstFile);
                useChatStore.getState().setOpenFiles([firstFile]);
              }
            });
          }
        }

        // Handle code patches from agent
        if (parsed.type === 'code_patch') {
          const patchData = parsed.data as { filePath?: string; content?: string; action?: string } | undefined;
          const filePath = patchData?.filePath;
          const content = patchData?.content;
          const action = patchData?.action;

          if (filePath) {
            if (action === 'streaming_start') {
              // File is about to be written — open tab, show shimmer
              ifMounted(() => {
                useChatStore.getState().addStreamingFile(filePath);
                useChatStore.getState().setSelectedFile(filePath);
                const currentOpen = useChatStore.getState().openFiles;
                if (!currentOpen.includes(filePath)) {
                  useChatStore.getState().setOpenFiles([...currentOpen, filePath]);
                }
                // Initialize empty file in tree
                useChatStore.getState().setFileTree(prev => {
                  const exists = findFileInTree(prev, filePath);
                  if (!exists) {
                    return addFileToTree(prev, filePath, '');
                  }
                  return prev;
                });
              });
            } else if (action === 'streaming_chunk' && content !== undefined) {
              // Progressive content — append to file
              ifMounted(() => {
                useChatStore.getState().setFileTree(prev => {
                  return updateFileInTree(prev, filePath, (existing) => (existing || '') + content);
                });
              });
            } else if (action === 'streaming_end') {
              // Streaming done — remove shimmer, sync to Yjs
              ifMounted(() => {
                useChatStore.getState().removeStreamingFile(filePath);
                const finalContent = useChatStore.getState().getFileContent(filePath);
                if (finalContent) {
                  lastSavedContentRef.current[filePath] = finalContent;
                  import('@/lib/collaboration').then(({ updateYjsDocument }) => {
                    const roomId = `${sess}-${filePath}`;
                    updateYjsDocument(roomId, finalContent).catch((err: Error) => {
                      console.error('[Agent] Failed to update Yjs:', err);
                    });
                  });
                }
              });
            } else if (action === 'start') {
              // Legacy: tool execution start (e2b_write_file just began)
              ifMounted(() => {
                useChatStore.getState().setSelectedFile(filePath);
                const currentOpen = useChatStore.getState().openFiles;
                if (!currentOpen.includes(filePath)) {
                  useChatStore.getState().setOpenFiles([...currentOpen, filePath]);
                }
              });
            } else if (action === 'complete') {
              // Legacy: tool execution done
              ifMounted(() => {
                useChatStore.getState().removeStreamingFile(filePath);
              });
            } else if (action === 'patch' && content !== undefined) {
              // Legacy: full content from tool (fallback if streaming didn't happen)
              lastSavedContentRef.current[filePath] = content;
              ifMounted(() => {
                useChatStore.getState().removeStreamingFile(filePath);
                useChatStore.getState().setFileTree(prev => {
                  const exists = findFileInTree(prev, filePath);
                  if (!exists) {
                    return addFileToTree(prev, filePath, content);
                  }
                  return updateFileInTree(prev, filePath, () => content);
                });

                import('@/lib/collaboration').then(({ updateYjsDocument }) => {
                  const roomId = `${sess}-${filePath}`;
                  updateYjsDocument(roomId, content).catch((err: Error) => {
                    console.error('[Agent] Failed to update Yjs:', err);
                  });
                });
              });
            }
          }
        }

        // Handle legacy file_update events (rare cases where agent writes to e2b directly)
        if (parsed.type === 'file_update') {
          const fileData = parsed.data as FileUpdateData | undefined;
          const filePath = fileData?.filePath;
          const content = fileData?.content;

          if (filePath && content !== undefined) {
            console.log('[Agent] File written directly to e2b, syncing to Yjs:', filePath);
            // Mark as saved to prevent handleCodeChange from writing back to E2B
            lastSavedContentRef.current[filePath] = content;
            // Immediately sync to Yjs
            import('@/lib/collaboration').then(({ updateYjsDocument }) => {
              const roomId = `${sess}-${filePath}`;
              updateYjsDocument(roomId, content).catch((err: Error) => {
                console.error('[Agent] Failed to sync e2b write to Yjs:', err);
              });
            });

            // Update file tree
            ifMounted(() => {
              useChatStore.getState().setFileTree(prev => {
                function updateFile(nodes: FileNode[]): FileNode[] {
                  return nodes.map(node => {
                    if (node.type === 'file' && node.path === filePath) {
                      return { ...node, content };
                    }
                    if (node.type === 'folder' && node.children) {
                      return { ...node, children: updateFile(node.children) };
                    }
                    return node;
                  });
                }
                return updateFile(prev);
              });
            });
          }
        }

        // Update messages directly based on event type
        if (parsed.type === 'tool') {
          const toolData = parsed.data as ToolData | undefined;
          ifMounted(() => {
            useChatStore.getState().setMessages(prev => {
              const newMessages = [...prev];
              // Find last AI message and update tool calls
              for (let i = newMessages.length - 1; i >= 0; i--) {
                if (newMessages[i].role === 'ai') {
                  const existingToolCalls = newMessages[i].toolCalls || [];

                  // Helper to extract file path from args for matching
                  const getFilePath = (args?: Record<string, unknown>) => {
                    if (!args) return null;
                    return args.filePath ?? args.file_path ?? args.path ?? args.filename ?? args.file ?? null;
                  };

                  const incomingFilePath = getFilePath(toolData?.args);

                  // Find existing tool call by matching tool name AND file path (if available)
                  const toolCallIndex = existingToolCalls.findIndex(tc => {
                    if (tc.tool !== toolData?.tool) return false;

                    if (toolData?.status === 'complete' || toolData?.status === 'error') {
                      if (tc.status !== 'running' && tc.status !== 'pending') return false;
                      const existingFilePath = getFilePath(tc.args);
                      if (incomingFilePath && existingFilePath) {
                        return existingFilePath === incomingFilePath;
                      }
                      return true;
                    }

                    if (toolData?.status === 'running' || toolData?.status === 'pending') {
                      const existingFilePath = getFilePath(tc.args);
                      if (incomingFilePath && existingFilePath) {
                        return existingFilePath === incomingFilePath;
                      }
                      return (tc.status === 'running' || tc.status === 'pending');
                    }

                    return false;
                  });

                  if (toolCallIndex >= 0) {
                    existingToolCalls[toolCallIndex] = {
                      ...existingToolCalls[toolCallIndex],
                      ...toolData,
                      status: toolData?.status ?? existingToolCalls[toolCallIndex].status
                    };
                  } else {
                    existingToolCalls.push({
                      tool: toolData?.tool || 'unknown',
                      args: toolData?.args,
                      result: toolData?.result,
                      status: toolData?.status || 'running'
                    });
                  }

                  newMessages[i] = {
                    ...newMessages[i],
                    toolCalls: existingToolCalls,
                    status: 'using_tool',
                    toolName: toolData?.tool
                  };
                  break;
                }
              }
              return newMessages;
            });
          });
        } else if (parsed.type === 'partial') {
          const fullContent = parsed.data?.fullContent as string | undefined;
          ifMounted(() => {
            useChatStore.getState().setMessages(prev => {
              const newMessages = [...prev];
              let aiIndex = -1;
              for (let i = newMessages.length - 1; i >= 0; i--) {
                if (newMessages[i].role === 'ai') {
                  aiIndex = i;
                  break;
                }
              }

              if (aiIndex !== -1 && fullContent) {
                newMessages[aiIndex] = { ...newMessages[aiIndex], content: fullContent, status: 'streaming' };
              }

              return newMessages;
            });
          });
        } else if (parsed.type === 'complete') {
          const response = parsed.data?.response as string | undefined;
          ifMounted(() => {
            useChatStore.getState().setMessages(prev => {
              const newMessages = [...prev];
              for (let i = newMessages.length - 1; i >= 0; i--) {
                if (newMessages[i].role === 'ai') {
                  const updatedToolCalls = newMessages[i].toolCalls?.map(tc => ({
                    ...tc,
                    status: tc.status === 'running' ? 'complete' as const : tc.status
                  }));

                  if (response && response.trim()) {
                    newMessages[i] = {
                      ...newMessages[i],
                      content: response,
                      status: 'complete',
                      toolCalls: updatedToolCalls
                    };
                  } else {
                    newMessages[i] = {
                      ...newMessages[i],
                      status: 'complete',
                      toolCalls: updatedToolCalls
                    };
                  }
                  break;
                }
              }
              return newMessages;
            });
          });
        } else if (parsed.type === 'error') {
          const error = parsed.data?.error as string | undefined;
          ifMounted(() => {
            useChatStore.getState().setMessages(prev => {
              const newMessages = [...prev];
              for (let i = newMessages.length - 1; i >= 0; i--) {
                if (newMessages[i].role === 'ai') {
                  newMessages[i] = { ...newMessages[i], content: `Error: ${error}` };
                  break;
                }
              }
              return newMessages;
            });
          });
        }

        if (parsed.type === 'status') {
          const status = parsed.data?.status;
          ifMounted(() => useChatStore.getState().setIsStreaming(status === 'started' || status === 'processing'));
        } else if (parsed.type === 'partial') {
          ifMounted(() => useChatStore.getState().setIsStreaming(true));
        } else if (parsed.type === 'sandbox') {
          if (parsed.data?.sandboxId) {
            const newSandboxId = parsed.data.sandboxId;
            const replacedOld = parsed.data?.replacedOld as string | undefined;
            console.log('[SSE] Received sandbox event:', { newSandboxId, sessionId: sess, isNew: parsed.data?.isNew, replacedOld });

            ifMounted(() => {
              console.log('[State] Setting sandboxId to:', newSandboxId);
              useChatStore.getState().setSandboxId(newSandboxId);
              useChatStore.getState().setShowSecondPanel(true);

              // Trigger filesystem sync immediately when sandbox is created
              useChatStore.getState().setIsSyncingFilesystem(true);
              setTimeout(async () => {
                try {
                  const response = await fetch('/api/sync-filesystem', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      sandboxId: newSandboxId,
                      sessionId: sess
                    }),
                  });
                  if (response.ok) {
                    console.log('[Sync] Filesystem sync completed after sandbox creation');
                  } else {
                    console.error('[Sync] Filesystem sync failed');
                  }
                } catch (err) {
                  console.error('[Sync] Auto-sync failed:', err);
                } finally {
                  useChatStore.getState().setIsSyncingFilesystem(false);
                }
              }, 500);

              // If this is replacing a deleted sandbox, update the session in database
              if (replacedOld) {
                console.log('[Database] Updating session with new sandbox ID');
                updateSessionRef.current.mutate({
                  id: sess,
                  sandboxId: newSandboxId,
                  sandboxCreatedAt: new Date()
                });
              }
            });
          }
          if (parsed.data?.sandboxUrl) {
            const newSandboxUrl = parsed.data.sandboxUrl;
            ifMounted(() => {
              const currentUrl = useChatStore.getState().sandboxUrl;
              if (currentUrl !== newSandboxUrl) {
                console.log('[Sandbox URL] Updating from', currentUrl, 'to', newSandboxUrl);
                useChatStore.getState().setSandboxUrl(newSandboxUrl);
                useChatStore.getState().setShowSecondPanel(true);
                useChatStore.getState().setActiveTab('live preview');
                useChatStore.getState().setIframeLoading(true);
                useChatStore.getState().setSandboxCreatedAt(Date.now());
                useChatStore.getState().setIsSandboxExpired(false);
              } else {
                console.log('[Sandbox URL] No change, keeping existing:', currentUrl);
              }
            });
          }
        } else if (parsed.type === 'complete' || parsed.type === 'error') {
          ifMounted(() => useChatStore.getState().setIsStreaming(false));
          if (parsed.data?.sandboxUrl) {
            const newSandboxUrl = parsed.data.sandboxUrl;
            ifMounted(() => {
              const currentUrl = useChatStore.getState().sandboxUrl;
              if (currentUrl !== newSandboxUrl) {
                useChatStore.getState().setSandboxUrl(newSandboxUrl);
                useChatStore.getState().setSandboxCreatedAt(Date.now());
                useChatStore.getState().setIsSandboxExpired(false);
              }
            });
          }
        }
      };

      eventSource.onerror = () => {
        ifMounted(() => useChatStore.getState().setIsStreaming(false));
        if (retriesRef.current < MAX_RETRIES && mountedRef.current) {
          const retryIn = 500 * 2 ** retriesRef.current;
          retriesRef.current += 1;
          setTimeout(() => {
            if (mountedRef.current) startRealtimeSubscription(sess);
          }, retryIn);
        } else {
          toast.error('Real-time connection failed');
        }
      };

    } catch (error) {
      console.error('Failed to start subscription:', error);
      toast.error('Failed to start real-time updates');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Establish SSE connection when sessionId is set
  useEffect(() => {
    if (sessionId && !sessionId.startsWith('session-')) {
      startRealtimeSubscription(sessionId);
    }
  }, [sessionId, startRealtimeSubscription]);

  // Cleanup subscription on unmount
  useEffect(() => {
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }
    };
  }, []);

  // --- handleCodeChange: reads from store.getState() so never stale ---
  const handleCodeChange = useCallback((val: string | undefined) => {
    const { selectedFile, sandboxId, isStreaming, updateFileContent } = useChatStore.getState();
    const newContent = val ?? "";

    // Update file tree with new content
    updateFileContent(selectedFile, newContent);

    // Debounced sync to e2b filesystem (skip when agent is writing)
    if (sandboxId && selectedFile && !isStreaming) {
      // Cancel previous timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Check if content actually changed
      if (lastSavedContentRef.current[selectedFile] === newContent) {
        return;
      }

      // Set new timeout to save after 1 second of inactivity
      saveTimeoutRef.current = setTimeout(async () => {
        // Re-read latest state at save time
        const latestState = useChatStore.getState();
        const currentFile = latestState.selectedFile;

        try {
          useChatStore.getState().setIsSyncingToE2B(true);
          lastSavedContentRef.current[selectedFile] = newContent;

          const response = await fetch('/api/write-to-sandbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sandboxId,
              filePath: selectedFile,
              content: newContent,
            }),
          });

          const data = await response.json();
          if (response.ok) {
            console.log('[Sync] Saved to e2b:', selectedFile);
          } else {
            console.error('[Sync] Failed to write to e2b:', data.error);
            toast.error('Failed to sync to sandbox');
          }
        } catch (error) {
          console.error('[Sync] Error writing to e2b:', error);
          toast.error('Sync error');
        } finally {
          useChatStore.getState().setIsSyncingToE2B(false);
        }
      }, 1000);
    }
  }, []); // Empty deps! Reads from store.getState() so never stale

  // Notify sidebar to refresh when messages change
  useEffect(() => {
    const hasUserMessages = messages.some(m => m.role === 'user');
    if (hasUserMessages && typeof globalThis !== 'undefined') {
      globalThis.dispatchEvent(new CustomEvent('chatUpdated'));
    }
  }, [messages]);

  // Auto-save messages and sandbox data to database (debounced)
  useEffect(() => {
    if (!sessionId || !sessionExistsRef.current || messages.length === 0) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch(`/api/session/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
          })),
          fileTree: fileTree,
          sandboxId: sandboxId || undefined,
          sandboxUrl: sandboxUrl || undefined,
          sandboxCreatedAt: sandboxCreatedAt ? new Date(sandboxCreatedAt).toISOString() : undefined,
        }),
      }).catch(err => console.error('[DB] Failed to save session:', err));
    }, 2000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sessionId, messages, fileTree, sandboxId, sandboxUrl, sandboxCreatedAt]);

  // Handler for sending a message
  const handleSend = useCallback(() => {
    const { message, sessionId, sandboxId } = useChatStore.getState();

    if (!message.trim()) return;
    if (isSending.current) {
      return;
    }

    isSending.current = true;
    const userMessage = message;
    useChatStore.getState().setMessage("");

    // Add user message to chat and ensure AI response placeholder
    useChatStore.getState().setMessages((prev) => {
      const newMessages: ChatMessage[] = [
        ...prev,
        {
          role: "user",
          content: userMessage,
          timestamp: Date.now(),
          id: `user-${Date.now()}`
        }
      ];
      newMessages.push({
        role: 'ai',
        content: '',
        timestamp: Date.now(),
        id: `ai-${Date.now()}`,
        status: 'thinking'
      });
      return newMessages;
    });

    // Start streaming mode
    useChatStore.getState().setIsStreaming(true);

    // IMPORTANT: Start SSE subscription BEFORE sending the message
    startRealtimeSubscription(sessionId);

    console.log('[handleSend] Current state - sandboxId:', sandboxId, 'sessionId:', sessionId);
    if (sandboxId) {
      useChatStore.getState().setShowSecondPanel(true);
      console.log('[handleSend] Reusing existing sandbox:', sandboxId, 'for session:', sessionId);
      invokeWithSandbox.mutate({
        message: userMessage,
        sandboxId,
        sessionId
      });
    } else {
      invoke.mutate({
        message: userMessage,
        sessionId
      });
    }
  }, [invoke, invokeWithSandbox, startRealtimeSubscription]);

  // Check sandbox expiration
  useEffect(() => {
    if (!sandboxCreatedAt || !sandboxUrl) return;

    const checkExpiration = () => {
      const elapsed = Date.now() - sandboxCreatedAt;
      if (elapsed >= SANDBOX_EXPIRY_MS) {
        setIsSandboxExpired(true);
      }
    };

    // Check immediately
    checkExpiration();

    // Check every minute
    const interval = setInterval(checkExpiration, 60000);
    return () => clearInterval(interval);
  }, [sandboxCreatedAt, sandboxUrl, setIsSandboxExpired]);

  // Switch to code tab when sandbox expires
  useEffect(() => {
    if (isSandboxExpired) {
      setActiveTab('code');
    }
  }, [isSandboxExpired, setActiveTab]);

  // Auto-send initial message from home page
  useEffect(() => {
    if (shouldAutoSend && message.trim() && !hasAutoSent.current && messages.length === 1) {
      hasAutoSent.current = true;
      setShouldAutoSend(false);
      setTimeout(() => {
        handleSend();
      }, 100);
    }
  }, [shouldAutoSend, message, messages.length, handleSend]);

  // Extracted nested ternary rendering into an independent function for clarity
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
          {/* Browser Chrome */}
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
            {/* Navigation Buttons */}
            <div className="flex items-center gap-1 mr-2">
              <button
                type="button"
                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setIframeLoading(true);
                  const iframe = document.querySelector('iframe[title="Sandbox Preview"]') as HTMLIFrameElement;
                  if (iframe) {
                    const currentSrc = iframe.src;
                    iframe.src = '';
                    setTimeout(() => { iframe.src = currentSrc; }, 0);
                  }
                }}
                title="Refresh"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>

            {/* URL Bar */}
            <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-background rounded-md border text-sm">
              <svg className="w-3.5 h-3.5 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              <span className="text-muted-foreground truncate font-mono text-xs">
                {sandboxUrl}
              </span>
              <button
                type="button"
                className="ml-auto p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(sandboxUrl);
                  toast.success('URL copied to clipboard');
                }}
                title="Copy URL"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>

            {/* External Link Button */}
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

          {/* Iframe Container */}
          <div className="relative flex-1 min-h-0">
            {iframeLoading && (
              <div className="absolute inset-0 z-10">
                <PreviewShimmer />
              </div>
            )}
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
            <p className="text-sm text-muted-foreground max-w-md">
              This sandbox has expired after 25 minutes of inactivity.
            </p>
          </div>
        </div>
      );
    }

    return null;
  };

  // Render main content based on panel state and device type
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
              isLoading={invoke.isPending || invokeWithSandbox.isPending}
              isStreaming={isStreaming}
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
          isLoading={invoke.isPending || invokeWithSandbox.isPending}
          isStreaming={isStreaming}
          renderPreview={renderPreview}
          handleCodeChange={handleCodeChange}
          guestCredentials={guestCredentials}
        />
      );
    }

    return (
      <DesktopChatLayout
        messages={messages}
        message={message}
        setMessage={setMessage as Dispatch<SetStateAction<string>>}
        handleSend={handleSend}
        isLoading={invoke.isPending || invokeWithSandbox.isPending}
        isStreaming={isStreaming}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        handleCodeChange={handleCodeChange}
        guestCredentials={guestCredentials}
        renderPreview={renderPreview}
      />
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
          <span className="text-sm font-medium">
            {isStreaming ? 'AI is thinking...' : 'Ready'}
          </span>
          {isSharedAccess && (
            <Badge variant="secondary" className="text-xs">
              <Users className="h-3 w-3 mr-1" />
              Shared Session
            </Badge>
          )}
          {messages.length > 1 && (
            <span className="text-xs text-muted-foreground">
              {messages.length} messages
            </span>
          )}
          {sandboxUrl && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              {' '}
              Sandbox Active
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Tab Switcher */}
          {showSecondPanel && (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-7 bg-muted/50">
                <TabsTrigger value="live preview" className="text-xs h-6 px-3">Preview</TabsTrigger>
                <TabsTrigger value="code" className="text-xs h-6 px-3">Code</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {/* Connected Users Avatars */}
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
                    <TooltipContent>
                      <p className="text-xs">{user.name}</p>
                    </TooltipContent>
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
                  // Clear in database
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

// Helper to find first file path in a tree (used in SSE handler)
function findFirstFile(nodes: FileNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'file') return node.path;
    if (node.type === 'folder' && node.children) {
      const found = findFirstFile(node.children);
      if (found) return found;
    }
  }
  return null;
}

export default Page;
