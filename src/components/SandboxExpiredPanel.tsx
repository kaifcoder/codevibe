"use client";

import { useState } from "react";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChat } from "@/contexts/chat-context";

type Phase = "idle" | "provisioning" | "error";

interface RewarmResponse {
  ok: boolean;
  sandboxId: string;
  sandboxUrl: string;
  templateType: "nextjs" | "n8n" | "chat";
  seeded?: { totalFiles: number; written: number; skipped: number };
  devReady?: "ready" | "timeout" | "fail" | "skipped";
  error?: string;
}

export function SandboxExpiredPanel() {
  const ctx = useChat();
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<{ totalFiles: number; written: number; skipped: number } | null>(null);
  const [devReady, setDevReady] = useState<RewarmResponse["devReady"] | null>(null);

  async function handleRestore() {
    setPhase("provisioning");
    setErrorMessage(null);
    setSeeded(null);
    setDevReady(null);
    try {
      const res = await fetch("/api/rewarm-sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: ctx.sessionId,
          shareToken: ctx.shareToken ?? undefined,
        }),
      });
      const data: RewarmResponse = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Restore failed (${res.status})`);
      }

      // Adopt the new sandbox: clear expiry, restart the 25-min timer, and
      // bring the iframe back. handleSend forwards ctx.sandboxId to the agent
      // via configurable, so the next prompt reuses this sandbox instead of
      // spinning up another one.
      ctx.setSandboxId(data.sandboxId);
      ctx.setSandboxUrl(data.sandboxUrl);
      ctx.setSandboxCreatedAt(Date.now());
      ctx.setIsSandboxExpired(false);
      ctx.setIframeLoading(true);
      ctx.setActiveTab("live preview");
      if (data.seeded) setSeeded(data.seeded);
      if (data.devReady) setDevReady(data.devReady);
      setPhase("idle");
    } catch (err) {
      setErrorMessage((err as Error).message);
      setPhase("error");
    }
  }

  const provisioning = phase === "provisioning";

  return (
    <div className="w-full h-full flex items-center justify-center p-8">
      <div className="max-w-md w-full rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm p-8 flex flex-col items-center text-center gap-5">
        <div className="h-14 w-14 rounded-full bg-amber-500/10 flex items-center justify-center">
          {provisioning ? (
            <Loader2 className="h-7 w-7 text-amber-500 animate-spin" />
          ) : (
            <RefreshCw className="h-7 w-7 text-amber-500" />
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-foreground">
            {provisioning ? "Restoring sandbox…" : "Sandbox went to sleep"}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {provisioning
              ? "Spinning up a fresh environment and re-seeding it with your saved files."
              : "Sandboxes hibernate after 25 minutes of inactivity. Your files are safe — restore the sandbox to keep building."}
          </p>
        </div>

        <Button
          onClick={handleRestore}
          disabled={provisioning}
          size="lg"
          className="w-full"
        >
          {provisioning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Restoring
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Restore sandbox
            </>
          )}
        </Button>

        {seeded && (
          <p className="text-xs text-muted-foreground">
            Wrote {seeded.written} changed file{seeded.written === 1 ? "" : "s"}
            {seeded.skipped > 0 ? `, ${seeded.skipped} unchanged` : ""}
            .
            {devReady && devReady !== "ready" && devReady !== "skipped" && (
              <>
                {" "}
                <span className="text-amber-500">
                  Dev server didn&apos;t come up cleanly — refresh the preview after a moment.
                </span>
              </>
            )}
          </p>
        )}

        {phase === "error" && errorMessage && (
          <div className="w-full rounded-md border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-2 text-left">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-xs text-destructive">
              <div className="font-medium">Restore failed</div>
              <div className="text-destructive/80 break-words">{errorMessage}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
