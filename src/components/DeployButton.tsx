"use client";

import { useState } from "react";
import { Rocket, Loader2, ExternalLink } from "lucide-react";
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

interface DeployButtonProps {
  sessionId: string;
}

const TOKEN_KEY = "codevibe.vercelToken";

export function DeployButton({ sessionId }: Readonly<DeployButtonProps>) {
  const { sandboxId, shareToken, isSandboxExpired } = useChat();
  const [open, setOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [deploying, setDeploying] = useState(false);

  // Even if the sandbox is expired we can still deploy from the persisted
  // file tree + Yjs — only block if we have nothing at all (no sandbox id
  // ever attached) and we're mid-deploy.
  const disabled = (!sandboxId && !isSandboxExpired) || deploying;

  const runDeploy = async (token: string) => {
    setDeploying(true);
    const t = toast.loading("Deploying to Vercel…");
    try {
      const res = await fetch("/api/deploy-to-vercel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          shareToken: shareToken ?? undefined,
          vercelToken: token,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Stale token → clear it so the next click re-prompts.
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem(TOKEN_KEY);
        }
        throw new Error(body?.error || `Deploy failed (${res.status})`);
      }
      toast.success(
        <span className="flex items-center gap-1.5">
          {body.source === "yjs+db" ? "Deployed (from saved files)" : "Deployed"}
          {body.url && (
            <a
              href={body.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              {body.url.replace(/^https?:\/\//, "")}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </span>,
        { id: t, duration: 10_000 },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Deploy failed", { id: t });
    } finally {
      setDeploying(false);
    }
  };

  const handleClick = () => {
    if (disabled) return;
    const saved = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (saved) {
      void runDeploy(saved);
      return;
    }
    setTokenInput("");
    setOpen(true);
  };

  const handleSaveAndDeploy = () => {
    const t = tokenInput.trim();
    if (!t) {
      toast.error("Paste a Vercel token first");
      return;
    }
    localStorage.setItem(TOKEN_KEY, t);
    setOpen(false);
    void runDeploy(t);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleClick}
        disabled={disabled}
        className="gap-1.5 text-xs"
        title={
          !sandboxId && !isSandboxExpired
            ? "No project to deploy yet"
            : isSandboxExpired
              ? "Deploy from saved files (sandbox expired)"
              : "Deploy this project to Vercel"
        }
      >
        {deploying ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Rocket className="h-3.5 w-3.5" />
        )}
        Deploy
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Vercel</DialogTitle>
            <DialogDescription>
              Paste a Vercel access token to deploy this project. We store it in
              your browser only — it never leaves your device except to call
              Vercel via this app&apos;s server.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="vercel-token" className="text-xs">
              Vercel Access Token
            </Label>
            <Input
              id="vercel-token"
              type="password"
              autoComplete="off"
              placeholder="vercel_..."
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveAndDeploy();
              }}
            />
            <p className="text-xs text-muted-foreground">
              Create one at{" "}
              <a
                href="https://vercel.com/account/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                vercel.com/account/tokens
              </a>
              . Scope: Full Account.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveAndDeploy}>
              Save & Deploy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
