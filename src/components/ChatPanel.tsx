import { Button } from "@/components/ui/button";
import { Dispatch, SetStateAction, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LucideSend } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export interface ChatMessage {
  role: "user" | "ai";
  content: string;
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
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-muted-foreground text-center mt-8">Start a conversation with Copilot!</div>
        )}
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => {
            const key = `${msg.role}-${msg.content.slice(0,12)}-${i}`;
            // Style variants
            const isUser = msg.role === 'user';
            const isAI = msg.role === 'ai';
            let baseBubble: string;
            if (isUser) {
              baseBubble = 'bg-primary text-primary-foreground';
            } else if (isAI) {
              baseBubble = 'bg-muted text-foreground';
            } else {
              baseBubble = 'bg-muted text-foreground';
            }
            return (
            <motion.div
              key={key}
              initial={{
                opacity: 0,
                x: isUser ? 40 : -40,
              }}
              animate={{
                opacity: 1,
                x: 0,
                transition: { type: "tween", duration: 0.3 }
              }}
              exit={{
                opacity: 0,
                x: isUser ? 40 : -40,
                transition: { type: "tween", duration: 0.2 }
              }}
              className={
                isUser ? 'flex justify-end' : 'flex justify-start'
              }
            >
              <div
                className={`${baseBubble} rounded-lg px-4 py-2 max-w-[70%] shadow relative`}
              >
                <span className="whitespace-pre-line text-sm leading-relaxed">{msg.content}</span>
                {isAI && i === messages.length - 1 && isStreaming && (
                  <span className="inline-block w-1 h-4 bg-foreground/70 animate-pulse ml-1 align-baseline" />
                )}
              </div>
            </motion.div>
          )})}
        </AnimatePresence>
        <div ref={chatEndRef} />
      </div>
      {/* Input bar */}
      <form
        className="flex items-end-safe gap-2 border-t border-border bg-background px-4 py-3"
        onSubmit={e => {
          e.preventDefault();
          if (!isLoading && message.trim()) onSend();
        }}
      >
        <Textarea
          placeholder="Send a message to Copilot..."
          value={message}
          onChange={e => setMessage(e.target.value)}
          disabled={isLoading}
          rows={3}
          style={{ lineHeight: '1.5' }}
        />
        <Button
          type="submit"
          className="cursor-pointer"
          disabled={isLoading || !message.trim()}
          variant={"ghost"}
          tabIndex={0}
        >
          <LucideSend className="w-5 h-5" />
        </Button>
      </form>
    </div>
  );
}
