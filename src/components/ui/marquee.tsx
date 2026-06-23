import { cn } from "@/lib/utils";
import { ComponentPropsWithoutRef } from "react";

interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
  /** Whether the marquee should reverse direction */
  reverse?: boolean;
  /** Pause when the user hovers the marquee */
  pauseOnHover?: boolean;
  /** Children to render inside the marquee */
  children: React.ReactNode;
  /** Run the marquee vertically instead of horizontally */
  vertical?: boolean;
  /** Number of times to duplicate the children for a seamless loop */
  repeat?: number;
}

/**
 * Magic-UI style marquee. The track itself is just a flex container that
 * runs the `marquee` / `marquee-vertical` keyframes (defined in globals.css).
 * We render `repeat` copies of the children so the loop appears seamless —
 * 4 copies is enough for short lists; bump it up when content is sparse.
 *
 * Speed is controlled via the `--duration` CSS variable on the parent —
 * `className="[--duration:20s]"` is the conventional override.
 */
export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  children,
  vertical = false,
  repeat = 4,
  ...props
}: MarqueeProps) {
  return (
    <div
      {...props}
      className={cn(
        "group flex overflow-hidden p-2 [--duration:40s] [--gap:1rem] [gap:var(--gap)]",
        {
          "flex-row": !vertical,
          "flex-col": vertical,
        },
        className,
      )}
    >
      {Array(repeat)
        .fill(0)
        .map((_, i) => (
          <div
            key={i}
            className={cn("flex shrink-0 justify-around [gap:var(--gap)]", {
              "animate-marquee flex-row": !vertical,
              "animate-marquee-vertical flex-col": vertical,
              "group-hover:[animation-play-state:paused]": pauseOnHover,
              "[animation-direction:reverse]": reverse,
            })}
          >
            {children}
          </div>
        ))}
    </div>
  );
}
