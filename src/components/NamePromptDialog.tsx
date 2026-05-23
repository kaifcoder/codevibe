"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useChat } from "@/contexts/chat-context";

export function NamePromptDialog() {
  const { displayName, setDisplayName, isClerkAuthed, shareToken, isAuthLoaded } = useChat();
  const [value, setValue] = useState("");

  // Only ever prompt on shared-session URLs. Owners (no token) keep their
  // Clerk name. Wait for Clerk to hydrate so the dialog doesn't flash for
  // an authenticated collaborator before isSignedIn resolves.
  const open = !!shareToken && isAuthLoaded && !isClerkAuthed && !displayName;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setDisplayName(trimmed);
  };

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Pick a display name</DialogTitle>
          <DialogDescription>
            Other people in this room will see this name next to your cursor.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="e.g. Alex"
          value={value}
          maxLength={32}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <DialogFooter>
          <Button onClick={submit} disabled={!value.trim()}>
            Join room
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
