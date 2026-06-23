"use client";

import { useState } from "react";
import { useChat } from "@/contexts/chat-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  MessageSquare,
  Eye,
  Code,
  Users,
  MoreHorizontal,
  RefreshCw,
  Copy,
  ExternalLink,
  Lock,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ChatTopBarProps {
  sessionId: string;
  isSharedAccess: boolean;
  isMounted: boolean;
  /** Render slot for the primary actions (Share/Deploy/Github/Download).
   *  The page already constructs these — we just inject them so each button
   *  keeps its own state & permission gates. */
  primaryActions?: React.ReactNode;
  /** Same slot, but the buttons inside should be visually de-prioritized
   *  on mobile (collapsed into the actions sheet). */
  overflowActions?: React.ReactNode;
}

/**
 * Top-of-page toolbar for the chat route.
 *
 * Desktop: a single dense row with identity, segmented Preview/Code control,
 * connected-user avatars, and inline action buttons. URL chip sits in a
 * sub-row when preview is active.
 *
 * Mobile (Lovable-style):
 *   - Top: trimmed header — title · "live URL" pill · ⋯ sheet trigger. No
 *     inline buttons. No segmented control.
 *   - Bottom: floating tab bar (rendered via {@link ChatBottomTabBar})
 *     handles Chat / Preview / Code switching with thumb-reachable targets.
 *   - ⋯ opens a bottom sheet with every project action.
 *   - "Live" opens a small bottom sheet with the sandbox URL + refresh /
 *     copy / open.
 */
