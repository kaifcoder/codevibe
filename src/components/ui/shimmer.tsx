"use client";

import { cn } from "@/lib/utils";

interface ShimmerProps {
  className?: string;
}

export function Shimmer({ className }: Readonly<ShimmerProps>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-muted",
        className
      )}
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </div>
  );
}

export function PreviewShimmer() {
  return (
    <div className="w-full h-full flex flex-col bg-background p-4 gap-4 animate-in fade-in duration-300">
      {/* Content area */}
      <div className="flex-1 flex flex-col gap-4">
        {/* Header shimmer */}
        <div className="flex items-center gap-3">
          <Shimmer className="w-10 h-10 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Shimmer className="h-4 w-3/4 rounded" />
            <Shimmer className="h-3 w-1/2 rounded" />
          </div>
        </div>

        {/* Hero area */}
        <Shimmer className="w-full h-40 rounded-lg" />

        {/* Content blocks */}
        <div className="grid grid-cols-3 gap-3">
          <Shimmer className="h-24 rounded-lg" />
          <Shimmer className="h-24 rounded-lg" />
          <Shimmer className="h-24 rounded-lg" />
        </div>

        {/* Text content */}
        <div className="space-y-2 mt-2">
          <Shimmer className="h-3 w-full rounded" />
          <Shimmer className="h-3 w-5/6 rounded" />
          <Shimmer className="h-3 w-4/5 rounded" />
        </div>

        {/* Bottom cards */}
        <div className="grid grid-cols-2 gap-3 mt-auto">
          <Shimmer className="h-20 rounded-lg" />
          <Shimmer className="h-20 rounded-lg" />
        </div>
      </div>

      {/* Loading text */}
      <div className="flex items-center justify-center gap-2 pt-3 border-t">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">Loading preview...</span>
      </div>
    </div>
  );
}
