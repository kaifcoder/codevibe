"use client";

import { X } from "lucide-react";

interface QueueEntry {
  id: string;
  values?: { messages?: { text?: string; content?: string } | Array<{ type: string; content: string }> };
}

export interface MessageQueue {
  size: number;
  entries: QueueEntry[];
  clear: () => Promise<void>;
  cancel: (id: string) => Promise<void>;
}

function getEntryText(entry: QueueEntry): string {
  if (!entry.values || !("messages" in entry.values) || !entry.values.messages) return "Pending…";
  const msgs = entry.values.messages;
  if (Array.isArray(msgs)) {
    const human = msgs.find((m) => m.type === "human");
    return human?.content?.slice(0, 60) || "Pending…";
  }
  if (typeof msgs === "object" && msgs !== null) {
    return (msgs as { text?: string; content?: string }).text || (msgs as { content?: string }).content?.slice(0, 60) || "Pending…";
  }
  return "Pending…";
}

export function QueueList({ queue }: { queue: MessageQueue | undefined }) {
  if (!queue || queue.size === 0) return null;

  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-muted-foreground font-medium">
          {queue.size} queued
        </span>
        {queue.entries.slice(0, 3).map((entry) => (
          <span key={entry.id} className="text-muted-foreground/70 truncate max-w-[120px]">
            {getEntryText(entry)}
          </span>
        ))}
        <button
          type="button"
          onClick={() => void queue.clear()}
          className="ml-1 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
          title="Clear queue"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
