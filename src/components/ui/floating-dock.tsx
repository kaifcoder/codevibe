"use client";

/**
 * Mac-style "dock" navbar. The desktop variant uses pointer proximity to
 * magnify icons à la macOS — the closer the cursor is to an icon, the
 * bigger it scales. We expose it as a single tab bar (not the split
 * desktop / mobile-collapsed-menu the upstream Aceternity snippet uses):
 * one row of icons that works on touch and pointer.
 *
 * On touch devices `mouseX` never updates, so the magnify never triggers.
 * To keep the dock feeling alive we permanently inflate whichever item is
 * `active`, which also doubles as the "selected pane" affordance.
 */

import { cn } from "@/lib/utils";
import {
  AnimatePresence,
  MotionValue,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import { useEffect, useRef, useState } from "react";

export interface FloatingDockItem {
  /** Tooltip + a11y label. */
  title: string;
  /** Pre-sized SVG / element. Will be scaled by the parent. */
  icon: React.ReactNode;
  /** Optional href — when omitted, the dock renders a button and calls
   *  `onSelect`. */
  href?: string;
  /** Stable id, used by the dock to mark this item as active. */
  id?: string;
}

export interface FloatingDockProps {
  items: FloatingDockItem[];
  /** Id of the currently active item — that one is permanently magnified
   *  (covers the touch case where mouseX never moves). */
  activeId?: string;
  /** Click / tap handler. Receives the clicked item. */
  onSelect?: (item: FloatingDockItem) => void;
  className?: string;
  /** Resting icon size in px. The hover apex is 2× this. */
  size?: number;
}

/**
 * Bare dock — just the row of magnifying icons. The page is responsible
 * for positioning (fixed bottom for a Mac-dock-like tab bar, inline for
 * a regular row, etc.).
 */
export function FloatingDock({
  items,
  activeId,
  onSelect,
  className,
  size = 40,
}: FloatingDockProps) {
  const mouseX = useMotionValue(Infinity);

  return (
    <motion.div
      onMouseMove={(e) => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      // The aluminum-pill look. Light theme uses a frosted white, dark a
      // soft neutral — both with a hairline border and a drop shadow so the
      // dock reads as floating above content.
      className={cn(
        "mx-auto flex h-16 items-end gap-3 sm:gap-4 rounded-2xl border border-black/5 dark:border-white/10 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl px-3 sm:px-4 pb-2 shadow-xl shadow-black/10 dark:shadow-black/50",
        className,
      )}
    >
      {items.map((item) => (
        <DockIcon
          key={item.id ?? item.title}
          mouseX={mouseX}
          size={size}
          isActive={item.id !== undefined && item.id === activeId}
          item={item}
          onSelect={onSelect}
        />
      ))}
    </motion.div>
  );
}

function DockIcon({
  mouseX,
  item,
  isActive,
  onSelect,
  size,
}: {
  mouseX: MotionValue<number>;
  item: FloatingDockItem;
  isActive: boolean;
  onSelect?: (item: FloatingDockItem) => void;
  size: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Distance from the icon's center to the cursor, on the page-x axis.
  const distance = useTransform(mouseX, (val) => {
    const b = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - b.x - b.width / 2;
  });

  // Map distance → width. Apex (cursor on center) is 2× the resting size.
  const apex = size * 2;
  const iconResting = Math.round(size * 0.5);
  const iconApex = Math.round(size * 1.0);

  const widthTransform = useTransform(distance, [-150, 0, 150], [size, apex, size]);
  const heightTransform = useTransform(distance, [-150, 0, 150], [size, apex, size]);
  const iconWidthTransform = useTransform(
    distance,
    [-150, 0, 150],
    [iconResting, iconApex, iconResting],
  );
  const iconHeightTransform = useTransform(
    distance,
    [-150, 0, 150],
    [iconResting, iconApex, iconResting],
  );

  // Soft spring — matches the macOS "wobble" of the dock.
  const spring = { mass: 0.1, stiffness: 150, damping: 12 } as const;
  const width = useSpring(widthTransform, spring);
  const height = useSpring(heightTransform, spring);
  const iconWidth = useSpring(iconWidthTransform, spring);
  const iconHeight = useSpring(iconHeightTransform, spring);

  // On touch devices mouseX never fires — keep the active item enlarged
  // so the dock still reads as a tab bar. We bump the motion values to
  // ~75% of apex on activation; the spring smooths the transition.
  useEffect(() => {
    if (!isActive) return;
    const activeSize = Math.round(size * 1.4);
    const activeIcon = Math.round(iconApex * 0.85);
    width.jump(activeSize);
    height.jump(activeSize);
    iconWidth.jump(activeIcon);
    iconHeight.jump(activeIcon);
    // Intentionally don't shrink on deactivate — the next pointer or active
    // change will reset via the transforms above.
  }, [isActive, size, iconApex, width, height, iconWidth, iconHeight]);

  const [hovered, setHovered] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    if (onSelect) {
      e.preventDefault();
      onSelect(item);
    }
  };

  // Each item is a button (or an anchor wrapping a button) — buttons get
  // keyboard focus for free, which matters for accessibility.
  const inner = (
    <motion.button
      ref={ref}
      type="button"
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width, height }}
      aria-label={item.title}
      className={cn(
        "relative flex aspect-square items-center justify-center rounded-full transition-colors",
        isActive
          ? "bg-gradient-to-br from-blue-500/20 via-purple-500/20 to-cyan-500/20 ring-1 ring-blue-500/40"
          : "bg-neutral-200/80 dark:bg-neutral-800/80 hover:bg-neutral-200 dark:hover:bg-neutral-800",
      )}
    >
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 6, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 2, x: "-50%" }}
            className="pointer-events-none absolute -top-9 left-1/2 w-fit rounded-md border border-black/10 bg-neutral-100 px-2 py-0.5 text-xs whitespace-pre text-neutral-700 shadow-sm dark:border-white/10 dark:bg-neutral-800 dark:text-white"
          >
            {item.title}
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        style={{ width: iconWidth, height: iconHeight }}
        className="flex items-center justify-center"
      >
        {item.icon}
      </motion.div>
      {/* Active indicator dot — Mac dock convention for "app running". */}
      {isActive && (
        <span
          aria-hidden
          className="absolute -bottom-1.5 h-1 w-1 rounded-full bg-foreground/70"
        />
      )}
    </motion.button>
  );

  if (item.href) {
    return (
      <a href={item.href} aria-label={item.title}>
        {inner}
      </a>
    );
  }
  return inner;
}
