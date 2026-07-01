"use client";

import { useState } from "react";
import {
  Loader2,
  ExternalLink,
  Plug,
  GitBranch,
  CheckCircle2,
  ArrowUpRight,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
// The `Github` brand icon is marked @deprecated in lucide-react (brand marks
// slated for removal in v1.0), but it's still the right glyph for a "push
// to GitHub" action. Aliased so the deprecation notice is scoped to this
// one import line and doesn't pepper every JSX use.
import { Github as GithubIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useChat } from "@/contexts/chat-context";
import { cn } from "@/lib/utils";

interface GithubButtonProps {
  sessionId: string;
}

interface PushResponse {
  ok: boolean;
  repo: string;
  branch: string;
  url: string;
  commitUrl: string;
  created: boolean;
  error?: string;
}

// Optimistic-progress phases for the push flow. The API is one call, so we
// approximate progress with a rolling label — the user gets motion instead of
// staring at a static spinner while `git add -A` walks the tree.
const PUSH_PHASES = [
  "Staging changes",
  "Compressing objects",
  "Uploading to GitHub",
  "Finishing up",
] as const;

export function GithubButton({ sessionId }: Readonly<GithubButtonProps>) {
  const ctx = useChat();
  const linked = !!ctx.githubRepo;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // 0-indexed into PUSH_PHASES; -1 = idle. Bumps forward on a timer while a
  // push is in flight so the dialog feels alive.
  const [pushPhase, setPushPhase] = useState<number>(-1);

  // Linked-mode state.
  const [commitMessage, setCommitMessage] = useState("");

  // Unlinked-mode state — just a repo name. "Import existing" was removed
  // because this button lives inside an active chat where a project is
  // already open in the sandbox; importing would silently replace it.
  const [repoName, setRepoName] = useState("");

  const disabled =
    !ctx.isClerkAuthed
    || (!ctx.sandboxId && !linked)
    || ctx.isSandboxExpired;

  const titleText = (() => {
    if (!ctx.isClerkAuthed) return "Sign in to push to GitHub";
    if (ctx.isSandboxExpired) return "Restore the sandbox before using GitHub";
    if (linked) return `Push to ${ctx.githubRepo}`;
    return "Push this project to a new GitHub repository";
  })();

  const branchLabel = ctx.githubBranch || "main";

  // Steps forward through the fake phase labels while a real push runs. The
  // last phase sticks — we don't want it to loop back to "Staging" if the
  // API is slow, that would be a lie. Timings roughly match the real work:
  // stage/commit finish quickly (~600ms combined) and upload is the long
  // tail, so we linger there rather than racing to "Finishing up".
  const PHASE_DELAYS = [400, 700, 2000] as const; // gap AFTER phases 0, 1, 2
  function startProgressAnimation(): () => void {
    setPushPhase(0);
    let phase = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const step = () => {
      if (phase >= PUSH_PHASES.length - 1) return;
      const delay = PHASE_DELAYS[phase] ?? 1500;
      timers.push(
        setTimeout(() => {
          phase += 1;
          setPushPhase(phase);
          step();
        }, delay),
      );
    };
    step();
    return () => {
      timers.forEach(clearTimeout);
      setPushPhase(-1);
    };
  }

  async function handleCommit() {
    if (!commitMessage.trim()) {
      toast.error("Add a commit message first");
      return;
    }
    setBusy(true);
    const stopProgress = startProgressAnimation();
    const t = toast.loading(`Pushing to ${ctx.githubRepo}…`);
    try {
      const res = await fetch("/api/github/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "commit",
          sessionId,
          message: commitMessage.trim(),
        }),
      });
      const data = (await res.json()) as PushResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || `Push failed (${res.status})`);
      toast.success(
        <span className="flex items-center gap-1.5">
          Pushed to {data.repo}
          <a
            href={data.commitUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            view
            <ExternalLink className="h-3 w-3" />
          </a>
        </span>,
        { id: t, duration: 8_000 },
      );
      setCommitMessage("");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Push failed", { id: t });
    } finally {
      stopProgress();
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (!repoName.trim()) {
      toast.error("Repo name is required");
      return;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(repoName.trim())) {
      toast.error("Use letters, numbers, dot, underscore, dash only");
      return;
    }
    setBusy(true);
    const stopProgress = startProgressAnimation();
    const t = toast.loading("Creating repo & pushing…");
    try {
      const res = await fetch("/api/github/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "create",
          sessionId,
          name: repoName.trim(),
        }),
      });
      const data = (await res.json()) as PushResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || `Create failed (${res.status})`);
      ctx.setGithubRepo(data.repo);
      ctx.setGithubBranch(data.branch);
      toast.success(
        <span className="flex items-center gap-1.5">
          Created {data.repo}
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            open
            <ExternalLink className="h-3 w-3" />
          </a>
        </span>,
        { id: t, duration: 8_000 },
      );
      setRepoName("");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed", { id: t });
    } finally {
      stopProgress();
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    // Persist the disconnect to the session row — a UI-only clear reverts
    // on refresh because the page rehydrates githubRepo/githubBranch from
    // the DB. Optimistically clear the UI first so the dialog closes
    // instantly; if the PATCH fails we surface the error and restore.
    const prevRepo = ctx.githubRepo;
    const prevBranch = ctx.githubBranch;
    ctx.setGithubRepo(null);
    ctx.setGithubBranch(null);
    setOpen(false);
    try {
      const res = await fetch(`/api/session/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubRepo: null, githubBranch: null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Disconnect failed (${res.status})`);
      }
      toast.message("Disconnected from GitHub");
    } catch (err) {
      // Roll back so the user isn't stranded with a lie in the UI.
      ctx.setGithubRepo(prevRepo);
      ctx.setGithubBranch(prevBranch);
      toast.error(err instanceof Error ? err.message : "Disconnect failed");
    }
  }

  const activePhase = pushPhase >= 0 ? PUSH_PHASES[pushPhase] : null;

  // We don't have the GitHub username in ctx — display a neutral placeholder
  // in the create preview. The server route uses the OAuth token to resolve
  // the actual owner, so this is purely cosmetic.
  const clerkUsername = "your-account";

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        className="gap-1.5 text-xs"
        title={titleText}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <GithubIcon className="h-3.5 w-3.5" />
        )}
        {linked ? "Push" : "Connect to GitHub"}
      </Button>

      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
          {linked ? (
            <>
              {/* Linked header — the repo link is the star of the show. */}
              <div className="relative overflow-hidden border-b border-border/60 bg-linear-to-br from-muted/40 via-background to-background px-6 pt-6 pb-5">
                <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl" />
                <DialogHeader className="space-y-2 relative">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/80 shadow-sm">
                      <GithubIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <DialogTitle className="text-base font-semibold leading-tight">
                        Push to GitHub
                      </DialogTitle>
                      <DialogDescription className="text-xs text-muted-foreground leading-snug">
                        Stages the sandbox tree, commits, and pushes to the linked repo.
                      </DialogDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <a
                      href={`https://github.com/${ctx.githubRepo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 font-mono text-[11px] text-foreground hover:border-border transition-colors"
                    >
                      <GithubIcon className="h-3 w-3" />
                      {ctx.githubRepo}
                      <ExternalLink className="h-2.5 w-2.5 text-muted-foreground" />
                    </a>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[11px] font-mono text-muted-foreground">
                      <GitBranch className="h-3 w-3" />
                      {branchLabel}
                    </span>
                  </div>
                </DialogHeader>
              </div>

              <div className="px-6 py-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="commit-message" className="text-xs font-medium">
                    Commit message
                  </Label>
                  <Input
                    id="commit-message"
                    placeholder="Update from CodeVibe"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !busy) handleCommit();
                    }}
                    disabled={busy}
                    className="h-9 bg-muted/30 border-border/60 focus-visible:ring-1 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/40"
                    autoFocus
                  />
                  <p className="text-[11px] text-muted-foreground leading-snug pt-0.5">
                    Cache dirs like <span className="font-mono">node_modules</span>,{" "}
                    <span className="font-mono">.next</span>, and{" "}
                    <span className="font-mono">.cache</span> are skipped automatically
                    for a fast push.
                  </p>
                </div>

                {/* Progress bar / phase label — only visible while a push is
                    running. Gives the user a real sense of forward motion. */}
                {busy && activePhase && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-[12px] font-medium">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
                      <span>{activePhase}…</span>
                    </div>
                    <div className="flex gap-1">
                      {PUSH_PHASES.map((_, i) => (
                        <div
                          key={i}
                          className={cn(
                            "h-1 flex-1 rounded-full transition-colors",
                            i <= pushPhase
                              ? "bg-emerald-500/80"
                              : "bg-emerald-500/15",
                          )}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="px-6 py-3 border-t border-border/60 bg-muted/20 flex items-center gap-2 sm:justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={busy}
                  className="gap-1.5 h-8 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Plug className="h-3.5 w-3.5" />
                  Disconnect
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpen(false)}
                    disabled={busy}
                    className="h-8 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleCommit}
                    disabled={busy || !commitMessage.trim()}
                    className="h-8 text-xs gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    )}
                    Push
                  </Button>
                </div>
              </DialogFooter>
            </>
          ) : (
            <>
              {/* Unlinked — this button is opened from an active chat where
                  a project already exists in the sandbox. The only action
                  that makes sense here is "publish it to a new GitHub repo",
                  so we skip the tabs entirely and land straight on the
                  create-and-push flow. */}
              <div className="relative overflow-hidden border-b border-border/60 bg-linear-to-br from-muted/40 via-background to-background px-6 pt-6 pb-5">
                <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-blue-500/10 blur-3xl" />
                <DialogHeader className="space-y-2 relative">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/80 shadow-sm">
                      <GithubIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <DialogTitle className="text-base font-semibold leading-tight">
                        Publish to GitHub
                      </DialogTitle>
                      <DialogDescription className="text-xs text-muted-foreground leading-snug">
                        Create a new repository and push this project as its first commit.
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>
              </div>

              <div className="px-6 py-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="repo-name" className="text-xs font-medium">
                    Repository name
                  </Label>
                  <Input
                    id="repo-name"
                    placeholder="my-codevibe-project"
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !busy) handleCreate();
                    }}
                    disabled={busy}
                    className="h-9 bg-muted/30 border-border/60 font-mono text-xs focus-visible:ring-1 focus-visible:ring-blue-500/40 focus-visible:border-blue-500/40"
                    autoFocus
                  />
                  <p className="text-[11px] text-muted-foreground/80 pl-0.5">
                    Will be created at{" "}
                    <span className="font-mono text-muted-foreground">
                      github.com/{clerkUsername}/{repoName.trim() || "…"}
                    </span>
                  </p>
                </div>

                {/* Bulleted plan — makes the two-step nature explicit so
                    the user isn't surprised when the button "creates &
                    pushes" in a single click. */}
                <ul className="space-y-1.5 rounded-lg border border-border/50 bg-muted/20 p-3 text-[11px] text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                    <span>Creates a public repo under your account</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                    <span>Initializes git in the sandbox and pushes the current state</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-blue-500" />
                    <span>
                      Token is scoped to this push — never written to{" "}
                      <span className="font-mono">.git/config</span>
                    </span>
                  </li>
                </ul>

                {busy && activePhase && (
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-[12px] font-medium">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                      <span>{activePhase}…</span>
                    </div>
                    <div className="flex gap-1">
                      {PUSH_PHASES.map((_, i) => (
                        <div
                          key={i}
                          className={cn(
                            "h-1 flex-1 rounded-full transition-colors",
                            i <= pushPhase ? "bg-blue-500/80" : "bg-blue-500/15",
                          )}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="px-6 py-3 border-t border-border/60 bg-muted/20 flex items-center gap-2 sm:justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={busy || !repoName.trim()}
                  className="h-8 text-xs gap-1.5"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Create &amp; push
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
