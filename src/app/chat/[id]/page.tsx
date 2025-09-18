"use client";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { CodeEditor } from "@/components/CodeEditor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileTree } from "@/components/FileTree";
import { ChatPanel, ChatMessage } from "@/components/ChatPanel";

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
  type: 'status' | 'partial' | 'tool' | 'complete' | 'error' | 'sandbox';
  content: string;
  timestamp: Date;
  data?: Record<string, unknown>;
};

function Page() {
  const trpc = useTRPC();
  
  // Session management (allow dynamic updates from backend)
  const [sessionId, setSessionId] = useState(() => `session-${Date.now()}`);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  // Auto fallback mode: attempt Inngest first, fall back automatically if no stream starts or errors.
  const [autoFallbackEnabled, setAutoFallbackEnabled] = useState(true);
  const attemptedFallbackRef = useRef(false);
  const hasStreamingStartedRef = useRef(false);
  const pendingUserMessageRef = useRef<string | null>(null);
  const fallbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  const FALLBACK_TIMEOUT_MS = 8000; // time to wait for first streaming token before falling back
  const [agentMethod, setAgentMethod] = useState<'inngest' | 'fallback' | null>(null);
  
  // Real-time updates
  const [agentUpdates, setAgentUpdates] = useState<AgentUpdate[]>([]);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  const invoke = useMutation(
    trpc.invoke.mutationOptions({
      onSuccess: ({ sessionId: newSessionId, method }) => {
        toast.success(`Agent started successfully via ${method}!`);
        setAgentMethod(method as 'inngest' | 'fallback');
        console.log("Session ID:", newSessionId);
        if (newSessionId && newSessionId !== sessionId) {
          setSessionId(newSessionId);
        }
        // Always subscribe (fallback also emits SSE)
        startRealtimeSubscription(newSessionId);
      },
      onError: (error) => {
        toast.error(`Error invoking agent: ${error.message}`);
        setIsStreaming(false);
      },
      onMutate: () => {
        setIsStreaming(true);
        setAgentUpdates([]);
        toast.loading("Starting AI agent...");
        attemptedFallbackRef.current = false;
        hasStreamingStartedRef.current = false;
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        if (autoFallbackEnabled) {
          fallbackTimerRef.current = setTimeout(() => {
            if (!hasStreamingStartedRef.current && !attemptedFallbackRef.current && pendingUserMessageRef.current) {
              console.log('[AutoFallback] No streaming detected, invoking fallback agent.');
              attemptedFallbackRef.current = true;
              invoke.mutate({ message: pendingUserMessageRef.current, sessionId, useFallback: true });
            }
          }, FALLBACK_TIMEOUT_MS);
        }
      },
      onSettled: () => {
        toast.dismiss();
      }
    })
  );

  const invokeWithSandbox = useMutation(
    trpc.invokeWithSandbox.mutationOptions({
      onSuccess: ({ sessionId: newSessionId, method }) => {
        toast.success(`Agent started with sandbox via ${method}!`);
        setAgentMethod(method as 'inngest' | 'fallback');
        if (newSessionId && newSessionId !== sessionId) {
          setSessionId(newSessionId);
        }
        startRealtimeSubscription(newSessionId);
      },
      onError: (error) => {
        toast.error(`Error invoking agent: ${error.message}`);
        setIsStreaming(false);
      },
      onMutate: () => {
        setIsStreaming(true);
        setAgentUpdates([]);
        toast.loading("Starting AI agent with sandbox...");
        attemptedFallbackRef.current = false;
        hasStreamingStartedRef.current = false;
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        if (autoFallbackEnabled) {
          fallbackTimerRef.current = setTimeout(() => {
            if (!hasStreamingStartedRef.current && !attemptedFallbackRef.current && pendingUserMessageRef.current) {
              console.log('[AutoFallback] No streaming (sandbox) detected, invoking fallback agent.');
              attemptedFallbackRef.current = true;
              invokeWithSandbox.mutate({ message: pendingUserMessageRef.current, sandboxId: sandboxId!, sessionId, useFallback: true });
            }
          }, FALLBACK_TIMEOUT_MS);
        }
      },
      onSettled: () => {
        toast.dismiss();
      }
    })
  );

  // Types for SSE payload
  type StatusData = { status?: string; message?: string; hasSandbox?: boolean };
  type PartialData = { content?: string; fullContent?: string };
  type ToolData = { tool?: string };
  type SandboxData = { sandboxId?: string; sandboxUrl?: string; isNew?: boolean };
  type CompleteData = { response?: string; sandboxUrl?: string; hasSandbox?: boolean };
  type ErrorData = { error?: string; sandboxUrl?: string };
  interface SSEPayloadBase { sessionId?: string }
  type SSEPayload =
    | (SSEPayloadBase & { type: 'status'; data?: StatusData })
    | (SSEPayloadBase & { type: 'partial'; data?: PartialData })
    | (SSEPayloadBase & { type: 'tool'; data?: ToolData })
    | (SSEPayloadBase & { type: 'sandbox'; data?: SandboxData })
    | (SSEPayloadBase & { type: 'complete'; data?: CompleteData })
    | (SSEPayloadBase & { type: 'error'; data?: ErrorData })
    | (SSEPayloadBase & { type: 'connected'; data?: Record<string, unknown> })
    | (SSEPayloadBase & { type: 'heartbeat'; data?: Record<string, unknown> });

  const mountedRef = useRef(true);
  const retriesRef = useRef(0);
  const MAX_RETRIES = 5;

  useEffect(() => () => { mountedRef.current = false; }, []);

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
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
    }

    try {
      const url = `/api/stream?sessionId=${encodeURIComponent(sess)}`;
      const eventSource = new EventSource(url);
      console.log('[SSE] Connecting to', url);

      subscriptionRef.current = { unsubscribe: () => eventSource.close() };

      eventSource.onopen = () => {
        console.log('[SSE] Opened');
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
          console.log('[SSE] Connected session', parsed.sessionId);
          return;
        }

        const update: AgentUpdate = {
          type: parsed.type as AgentUpdate['type'],
          content: getContentFromData(parsed),
          timestamp: new Date(),
          data: parsed.data,
        };
        ifMounted(() => setAgentUpdates(prev => [...prev, update]));

        if (parsed.type === 'status') {
          const status = parsed.data?.status;
          ifMounted(() => setIsStreaming(status === 'started' || status === 'processing'));
        } else if (parsed.type === 'partial') {
          ifMounted(() => setIsStreaming(true));
          hasStreamingStartedRef.current = true;
          if (fallbackTimerRef.current) {
            clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = null;
          }
        } else if (parsed.type === 'sandbox') {
          if (parsed.data?.sandboxId) ifMounted(() => setSandboxId(parsed.data!.sandboxId!));
          if (parsed.data?.sandboxUrl) ifMounted(() => setSandboxUrl(parsed.data!.sandboxUrl!));
        } else if (parsed.type === 'complete' || parsed.type === 'error') {
          ifMounted(() => setIsStreaming(false));
          if (parsed.data?.sandboxUrl) ifMounted(() => setSandboxUrl(parsed.data!.sandboxUrl!));
          if (parsed.type === 'error' && autoFallbackEnabled && !attemptedFallbackRef.current && pendingUserMessageRef.current) {
            console.log('[AutoFallback] Error event received, invoking fallback agent.');
            attemptedFallbackRef.current = true;
            // Decide which mutation to call based on sandbox presence request
            if (sandboxId) {
              invokeWithSandbox.mutate({ message: pendingUserMessageRef.current, sandboxId, sessionId, useFallback: true });
            } else {
              invoke.mutate({ message: pendingUserMessageRef.current, sessionId, useFallback: true });
            }
          }
        }
      };

      eventSource.onerror = (ev) => {
        console.error('[SSE] error', ev);
        ifMounted(() => setIsStreaming(false));
        if (retriesRef.current < MAX_RETRIES && mountedRef.current) {
          const retryIn = 500 * 2 ** retriesRef.current;
          console.log(`[SSE] retrying in ${retryIn}ms`);
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
  }, [getContentFromData, autoFallbackEnabled, sandboxId, sessionId, invoke, invokeWithSandbox]);

  // Start real-time subscription on mount
  useEffect(() => {
    startRealtimeSubscription(sessionId);
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
  // state for toggling the second panel
  const [showSecondPanel] = useState(true);
  // state for the code editor
  const [code, setCode] = useState("// Write your code here\n");
  // state for iframe loading
  const [iframeLoading, setIframeLoading] = useState(true);
  // state for active tab
  const [activeTab, setActiveTab] = useState("live preview");

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
  const [selectedFile, setSelectedFile] = useState(allFiles[0].path);

  // update code when file changes
  useEffect(() => {
    const file = allFiles.find(f => f.path === selectedFile);
    if (file) setCode(file.content ?? "");
  }, [selectedFile, allFiles]);

  // update file content when code changes
  const handleCodeChange = (val: string | undefined) => {
    setCode(val ?? "");
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
          if (n.type === "file" && n.path === selectedFile) return { ...n, content: val ?? "" };
          if (n.type === "folder" && n.children) return { ...n, children: update(n.children) };
          return n;
        });
      }
      return update(prev);
    });
  };

  // Chat state for Copilot-like interface
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "ai", content: "👋 Welcome to CodeVibe! I can help you generate code. Try asking me to 'generate some code' or 'create components' to see live file streaming in action!" }
  ]);
  // Removed unused streaming demo code

  // Simulate streaming code to files

  // Handler for sending a message
  // (removed duplicate handleSend definition)

  // Update messages when real-time updates come in - agent activity logic for chat bubbles
  useEffect(() => {
    if (agentUpdates.length === 0) return;
    const latestUpdate = agentUpdates[agentUpdates.length - 1];
    if (latestUpdate.type === 'partial') {
      setMessages(prev => {
        const newMessages = [...prev];
        // Ensure AI stub exists
        if (newMessages.length === 0 || newMessages[newMessages.length - 1].role !== 'ai') {
          newMessages.push({ role: 'ai', content: '' });
        }
        const aiIndex = newMessages.length - 1;
        const existing = newMessages[aiIndex].content;
        const fullFromEvent = (latestUpdate.data?.fullContent as string | undefined) || '';
        let nextContent: string;
        // Prefer fullContent if provided and not shorter (guards against race conditions)
        if (fullFromEvent && fullFromEvent.length >= existing.length) {
          nextContent = fullFromEvent;
        } else {
          // Append only the new delta chunk
            const delta = latestUpdate.content || '';
            // Avoid duplicating if delta already present at end
            if (delta && !existing.endsWith(delta)) {
              nextContent = existing + delta;
            } else {
              nextContent = existing; // no change
            }
        }
        newMessages[aiIndex] = { ...newMessages[aiIndex], content: nextContent };
        return newMessages;
      });
      setIsStreaming(true);
    } else if (latestUpdate.type === 'complete') {
      setMessages((prev) => {
        const newMessages = [...prev];
        for (let i = newMessages.length - 1; i >= 0; i--) {
          if (newMessages[i].role === 'ai') {
            newMessages[i] = { ...newMessages[i], content: (latestUpdate.data?.response as string) || latestUpdate.content };
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

  // Handler for sending a message
  const handleSend = () => {
    if (!message.trim()) return;
    
    const userMessage = message;
    setMessage("");
    
    // Add user message to chat
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    
    // Only add an AI processing stub if last message isn't already AI
    setMessages((prev) => {
      if (prev.length === 0 || prev[prev.length - 1].role !== 'ai') {
        return [...prev, { role: 'ai', content: '🔄 Processing...' }];
      }
      return prev;
    });

    // Start streaming mode and add debugging
  setIsStreaming(true);
  pendingUserMessageRef.current = userMessage;
    console.log('Started streaming mode for session:', sessionId);

    // Determine if we should use sandbox based on user request
    const needsSandbox = sandboxId || 
      userMessage.toLowerCase().includes("create") ||
      userMessage.toLowerCase().includes("build") ||
      userMessage.toLowerCase().includes("generate code") ||
      userMessage.toLowerCase().includes("component");

    // Choose the appropriate mutation based on whether we have a sandbox
    if (needsSandbox && sandboxId) {
      invokeWithSandbox.mutate({ 
        message: userMessage, 
        sandboxId,
        sessionId,
        useFallback: attemptedFallbackRef.current // if fallback path triggered manually
      });
    } else {
      invoke.mutate({ 
        message: userMessage, 
        sessionId,
        useFallback: attemptedFallbackRef.current
      });
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Status Bar */}
      <div className="flex items-center justify-between p-2 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
          <span className="text-sm font-medium">
            {isStreaming ? 'Agent Active' : 'Ready'}
            {agentMethod && (
              <span className="ml-1 text-xs text-muted-foreground">
                ({agentMethod})
              </span>
            )}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {sandboxUrl && (
            <button
              onClick={() => window.open(sandboxUrl, '_blank')}
              className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              🏗️ View Sandbox
            </button>
          )}
          
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={autoFallbackEnabled}
              onChange={(e) => setAutoFallbackEnabled(e.target.checked)}
              className="w-3 h-3"
            />
            <span>Auto Fallback</span>
          </label>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={30}>
            <div className="h-full flex flex-col">
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
          {showSecondPanel && (
            <ResizablePanel
              defaultSize={70}
              className="animate-in fade-in-0 data-[state=active]:fade-in-100"
            >
              <AnimatePresence mode="wait">
                {showSecondPanel && (
                  <motion.div
                    key="webview-panel"
                    initial={{ x: "100%", opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: "100%", opacity: 0 }}
                    transition={{ type: "tween", duration: 0.35 }}
                    className="flex h-full w-full flex-col p-4 overflow-hidden"
                  >
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full overflow-hidden">
                      <TabsList className="shrink-0">
                        <TabsTrigger value="live preview">live preview</TabsTrigger>
                        <TabsTrigger value="code">Code</TabsTrigger>
                      </TabsList>
                      <TabsContent value="code" className="flex flex-row flex-1 min-h-0 gap-2 mt-2 overflow-hidden">
                        <div className="w-48 h-full flex-shrink-0 overflow-hidden">
                          <FileTree
                            nodes={fileTree}
                            selected={selectedFile}
                            onSelect={setSelectedFile}
                          />
                        </div>
                        <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
                          <CodeEditor
                            value={code}
                            onChange={handleCodeChange}
                            language="typescript"
                            height={"100%"}
                            label={selectedFile}
                            autoScroll={false}
                          />
                        </div>
                      </TabsContent>
                      <TabsContent value="live preview" className="flex flex-col flex-1 min-h-0 mt-2 overflow-hidden">
                        <h1 className="text-lg font-semibold shrink-0">Live Output</h1>
                        <div className="flex-1 w-full rounded-lg overflow-hidden border mt-2 relative min-h-0">
                          {iframeLoading && (
                            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
                              <span className="animate-spin rounded-full border-4 border-gray-300 border-t-primary h-10 w-10 block" />
                            </div>
                          )}
                          {sandboxUrl ? (
                            <iframe
                              key={sandboxUrl}
                              src={sandboxUrl}
                              className="w-full h-full min-h-[200px] border-0"
                              onLoad={() => setIframeLoading(false)}
                              title="Sandbox Preview"
                              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                              allow="clipboard-write; clipboard-read; microphone; camera; accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
                              No sandbox yet. Ask the agent to create or generate code (e.g. &quot;create a component&quot;) to spin one up.
                            </div>
                          )}
                        </div>
                      </TabsContent>
                    </Tabs>
                  </motion.div>
                )}
              </AnimatePresence>
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

export default Page;
