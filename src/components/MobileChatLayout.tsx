"use client";

import { Dispatch, SetStateAction } from "react";
import { MessageSquare, Code, Eye } from "lucide-react";
import { ChatPanel, ChatMessage } from "@/components/ChatPanel";
import type { MessageQueue } from "@/components/QueueList";
import { CodeEditor } from "@/components/CodeEditor";
import { useChat } from "@/contexts/chat-context";
import { useCollaboration } from "@/hooks/use-collaboration";

export interface MobileChatLayoutProps {
  messages: ChatMessage[];
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  handleSend: () => void;
  isLoading: boolean;
  isStreaming: boolean;
  renderPreview: () => React.ReactNode;
  queue?: MessageQueue;
  interruptSlot?: React.ReactNode;
}

export function MobileChatLayout({
  messages,
  message,
  setMessage,
  handleSend,
  isLoading,
  isStreaming,
  renderPreview,
  queue,
  interruptSlot,
}: Readonly<MobileChatLayoutProps>) {
  const {
    sessionId,
    openFiles,
    selectedFile,
    setSelectedFile,
    isSyncingFilesystem,
    mobileActivePanel,
    setMobileActivePanel,
    getFileContent,
  } = useChat();
  const selectedFileContent = getFileContent(selectedFile);
  const { yText, provider } = useCollaboration(sessionId, selectedFile);

  return (
    <div className="h-full flex flex-col">
      {/* Mobile Tab Bar */}
      <div className="flex items-center border-b bg-muted/30 px-2">
        <button
          onClick={() => setMobileActivePanel("chat")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            mobileActivePanel === "chat"
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground"
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          Chat
        </button>
        <button
          onClick={() => setMobileActivePanel("preview")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            mobileActivePanel === "preview"
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground"
          }`}
        >
          <Eye className="h-4 w-4" />
          Preview
        </button>
        <button
          onClick={() => setMobileActivePanel("code")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            mobileActivePanel === "code"
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground"
          }`}
        >
          <Code className="h-4 w-4" />
          Code
        </button>
      </div>

      {/* Mobile Panel Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {mobileActivePanel === "chat" && (
          <div className="h-full flex flex-col w-full">
            <ChatPanel
              messages={messages}
              message={message}
              setMessage={setMessage}
              onSend={handleSend}
              isLoading={isLoading}
              isStreaming={isStreaming}
              queue={queue}
              interruptSlot={interruptSlot}
            />
          </div>
        )}
        {mobileActivePanel === "preview" && (
          <div className="h-full w-full overflow-hidden">
            {renderPreview()}
          </div>
        )}
        {mobileActivePanel === "code" && (
          <div className="h-full flex flex-col overflow-hidden">
            <div className="flex items-center bg-muted/20 border-b overflow-x-auto">
              {openFiles.map((filePath) => {
                const fileName = filePath.split('/').pop() || filePath;
                const isActive = filePath === selectedFile;
                return (
                  <button
                    key={filePath}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs border-r cursor-pointer hover:bg-accent/50 transition-colors whitespace-nowrap ${
                      isActive ? 'bg-background' : 'bg-muted/20'
                    }`}
                    onClick={() => setSelectedFile(filePath)}
                  >
                    <span className={isActive ? 'font-medium' : ''}>{fileName}</span>
                  </button>
                );
              })}
              {isSyncingFilesystem && (
                <span className="px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Syncing…
                </span>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden relative">
              <CodeEditor
                yText={yText}
                provider={provider}
                language="typescript"
                initialContent={selectedFileContent}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
