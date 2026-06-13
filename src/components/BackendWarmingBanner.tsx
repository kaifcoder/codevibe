"use client";

import { useEffect, useState } from "react";

interface BackendWarmingBannerProps {
  warming: boolean;
}

// Soft banner shown while the LangGraph dyno is cold-starting. Non-blocking —
// users can still type a prompt and queue it; handleSend will await readiness
// before submitting. Counts elapsed seconds so the wait feels intentional
// instead of frozen.
export function BackendWarmingBanner({ warming }: BackendWarmingBannerProps) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!warming) {
      setSeconds(0);
      return;
    }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [warming]);

  if (!warming) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs border-b bg-amber-500/10 text-amber-700 dark:text-amber-300">
      <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span>
        Waking up the backend… first send may take ~30s
        {seconds > 0 ? ` (${seconds}s)` : ""}
      </span>
    </div>
  );
}
