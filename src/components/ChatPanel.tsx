import { Button } from "@/components/ui/button";
import { Dispatch, SetStateAction, useRef, useEffect, useState } from "react";
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
}

export function ChatPanel({
  messages,
  message,
  setMessage,
  onSend,
  isLoading,
}: ChatPanelProps) {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [streamingIdx, setStreamingIdx] = useState<number | null>(null);
  const [streamedText, setStreamedText] = useState("");

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamedText]);

  // Streaming effect for last AI message
  useEffect(() => {
    if (
      messages.length > 0 &&
      messages[messages.length - 1].role === "ai" &&
      streamingIdx !== messages.length - 1
    ) {
      setStreamingIdx(messages.length - 1);
      setStreamedText("");
      const content = messages[messages.length - 1].content;
      let i = 0;
      const interval = setInterval(() => {
        setStreamedText(content.slice(0, i + 1));
        i++;
        if (i >= content.length) {
          clearInterval(interval);
          setStreamingIdx(null);
        }
      }, 18);
      return () => clearInterval(interval);
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full w-full bg-background border-r border-border">
      {/* Chat history */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-muted-foreground text-center mt-8">Start a conversation with Copilot!</div>
        )}
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{
                opacity: 0,
                x: msg.role === "user" ? 40 : -40,
              }}
              animate={{
                opacity: 1,
                x: 0,
                transition: { type: "tween", duration: 0.3 }
              }}
              exit={{
                opacity: 0,
                x: msg.role === "user" ? 40 : -40,
                transition: { type: "tween", duration: 0.2 }
              }}
              className={
                msg.role === "user"
                  ? "flex justify-end"
                  : "flex justify-start"
              }
            >
              <div
                className={
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-lg px-4 py-2 max-w-[70%] shadow"
                    : "bg-muted text-foreground rounded-lg px-4 py-2 max-w-[70%] shadow"
                }
              >
                {msg.role === "ai" && i === streamingIdx ? (
                  <span className="whitespace-pre-line animate-pulse">{streamedText}</span>
                ) : (
                  <span className="whitespace-pre-line">{msg.content}</span>
                )}
              </div>
            </motion.div>
          ))}
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
