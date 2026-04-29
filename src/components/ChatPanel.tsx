"use client";

import { Button } from "@/components/ui/button";
import { Dispatch, SetStateAction, useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LucideSend, Bot, User, ChevronDown, ChevronRight, Brain, AlertCircle, Check, Terminal, Pencil, Eye, FolderOpen, Trash2, Globe, Search, Package, Box } from "lucide-react";
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
    startTime?: number;
    endTime?: number;
  }>;
  reasoning?: string;
}

// Get icon for tool type
function getToolIcon(toolName: string): React.ReactNode {
  const name = toolName.toLowerCase();
  if (name.includes('write_file') || name.includes('writefile') || name.includes('edit_file') || name.includes('editfile')) return <Pencil className="w-3 h-3" />;
  if (name.includes('read_file') || name.includes('readfile')) return <Eye className="w-3 h-3" />;
  if (name.includes('list_files') || name.includes('listfiles') || name.includes('list_dir') || name.includes('listdir') || name.includes('list_files_recursive')) return <FolderOpen className="w-3 h-3" />;
  if (name.includes('run_command') || name.includes('execute') || name.includes('shell')) return <Terminal className="w-3 h-3" />;
  if (name.includes('delete_file') || name.includes('deletefile') || name.includes('remove')) return <Trash2 className="w-3 h-3" />;
  if (name.includes('create_directory') || name.includes('mkdir') || name.includes('create_dir')) return <FolderOpen className="w-3 h-3" />;
  if (name.includes('browser') || name.includes('navigate') || name.includes('screenshot') || name.includes('playwright')) return <Globe className="w-3 h-3" />;
  if (name.includes('search') || name.includes('query') || name.includes('fetch') || name.includes('get')) return <Search className="w-3 h-3" />;
  if (name.includes('install')) return <Package className="w-3 h-3" />;
  if (name.includes('create_sandbox') || name.includes('createsandbox')) return <Box className="w-3 h-3" />;
  return <Terminal className="w-3 h-3" />;
}

// Get action verb from tool name
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

// Extract filename or target from tool args
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

// Format tool display with action and target
function formatToolDisplay(tool: ToolCall): { action: string; target: string } {
  return { action: getToolAction(tool.tool), target: getToolTarget(tool) };
}

