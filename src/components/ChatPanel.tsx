"use client";

import { Button } from "@/components/ui/button";
import { Dispatch, SetStateAction, useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LucideSend, Bot, User, ChevronDown, ChevronRight, Brain, AlertCircle, Check, Terminal, Pencil, Eye, FolderOpen, Trash2, Globe, Search, Package, Box, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { QueueList, type MessageQueue } from "@/components/QueueList";

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
    startTime?: number;
    endTime?: number;
  }>;
  reasoning?: string;
}

function getToolIcon(toolName: string): React.ReactNode {
  const name = toolName.toLowerCase();
  if (name.includes('write_file') || name.includes('writefile') || name.includes('edit_file') || name.includes('editfile')) return <Pencil className="w-3.5 h-3.5" />;
  if (name.includes('read_file') || name.includes('readfile')) return <Eye className="w-3.5 h-3.5" />;
  if (name.includes('list_files') || name.includes('listfiles') || name.includes('list_dir') || name.includes('listdir') || name.includes('list_files_recursive')) return <FolderOpen className="w-3.5 h-3.5" />;
  if (name.includes('run_command') || name.includes('execute') || name.includes('shell')) return <Terminal className="w-3.5 h-3.5" />;
  if (name.includes('delete_file') || name.includes('deletefile') || name.includes('remove')) return <Trash2 className="w-3.5 h-3.5" />;
  if (name.includes('browser') || name.includes('navigate') || name.includes('screenshot') || name.includes('playwright')) return <Globe className="w-3.5 h-3.5" />;
  if (name.includes('search') || name.includes('query') || name.includes('fetch') || name.includes('get')) return <Search className="w-3.5 h-3.5" />;
  if (name.includes('install')) return <Package className="w-3.5 h-3.5" />;
  if (name.includes('create_sandbox') || name.includes('createsandbox')) return <Box className="w-3.5 h-3.5" />;
  return <Terminal className="w-3.5 h-3.5" />;
}

function getToolAction(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name.includes('write_file') || name.includes('writefile')) return 'Wrote';
  if (name.includes('read_file') || name.includes('readfile')) return 'Read';
  if (name.includes('edit_file') || name.includes('editfile')) return 'Edited';
  if (name.includes('list_files_recursive')) return 'Scanned';
  if (name.includes('list_files') || name.includes('listfiles') || name.includes('list_dir') || name.includes('listdir')) return 'Listed';
  if (name.includes('run_command') || name.includes('execute') || name.includes('shell')) return 'Ran';
  if (name.includes('delete_file') || name.includes('deletefile') || name.includes('remove')) return 'Deleted';
  if (name.includes('create_directory') || name.includes('mkdir') || name.includes('create_dir')) return 'Created dir';
  if (name.includes('browser_navigate') || name.includes('navigate')) return 'Navigated to';
  if (name.includes('browser_screenshot') || name.includes('screenshot')) return 'Captured screenshot';
  if (name.includes('browser_click') || name.includes('click')) return 'Clicked';
  if (name.includes('browser_type') || name.includes('type')) return 'Typed in';
  if (name.includes('browser_') || name.includes('playwright')) return 'Used browser';
  if (name.includes('search') || name.includes('query')) return 'Searched';
  if (name.includes('fetch') || name.includes('get')) return 'Fetched';
  if (name.includes('install')) return 'Installed';
  if (name.includes('create_sandbox') || name.includes('createsandbox')) return 'Created sandbox';
  return 'Used tool';
}

type ToolCall = NonNullable<ChatMessage['toolCalls']>[number];

