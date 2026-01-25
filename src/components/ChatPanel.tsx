"use client";

import { Button } from "@/components/ui/button";
import { Dispatch, SetStateAction, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LucideSend, Bot, User } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  role: "user" | "ai";
  content: string;
  timestamp?: number;
  id?: string;
  status?: "thinking" | "using_tool" | "streaming" | "complete";
  toolName?: string;
  toolCalls?: Array<{
    tool: string;
    args?: Record<string, unknown>;
    result?: string;
    status?: "pending" | "running" | "complete" | "error";
  }>;
  reasoning?: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  onSend: () => void;
  isLoading?: boolean;
  isStreaming?: boolean; // whether the last AI message is actively streaming
  readOnly?: boolean; // For shared sessions - disable sending messages
}

export function ChatPanel({
  messages,
  message,
  setMessage,
  onSend,
  isLoading,
  isStreaming,
  readOnly = false,
}: Readonly<ChatPanelProps>) {
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Always scroll to bottom when messages change (or streaming updates replace last content)
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col h-full w-full bg-background border-r border-border">
      {/* Chat history */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-1">Start a conversation</h3>
              <p className="text-sm text-muted-foreground">Ask me anything about your code or project!</p>
            </div>
          </div>
        )}
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => {
            const key = msg.id || `${msg.role}-${i}`;
            const isUser = msg.role === 'user';
            const isAI = msg.role === 'ai';
            
            return (
            <motion.div
              key={key}
              initial={{
                opacity: 0,
                y: 20,
              }}
              animate={{
                opacity: 1,
                y: 0,
                transition: { type: "spring", stiffness: 300, damping: 30 }
              }}
              exit={{
                opacity: 0,
                y: -20,
                transition: { duration: 0.2 }
              }}
              className="flex gap-3 group"
            >
              {/* Avatar */}
              <div className={cn(
                "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
                isUser ? "bg-primary" : "bg-muted border border-border"
              )}>
                {isUser ? (
                  <User className="w-4 h-4 text-primary-foreground" />
                ) : (
                  <Bot className="w-4 h-4 text-foreground" />
                )}
              </div>
              
              {/* Message content */}
              <div className="flex-1 space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">
                    {isUser ? 'You' : 'AI Assistant'}
                  </span>
                  {msg.timestamp && (
                    <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <div className={cn(
                  "rounded-lg px-4 py-3 prose prose-sm max-w-none",
                  isUser 
                    ? "bg-primary/10 text-foreground" 
                    : "bg-muted/50 text-foreground"
                )}>
                  {/* Reasoning section */}
                  {isAI && msg.reasoning && (
                    <div className="mb-3 pb-3 border-b border-border/50 bg-blue-50/50 dark:bg-blue-950/20 rounded-lg p-3">
                      <div className="flex items-start gap-2 text-sm">
                        <div className="mt-0.5 w-5 h-5 shrink-0 flex items-center justify-center">
                          <span className="text-base">💭</span>
                        </div>
                        <div className="flex-1">
                          <div className="text-blue-600 dark:text-blue-400 font-semibold mb-1.5 text-xs uppercase tracking-wide">Thinking</div>
                          <div className="text-muted-foreground text-sm leading-relaxed whitespace-pre-wrap italic">{msg.reasoning}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tool calls section - compact design */}
                  {isAI && msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mb-3 pb-3 border-b border-border/50">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tools Used</span>
                        <span className="text-xs text-muted-foreground">({msg.toolCalls.length})</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.toolCalls.map((toolCall, idx) => {
                          // Format tool name for display (e2b_write_file -> Write File)
                          const displayName = toolCall.tool
                            .replace(/^e2b_/, '')
                            .replace(/^browser_/, '🌐 ')
                            .replace(/_/g, ' ')
                            .replace(/\b\w/g, c => c.toUpperCase());
                          
                          // Get status icon
                          const statusIcon = toolCall.status === 'running' ? '⏳' : 
                                           toolCall.status === 'complete' ? '✓' : 
                                           toolCall.status === 'error' ? '✗' : '•';
                          
                          const statusColor = toolCall.status === 'running' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800' :
                                            toolCall.status === 'complete' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' :
                                            toolCall.status === 'error' ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800' :
                                            'bg-muted text-muted-foreground border-border';
                          
                          return (
                            <span 
                              key={`${msg.id}-tool-${idx}`} 
                              className={cn(
                                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors",
                                statusColor
                              )}
                              title={toolCall.result ? `Result: ${toolCall.result.slice(0, 200)}` : undefined}
                            >
                              <span>{statusIcon}</span>
                              <span>{displayName}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Status indicators for AI messages */}
                  {isAI && msg.status && msg.status !== 'complete' && (
                    <div className="mb-3 pb-3 border-b border-border/50">
                      {msg.status === 'thinking' && (
                        <div className="flex items-center gap-2 text-sm">
                          <div className="flex gap-1">
                            <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:0ms]" />
                            <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:150ms]" />
                            <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:300ms]" />
                          </div>
                          <span className="text-blue-600 dark:text-blue-400 font-medium">Thinking...</span>
                        </div>
                      )}
                      {msg.status === 'using_tool' && msg.toolName && (
                        <div className="flex items-center gap-2 text-sm">
                          <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
                          <span className="text-purple-600 dark:text-purple-400 font-medium">
                            Using tool: <code className="text-xs bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 rounded">{msg.toolName}</code>
                          </span>
                        </div>
                      )}
                      {msg.status === 'streaming' && (
                        <div className="flex items-center gap-2 text-sm">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                          <span className="text-green-600 dark:text-green-400 font-medium">Generating response...</span>
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {msg.content === '🔄 Processing...' ? (
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          <span className="inline-block w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:0ms]" />
                          <span className="inline-block w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:150ms]" />
                          <span className="inline-block w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:300ms]" />
                        </div>
                        <span className="text-muted-foreground">Processing...</span>
                      </div>
                    ) : (
                      <>
                        {msg.content}
                        {isAI && i === messages.length - 1 && isStreaming && msg.content !== '🔄 Processing...' && (
                          <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-1 align-middle" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )})}
        </AnimatePresence>
        <div ref={chatEndRef} />
      </div>
      {/* Input bar */}
      {!readOnly && (
        <div className="border-t border-border bg-muted/30 px-4 py-4">
          <form
            className="flex items-end gap-2 bg-background rounded-lg border border-border p-2 focus-within:ring-2 focus-within:ring-primary/20 transition-all"
            onSubmit={e => {
              e.preventDefault();
              if (!isLoading && !isStreaming && message.trim()) onSend();
            }}
          >
            <Textarea
              placeholder={isStreaming ? "Agent is working..." : "Type a message... (Shift+Enter for new line)"}
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!isLoading && !isStreaming && message.trim()) onSend();
                }
              }}
              disabled={isLoading || isStreaming}
              className="flex-1 min-h-[60px] max-h-[200px] resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent"
              rows={1}
            />
            <Button
              type="submit"
              size="icon"
              disabled={isLoading || isStreaming || !message.trim()}
              className={cn(
                "transition-all",
                (!message.trim() || isStreaming) && "opacity-50"
              )}
            >
              <LucideSend className="w-4 h-4" />
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {isStreaming ? "⏳ Agent is working on your request..." : "Press Enter to send, Shift+Enter for new line"}
          </p>
        </div>
      )}
      {readOnly && (
        <div className="border-t border-border bg-muted/30 px-4 py-3 text-center">
          <p className="text-sm text-muted-foreground">
            👀 View-only mode • Messages cannot be sent in shared sessions
          </p>
        </div>
      )}
    </div>
  );
}