// Format tool name for display
function formatToolName(toolName: string): string {
  return toolName
    .replace(/^e2b_/, '')
    .replace(/^browser_/, '')
    .replace(/^mcp_/, '')
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Tool call type helper
type ToolCall = NonNullable<ChatMessage['toolCalls']>[number];

// Compact tool line
function ToolLine({ tool, idx }: { tool: ToolCall; idx: number }) {
  const { action, target } = formatToolDisplay(tool);
  const isError = tool.status === 'error';

  return (
    <div key={`${tool.tool}-${idx}`} className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
      <span className={cn("shrink-0", isError && "text-red-500")}>
        {isError ? <AlertCircle className="w-3 h-3" /> : getToolIcon(tool.tool)}
      </span>
      <span className={cn("truncate", isError && "text-red-500")}>
        {action}{target ? ` ${target}` : ''}
      </span>
      {!isError && <Check className="w-3 h-3 text-emerald-500 shrink-0 ml-auto" />}
    </div>
  );
}

// Action Timeline Component - Collapsible, compact
function ActionTimeline({
  toolCalls,
  status,
  isStreaming,
  reasoning
}: Readonly<{
  toolCalls: ToolCall[];
  status?: string;
  isStreaming?: boolean;
  reasoning?: string;
}>) {
  const [isOpen, setIsOpen] = useState(false);
  const completedCalls = toolCalls.filter(t => t.status === 'complete' || t.status === 'error');
  const runningCalls = toolCalls.filter(t => t.status === 'running' || t.status === 'pending');
  const currentRunning = runningCalls[0];
  const totalSteps = toolCalls.length;

  return (
    <div className="my-2">
      {/* Collapsible completed tools */}
      {completedCalls.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-muted/20 overflow-hidden">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40 transition-colors"
          >
            {isOpen
              ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
              : <ChevronRight className="w-3 h-3 text-muted-foreground" />
            }
            <span className="text-xs text-muted-foreground">
              {currentRunning
                ? `Used ${completedCalls.length} of ${totalSteps} tools`
                : `Used ${completedCalls.length} tool${completedCalls.length !== 1 ? 's' : ''}`
              }
            </span>
            {!currentRunning && completedCalls.every(t => t.status === 'complete') && (
              <Check className="w-3 h-3 text-emerald-500 ml-auto" />
            )}
          </button>
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="overflow-hidden"
              >
                <div className="px-3 pb-2 space-y-0.5 max-h-[200px] overflow-y-auto">
                  {completedCalls.map((tool, idx) => (
                    <ToolLine key={`${tool.tool}-${idx}`} tool={tool} idx={idx} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Current running tool - single inline indicator */}
      {currentRunning && (
        <div className="flex items-center gap-2 mt-1.5 px-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
          </span>
          <span className="text-xs text-muted-foreground">
            {(() => {
              const { action, target } = formatToolDisplay(currentRunning);
              return target ? `${action} ${target}` : action;
            })()}
          </span>
        </div>
      )}

      {/* Reasoning */}
      {reasoning && !currentRunning && (
        <CollapsibleSection
          title="Reasoning"
          icon={<Brain className="w-3.5 h-3.5" />}
          variant="thinking"
          defaultOpen={false}
        >
          <div className="text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap italic">
            {reasoning}
          </div>
        </CollapsibleSection>
      )}

      {/* Generating response - subtle indicator */}
      {isStreaming && !currentRunning && status === 'streaming' && (
        <div className="flex items-center gap-2 mt-1.5 px-1">
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

// Collapsible section component
function CollapsibleSection({ 
  title, 
  icon, 
  children, 
  defaultOpen = false,
  badge,
  variant = 'default'
}: Readonly<{ 
  title: string; 
  icon: React.ReactNode; 
  children: React.ReactNode; 
  defaultOpen?: boolean;
  badge?: string | number;
  variant?: 'default' | 'thinking' | 'tool';
}>) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  const variantStyles = {
    default: 'bg-muted/30 border-border/50',
    thinking: 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-800/50',
    tool: 'bg-purple-50/50 dark:bg-purple-950/20 border-purple-200/50 dark:border-purple-800/50'
  };
  
  return (
    <div className={cn("rounded-lg border overflow-hidden mb-2", variantStyles[variant])}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-xs font-medium flex-1">{title}</span>
        {badge !== undefined && (
          <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
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
            <div className="px-3 pb-3 pt-1 text-sm">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
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
                  {/* Reasoning section - collapsible */}
                  {isAI && msg.reasoning && !msg.toolCalls?.length && (
                    <CollapsibleSection
                      title="Thinking"
                      icon={<Brain className="w-3.5 h-3.5" />}
                      variant="thinking"
                      defaultOpen={false}
                    >
                      <div className="text-muted-foreground text-sm leading-relaxed whitespace-pre-wrap italic">
                        {msg.reasoning}
                      </div>
                    </CollapsibleSection>
                  )}

                  {/* Action Timeline - shows reasoning + tool calls in scrollable timeline */}
                  {isAI && msg.toolCalls && msg.toolCalls.length > 0 && (
                    <ActionTimeline
                      toolCalls={msg.toolCalls}
                      status={msg.status}
                      isStreaming={isStreaming && i === messages.length - 1}
                      reasoning={msg.reasoning}
                    />
                  )}

                  {/* Status indicators for AI messages when no tool calls */}
                  {isAI && msg.status && msg.status !== 'complete' && !msg.toolCalls?.length && (
                    <div className="flex items-center gap-2 my-2 px-1">
                      {msg.status === 'thinking' && (
                        <>
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                          </span>
                          <span className="text-xs text-muted-foreground">Thinking...</span>
                        </>
                      )}
                      {msg.status === 'using_tool' && msg.toolName && (
                        <>
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                          </span>
                          <span className="text-xs text-muted-foreground">Using {formatToolName(msg.toolName)}</span>
                        </>
                      )}
                      {msg.status === 'streaming' && (
                        <>
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                          </span>
                          <span className="text-xs text-muted-foreground">Writing response...</span>
                        </>
                      )}
                    </div>
                  )}
                  
                  {/* Message content text */}
                  {(() => {
                    // Skip content area when processing/thinking without content
                    const isProcessing = msg.content === '🔄 Processing...' || (isAI && !msg.content && msg.status === 'thinking');
                    if (isProcessing) return null;
                    if (!msg.content) return null;
                    
                    return (
                      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {msg.content}
                        {isAI && i === messages.length - 1 && isStreaming && (
                          <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-1 align-middle" />
                        )}
                      </div>
                    );
                  })()}
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
            {isStreaming ? "Agent is working on your request..." : "Press Enter to send, Shift+Enter for new line"}
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