function getToolTarget(tool: ToolCall): string {
  const args = tool.args;
  if (!args) return '';

  const filePath = args.filePath ?? args.file_path ?? args.path ?? args.filename ?? args.file;
  if (typeof filePath === 'string') {
    const parts = filePath.split('/');
    const toolName = tool.tool.toLowerCase();
    if (toolName.includes('list_dir') || toolName.includes('listfiles') || toolName.includes('list_files')) {
      return filePath === '.' || filePath === '/' ? 'root' : filePath;
    }
    return parts.at(-1) ?? filePath;
  }

  const command = args.command ?? args.cmd;
  if (typeof command === 'string') {
    return command.slice(0, 50) + (command.length > 50 ? '...' : '');
  }

  const url = args.url;
  if (typeof url === 'string') {
    try { return new URL(url).hostname; } catch { return url.slice(0, 30); }
  }

  const query = args.query ?? args.q ?? args.search;
  if (typeof query === 'string') {
    return query.slice(0, 40) + (query.length > 40 ? '...' : '');
  }

  return '';
}

// Timeline step for a single tool call
function TimelineToolStep({ tool, isLast }: { tool: ToolCall; isLast: boolean }) {
  const action = getToolAction(tool.tool);
  const target = getToolTarget(tool);
  const isError = tool.status === 'error';
  const isRunning = tool.status === 'running' || tool.status === 'pending';

  return (
    <div className="flex gap-3 relative">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />
      )}
      {/* Dot/Icon */}
      <div className={cn(
        "relative z-10 flex items-center justify-center w-[23px] h-[23px] rounded-full shrink-0 mt-0.5",
        isRunning && "bg-blue-500/10 text-blue-500",
        isError && "bg-red-500/10 text-red-500",
        !isRunning && !isError && "bg-emerald-500/10 text-emerald-500"
      )}>
        {isRunning ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isError ? (
          <AlertCircle className="w-3.5 h-3.5" />
        ) : (
          getToolIcon(tool.tool)
        )}
      </div>
      {/* Content */}
      <div className="flex-1 min-w-0 pb-3">
        <div className="flex items-center gap-1.5">
          <span className={cn(
            "text-xs font-medium",
            isRunning && "text-blue-500",
            isError && "text-red-500",
            !isRunning && !isError && "text-foreground/80"
          )}>
            {action}
          </span>
          {target && (
            <span className="text-xs text-muted-foreground font-mono truncate">
              {target}
            </span>
          )}
          {!isRunning && !isError && (
            <Check className="w-3 h-3 text-emerald-500 shrink-0 ml-auto" />
          )}
        </div>
      </div>
    </div>
  );
}

// Timeline step for thinking/reasoning
function TimelineThinkingStep({ reasoning, isLast, defaultOpen }: { reasoning: string; isLast: boolean; defaultOpen: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="flex gap-3 relative">
      {!isLast && (
        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />
      )}
      <div className="relative z-10 flex items-center justify-center w-[23px] h-[23px] rounded-full shrink-0 mt-0.5 bg-violet-500/10 text-violet-500">
        <Brain className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0 pb-3">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1 text-xs font-medium text-violet-500 hover:text-violet-400 transition-colors"
        >
          Thinking
          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <p className="text-xs text-muted-foreground leading-relaxed mt-1.5 italic whitespace-pre-wrap">
                {reasoning}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Full AI message timeline
function AIMessageTimeline({ msg, isStreaming }: { msg: ChatMessage; isStreaming: boolean }) {
  const hasReasoning = !!msg.reasoning;
  const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;
  const hasContent = !!msg.content && msg.content !== '🔄 Processing...';
  const isThinking = msg.status === 'thinking' && !hasReasoning && !hasToolCalls && !hasContent;

  // Build timeline steps
  const steps: React.ReactNode[] = [];

  // If we only have reasoning (no tools), show it
  if (hasReasoning) {
    const isLastStep = !hasToolCalls && !hasContent && !isStreaming;
    steps.push(
      <TimelineThinkingStep
        key="reasoning"
        reasoning={msg.reasoning!}
        isLast={isLastStep}
        defaultOpen={isStreaming && !hasContent}
      />
    );
  }

  // Tool calls
  if (hasToolCalls) {
    msg.toolCalls!.forEach((tool, idx) => {
      const isLastTool = idx === msg.toolCalls!.length - 1;
      const isLastStep = isLastTool && !hasContent && !isStreaming;
      steps.push(
        <TimelineToolStep
          key={`tool-${idx}-${tool.tool}`}
          tool={tool}
          isLast={isLastStep}
        />
      );
    });
  }

  // If only thinking with no content yet (loading dots)
  if (isThinking) {
    return (
      <div className="flex items-center gap-2 py-1">
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.5s_ease-in-out_infinite]" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.5s_ease-in-out_0.3s_infinite]" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.5s_ease-in-out_0.6s_infinite]" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* Timeline steps */}
      {steps.length > 0 && (
        <div className="py-1">
          {steps}
        </div>
      )}

      {/* Final response text */}
      {hasContent && (
        <div className="break-words text-sm leading-relaxed">
          <div className="markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {msg.content}
            </ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-1 align-middle" />
            )}
          </div>
        </div>
      )}

      {/* Streaming indicator when writing response */}
      {isStreaming && !hasContent && msg.status === 'streaming' && (
        <div className="flex items-center gap-2 py-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-xs text-muted-foreground">Writing response...</span>
        </div>
      )}
    </div>
  );
}

