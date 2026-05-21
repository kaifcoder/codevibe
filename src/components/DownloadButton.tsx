"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { useChat } from "@/contexts/chat-context";

interface DownloadButtonProps {
  sessionId: string;
}

export function DownloadButton({ sessionId }: Readonly<DownloadButtonProps>) {
  const { sandboxId, shareToken, isSandboxExpired } = useChat();
  const [downloading, setDownloading] = useState(false);

  const disabled = !sandboxId || isSandboxExpired || downloading;

  const handleDownload = async () => {
    if (disabled) return;
    setDownloading(true);
    try {
      const res = await fetch("/api/download-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          shareToken: shareToken ?? undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Download failed");
      }

      const blob = await res.blob();
      const dispo = res.headers.get("Content-Disposition") || "";
      const match = /filename="?([^";]+)"?/.exec(dispo);
      const filename = match?.[1] || "codevibe-project.zip";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Project downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleDownload}
      disabled={disabled}
      className="gap-1.5 text-xs"
      title={
        !sandboxId
          ? "No sandbox to download"
          : isSandboxExpired
            ? "Sandbox expired"
            : "Download project as zip"
      }
    >
      {downloading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      Download
    </Button>
  );
}
