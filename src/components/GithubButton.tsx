"use client";

import { useState } from "react";
import { Github, Loader2, ExternalLink, Plug, GitBranch } from "lucide-react";
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
import { Switch } from "./ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { useChat } from "@/contexts/chat-context";

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

interface ImportResponse {
  ok: boolean;
  sandboxId: string;
  sandboxUrl: string;
  repo: string;
  branch: string;
  templateType: "nextjs" | "n8n" | "chat";
  devReady: "ready" | "timeout" | "fail";
  error?: string;
}

export function GithubButton({ sessionId }: Readonly<GithubButtonProps>) {
  const ctx = useChat();
  const linked = !!ctx.githubRepo;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Linked-mode state.
  const [commitMessage, setCommitMessage] = useState("");

  // Unlinked-mode state.
  const [tab, setTab] = useState<"create" | "import">("create");
  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [importInput, setImportInput] = useState("");

  const disabled =
    !ctx.isClerkAuthed
    || (!ctx.sandboxId && !linked)
    || ctx.isSandboxExpired;

  const titleText = (() => {
    if (!ctx.isClerkAuthed) return "Sign in to push to GitHub";
    if (ctx.isSandboxExpired) return "Restore the sandbox before using GitHub";
    if (linked) return `Push to ${ctx.githubRepo}`;
    return "Connect a GitHub repository";
  })();

  async function handleCommit() {
    if (!commitMessage.trim()) {
      toast.error("Add a commit message first");
      return;
    }
    setBusy(true);
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
    const t = toast.loading("Creating repo & pushing…");
    try {
      const res = await fetch("/api/github/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "create",
          sessionId,
          name: repoName.trim(),
          isPrivate,
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
      setBusy(false);
    }
  }

  async function handleImport() {
    if (!importInput.trim()) {
      toast.error("Paste owner/name or a GitHub URL");
      return;
    }
    setBusy(true);
    const t = toast.loading("Importing repo into a fresh sandbox…");
    try {
      const res = await fetch("/api/github/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          repo: importInput.trim(),
        }),
      });
      const data = (await res.json()) as ImportResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || `Import failed (${res.status})`);

      // Adopt the new sandbox the same way SandboxExpiredPanel does — the
      // next agent run will forward this id via configurable.sandboxId so
      // resolveSandbox picks it up instead of spinning a duplicate.
      ctx.setSandboxId(data.sandboxId);
      ctx.setSandboxUrl(data.sandboxUrl);
      ctx.setSandboxCreatedAt(Date.now());
      ctx.setIsSandboxExpired(false);
      ctx.setIframeLoading(true);
      ctx.setShowSecondPanel(true);
      ctx.setActiveTab("live preview");
      ctx.setGithubRepo(data.repo);
      ctx.setGithubBranch(data.branch);

      toast.success(
        <span className="flex items-center gap-1.5">
          Imported {data.repo}
          {data.devReady !== "ready" && (
            <span className="text-amber-500">— dev server slow to boot</span>
          )}
        </span>,
        { id: t, duration: 8_000 },
      );
      setImportInput("");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed", { id: t });
    } finally {
      setBusy(false);
    }
  }

  function handleDisconnect() {
    // Local-only: clear the link in the UI. The session row keeps the link
    // until the next push (which will overwrite it). We don't expose a
    // server-side delete because reconnecting just means linking again, and
    // a stray "Disconnect" click would otherwise lose the repo association.
    ctx.setGithubRepo(null);
    ctx.setGithubBranch(null);
    setOpen(false);
    toast.message("Disconnected from GitHub for this view");
  }

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
          <Github className="h-3.5 w-3.5" />
        )}
        {linked ? "Push" : "GitHub"}
      </Button>

      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="sm:max-w-md">
          {linked ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Github className="h-4 w-4" /> Push to GitHub
                </DialogTitle>
                <DialogDescription className="flex items-center gap-1.5">
                  <span>Linked to</span>
                  <a
                    href={`https://github.com/${ctx.githubRepo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-xs underline underline-offset-2"
                  >
                    {ctx.githubRepo}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <span className="inline-flex items-center gap-1 ml-1 text-xs">
                    <GitBranch className="h-3 w-3" />
                    {ctx.githubBranch || "main"}
                  </span>
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-2">
                <Label htmlFor="commit-message" className="text-xs">
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
                />
                <p className="text-xs text-muted-foreground">
                  Stages everything in the sandbox, commits, and pushes to{" "}
                  <span className="font-mono">{ctx.githubBranch || "main"}</span>.
                </p>
              </div>
              <DialogFooter className="flex justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={busy}
                  className="gap-1.5"
                >
                  <Plug className="h-3.5 w-3.5" />
                  Disconnect
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleCommit} disabled={busy}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                    Push
                  </Button>
                </div>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Github className="h-4 w-4" /> Connect GitHub
                </DialogTitle>
                <DialogDescription>
                  Push this project to a new repository, or replace the sandbox
                  with an import of an existing one.
                </DialogDescription>
              </DialogHeader>

              <Tabs value={tab} onValueChange={(v) => setTab(v as "create" | "import")} className="pt-1">
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="create">Create new</TabsTrigger>
                  <TabsTrigger value="import">Import existing</TabsTrigger>
                </TabsList>

                <TabsContent value="create" className="space-y-3 pt-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="repo-name" className="text-xs">
                      Repository name
                    </Label>
                    <Input
                      id="repo-name"
                      placeholder="my-codevibe-project"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2">
                    <Label htmlFor="repo-private" className="text-xs cursor-pointer">
                      Private repository
                    </Label>
                    <Switch
                      id="repo-private"
                      checked={isPrivate}
                      onCheckedChange={setIsPrivate}
                      disabled={busy}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Creates the repo under your account, initializes git in the
                    sandbox, and pushes the current state as the first commit.
                  </p>
                  <DialogFooter>
                    <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleCreate} disabled={busy}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                      Create &amp; push
                    </Button>
                  </DialogFooter>
                </TabsContent>

                <TabsContent value="import" className="space-y-3 pt-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="repo-import" className="text-xs">
                      Repository (owner/name or URL)
                    </Label>
                    <Input
                      id="repo-import"
                      placeholder="kaifcoder/my-app"
                      value={importInput}
                      onChange={(e) => setImportInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !busy) handleImport();
                      }}
                      disabled={busy}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Provisions a fresh sandbox, clones the repo into it, runs
                    <span className="font-mono"> npm install</span>, and starts
                    the dev server. Replaces the current sandbox.
                  </p>
                  <DialogFooter>
                    <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleImport} disabled={busy}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                      Import
                    </Button>
                  </DialogFooter>
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
