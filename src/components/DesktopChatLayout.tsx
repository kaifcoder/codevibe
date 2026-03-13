"use client";

import { Dispatch, SetStateAction } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ChatPanel, ChatMessage } from "@/components/ChatPanel";
import { CodeEditor } from "@/components/CodeEditor";
import { FileTree } from "@/components/FileTree";

// Define FileNode type for file tree structure
type FileNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  content?: string;
};

type ConnectionStatus = "connected" | "connecting" | "disconnected";
type ConnectedUser = { id: string; name: string; color: string };

export interface DesktopChatLayoutProps {
  messages: ChatMessage[];
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  handleSend: () => void;
  isLoading: boolean;
  isStreaming: boolean;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  fileTree: FileNode[];
  selectedFile: string;
  setSelectedFile: (file: string) => void;
  openFiles: string[];
  setOpenFiles: (files: string[]) => void;
  isSyncingFilesystem: boolean;
  sandboxId: string | null;
  sessionId: string;
  getCurrentFileContent: (file: string) => string;
  handleCodeChange: (value: string | undefined) => void;
  guestCredentials: { username: string; userId: string } | null;
  connectionStatus: ConnectionStatus;
  connectedUsers: ConnectedUser[];
  setConnectedUsers: (users: ConnectedUser[]) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  isSyncingToE2B: boolean;
  renderPreview: () => React.ReactNode;
}

export function DesktopChatLayout({
  messages,
  message,
  setMessage,
  handleSend,
  isLoading,
  isStreaming,
  activeTab,
  setActiveTab,
  fileTree,
  selectedFile,
  setSelectedFile,
  openFiles,
  setOpenFiles,
  isSyncingFilesystem,
  sandboxId,
  sessionId,
  getCurrentFileContent,
  handleCodeChange,
  guestCredentials,
  connectionStatus,
  connectedUsers,
  setConnectedUsers,
  setConnectionStatus,
  isSyncingToE2B,
  renderPreview,
}: Readonly<DesktopChatLayoutProps>) {
  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel defaultSize={30} minSize={20}>
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
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        defaultSize={70}
        minSize={30}
        className="animate-in fade-in-0 data-[state=active]:fade-in-100"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key="webview-panel"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "tween", duration: 0.35 }}
            className="flex h-full w-full flex-col overflow-hidden"
          >
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full overflow-hidden">
              <TabsContent value="code" className="flex flex-row flex-1 min-h-0 gap-0 mt-0 overflow-hidden">
                <div className="w-48 h-full flex-shrink-0 overflow-hidden border-r flex flex-col">
                  <div className="p-2 border-b flex items-center justify-between bg-muted/20">
                    <span className="text-xs font-medium text-muted-foreground">Files</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={async () => {
                        if (!sandboxId || !sessionId) {
                          toast.error('No sandbox available');
                          return;
                        }
                        try {
                          const response = await fetch('/api/sync-filesystem', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sandboxId, sessionId }),
                          });
                          const data = await response.json();
                          if (data.success) {
                            toast.success('Filesystem synced!');
                          } else {
                            toast.error(data.error || 'Sync failed');
                          }
                        } catch (error) {
                          toast.error('Failed to sync filesystem');
                          console.error('Sync error:', error);
                        }
                      }}
                      title="Sync filesystem from e2b sandbox"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                      </svg>
                    </Button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <FileTree
                      nodes={fileTree}
                      selected={selectedFile}
                      onSelect={(path) => {
                        setSelectedFile(path);
                        if (!openFiles.includes(path)) {
                          setOpenFiles([...openFiles, path]);
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
                  {isSyncingFilesystem ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center space-y-2">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                        <p className="text-sm text-muted-foreground">Syncing filesystem...</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* File Tabs */}
                      <div className="flex items-center justify-between bg-muted/20 border-b overflow-x-auto">
                        <div className="flex items-center overflow-x-auto">
                          {openFiles.map((filePath) => {
                            const fileName = filePath.split('/').pop() || filePath;
                            const isActive = filePath === selectedFile;
                            return (
                              <div
                                key={filePath}
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-r transition-colors ${
                                  isActive ? 'bg-background' : 'bg-muted/20'
                                }`}
                              >
                                <button
                                  type="button"
                                  className={`hover:text-foreground transition-colors ${isActive ? 'font-medium' : ''}`}
                                  onClick={() => setSelectedFile(filePath)}
                                >
                                  {fileName}
                                </button>
                                {openFiles.length > 1 && (
                                  <button
                                    type="button"
                                    className="hover:bg-muted rounded p-0.5 transition-colors"
                                    aria-label={`Close ${fileName}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newOpenFiles = openFiles.filter(f => f !== filePath);
                                      setOpenFiles(newOpenFiles);
                                      if (filePath === selectedFile && newOpenFiles.length > 0) {
                                        setSelectedFile(newOpenFiles.at(-1) ?? selectedFile);
                                      }
                                    }}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-muted-foreground hover:text-foreground">
                                      <path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                    </svg>
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {/* Connection Status and Sync Indicator */}
                        <div className="flex items-center gap-3 px-3 py-1.5 text-xs border-l shrink-0">
                          {/* Yjs Connection Status */}
                          <div className="flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              (() => {
                                switch (connectionStatus) {
                                  case 'connected': return 'bg-green-500';
                                  case 'connecting': return 'bg-yellow-500 animate-pulse';
                                  default: return 'bg-gray-400';
                                }
                              })()
                            }`} />
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                              {(() => {
                                switch (connectionStatus) {
                                  case 'connected': return 'Live';
                                  case 'connecting': return 'Connecting';
                                  default: return 'Offline';
                                }
                              })()}
                            </span>
                          </div>
                          {connectionStatus === 'connected' && (
                            <span className="text-[10px] text-muted-foreground">
                              • {connectedUsers.length + 1} {connectedUsers.length + 1 === 1 ? 'user' : 'users'}
                            </span>
                          )}
                          {/* E2B Sync Status */}
                          {isSyncingToE2B && (
                            <div className="flex items-center gap-1 text-blue-500">
                              <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              <span className="text-[10px] uppercase tracking-wide">Syncing to E2B</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <CodeEditor
                        key={`${sessionId}-${selectedFile}`}
                        value={getCurrentFileContent(selectedFile)}
                        onChange={handleCodeChange}
                        language="typescript"
                        autoScroll={false}
                        collaborative={true}
                        roomId={`${sessionId}-${selectedFile}`}
                        username={guestCredentials?.username || 'User'}
                        userId={guestCredentials?.userId || sessionId}
                        onUsersChange={setConnectedUsers}
                        onConnectionStatusChange={setConnectionStatus}
                      />
                    </>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="live preview" className="flex flex-col flex-1 min-h-0 mt-0 overflow-hidden">
                <div className="flex-1 w-full overflow-hidden border-0 relative min-h-0">
                  {renderPreview()}
                </div>
              </TabsContent>
            </Tabs>
          </motion.div>
        </AnimatePresence>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
