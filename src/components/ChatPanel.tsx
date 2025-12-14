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
}

interface ChatPanelProps {
  messages: ChatMessage[];
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  onSend: () => void;
  isLoading?: boolean;
  isStreaming?: boolean; // whether the last AI message is actively streaming
}

export function ChatPanel({
  messages,
  message,
  setMessage,
  onSend,
  isLoading,
  isStreaming,
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
                    : "bg-muted/50 text-foreground",
                  isAI && i === messages.length - 1 && isStreaming && msg.content === '🔄 Processing...' && "animate-pulse"
                )}>
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {msg.content === '🔄 Processing...' ? (
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          <span className="inline-block w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="inline-block w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="inline-block w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                        <span className="text-muted-foreground">Processing...</span>
                      </div>
                    ) : (
                      <>
                        {msg.content}
                        {isAI && i === messages.length - 1 && isStreaming && msg.content !== '🔄 Processing...' && (
                          <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />
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
      <div className="border-t border-border bg-muted/30 px-4 py-4">
        <form
          className="flex items-end gap-2 bg-background rounded-lg border border-border p-2 focus-within:ring-2 focus-within:ring-primary/20 transition-all"
          onSubmit={e => {
            e.preventDefault();
            if (!isLoading && message.trim()) onSend();
          }}
        >
          <Textarea
            placeholder="Type a message... (Shift+Enter for new line)"
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!isLoading && message.trim()) onSend();
              }
            }}
            disabled={isLoading}
            className="flex-1 min-h-[60px] max-h-[200px] resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent"
            rows={1}
          />
          <Button
            type="submit"
            size="icon"
            disabled={isLoading || !message.trim()}
            className={cn(
              "transition-all",
              !message.trim() && "opacity-50"
            )}
          >
            <LucideSend className="w-4 h-4" />
          </Button>
        </form>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