export function ChatTopBar({
  sessionId,
  isSharedAccess,
  isMounted,
  primaryActions,
  overflowActions,
}: ChatTopBarProps) {
  const ctx = useChat();
  const isMobile = useIsMobile();
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);
  const [urlSheetOpen, setUrlSheetOpen] = useState(false);

  const showSegmented = ctx.showSecondPanel;
  const isN8n = ctx.templateType === "n8n";

  const desktopSegments: Array<{
    id: "preview" | "code";
    label: string;
    Icon: typeof MessageSquare;
  }> = [
    { id: "preview", label: "Preview", Icon: Eye },
    ...(!isN8n ? [{ id: "code" as const, label: "Code", Icon: Code }] : []),
  ];

  const activeDesktopSegment: "preview" | "code" =
    ctx.activeTab === "code" ? "code" : "preview";

  const onDesktopSegmentSelect = (id: "preview" | "code") => {
    if (id === "code") ctx.setActiveTab("code");
    else ctx.setActiveTab("live preview");
  };

  return (
    <div className="relative shrink-0 border-b border-border/40 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      {/* ── Row 1 ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4 h-12">
        {/* Identity */}
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-xs font-medium truncate max-w-[40vw] sm:max-w-[18ch] md:max-w-[28ch]">
              {isSharedAccess ? "Shared session" : "Untitled session"}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground truncate">
              {sessionId.slice(0, 8)}
            </span>
          </div>
        </div>

        {/* Status pills (desktop only) */}
        <div className="hidden sm:flex items-center gap-2 min-w-0">
          {isSharedAccess && (
            <Badge
              variant="secondary"
              className="text-[10px] h-6 gap-1 whitespace-nowrap"
            >
              <Users className="h-3 w-3" />
              <span>Shared</span>
            </Badge>
          )}
          {ctx.sandboxUrl && (
            <Badge
              variant="outline"
              className="text-[10px] h-6 gap-1.5 whitespace-nowrap border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-600 dark:text-emerald-400"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Sandbox live
            </Badge>
          )}
          {isSharedAccess && (
            <Badge
              variant="outline"
              className="text-[10px] h-6 gap-1 whitespace-nowrap"
            >
              <Lock className="h-3 w-3" />
              read-only
            </Badge>
          )}
        </div>

        {/* Connected-user avatars — desktop only */}
        {!isMobile && ctx.connectedUsers.length > 0 && (
          <TooltipProvider>
            <div className="flex items-center gap-0 shrink-0">
              {ctx.connectedUsers.slice(0, 4).map((user) => (
                <Tooltip key={user.id}>
                  <TooltipTrigger asChild>
                    <Avatar
                      className="h-7 w-7 border-2 -ml-1.5 first:ml-0 ring-2 ring-background"
                      style={{ borderColor: user.color }}
                    >
                      <AvatarFallback
                        style={{
                          backgroundColor: user.color + "20",
                          color: user.color,
                        }}
                      >
                        {user.name.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">{user.name}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
              {ctx.connectedUsers.length > 4 && (
                <div className="h-7 px-2 flex items-center justify-center text-[10px] font-medium rounded-full bg-muted text-muted-foreground -ml-1.5 ring-2 ring-background">
                  +{ctx.connectedUsers.length - 4}
                </div>
              )}
            </div>
          </TooltipProvider>
        )}

        {/* Action cluster */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {isMobile ? (
            <>
              {/* Segmented Chat/Preview/Code pill — pinned to the far
                  right of the action cluster on mobile. */}
              <ChatMobilePill />
              {/* "Live URL" pill — opens a bottom sheet with the URL row. */}
              {ctx.sandboxUrl && (
                <Sheet open={urlSheetOpen} onOpenChange={setUrlSheetOpen}>
                  <SheetTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 rounded-full border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300 px-2.5"
                      aria-label="Open live URL"
                    >
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                      <span className="text-[11px] font-medium">Live</span>
                    </Button>
                  </SheetTrigger>
                  <SheetContent
                    side="bottom"
                    className="rounded-t-2xl border-t border-border/60 pb-[max(env(safe-area-inset-bottom,0px),1rem)]"
                  >
                    <UrlSheetBody onClose={() => setUrlSheetOpen(false)} />
                  </SheetContent>
                </Sheet>
              )}

              <Sheet open={actionsSheetOpen} onOpenChange={setActionsSheetOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="bottom"
                  className="rounded-t-2xl border-t border-border/60 pb-[max(env(safe-area-inset-bottom,0px),1rem)]"
                >
                  <ActionsSheetBody
                    sessionId={sessionId}
                    primaryActions={primaryActions}
                    overflowActions={overflowActions}
                  />
                </SheetContent>
              </Sheet>

            </>
          ) : (
            <>
              {/* Desktop segmented control — sits left of Share/Download */}
              {showSegmented && (
                <div
                  className="relative flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5 mr-1"
                  role="tablist"
                >
                  {desktopSegments.map(({ id, label, Icon }) => {
                    const active = id === activeDesktopSegment;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onDesktopSegmentSelect(id)}
                        className={cn(
                          "relative flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors min-w-[88px]",
                          active
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-3.5 w-3.5",
                            active && "text-blue-500",
                          )}
                        />
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
              {overflowActions}
              {primaryActions}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem asChild>
                    <button
                      type="button"
                      className="w-full"
                      onClick={() => {
                        navigator.clipboard.writeText(sessionId);
                        toast.success("Session id copied");
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy session id</span>
                    </button>
                  </DropdownMenuItem>
                  {ctx.sandboxUrl && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <button
                          type="button"
                          className="w-full"
                          onClick={() => {
                            navigator.clipboard.writeText(ctx.sandboxUrl!);
                            toast.success("Sandbox URL copied");
                          }}
                        >
                          <Globe className="h-3.5 w-3.5" />
                          <span>Copy sandbox URL</span>
                        </button>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <button
                          type="button"
                          className="w-full"
                          onClick={() =>
                            globalThis.open(ctx.sandboxUrl!, "_blank")
                          }
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>Open in new tab</span>
                        </button>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* ── Desktop URL sub-row (preview pane only) ──────────────────── */}
      {!isMobile && ctx.sandboxUrl && ctx.activeTab !== "code" && <DesktopUrlBar />}

      {/* The page should also render <ChatBottomTabBar /> below the layout
          so mobile users get a thumb-reachable Chat/Preview/Code switcher. */}
      {isMounted ? null : null}
    </div>
  );
}

// ─── Mobile inline pill (in session header) ─────────────────────────────

/**
 * Tiny segmented pill rendered next to the session title on mobile. Three
 * icon-only tabs, always visible. Pairs with the swipe gestures in
 * MobileChatLayout so users can either tap a segment or swipe between
 * panels.
 */
export function ChatMobilePill() {
  const ctx = useChat();
  const isMobile = useIsMobile();
  if (!isMobile || !ctx.showSecondPanel) return null;

  const isN8n = ctx.templateType === "n8n";
  const segments: Array<{
    id: "chat" | "preview" | "code";
    label: string;
    Icon: typeof MessageSquare;
  }> = [
    { id: "chat", label: "Chat", Icon: MessageSquare },
    { id: "preview", label: "Preview", Icon: Eye },
    ...(!isN8n ? [{ id: "code" as const, label: "Code", Icon: Code }] : []),
  ];

  return (
    <div
      role="tablist"
      className="flex items-center gap-0.5 rounded-full border border-border/60 bg-muted/40 p-0.5"
    >
      {segments.map(({ id, label, Icon }) => {
        const active = ctx.mobileActivePanel === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            onClick={() => ctx.setMobileActivePanel(id)}
            className={cn(
              "relative flex h-7 w-9 items-center justify-center rounded-full transition-all",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", active && "text-blue-500")} />
          </button>
        );
      })}
    </div>
  );
}

// Legacy named export — kept so the page's import keeps compiling. Now a
// no-op (the dock got replaced by the inline pill above + swipe gestures
// in MobileChatLayout).
export function ChatBottomTabBar() {
  return null;
}
ChatBottomTabBar.HEIGHT = 0;

// ─── Sheet bodies ───────────────────────────────────────────────────────

function UrlSheetBody({ onClose }: { onClose: () => void }) {
  const ctx = useChat();
  if (!ctx.sandboxUrl) return null;

  const refresh = () => {
    ctx.setIframeLoading(true);
    const iframe = document.querySelector(
      'iframe[title="Sandbox Preview"]',
    ) as HTMLIFrameElement | null;
    if (iframe) {
      const s = iframe.src;
      iframe.src = "";
      setTimeout(() => {
        iframe.src = s;
      }, 0);
    }
    onClose();
  };

  return (
    <div className="px-4 pb-2 pt-1">
      <SheetHeader className="px-0 pt-2 pb-3">
        <SheetTitle className="text-base">Live sandbox</SheetTitle>
        <SheetDescription className="text-xs">
          Your project is running in an isolated Linux VM.
        </SheetDescription>
      </SheetHeader>

      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border/60 bg-muted/40">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-foreground">
          {ctx.sandboxUrl}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <SheetAction Icon={RefreshCw} label="Refresh" onClick={refresh} />
        <SheetAction
          Icon={Copy}
          label="Copy URL"
          onClick={() => {
            navigator.clipboard.writeText(ctx.sandboxUrl!);
            toast.success("URL copied");
            onClose();
          }}
        />
        <SheetAction
          Icon={ExternalLink}
          label="Open"
          onClick={() => {
            globalThis.open(ctx.sandboxUrl!, "_blank");
            onClose();
          }}
        />
      </div>
    </div>
  );
}

function ActionsSheetBody({
  sessionId,
  primaryActions,
  overflowActions,
}: {
  sessionId: string;
  primaryActions?: React.ReactNode;
  overflowActions?: React.ReactNode;
}) {
  const ctx = useChat();

  return (
    <div className="px-4 pb-2 pt-1">
      <SheetHeader className="px-0 pt-2 pb-3">
        <SheetTitle className="text-base">Project actions</SheetTitle>
        <SheetDescription className="text-xs">
          Share, deploy, or download your project.
        </SheetDescription>
      </SheetHeader>

      {/* Page-injected action buttons. We force each to a full-width row so
          the sheet reads like Lovable / Vercel mobile menus — one tappable
          row per action. */}
      <div className="flex flex-col gap-1 [&_button]:!h-12 [&_button]:!w-full [&_button]:!justify-start [&_button]:!text-sm [&_button]:!rounded-xl [&_button]:!px-3 [&_button]:!gap-2.5">
        {primaryActions}
        {overflowActions}
      </div>

      <div className="mt-4 border-t border-border/60 pt-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2 px-1">
          Session
        </div>
        <div className="flex flex-col gap-1">
          <SheetClose asChild>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(sessionId);
                toast.success("Session id copied");
              }}
              className="flex h-12 w-full items-center gap-2.5 rounded-xl px-3 text-sm hover:bg-muted/60 transition-colors text-left"
            >
              <Copy className="h-4 w-4 text-muted-foreground" />
              <span>Copy session id</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {sessionId.slice(0, 6)}
              </span>
            </button>
          </SheetClose>
          {ctx.sandboxUrl && (
            <SheetClose asChild>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(ctx.sandboxUrl!);
                  toast.success("Sandbox URL copied");
                }}
                className="flex h-12 w-full items-center gap-2.5 rounded-xl px-3 text-sm hover:bg-muted/60 transition-colors text-left"
              >
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span>Copy sandbox URL</span>
              </button>
            </SheetClose>
          )}
        </div>
      </div>
    </div>
  );
}

function SheetAction({
  Icon,
  label,
  onClick,
}: {
  Icon: typeof RefreshCw;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl border border-border/60 bg-muted/30 hover:bg-muted/60 transition-colors text-xs font-medium"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      {label}
    </button>
  );
}

// ─── Desktop URL chip (preview pane only) ───────────────────────────────

function DesktopUrlBar() {
  const ctx = useChat();
  if (!ctx.sandboxUrl) return null;

  const refresh = () => {
    ctx.setIframeLoading(true);
    const iframe = document.querySelector(
      'iframe[title="Sandbox Preview"]',
    ) as HTMLIFrameElement | null;
    if (iframe) {
      const s = iframe.src;
      iframe.src = "";
      setTimeout(() => {
        iframe.src = s;
      }, 0);
    }
  };

  return (
    <div className="flex items-center gap-1.5 px-4 pb-2 pt-0">
      <button
        type="button"
        onClick={refresh}
        className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
        title="Refresh preview"
        aria-label="Refresh preview"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
      <div className="flex-1 min-w-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 bg-background/70 text-sm">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        <span className="flex-1 min-w-0 truncate font-mono text-xs text-muted-foreground">
          {ctx.sandboxUrl}
        </span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(ctx.sandboxUrl!);
            toast.success("URL copied");
          }}
          className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
          title="Copy URL"
          aria-label="Copy URL"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={() => globalThis.open(ctx.sandboxUrl!, "_blank")}
        className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
        title="Open in new tab"
        aria-label="Open in new tab"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
