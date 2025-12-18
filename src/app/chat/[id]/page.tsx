"use client";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { CodeEditor } from "@/components/CodeEditor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileTree } from "@/components/FileTree";
import { ChatPanel, ChatMessage } from "@/components/ChatPanel";
import { ShareButton } from "@/components/ShareButton";
import { Users } from "lucide-react";

// Define FileNode type for file tree structure
type FileNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  content?: string;
};

// Real-time update types
type AgentUpdate = {
  type: 'status' | 'partial' | 'tool' | 'complete' | 'error' | 'sandbox' | 'file_tree_sync' | 'code_patch' | 'file_update';
  content: string;
  timestamp: Date;
  data?: Record<string, unknown>;
};

interface PageProps {
  params: Promise<{ id: string }>;
}

function Page({ params }: PageProps) {
  const trpc = useTRPC();
  const searchParams = useSearchParams();
  const shareToken = searchParams.get('token');
  const isSharedAccess = !!shareToken;
  
  const [shouldAutoSend, setShouldAutoSend] = useState(false);
  const [connectedUsers, setConnectedUsers] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [isMounted, setIsMounted] = useState(false);
  const [isSyncingToE2B, setIsSyncingToE2B] = useState(false);
  
  // Sandbox expiration constants
  const SANDBOX_EXPIRY_MS = 25 * 60 * 1000; // 25 minutes

  // Generate stable guest credentials for shared sessions
  const guestCredentials = useMemo(() => {
    if (!isSharedAccess) return null;
    const randomId = Math.floor(Math.random() * 10000);
    return {
      username: `Guest-${randomId}`,
      userId: `guest-${Date.now()}-${randomId}`,
    };
  }, [isSharedAccess]);

  // Mutation to create session in database
  const sessionCheckRef = useRef<Set<string>>(new Set());
  const sessionExistsRef = useRef(false);

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
          createDbSession.mutate({
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
          setMessage(initialPrompt);
          setShouldAutoSend(true);
          // Clean up sessionStorage
          sessionStorage.removeItem(`chat_${id}_initial`);
        }
      }
    });
    
    return () => {
      mounted = false;
    };
  }, [params]);
  
  // Session management (allow dynamic updates from backend)
  const [sessionId, setSessionId] = useState(() => `session-${Date.now()}`);
  const [isSyncingFilesystem, setIsSyncingFilesystem] = useState(false);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  
  // Use ref to always access latest sandboxId in event handlers
  const sandboxIdRef = useRef<string | null>(null);
  useEffect(() => {
    sandboxIdRef.current = sandboxId;
  }, [sandboxId]);
  
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
                setIsSyncingFilesystem(false);
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
                  setIsSandboxExpired(true);
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
  }, [sessionId, SANDBOX_EXPIRY_MS]);
  
  const [isStreaming, setIsStreaming] = useState(false);
  
  // Real-time updates
  const [agentUpdates, setAgentUpdates] = useState<AgentUpdate[]>([]);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const hasAutoSent = useRef(false);
  const isSending = useRef(false);

  const invoke = useMutation(
    trpc.invoke.mutationOptions({
      onSuccess: ({ sessionId: newSessionId }) => {
        toast.success('Agent started successfully!');
        if (newSessionId && newSessionId !== sessionId) {
          setSessionId(newSessionId);
        }
        isSending.current = false;
        // SSE connection already started in handleSend before mutation
      },
      onError: (error) => {
        toast.error(`Error invoking agent: ${error.message}`);
        setIsStreaming(false);
        isSending.current = false;
      },
      onMutate: () => {
        setIsStreaming(true);
        setAgentUpdates([]);
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
        if (newSessionId && newSessionId !== sessionId) {
          setSessionId(newSessionId);
        }
        isSending.current = false;
        // SSE connection already started in handleSend before mutation
      },
      onError: (error) => {
        toast.error(`Error invoking agent: ${error.message}`);
        setIsStreaming(false);
        isSending.current = false;
      },
      onMutate: () => {
        setIsStreaming(true);
        setAgentUpdates([]);
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
  type ReasoningData = { reasoning?: string };
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
    | (SSEPayloadBase & { type: 'reasoning'; data?: ReasoningData })
    | (SSEPayloadBase & { type: 'file_update'; data?: FileUpdateData })
    | (SSEPayloadBase & { type: 'code_patch'; data?: CodePatchData })
    | (SSEPayloadBase & { type: 'file_tree_sync'; data?: FileTreeSyncData })
    | (SSEPayloadBase & { type: 'connected'; data?: Record<string, unknown> })
    | (SSEPayloadBase & { type: 'heartbeat'; data?: Record<string, unknown> });

  const mountedRef = useRef(true);
  const retriesRef = useRef(0);
  const MAX_RETRIES = 5;

  useEffect(() => {
    mountedRef.current = true;
    setIsMounted(true);
    return () => { 
      mountedRef.current = false; 
    };
  }, []);

  // Helper to update state only if component still mounted
  const ifMounted = (fn: () => void) => { if (mountedRef.current) fn(); };

  const getContentFromData = useCallback((data: SSEPayload): string => {
    switch (data.type) {
      case 'status':
        return data.data?.message || 'Status update';
      case 'partial':
        return data.data?.content || '';
      case 'tool':
        return `\uD83D\uDD27 ${data.data?.tool}`; // wrench emoji escaped for safety
      case 'sandbox':
        return `\uD83C\uDFD7️ Sandbox ${data.data?.isNew ? 'created' : 'connected'}: ${data.data?.sandboxId}`;
      case 'complete':
        return '✅ Task completed';
      case 'error':
        return `❌ Error: ${data.data?.error}`;
      case 'file_update':
        return `📝 Updating file: ${data.data?.filePath || 'unknown'}`;
      default:
        return data.data ? JSON.stringify(data.data) : '';
    }
  }, []);

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

        // Heartbeat / connection notifications
        if (parsed.type === 'heartbeat') return;
        if (parsed.type === 'connected') {
          return;
        }
        
        const update: AgentUpdate = {
          type: parsed.type as AgentUpdate['type'],
          content: getContentFromData(parsed),
          timestamp: new Date(),
          data: parsed.data,
        };
        ifMounted(() => setAgentUpdates(prev => [...prev, update]));

        // Handle file tree sync from agent
        if (parsed.type === 'file_tree_sync') {
          const syncData = parsed.data as FileTreeSyncData | undefined;
          if (syncData?.fileTree && Array.isArray(syncData.fileTree)) {
            console.log('[Agent] Syncing complete file tree from e2b filesystem');
            const newFileTree = syncData.fileTree;
            ifMounted(() => {
              setFileTree(newFileTree);
              // Auto-select first file if none selected
              const allFiles = flattenFiles(newFileTree);
              if (allFiles.length > 0 && !selectedFile) {
                setSelectedFile(allFiles[0].path);
                setOpenFiles([allFiles[0].path]);
              }
            });
          }
        }

        // Handle code patches from agent - NEW APPROACH: Agent writes directly to editor
        if (parsed.type === 'code_patch') {
          const patchData = parsed.data as { filePath?: string; content?: string; action?: string } | undefined;
          const filePath = patchData?.filePath;
          const content = patchData?.content;
          const action = patchData?.action;
          
          console.log('[Agent] code_patch event:', { action, filePath, hasContent: content !== undefined, contentLength: content?.length, hasSandboxId: !!sandboxIdRef.current });

          if (filePath) {
            if (action === 'start') {
              console.log('[Agent] Started editing file:', filePath);
              // Switch to the file being edited
              ifMounted(() => {
                setSelectedFile(filePath);
                if (!openFiles.includes(filePath)) {
                  setOpenFiles(prev => [...prev, filePath]);
                }
              });
            } else if (action === 'complete') {
              console.log('[Agent] Completed editing file:', filePath);
              // Sync final content to e2b immediately - content is included in complete event
              if (content !== undefined && sandboxIdRef.current) {
                console.log('[Agent] Syncing final content to e2b:', filePath, 'length:', content.length);
                fetch('/api/write-to-sandbox', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sandboxId: sandboxIdRef.current,
                    filePath,
                    content,
                  }),
                })
                  .then(response => response.json())
                  .then(data => {
                    if (data.success) {
                      console.log('[Agent] ✅ Synced to e2b:', filePath);
                    } else {
                      console.error('[Agent] Failed to sync to e2b:', data.error);
                    }
                  })
                  .catch(err => console.error('[Agent] Failed to sync to e2b:', err));
              } else {
                console.warn('[Agent] Cannot sync to e2b: content or sandboxId missing');
              }
            } else if (action === 'patch' && content !== undefined) {
              // Apply patch directly to editor state
              console.log('[Agent] Applying code patch to:', filePath, 'content length:', content.length);
              ifMounted(() => {
                // Update file tree - add file if it doesn't exist
                setFileTree(prev => {
                  let fileExists = false;
                  
                  function updateFile(nodes: FileNode[]): FileNode[] {
                    return nodes.map(node => {
                      if (node.type === 'file' && node.path === filePath) {
                        fileExists = true;
                        return { ...node, content };
                      }
                      if (node.type === 'folder' && node.children) {
                        return { ...node, children: updateFile(node.children) };
                      }
                      return node;
                    });
                  }
                  
                  const updated = updateFile(prev);
                  
                  // If file doesn't exist, add it to root
                  if (!fileExists) {
                    console.log('[Agent] File not in tree, adding:', filePath);
                    return [...updated, {
                      name: filePath.split('/').pop() || filePath,
                      path: filePath,
                      type: 'file',
                      content
                    }];
                  }
                  
                  return updated;
                });
                
                // Always update Yjs for the file being edited by agent
                console.log('[Agent] Updating Yjs document:', filePath);
                import('@/lib/collaboration').then(({ updateYjsDocument }) => {
                  const roomId = `${sess}-${filePath}`;
                  updateYjsDocument(roomId, content).catch((err: Error) => {
                    console.error('[Agent] Failed to update Yjs document:', err);
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
            // Immediately sync to Yjs
            import('@/lib/collaboration').then(({ updateYjsDocument }) => {
              const roomId = `${sess}-${filePath}`;
              updateYjsDocument(roomId, content).catch((err: Error) => {
                console.error('[Agent] Failed to sync e2b write to Yjs:', err);
              });
            });
            
            // Update file tree
            ifMounted(() => {
              setFileTree(prev => {
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
        if (parsed.type === 'reasoning') {
          const reasoning = parsed.data?.reasoning as string | undefined;
          ifMounted(() => {
            setMessages(prev => {
              const newMessages = [...prev];
              // Find last AI message and add reasoning
              for (let i = newMessages.length - 1; i >= 0; i--) {
                if (newMessages[i].role === 'ai') {
                  newMessages[i] = { ...newMessages[i], reasoning };
                  break;
                }
              }
              return newMessages;
            });
          });
        } else if (parsed.type === 'tool') {
          const toolData = parsed.data as ToolData | undefined;
          ifMounted(() => {
            setMessages(prev => {
              const newMessages = [...prev];
              // Find last AI message and update tool calls
              for (let i = newMessages.length - 1; i >= 0; i--) {
                if (newMessages[i].role === 'ai') {
                  const existingToolCalls = newMessages[i].toolCalls || [];
                  const toolCallIndex = existingToolCalls.findIndex(tc => tc.tool === toolData?.tool);
                  
                  if (toolCallIndex >= 0) {
                    // Update existing tool call
                    existingToolCalls[toolCallIndex] = {
                      ...existingToolCalls[toolCallIndex],
                      ...toolData,
                      status: toolData?.status || existingToolCalls[toolCallIndex].status
                    };
                  } else {
                    // Add new tool call
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
            setMessages(prev => {
              const newMessages = [...prev];
              // Find last AI message
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
            setMessages(prev => {
              const newMessages = [...prev];
              for (let i = newMessages.length - 1; i >= 0; i--) {
                if (newMessages[i].role === 'ai') {
                  if (response && response.trim()) {
                    newMessages[i] = { ...newMessages[i], content: response };
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
            setMessages(prev => {
              const newMessages = [...prev];
              for (let i = newMessages.length - 1; i >= 0; i--) {
                if (newMessages[i].role === 'ai') {
                  newMessages[i] = { ...newMessages[i], content: `❌ Error: ${error}` };
                  break;
                }
              }
              return newMessages;
            });
          });
        }

        if (parsed.type === 'status') {
          const status = parsed.data?.status;
          ifMounted(() => setIsStreaming(status === 'started' || status === 'processing'));
        } else if (parsed.type === 'partial') {
          ifMounted(() => setIsStreaming(true));
        } else if (parsed.type === 'sandbox') {
          if (parsed.data?.sandboxId) {
            const newSandboxId = parsed.data.sandboxId;
            const replacedOld = parsed.data?.replacedOld as string | undefined;
            console.log('[SSE] Received sandbox event:', { newSandboxId, sessionId: sess, isNew: parsed.data?.isNew, replacedOld });
            
            ifMounted(() => {
              console.log('[State] Setting sandboxId to:', newSandboxId);
              setSandboxId(newSandboxId);
              // Auto-open preview panel when sandbox is created
              setShowSecondPanel(true);
              
              // Trigger filesystem sync immediately when sandbox is created
              setIsSyncingFilesystem(true);
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
                  setIsSyncingFilesystem(false);
                }
              }, 500);
              
              // If this is replacing a deleted sandbox, update the session in database
              if (replacedOld) {
                console.log('[Database] Updating session with new sandbox ID');
                updateSession.mutate({
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
              // Only update if the URL actually changed to prevent iframe refresh
              setSandboxUrl(prev => {
                if (prev !== newSandboxUrl) {
                  console.log('[Sandbox URL] Updating from', prev, 'to', newSandboxUrl);
                  setShowSecondPanel(true);
                  setActiveTab('live preview');
                  setIframeLoading(true);
                  setSandboxCreatedAt(Date.now());
                  setIsSandboxExpired(false);
                  return newSandboxUrl;
                }
                console.log('[Sandbox URL] No change, keeping existing:', prev);
                return prev;
              });
            });
          }
        } else if (parsed.type === 'complete' || parsed.type === 'error') {
          ifMounted(() => setIsStreaming(false));
          if (parsed.data?.sandboxUrl) {
            const newSandboxUrl = parsed.data.sandboxUrl;
            ifMounted(() => {
              // Only update if URL changed
              setSandboxUrl(prev => {
                if (prev !== newSandboxUrl) {
                  setSandboxCreatedAt(Date.now());
                  setIsSandboxExpired(false);
                  return newSandboxUrl;
                }
                return prev;
              });
            });
          }
        }
      };

      eventSource.onerror = () => {
        ifMounted(() => setIsStreaming(false));
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
  }, [getContentFromData, updateSession, sandboxId]);

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

  // state for the input message
  const [message, setMessage] = useState("");
  // state for toggling the second panel - show when sandbox exists or code-related activity
  const [showSecondPanel, setShowSecondPanel] = useState(false);
  // state for the code editor
  const [code, setCode] = useState("// Write your code here\n");
  // state for iframe loading
  const [iframeLoading, setIframeLoading] = useState(true);
  // state for active tab
  const [activeTab, setActiveTab] = useState("live preview");
  // state for sandbox expiration tracking
  const [sandboxCreatedAt, setSandboxCreatedAt] = useState<number | null>(null);
  const [isSandboxExpired, setIsSandboxExpired] = useState(false);
  const [isCheckingExpiration, setIsCheckingExpiration] = useState(false);

  // sample hierarchical file tree state
  const [fileTree, setFileTree] = useState<FileNode[]>([
    {
      name: "app",
      path: "app",
      type: "folder",
      children: [
        {
          name: "page.tsx",
          path: "app/page.tsx",
          type: "file",
          content: "// Home page code\n",
        },
      ],
    },
    {
      name: "lib",
      path: "lib",
      type: "folder",
      children: [
        {
          name: "utils.ts",
          path: "lib/utils.ts",
          type: "file",
          content: "export function sum(a, b) { return a + b; }\n",
        },
      ],
    },
    {
      name: "components",
      path: "components",
      type: "folder",
      children: [
        {
          name: "Button.tsx",
          path: "components/Button.tsx",
          type: "file",
          content: "export const Button = () => <button>Click</button>;\n",
        },
      ],
    },
  ]);

  // flatten file tree to get all files for selection and editing
  function flattenFiles(nodes: FileNode[]): FileNode[] {
    let files: FileNode[] = [];
    for (const node of nodes) {
      if (node.type === "file") files.push(node);
      if (node.type === "folder" && node.children) files = files.concat(flattenFiles(node.children));
    }
    return files;
  }
  const allFiles = flattenFiles(fileTree);
  const [selectedFile, setSelectedFile] = useState(allFiles[0]?.path || 'app/page.tsx');
  const [openFiles, setOpenFiles] = useState<string[]>([allFiles[0]?.path || 'app/page.tsx']);

  // Get current file's content directly from fileTree to avoid stale state
  const getCurrentFileContent = useCallback((filePath: string): string => {
    const file = allFiles.find(f => f.path === filePath);
    return file?.content ?? "";
  }, [allFiles]);



  // Ref to track the last saved content for debouncing
  const lastSavedContentRef = useRef<{ [filePath: string]: string }>({});
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // update file content when code changes - synced via Yjs
  const handleCodeChange = useCallback((val: string | undefined) => {
    const newContent = val ?? "";
    setCode(newContent);
    
    // Update file tree with new content
    setFileTree(prev => {
      interface UpdateNode {
        name: string;
        path: string;
        type: "file" | "folder";
        children?: UpdateNode[];
        content?: string;
      }

      function update(nodes: UpdateNode[]): UpdateNode[] {
        return nodes.map((n: UpdateNode) => {
          if (n.type === "file" && n.path === selectedFile) return { ...n, content: newContent };
          if (n.type === "folder" && n.children) return { ...n, children: update(n.children) };
          return n;
        });
      }
      return update(prev);
    });

    // Debounced sync to e2b filesystem
    if (sandboxId && selectedFile) {
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
        try {
          setIsSyncingToE2B(true);
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
            console.log('[Sync] ✅ Saved to e2b:', selectedFile);
          } else {
            console.error('[Sync] Failed to write to e2b:', data.error);
            toast.error('Failed to sync to sandbox');
          }
        } catch (error) {
          console.error('[Sync] Error writing to e2b:', error);
          toast.error('Sync error');
        } finally {
          setIsSyncingToE2B(false);
        }
      }, 1000);
    }
  }, [sandboxId, selectedFile]);

  // Chat state for Copilot-like interface with database persistence
  const [messages, setMessages] = useState<ChatMessage[]>([{ 
    role: "ai", 
    content: "👋 Welcome to CodeVibe! I can help you generate code. Try asking me to 'generate some code' or 'create components' to see live file streaming in action!",
    timestamp: Date.now(),
    id: 'welcome'
  }]);
  
  // Messages are loaded from database in the session load effect above
  // Notify sidebar to refresh when messages change
  useEffect(() => {
    const hasUserMessages = messages.some(m => m.role === 'user');
    if (hasUserMessages && typeof globalThis !== 'undefined') {
      globalThis.dispatchEvent(new CustomEvent('chatUpdated'));
    }
  }, [messages]);

  // Update messages when real-time updates come in - agent activity logic for chat bubbles
  useEffect(() => {
    if (agentUpdates.length === 0) return;
    const latestUpdate = agentUpdates[agentUpdates.length - 1];
    if (latestUpdate.type === 'partial') {
      setMessages(prev => {
        const newMessages = [...prev];
        // Find the last AI message (should already exist from handleSend)
        let aiIndex = -1;
        for (let i = newMessages.length - 1; i >= 0; i--) {
          if (newMessages[i].role === 'ai') {
            aiIndex = i;
            break;
          }
        }
        
        // If no AI message found, create one (shouldn't happen but safeguard)
        if (aiIndex === -1) {
          newMessages.push({ 
            role: 'ai', 
            content: '',
            timestamp: Date.now(),
            id: `ai-${Date.now()}`
          });
          aiIndex = newMessages.length - 1;
        }
        
        // Always use fullContent from the event if available, otherwise append delta
        const fullFromEvent = (latestUpdate.data?.fullContent as string | undefined) || '';
        if (fullFromEvent) {
          // Use the full accumulated content from the server
          newMessages[aiIndex] = { ...newMessages[aiIndex], content: fullFromEvent };
        } else {
          // Fallback: append delta (shouldn't happen with our current implementation)
          const existing = newMessages[aiIndex].content === '🔄 Processing...' ? '' : newMessages[aiIndex].content;
          const delta = latestUpdate.content || '';
          newMessages[aiIndex] = { ...newMessages[aiIndex], content: existing + delta };
        }
        return newMessages;
      });
      setIsStreaming(true);
    } else if (latestUpdate.type === 'complete') {
      setMessages((prev) => {
        const newMessages = [...prev];
        // Find the last AI message and update with final response
        for (let i = newMessages.length - 1; i >= 0; i--) {
          if (newMessages[i].role === 'ai') {
            const responseContent = latestUpdate.data?.response as string | undefined;
            // Always update if we have response content from complete event
            if (responseContent && responseContent.trim()) {
              newMessages[i] = { ...newMessages[i], content: responseContent };
            } 
            // If still showing processing or empty, use response or fallback
            else if (!newMessages[i].content || newMessages[i].content === '🔄 Processing...' || newMessages[i].content === '') {
              newMessages[i] = { ...newMessages[i], content: responseContent || 'Task completed' };
            }
            // Otherwise keep the accumulated content from partial updates
            break;
          }
        }
        return newMessages;
      });
      setIsStreaming(false);
    } else if (latestUpdate.type === 'error') {
      setMessages((prev) => {
        const newMessages = [...prev];
        for (let i = newMessages.length - 1; i >= 0; i--) {
          if (newMessages[i].role === 'ai') {
            newMessages[i] = { ...newMessages[i], content: `❌ Error: ${latestUpdate.data?.error || latestUpdate.content}` };
            break;
          }
        }
        return newMessages;
      });
      setIsStreaming(false);
    }
  }, [agentUpdates]);

  // Auto-save messages and sandbox data to database
  useEffect(() => {
    // Only save if session exists in database
    if (sessionId && sessionExistsRef.current && messages.length > 0) {
      // Debounce the save to avoid too many requests
      const timeoutId = setTimeout(() => {
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
      }, 1000);

      return () => clearTimeout(timeoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, JSON.stringify(messages), JSON.stringify(fileTree), sandboxId, sandboxUrl, sandboxCreatedAt]);

  // Handler for sending a message
  const handleSend = useCallback(() => {
    if (!message.trim()) return;
    if (isSending.current) {
      return;
    }
    
    isSending.current = true;
    const userMessage = message;
    setMessage("");
    
    // Add user message to chat and ensure AI response placeholder
    setMessages((prev) => {
      const newMessages: ChatMessage[] = [
        ...prev, 
        { 
          role: "user", 
          content: userMessage,
          timestamp: Date.now(),
          id: `user-${Date.now()}`
        }
      ];
      // Always add an AI processing stub for the new response
      newMessages.push({ 
        role: 'ai', 
        content: '🔄 Processing...',
        timestamp: Date.now(),
        id: `ai-${Date.now()}`
      });
      return newMessages;
    });

    // Start streaming mode
    setIsStreaming(true);

    // IMPORTANT: Start SSE subscription BEFORE sending the message
    // This ensures we don't miss any events from the agent
    startRealtimeSubscription(sessionId);

    // The agent will intelligently analyze if a sandbox is needed
    // We only need to check if one already exists to maintain context
    console.log('[handleSend] Current state - sandboxId:', sandboxId, 'sessionId:', sessionId);
    if (sandboxId) {
      // Show preview panel for existing sandbox
      setShowSecondPanel(true);
      // Use existing sandbox to maintain context
      console.log('[handleSend] Reusing existing sandbox:', sandboxId, 'for session:', sessionId);
      invokeWithSandbox.mutate({ 
        message: userMessage, 
        sandboxId,
        sessionId
      });
    } else {
      // Let the agent intelligently decide if a sandbox is needed
      // It will analyze the task and create one if necessary
      invoke.mutate({ 
        message: userMessage, 
        sessionId
      });
    }
  }, [message, sessionId, sandboxId, invoke, invokeWithSandbox, startRealtimeSubscription]);

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
  }, [sandboxCreatedAt, sandboxUrl, SANDBOX_EXPIRY_MS]);

  // Switch to code tab when sandbox expires
  useEffect(() => {
    if (isSandboxExpired) {
      setActiveTab('code');
    }
  }, [isSandboxExpired]);

  // Auto-send initial message from home page
  useEffect(() => {
    if (shouldAutoSend && message.trim() && !hasAutoSent.current && messages.length === 1) {
      // Only auto-send if we haven't sent yet and only have welcome message
      hasAutoSent.current = true;
      setShouldAutoSend(false);
      // Use setTimeout to ensure component is fully mounted
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
        <iframe
          src={sandboxUrl}
          className="w-full h-full min-h-[200px] border-0"
          onLoad={() => setIframeLoading(false)}
          title="Sandbox Preview"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          allow="clipboard-write; clipboard-read; microphone; camera; accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
        />
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
          {sandboxUrl && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => globalThis.globalThis.open(sandboxUrl, '_blank')}
              className="text-xs h-8"
            >
              🏗️ Open in Browser
            </Button>
          )}
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
        {showSecondPanel ? (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={30}>
              <div className="h-full flex flex-col w-full">
                <ChatPanel
                  messages={messages}
                  message={message}
                  setMessage={setMessage}
                  onSend={handleSend}
                  isLoading={invoke.isPending || invokeWithSandbox.isPending}
                  isStreaming={isStreaming}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel
              defaultSize={70}
              className="animate-in fade-in-0 data-[state=active]:fade-in-100"
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key="webview-panel"
                  initial={{ x: "100%", opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: "100%", opacity: 0 }}
                  transition={{ type: "tween", duration: 0.35 }}
                  className="flex h-full w-full flex-col overflow-hidden"
                >
                  <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full overflow-hidden">
                    <TabsContent value="code" className="flex flex-row flex-1 min-h-0 gap-0 mt-0 overflow-hidden">
                      <div className="w-48 h-full flex-shrink-0 overflow-hidden border-r flex flex-col">
                        <div className="p-2 border-b flex items-center justify-between bg-muted/20">
                          <span className="text-xs font-medium text-muted-foreground">Files</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={async () => {
                              if (!sandboxId || !sessionId) {
                                toast.error('No sandbox available');
                                return;
                              }
                              try {
                                const response = await fetch('/api/sync-filesystem', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ sandboxId, sessionId }),
                                });
                                const data = await response.json();
                                if (data.success) {
                                  toast.success('Filesystem synced!');
                                } else {
                                  toast.error(data.error || 'Sync failed');
                                }
                              } catch (error) {
                                toast.error('Failed to sync filesystem');
                                console.error('Sync error:', error);
                              }
                            }}
                            title="Sync filesystem from e2b sandbox"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                            </svg>
                          </Button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <FileTree
                            nodes={fileTree}
                            selected={selectedFile}
                            onSelect={(path) => {
                              setSelectedFile(path);
                              if (!openFiles.includes(path)) {
                                setOpenFiles([...openFiles, path]);
                              }
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
                        {isSyncingFilesystem ? (
                          <div className="flex items-center justify-center h-full">
                            <div className="text-center space-y-2">
                              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                              <p className="text-sm text-muted-foreground">Syncing filesystem...</p>
                            </div>
                          </div>
                        ) : (
                          <>
                        {/* File Tabs */}
                        <div className="flex items-center justify-between bg-muted/20 border-b overflow-x-auto">
                          <div className="flex items-center overflow-x-auto">
                          {openFiles.map((filePath) => {
                            const fileName = filePath.split('/').pop() || filePath;
                            const isActive = filePath === selectedFile;
                            return (
                              <div
                                key={filePath}
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-r cursor-pointer hover:bg-accent/50 transition-colors ${
                                  isActive ? 'bg-background' : 'bg-muted/20'
                                }`}
                                onClick={() => setSelectedFile(filePath)}
                                role="tab"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setSelectedFile(filePath);
                                  }
                                }}
                              >
                                <span className={isActive ? 'font-medium' : ''}>{fileName}</span>
                                {openFiles.length > 1 && (
                                  <button
                                    type="button"
                                    className="ml-1 hover:bg-muted rounded p-0.5 transition-colors"
                                    aria-label={`Close ${fileName}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newOpenFiles = openFiles.filter(f => f !== filePath);
                                      setOpenFiles(newOpenFiles);
                                      if (filePath === selectedFile && newOpenFiles.length > 0) {
                                        setSelectedFile(newOpenFiles[newOpenFiles.length - 1]);
                                      }
                                    }}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-muted-foreground hover:text-foreground">
                                      <path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                    </svg>
                                  </button>
                                )}
                              </div>
                            );
                          })}
                          </div>
                          {/* Connection Status and Sync Indicator */}
                          <div className="flex items-center gap-3 px-3 py-1.5 text-xs border-l shrink-0">
                            {/* Yjs Connection Status */}
                            <div className="flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                connectionStatus === 'connected' ? 'bg-green-500' :
                                connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                                'bg-gray-400'
                              }`} />
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                {connectionStatus === 'connected' ? 'Live' : connectionStatus === 'connecting' ? 'Connecting' : 'Offline'}
                              </span>
                            </div>
                            {connectionStatus === 'connected' && (
                              <span className="text-[10px] text-muted-foreground">
                                • {connectedUsers.length + 1} {connectedUsers.length + 1 === 1 ? 'user' : 'users'}
                              </span>
                            )}
                            {/* E2B Sync Status */}
                            {isSyncingToE2B && (
                              <div className="flex items-center gap-1 text-blue-500">
                                <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span className="text-[10px] uppercase tracking-wide">Syncing to E2B</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <CodeEditor
                          key={`${sessionId}-${selectedFile}`}
                          value={getCurrentFileContent(selectedFile)}
                          onChange={handleCodeChange}
                          language="typescript"
                          height={"100%"}
                          autoScroll={false}
                          collaborative={true}
                          roomId={`${sessionId}-${selectedFile}`}
                          username={guestCredentials?.username || 'User'}
                          userId={guestCredentials?.userId || sessionId}
                          onUsersChange={setConnectedUsers}
                          onConnectionStatusChange={setConnectionStatus}
                        />
                        </>
                        )}
                      </div>
                    </TabsContent>
                    <TabsContent value="live preview" className="flex flex-col flex-1 min-h-0 mt-0 overflow-hidden">
                      <div className="flex-1 w-full overflow-hidden border-0 relative min-h-0">
                        {renderPreview()}
                      </div>
                    </TabsContent>
                  </Tabs>
                </motion.div>
              </AnimatePresence>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="max-w-4xl w-full px-4 sm:px-6 lg:px-8 h-full flex flex-col">
              <ChatPanel
                messages={messages}
                message={message}
                setMessage={setMessage}
                onSend={handleSend}
                isLoading={invoke.isPending || invokeWithSandbox.isPending}
                isStreaming={isStreaming}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Page;
