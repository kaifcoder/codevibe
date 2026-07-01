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
}

interface ImportGithubDialogProps {
  className?: string;
}

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
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.fullName.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    );
  }, [repos, search]);

  const handleTriggerClick = () => {
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    setOpen(true);
  };

  const handleSelect = (repo: RepoSummary) => {
    if (importing) return;
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
        <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-4 w-4" /> Import a GitHub repository
          </DialogTitle>
          <DialogDescription>
            Pick one of your public repositories. We&apos;ll clone it into a fresh
            sandbox, install dependencies, and start the dev server.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search repositories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            disabled={loading || !!error}
          />
        </div>

        <ScrollArea className="h-80 -mx-1 px-1">
          {loading ? (
            <div className="space-y-2 py-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={`repo-skeleton-${i}`}
                  className="flex flex-col gap-2 rounded-lg border border-border/50 p-3"
                >
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <AlertCircle className="h-8 w-8 text-destructive/80" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" onClick={loadRepos} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Try again
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <Github className="h-8 w-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                {repos.length === 0
                  ? "No public repositories found on your account."
                  : "No repositories match your search."}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5 py-1">
              {filtered.map((repo) => {
                const isImporting = importing === repo.fullName;
                return (
                  <button
                    key={repo.fullName}
                    type="button"
                    onClick={() => handleSelect(repo)}
                    disabled={!!importing}
                    className={cn(
                      "group/repo flex w-full flex-col gap-1 rounded-lg border border-border/50 p-3 text-left transition-all",
                      "hover:border-blue-500/50 hover:bg-muted/50",
                      "disabled:pointer-events-none disabled:opacity-50",
                      isImporting && "border-blue-500/60 bg-muted/50 opacity-100",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {repo.private ? (
                        <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                      ) : (
                        <Github className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-sm font-medium">{repo.name}</span>
                      {repo.language && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {repo.language}
                        </span>
                      )}
                      {repo.stars > 0 && (
                        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
                          <Star className="h-3 w-3" />
                          {repo.stars}
                        </span>
                      )}
                      <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                        {isImporting ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Opening…
                          </>
                        ) : (
                          <>
                            <GitBranch className="h-3 w-3" />
                            {repo.defaultBranch}
                          </>
                        )}
                      </span>
                    </div>
                    {repo.description && (
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {repo.description}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground/70">
                      Updated {formatRelative(repo.updatedAt)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
