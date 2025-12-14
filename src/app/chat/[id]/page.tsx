"use client";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
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

interface PageProps {
  params: Promise<{ id: string }>;
}

function Page({ params }: PageProps) {
  const trpc = useTRPC();
  const [chatId, setChatId] = useState<string | null>(null);
  const [shouldAutoSend, setShouldAutoSend] = useState(false);
  
  // Extract chat ID from params
  useEffect(() => {
    params.then(({ id }) => {
      setChatId(id);
      setSessionId(id);
      
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
  }, [params]);
  
  // Session management (allow dynamic updates from backend)
  const [sessionId, setSessionId] = useState(() => `session-${Date.now()}`);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  
  // Load sandbox data when sessionId changes
  useEffect(() => {
    if (typeof globalThis.globalThis === 'undefined') return;
    try {
      const stored = localStorage.getItem(`chat-${sessionId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSandboxId(parsed.sandboxId || null);
      }
    } catch (error) {
      console.error('Failed to load sandbox data:', error);
    }
  }, [sessionId]);
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  
  // Load sandbox URL when sessionId changes
  useEffect(() => {
    if (typeof globalThis.globalThis === 'undefined') return;
    try {
      const stored = localStorage.getItem(`chat-${sessionId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSandboxUrl(parsed.sandboxUrl || null);
      }
    } catch (error) {
      console.error('Failed to load sandbox data:', error);
    }
  }, [sessionId]);
  
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

  useEffect(() => {
    mountedRef.current = true;
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

        // Update messages directly based on event type
        if (parsed.type === 'partial') {
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
                newMessages[aiIndex] = { ...newMessages[aiIndex], content: fullContent };
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
          if (parsed.data?.sandboxId) ifMounted(() => setSandboxId(parsed.data!.sandboxId!));
          if (parsed.data?.sandboxUrl) ifMounted(() => setSandboxUrl(parsed.data!.sandboxUrl!));
        } else if (parsed.type === 'complete' || parsed.type === 'error') {
          ifMounted(() => setIsStreaming(false));
          if (parsed.data?.sandboxUrl) ifMounted(() => setSandboxUrl(parsed.data!.sandboxUrl!));
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
  }, [getContentFromData]);

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

  // Chat state for Copilot-like interface with localStorage persistence
  const [messages, setMessages] = useState<ChatMessage[]>([{ 
    role: "ai", 
    content: "👋 Welcome to CodeVibe! I can help you generate code. Try asking me to 'generate some code' or 'create components' to see live file streaming in action!",
    timestamp: 0, // Will be set properly when loaded or updated
    id: 'welcome'
  }]);
  
  // Load messages from localStorage when sessionId changes
  useEffect(() => {
    if (typeof globalThis.globalThis === 'undefined') return;
    
    try {
      const stored = localStorage.getItem(`chat-${sessionId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.messages && parsed.messages.length > 0) {
          setMessages(parsed.messages);
        }
      } else {
        // New chat - show welcome message with current timestamp
        setMessages([{ 
          role: "ai", 
          content: "👋 Welcome to CodeVibe! I can help you generate code. Try asking me to 'generate some code' or 'create components' to see live file streaming in action!",
          timestamp: Date.now(),
          id: 'welcome'
        }]);
      }
    } catch (error) {
      console.error('Failed to load chat history:', error);
    }
  }, [sessionId]);
  // Removed unused streaming demo code

  // Simulate streaming code to files

  // Handler for sending a message
  // (removed duplicate handleSend definition)
  
  // Save messages to localStorage whenever they change
  useEffect(() => {
    // Only save if we have user messages (not just welcome message)
    const hasUserMessages = messages.some(m => m.role === 'user');
    if (messages.length > 0 && hasUserMessages) {
      try {
        localStorage.setItem(`chat-${sessionId}`, JSON.stringify({
          messages,
          sessionId,
          sandboxId,
          sandboxUrl,
          lastUpdated: Date.now()
        }));
        // Notify sidebar to refresh
        if (typeof globalThis !== 'undefined') {
          globalThis.dispatchEvent(new CustomEvent('chatUpdated'));
        }
      } catch (error) {
        console.error('Failed to save chat history:', error);
      }
    }
  }, [messages, sessionId, sandboxId, sandboxUrl]);

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
        sessionId
      });
    } else {
      invoke.mutate({ 
        message: userMessage, 
        sessionId
      });
    }
  }, [message, sessionId, sandboxId, invoke, invokeWithSandbox, startRealtimeSubscription]);

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Status Bar */}
      <div className="flex items-center justify-between p-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
          <span className="text-sm font-medium">
            {isStreaming ? 'AI is thinking...' : 'Ready'}
          </span>
          {messages.length > 1 && (
            <span className="text-xs text-muted-foreground">
              {messages.length} messages
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {sandboxUrl && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => globalThis.globalThis.open(sandboxUrl, '_blank')}
              className="text-xs"
            >
              🏗️ View Sandbox
            </Button>
          )}
          {messages.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm('Clear all messages? This cannot be undone.')) {
                  setMessages([{ 
                    role: "ai", 
                    content: "Chat cleared. How can I help you?",
                    timestamp: Date.now(),
                    id: 'clear-' + Date.now()
                  }]);
                  localStorage.removeItem(`chat-${sessionId}`);
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
