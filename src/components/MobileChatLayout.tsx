"use client";

import { Dispatch, SetStateAction } from "react";
import { MessageSquare, Code, Eye } from "lucide-react";
import { ChatPanel, ChatMessage } from "@/components/ChatPanel";
import { CodeEditor } from "@/components/CodeEditor";
import { useChatStore } from "@/stores/chat-store";

type MobilePanel = "chat" | "preview" | "code";

export interface MobileChatLayoutProps {
  mobileActivePanel: MobilePanel;
  setMobileActivePanel: (panel: MobilePanel) => void;
  messages: ChatMessage[];
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  handleSend: () => void;
  isLoading: boolean;
  isStreaming: boolean;
  renderPreview: () => React.ReactNode;
  handleCodeChange: (value: string | undefined) => void;
  guestCredentials: { username: string; userId: string } | null;
}

export function MobileChatLayout({
  mobileActivePanel,
  setMobileActivePanel,
  messages,
  message,
  setMessage,
  handleSend,
  isLoading,
  isStreaming,
  renderPreview,
  handleCodeChange,
  guestCredentials,
}: Readonly<MobileChatLayoutProps>) {
  // Read file/editor state directly from store
  const openFiles = useChatStore(s => s.openFiles);
  const selectedFile = useChatStore(s => s.selectedFile);
  const setSelectedFile = useChatStore(s => s.setSelectedFile);
  const sessionId = useChatStore(s => s.sessionId);
  const isSyncingFilesystem = useChatStore(s => s.isSyncingFilesystem);
  const setConnectedUsers = useChatStore(s => s.setConnectedUsers);
  const setConnectionStatus = useChatStore(s => s.setConnectionStatus);
  const getFileContent = useChatStore(s => s.getFileContent);
  const streamingFiles = useChatStore(s => s.streamingFiles);

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
            {isSyncingFilesystem ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-2">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                  <p className="text-sm text-muted-foreground">Syncing filesystem...</p>
                </div>
              </div>
            ) : (
              <>
                {/* Mobile File Tabs */}
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
                </div>
                <div className="flex-1 min-h-0 overflow-hidden relative">
                  {streamingFiles.includes(selectedFile) && (
                    <div className="absolute inset-0 z-10 pointer-events-none">
                      <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-background/90 border rounded-md px-2 py-1 z-20">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] text-muted-foreground font-medium">Writing...</span>
                      </div>
                    </div>
                  )}
                  <CodeEditor
                    key={`${sessionId}-${selectedFile}`}
                    value={getFileContent(selectedFile)}
                    onChange={handleCodeChange}
                    language="typescript"
                    autoScroll={streamingFiles.includes(selectedFile)}
                    collaborative={true}
                    roomId={`${sessionId}-${selectedFile}`}
                    username={guestCredentials?.username || 'User'}
                    userId={guestCredentials?.userId || sessionId}
                    onUsersChange={setConnectedUsers}
                    onConnectionStatusChange={setConnectionStatus}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