interface ChatPanelProps {
  messages: ChatMessage[];
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  onSend: () => void;
  isLoading?: boolean;
  isStreaming?: boolean;
  readOnly?: boolean;
  queue?: MessageQueue;
}

export function ChatPanel({
  messages,
  message,
  setMessage,
  onSend,
  isLoading,
  isStreaming,
  readOnly = false,
  queue,
}: Readonly<ChatPanelProps>) {
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col h-full w-full bg-background border-r border-border">
      {/* Chat history */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
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
            const isLastMsg = i === messages.length - 1;

            return (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 30 } }}
              exit={{ opacity: 0, y: -20, transition: { duration: 0.2 } }}
              className="flex gap-3 group"
            >
              {/* Avatar */}
              <div className={cn(
                "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5",
                isUser ? "bg-primary" : "bg-muted border border-border"
              )}>
                {isUser ? (
                  <User className="w-3.5 h-3.5 text-primary-foreground" />
                ) : (
                  <Bot className="w-3.5 h-3.5 text-foreground" />
                )}
              </div>

              {/* Message content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold">
                    {isUser ? 'You' : 'AI Assistant'}
                  </span>
                  {msg.timestamp && (
                    <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>

                {isUser && (
                  <div className="rounded-lg px-3 py-2 bg-primary/10 text-foreground">
                    <div className="whitespace-pre-wrap text-sm break-words">
                      {msg.content}
                    </div>
                  </div>
                )}

                {isAI && (
                  <AIMessageTimeline
                    msg={msg}
                    isStreaming={!!(isStreaming && isLastMsg)}
                  />
                )}
              </div>
            </motion.div>
          )})}
        </AnimatePresence>
        <div ref={chatEndRef} />
      </div>
      {/* Input bar */}
      {!readOnly && (
        <div className="border-t border-border bg-muted/30 px-4 py-4">
          {queue && queue.size > 0 && <QueueList queue={queue} />}
          <form
            className="flex items-end gap-2 bg-background rounded-lg border border-border p-2 focus-within:ring-2 focus-within:ring-primary/20 transition-all"
            onSubmit={e => {
              e.preventDefault();
              if (message.trim()) onSend();
            }}
          >
            <Textarea
              placeholder={isStreaming ? "Type to queue a follow-up..." : "Type a message... (Shift+Enter for new line)"}
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (message.trim()) onSend();
                }
              }}
              className="flex-1 min-h-[60px] max-h-[200px] resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent"
              rows={1}
            />
            <Button
              type="submit"
              size="icon"
              disabled={!message.trim()}
              className={cn(
                "transition-all",
                !message.trim() && "opacity-50"
              )}
            >
              <LucideSend className="w-4 h-4" />
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {isStreaming ? "Messages will be queued and processed in order" : "Press Enter to send, Shift+Enter for new line"}
          </p>
        </div>
      )}
      {readOnly && (
        <div className="border-t border-border bg-muted/30 px-4 py-3 text-center">
          <p className="text-sm text-muted-foreground">
            View-only mode - Messages cannot be sent in shared sessions
          </p>
        </div>
      )}
    </div>
  );
}
