"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useClerk } from "@clerk/nextjs";
import {
  Github,
  Loader2,
  Search,
  Star,
  Lock,
  GitBranch,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  Sparkles,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface RepoSummary {
  fullName: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  updatedAt: string;
  language: string | null;
  private: boolean;
  htmlUrl: string;
  stars: number;
  // Server-tagged: `false` means the language isn't in the Node/web-app
  // allowlist, so importing will almost certainly fail on dev-server boot.
  // We hide these by default and expose a "Show unsupported" toggle.
  supported: boolean;
}

interface ImportGithubDialogProps {
  className?: string;
}

// Tiny visual palette for the language dot. Anything not in the map falls
// back to a neutral muted swatch so the row still reads.
const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "bg-blue-500",
  JavaScript: "bg-yellow-400",
  Python: "bg-emerald-500",
  Go: "bg-cyan-500",
  Rust: "bg-orange-500",
  Ruby: "bg-red-500",
  Java: "bg-red-400",
  Kotlin: "bg-purple-500",
  Swift: "bg-orange-400",
  "C++": "bg-pink-500",
  C: "bg-slate-500",
  "C#": "bg-violet-500",
  HTML: "bg-orange-500",
  CSS: "bg-blue-400",
  Shell: "bg-lime-500",
  PHP: "bg-indigo-400",
  Vue: "bg-emerald-400",
  Svelte: "bg-orange-500",
};

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export function ImportGithubDialog({ className }: Readonly<ImportGithubDialogProps>) {
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { openSignIn } = useClerk();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  // Off by default — unsupported repos would fail on `npm install && next
  // dev`, so we surface them only when the user opts in.
  const [showUnsupported, setShowUnsupported] = useState(false);

  const loadRepos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/github/repos", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      setRepos(Array.isArray(data.repos) ? data.repos : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load repositories");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch the repo list the first time the dialog opens (and whenever it's
  // reopened after an error left the list empty).
  useEffect(() => {
    if (open && isSignedIn && repos.length === 0 && !loading && !error) {
      void loadRepos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isSignedIn]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = showUnsupported ? repos : repos.filter((r) => r.supported);
    if (!q) return base;
    return base.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.fullName.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    );
  }, [repos, search, showUnsupported]);

  const hiddenCount = useMemo(
    () => repos.filter((r) => !r.supported).length,
    [repos],
  );

  const handleTriggerClick = () => {
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    setOpen(true);
  };

  const handleSelect = (repo: RepoSummary) => {
    if (importing) return;
    if (!repo.supported) return;
    setImporting(repo.fullName);
    // Hand the repo off to a fresh chat session via URL param — the chat page
    // creates the session, clones the repo into a sandbox, and boots the dev
    // server, mirroring the in-chat "Import existing" flow.
    const chatId = crypto.randomUUID();
    router.push(`/chat/${chatId}?importRepo=${encodeURIComponent(repo.fullName)}`);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={handleTriggerClick}
        className={cn(
          "group/gh flex items-center gap-2 h-auto px-4 py-2 rounded-full border-border/60 bg-muted/40 hover:bg-muted/70 hover:border-blue-500/40 text-muted-foreground hover:text-foreground transition-all duration-200 text-sm font-normal backdrop-blur-sm",
          className,
        )}
      >
        <Github className="w-4 h-4" />
        <span>Import from GitHub</span>
      </Button>

      <Dialog open={open} onOpenChange={(v) => !importing && setOpen(v)}>
        <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
          {/* Header — subtle gradient wash + iconography set the tone before
              the list even loads. */}
          <div className="relative overflow-hidden border-b border-border/60 bg-linear-to-br from-muted/40 via-background to-background px-6 pt-6 pb-5">
            <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-blue-500/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-emerald-500/5 blur-3xl" />
            <DialogHeader className="space-y-2 relative">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/80 shadow-sm">
                  <Github className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <DialogTitle className="text-base font-semibold leading-tight">
                    Import from GitHub
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground leading-snug">
                    Clone a repo into a fresh sandbox — deps installed, dev server booted.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="px-6 py-4 space-y-3">
            {/* Search + count row. The count updates as the user types, so
                filtering feels responsive without a spinner. */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search your repositories"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 bg-muted/30 border-border/60 focus-visible:ring-1 focus-visible:ring-blue-500/40 focus-visible:border-blue-500/40"
                  disabled={loading || !!error}
                  autoFocus
                />
              </div>
              {!loading && !error && repos.length > 0 && (
                <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground tabular-nums whitespace-nowrap">
                  <span className="tabular-nums">{filtered.length}</span>
                  <span className="text-muted-foreground/60">
                    {filtered.length === 1 ? "repo" : "repos"}
                  </span>
                </div>
              )}
            </div>

            {/* Compatibility banner — appears only when we're actually
                hiding something, so it doesn't add noise for JS/TS-only
                accounts. */}
            {!loading && !error && hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowUnsupported((v) => !v)}
                className="flex w-full items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-muted/40"
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                    showUnsupported
                      ? "border-blue-500/60 bg-blue-500/15 text-blue-500"
                      : "border-border/60 bg-background",
                  )}
                >
                  {showUnsupported && (
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  )}
                </span>
                <span className="flex-1 leading-snug">
                  {showUnsupported ? (
                    <>
                      Showing all repositories, including{" "}
                      <span className="text-foreground font-medium">
                        {hiddenCount}
                      </span>{" "}
                      that may not boot as a Next.js sandbox.
                    </>
                  ) : (
                    <>
                      Hiding{" "}
                      <span className="text-foreground font-medium">
                        {hiddenCount}
                      </span>{" "}
                      {hiddenCount === 1 ? "repo" : "repos"} we can&apos;t run as a
                      Next.js sandbox. Tap to show anyway.
                    </>
                  )}
                </span>
              </button>
            )}

            <ScrollArea className="h-88 -mx-2 px-2">
              {loading ? (
                <div className="space-y-1.5 py-0.5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={`repo-skeleton-${i}`}
                      className="flex flex-col gap-2 rounded-lg border border-border/50 bg-muted/10 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-3.5 w-3.5 rounded-full" />
                        <Skeleton className="h-3.5 w-32" />
                        <Skeleton className="ml-auto h-3 w-12" />
                      </div>
                      <Skeleton className="h-2.5 w-64" />
                      <Skeleton className="h-2 w-20" />
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 px-6 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-destructive/30 bg-destructive/5">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Couldn&apos;t load repositories</p>
                    <p className="text-xs text-muted-foreground max-w-xs">{error}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={loadRepos} className="gap-1.5 h-8">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Try again
                  </Button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex h-full min-h-72 flex-col items-center justify-center gap-2.5 px-6 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-muted/30">
                    <Github className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {repos.length === 0
                        ? "No repositories yet"
                        : "No matches"}
                    </p>
                    <p className="text-xs text-muted-foreground max-w-xs">
                      {repos.length === 0
                        ? "We couldn't find any public repositories on your GitHub account."
                        : `Nothing matches “${search}”. Try a shorter query.`}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1 py-0.5">
                  {filtered.map((repo) => {
                    const isImporting = importing === repo.fullName;
                    const isDimmed = !!importing && !isImporting;
                    const isUnsupported = !repo.supported;
                    const languageColor = repo.language
                      ? LANGUAGE_COLORS[repo.language] ?? "bg-muted-foreground/50"
                      : null;
                    return (
                      <button
                        key={repo.fullName}
                        type="button"
                        onClick={() => handleSelect(repo)}
                        disabled={!!importing || isUnsupported}
                        title={
                          isUnsupported
                            ? `We can't currently boot a ${repo.language ?? "non-Node"} project as a sandbox`
                            : undefined
                        }
                        className={cn(
                          "group/repo relative flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-all",
                          "hover:border-border/70 hover:bg-muted/40",
                          "focus-visible:outline-none focus-visible:border-blue-500/50 focus-visible:bg-muted/40",
                          "disabled:cursor-not-allowed",
                          isDimmed && "opacity-40",
                          isUnsupported && "opacity-60 hover:border-transparent hover:bg-transparent",
                          isImporting &&
                            "border-blue-500/40 bg-blue-500/4 shadow-[0_0_0_1px_rgba(59,130,246,0.15)]",
                        )}
                      >
                        {/* Icon column keeps the row skimmable. Private repos
                            get an amber lock so at-a-glance triage works;
                            unsupported repos wear a muted "ban" glyph. */}
                        <div
                          className={cn(
                            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background transition-colors",
                            "group-hover/repo:border-border group-hover/repo:bg-muted",
                            isImporting && "border-blue-500/40 bg-blue-500/10",
                            isUnsupported && "group-hover/repo:border-border/60 group-hover/repo:bg-background",
                          )}
                        >
                          {isUnsupported ? (
                            <Ban className="h-3.5 w-3.5 text-muted-foreground/60" />
                          ) : repo.private ? (
                            <Lock className="h-3.5 w-3.5 text-amber-500" />
                          ) : (
                            <Github className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {repo.name}
                            </span>
                            {repo.private && (
                              <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium leading-none text-amber-600 dark:text-amber-400">
                                Private
                              </span>
                            )}
                            {isUnsupported && (
                              <span className="shrink-0 rounded-full border border-border/60 bg-muted/40 px-1.5 py-px text-[10px] font-medium leading-none text-muted-foreground">
                                Not supported
                              </span>
                            )}
                          </div>

                          {repo.description ? (
                            <p className="line-clamp-1 text-xs text-muted-foreground">
                              {repo.description}
                            </p>
                          ) : (
                            <p className="text-xs italic text-muted-foreground/60">
                              No description
                            </p>
                          )}

                          <div className="flex items-center gap-3 pt-0.5 text-[11px] text-muted-foreground/80">
                            {repo.language && languageColor && (
                              <span className="flex items-center gap-1.5">
                                <span className={cn("h-2 w-2 rounded-full", languageColor)} />
                                <span>{repo.language}</span>
                              </span>
                            )}
                            {repo.stars > 0 && (
                              <span className="flex items-center gap-1">
                                <Star className="h-3 w-3" />
                                <span className="tabular-nums">
                                  {repo.stars >= 1000
                                    ? `${(repo.stars / 1000).toFixed(1)}k`
                                    : repo.stars}
                                </span>
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <GitBranch className="h-3 w-3" />
                              <span className="truncate max-w-32">
                                {repo.defaultBranch}
                              </span>
                            </span>
                            <span className="ml-auto text-muted-foreground/60">
                              {formatRelative(repo.updatedAt)}
                            </span>
                          </div>
                        </div>

                        {/* Trailing indicator — imported: spinner + label;
                            hover: subtle arrow to invite click. Unsupported
                            rows stay silent — no arrow to imply action. */}
                        <div className="flex shrink-0 items-center self-center pl-1">
                          {isImporting ? (
                            <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Opening
                            </span>
                          ) : isUnsupported ? null : (
                            <ArrowRight className="h-4 w-4 text-muted-foreground/0 transition-all group-hover/repo:text-muted-foreground group-hover/repo:translate-x-0.5" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Footer keeps the dialog feeling finished — a hint about what
              happens next removes the "will anything even happen?" pause. */}
          <div className="border-t border-border/60 bg-muted/20 px-6 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Sparkles className="h-3 w-3 text-muted-foreground/70" />
                <span>Sandbox spins up in a few seconds</span>
              </div>
              <div className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground/70">
                <kbd className="rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[10px] shadow-sm">
                  Esc
                </kbd>
                <span>to close</span>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
