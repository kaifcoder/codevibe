"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useChat } from "@/contexts/chat-context";

export function NamePromptDialog() {
  const { displayName, setDisplayName, isClerkAuthed } = useChat();
  const [value, setValue] = useState("");

  const open = !displayName && !isClerkAuthed;

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
