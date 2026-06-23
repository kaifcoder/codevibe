"use client";

import { Dispatch, SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { ChatPanel, ChatMessage } from "@/components/ChatPanel";
import type { MessageQueue } from "@/components/QueueList";
import { CodeEditor } from "@/components/CodeEditor";
import { FileTree } from "@/components/FileTree";
import { useChat, type MobilePanel } from "@/contexts/chat-context";
import { useCollaboration } from "@/hooks/use-collaboration";
import { ChevronLeft, FileCode } from "lucide-react";

export interface MobileChatLayoutProps {
  messages: ChatMessage[];
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  handleSend: () => void;
  handleStop?: () => void;
  isLoading: boolean;
  isStreaming: boolean;
  renderPreview: () => React.ReactNode;
  queue?: MessageQueue;
  interruptSlot?: React.ReactNode;
}

// Mobile pane order. Index in this array drives the swipe direction —
// swipe left = +1 (advance), swipe right = -1 (go back).
const PANEL_ORDER: MobilePanel[] = ["chat", "preview", "code"];

/**
 * Mobile chat layout.
 *
 * Panel switching happens two ways:
 *   1. Tap a segment in the header pill (ChatMobilePill in ChatTopBar).
 *   2. Swipe the pane content left/right.
 *
 * The swipe uses framer-motion's drag on a transparent wrapper. Each pane
 * is rendered absolutely-positioned and slides in horizontally on change,
 * so the user feels they're paging through a carousel. We block the drag
 * inside text inputs and the Monaco editor (children stop the drag by
 * setting `data-no-swipe` on themselves — see CodeEditor).
 */
export function MobileChatLayout({
  messages,
  message,
  setMessage,
  handleSend,
  handleStop,
  isLoading,
  isStreaming,
  renderPreview,
  queue,
  interruptSlot,
}: Readonly<MobileChatLayoutProps>) {
  const {
    sessionId,
    fileTree,
    openFiles,
    setOpenFiles,
    selectedFile,
    setSelectedFile,
    isSyncingFilesystem,
    mobileActivePanel,
    setMobileActivePanel,
    templateType,
    getFileContent,
  } = useChat();
  const selectedFileContent = getFileContent(selectedFile);
  const { yText, provider } = useCollaboration(sessionId, selectedFile);

  // Mobile code pane has two screens: a file browser ("files") and the
  // editor itself ("editor"). Opening a file from the browser slides the
  // editor in; the back chevron returns to the browser. We default to the
  // browser so users see the project structure first, matching the
  // file-manager pattern users already know from iOS Files / VS Code mobile.
  const [codeView, setCodeView] = useState<"files" | "editor">("files");

  // n8n has no code pane — restrict swipe order accordingly.
  const order = useMemo(
    () => (templateType === "n8n" ? PANEL_ORDER.filter((p) => p !== "code") : PANEL_ORDER),
    [templateType],
  );
  const activeIndex = Math.max(0, order.indexOf(mobileActivePanel));
  const prevIndexRef = useRef(activeIndex);
  const directionRef = useRef(0);
  // Compute direction on activeIndex change, then update the previous-index
  // ref AFTER commit so React's double-render in dev doesn't zero it out.
  if (prevIndexRef.current !== activeIndex) {
    directionRef.current = activeIndex - prevIndexRef.current;
  }
  const direction = directionRef.current;
  useEffect(() => {
    prevIndexRef.current = activeIndex;
  }, [activeIndex]);

  // Re-entering the code panel should land on the file browser — same model
  // as backing out of a file in mobile IDEs (VS Code mobile, Working Copy).
  // Without this, swiping away from a half-read file and back skips the
  // browser entirely and the user has no obvious way to switch files.
  useEffect(() => {
    if (mobileActivePanel !== "code") setCodeView("files");
  }, [mobileActivePanel]);

  // Swipe handler. Triggers on release; ~50px or 400px/s threshold matches
  // Instagram / Twitter timeline feel. We honor velocity even on short
  // swipes so a flick still pages even if it didn't travel far.
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const SWIPE_DISTANCE = 60;
    const SWIPE_VELOCITY = 400;
    const dx = info.offset.x;
    const vx = info.velocity.x;
    let next: number | null = null;
    if (dx < -SWIPE_DISTANCE || vx < -SWIPE_VELOCITY) next = activeIndex + 1;
    else if (dx > SWIPE_DISTANCE || vx > SWIPE_VELOCITY) next = activeIndex - 1;
    if (next === null) return;
    if (next < 0 || next >= order.length) return;
    setMobileActivePanel(order[next]);
  };

  const variants = {
    enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0.6 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? "-100%" : "100%", opacity: 0.6 }),
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <motion.div
          drag="x"
          // Constrained near-zero so we feel resistance, not a free pan.
          // The actual page change comes from onDragEnd above.
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.18}
          dragDirectionLock
          onDragEnd={onDragEnd}
          // Don't capture pinch / multi-touch / scroll — only horizontal
          // swipes initiated on the pane background. Children that own
          // their own horizontal scroll (file tabs, Monaco) set
          // data-no-swipe; we detect it on pointer-down and abort the drag.
          onPointerDownCapture={(e) => {
            const t = e.target as HTMLElement | null;
            if (t?.closest?.("[data-no-swipe]")) {
              (e.currentTarget as HTMLElement).style.touchAction = "auto";
            } else {
              (e.currentTarget as HTMLElement).style.touchAction = "pan-y";
            }
          }}
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
          style={{ touchAction: "pan-y" }}
        >
          <AnimatePresence custom={direction} initial={false} mode="popLayout">
            <motion.div
              key={mobileActivePanel}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ x: { type: "spring", stiffness: 320, damping: 32 }, opacity: { duration: 0.18 } }}
              className="absolute inset-0"
            >
              {mobileActivePanel === "chat" && (
                <div className="h-full flex flex-col w-full">
                  <ChatPanel
                    messages={messages}
                    message={message}
                    setMessage={setMessage}
                    onSend={handleSend}
                    onStop={handleStop}
                    isLoading={isLoading}
                    isStreaming={isStreaming}
                    queue={queue}
                    interruptSlot={interruptSlot}
                  />
                </div>
              )}
              {mobileActivePanel === "preview" && (
                <div className="h-full w-full overflow-hidden" data-no-swipe>
                  {renderPreview()}
                </div>
              )}
              {mobileActivePanel === "code" && (
                <div className="h-full flex flex-col overflow-hidden" data-no-swipe>
                  <AnimatePresence initial={false} mode="popLayout">
                    {codeView === "files" ? (
                      <motion.div
                        key="files"
                        initial={{ x: "-12%", opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: "-12%", opacity: 0 }}
                        transition={{ type: "spring", stiffness: 320, damping: 32 }}
                        className="absolute inset-0 flex flex-col bg-background"
                      >
                        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
                          <div className="flex flex-col min-w-0">
                            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                              Project
                            </span>
                            <span className="text-sm font-medium truncate">
                              Files & folders
                            </span>
                          </div>
                          {isSyncingFilesystem && (
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                              Syncing…
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto py-1">
                          {fileTree.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-2">
                              <FileCode className="h-6 w-6 text-muted-foreground/60" />
                              <p className="text-xs text-muted-foreground">
                                {isSyncingFilesystem
                                  ? "Loading your project…"
                                  : "No files yet — start a prompt to generate code."}
                              </p>
                            </div>
                          ) : (
                            <FileTree
                              nodes={fileTree}
                              selected={selectedFile}
                              onSelect={(path) => {
                                setSelectedFile(path);
                                if (!openFiles.includes(path)) {
                                  setOpenFiles((prev) => [...prev, path]);
                                }
                                setCodeView("editor");
                              }}
                            />
                          )}
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="editor"
                        initial={{ x: "100%", opacity: 0.6 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: "100%", opacity: 0.6 }}
                        transition={{ type: "spring", stiffness: 320, damping: 32 }}
                        className="absolute inset-0 flex flex-col bg-background"
                      >
                        <div className="flex items-center gap-1 border-b bg-muted/20">
                          <button
                            type="button"
                            onClick={() => setCodeView("files")}
                            className="flex items-center gap-1 px-2.5 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground active:bg-muted/60 transition-colors min-h-11 shrink-0"
                            aria-label="Back to files"
                          >
                            <ChevronLeft className="h-4 w-4" />
                            <span>Files</span>
                          </button>
                          <div className="h-5 w-px bg-border/60 shrink-0" />
                          <div className="flex-1 min-w-0 flex items-center overflow-x-auto scrollbar-none">
                            {openFiles.map((filePath) => {
                              const fileName = filePath.split("/").pop() || filePath;
                              const isActive = filePath === selectedFile;
                              return (
                                <button
                                  key={filePath}
                                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs border-r cursor-pointer hover:bg-accent/50 transition-colors whitespace-nowrap min-h-11 ${
                                    isActive
                                      ? "bg-background text-foreground"
                                      : "bg-muted/20 text-muted-foreground"
                                  }`}
                                  onClick={() => setSelectedFile(filePath)}
                                >
                                  <span className={isActive ? "font-medium" : ""}>
                                    {fileName}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex-1 min-h-0 overflow-hidden relative">
                          {selectedFile ? (
                            <CodeEditor
                              yText={yText}
                              provider={provider}
                              language="typescript"
                              initialContent={selectedFileContent}
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-2">
                              <FileCode className="h-6 w-6 text-muted-foreground/60" />
                              <p className="text-xs text-muted-foreground">
                                Pick a file from the browser to start editing.
                              </p>
                              <button
                                type="button"
                                onClick={() => setCodeView("files")}
                                className="mt-1 text-xs font-medium text-blue-500 hover:underline"
                              >
                                Browse files
                              </button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>

        {/* Swipe hint dots — bottom-center, fades on first interaction.
            Three dots like Instagram stories, the active one widened. */}
        <SwipeHint order={order} activeIndex={activeIndex} />
      </div>
    </div>
  );
}

function SwipeHint({ order, activeIndex }: { order: MobilePanel[]; activeIndex: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-background/60 backdrop-blur-md border border-border/40 px-2 py-1 shadow-sm"
    >
      {order.map((p, i) => (
        <span
          key={p}
          className={`block h-1 rounded-full transition-all ${
            i === activeIndex ? "w-4 bg-foreground/70" : "w-1 bg-muted-foreground/40"
          }`}
        />
      ))}
    </div>
  );
}
