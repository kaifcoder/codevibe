"use client";

import { Share2, Check } from "lucide-react";
import { Button } from "./ui/button";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { toast } from "sonner";

interface ShareButtonProps {
  sessionId: string;
}

export function ShareButton({ sessionId }: Readonly<ShareButtonProps>) {
  const trpc = useTRPC();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const shareMutation = useMutation(
    trpc.session.shareSession.mutationOptions({
      onSuccess: (data) => {
        setShareUrl(data.shareUrl);
        toast.success("Share link generated!");
      },
      onError: (error) => {
        toast.error(`Failed to generate share link: ${error.message}`);
      },
    })
  );

  const handleShare = async () => {
    if (!shareUrl) {
      shareMutation.mutate({ id: sessionId });
    }
  };

  const copyToClipboard = async () => {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          onClick={handleShare}
          className="gap-2"
        >
          <Share2 className="h-4 w-4" />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Session</DialogTitle>
          <DialogDescription>
            Anyone with this link can view and collaborate on this session in
            real-time.
          </DialogDescription>
        </DialogHeader>
        {shareUrl ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input value={shareUrl} readOnly className="flex-1" />
              <Button
                onClick={copyToClipboard}
                variant="outline"
                className="gap-2"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    Copied
                  </>
                ) : (
                  "Copy"
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              This session is now public. Other users can edit code and see
              changes in real-time.
            </p>
          </div>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            Generating share link...
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
