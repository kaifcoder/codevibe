"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useClerk, SignInButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowRight,
  Sparkles,
  Code2,
  Boxes,
  Users2,
  Zap,
  GitBranch,
  Layers,
  Eye,
  Wand2,
  Terminal,
} from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { BentoGrid, BentoGridItem } from "@/components/ui/bento-grid";
import { Marquee } from "@/components/ui/marquee";
import { cn } from "@/lib/utils";

// Sections register the plugin lazily on the client. SSR-safe — the import
// is fine on the server but registerPlugin must only run in the browser.
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

// The page's scroll container is `#cv-scroll-root` (set by app/page.tsx),
// because the global body has `overflow-hidden`. Every ScrollTrigger on
// this page needs to bind to that element instead of window — otherwise
// triggers fire instantly (the window never scrolls). We resolve it once
// at module scope and also re-default in a useLayoutEffect below so the
// child triggers pick it up before they're instantiated.
function getScroller(): Element | undefined {
  if (typeof document === "undefined") return undefined;
  return document.getElementById("cv-scroll-root") ?? undefined;
}

// ─── Reveal helpers ─────────────────────────────────────────────────────────

/**
 * Splits a heading into words, wraps each in a span, and animates them up
 * from a clip-path mask as the section enters the viewport. This is the
 * editorial-style reveal you see on lovable/v0 — feels like the headline
 * is being "read into existence" rather than fading in.
 */
function useSplitHeadingReveal(
  ref: React.RefObject<HTMLElement | null>,
  options?: { stagger?: number; start?: string },
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      const words = el.querySelectorAll<HTMLElement>("[data-word]");
      if (words.length === 0) return;
      gsap.set(words, { yPercent: 110, rotate: 4, opacity: 0 });
      gsap.to(words, {
        yPercent: 0,
        rotate: 0,
        opacity: 1,
        duration: 1.1,
        ease: "expo.out",
        stagger: options?.stagger ?? 0.06,
        scrollTrigger: {
          trigger: el,
          start: options?.start ?? "top 82%",
          // once — after the headline has read itself in, scroll-past must
          // not reverse it back into the mask. With toggleActions reversing
          // on a fast flick the per-word stagger replays mid-flight.
          once: true,
        },
      });
    }, el);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
}

/**
 * Wraps a string into per-word spans with overflow-hidden so the
 * yPercent translate above is masked into nothingness.
 */
function SplitWords({ children, className }: { children: string; className?: string }) {
  return (
    <span className={className}>
      {children.split(" ").map((word, i) => (
        <span
          key={`${word}-${i}`}
          className="inline-block overflow-hidden align-bottom pr-[0.25em] last:pr-0"
        >
          <span data-word className="inline-block will-change-transform">
            {word}
          </span>
        </span>
      ))}
    </span>
  );
}

// ─── Decorative atmosphere (per-section rim-light + hairline divider) ─────
//
// The global atmosphere (line grid + film grain + top color seam) lives on
// the route wrapper in app/page.tsx. Per-section we only add (a) a single
// low-opacity rim-light orb so the section feels lit from a direction and
// (b) a glowing hairline at the top so adjacent sections read as "panels"
// rather than continuous gray. Light mode keeps a simpler look — no orbs,
// just the divider — to avoid washed-out pastels.

function SectionAtmosphere({
  variant = "default",
  side = "left",
}: {
  variant?: "default" | "violet" | "cyan" | "warm";
  side?: "left" | "right" | "center";
}) {
  const tint = {
    default: "rgba(59,130,246,0.10)", // blue-500
    violet: "rgba(168,85,247,0.10)", // purple-500
    cyan: "rgba(34,211,238,0.10)", // cyan-400
    warm: "rgba(244,114,182,0.10)", // pink-400
  }[variant];
  const dividerTint = {
    default: "rgba(96,165,250,0.55)",
    violet: "rgba(192,132,252,0.55)",
    cyan: "rgba(103,232,249,0.55)",
    warm: "rgba(251,146,178,0.55)",
  }[variant];
  const x = side === "left" ? "-15%" : side === "right" ? "115%" : "50%";
  return (
    <>
      {/* Glowing hairline divider — fades to nothing at the edges. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-px h-px hidden dark:block"
        style={{
          background: `linear-gradient(to right, transparent, ${dividerTint}, transparent)`,
        }}
      />
      {/* Single rim-light orb. Very low opacity, no animation — atmosphere */}
      {/* shouldn't compete with the GSAP scroll choreography. Dark only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute hidden dark:block"
        style={{
          left: x,
          top: "10%",
          width: "44rem",
          height: "44rem",
          transform: "translate(-50%, 0)",
          background: `radial-gradient(closest-side, ${tint}, transparent 70%)`,
          filter: "blur(40px)",
        }}
      />
    </>
  );
}

// ─── 1. HOW IT WORKS ────────────────────────────────────────────────────────

function HowItWorks() {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useSplitHeadingReveal(headingRef);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      // Step cards: stagger up
      gsap.from(el.querySelectorAll("[data-step]"), {
        y: 80,
        opacity: 0,
        scale: 0.96,
        duration: 0.9,
        ease: "expo.out",
        stagger: 0.18,
        // once:true — same reasoning as StackBento. After the cards have
        // animated in once, fast scroll-past must not retrigger / reverse
        // the tween — it visibly stutters when ScrollTrigger flips state
        // several times in a few frames.
        scrollTrigger: { trigger: el, start: "top 70%", once: true },
      });
    }, el);
    return () => ctx.revert();
  }, []);

  const steps = [
    {
      no: "01",
      icon: <Wand2 className="h-5 w-5" />,
      label: "Describe",
      title: "Write a sentence.",
      copy: "A todo app with categories. A pomodoro that tracks streaks. A landing page for my band. Whatever it is, type it in plain English.",
      mock: (
        <div className="font-mono text-[12px] leading-6 text-zinc-300">
          <span className="text-blue-400">$</span> codevibe new{" "}
          <span className="bg-blue-500/30 text-white px-1 rounded-sm">
            &quot;a habit tracker with streaks&quot;
            <span className="ml-0.5 inline-block h-3 w-0.5 bg-blue-300 animate-pulse" />
          </span>
        </div>
      ),
    },
    {
      no: "02",
      icon: <Terminal className="h-5 w-5" />,
      label: "Generate",
      title: "Watch the agent build.",
      copy: "Files appear in real time. Components, routes, server actions, styles — all in a live E2B sandbox you can actually open.",
      mock: (
        <div className="font-mono text-[11px] leading-[1.55] text-zinc-300 space-y-0.5">
          <div>
            <span className="text-emerald-400">+</span> app/page.tsx
          </div>
          <div>
            <span className="text-emerald-400">+</span> components/HabitGrid.tsx
          </div>
          <div>
            <span className="text-emerald-400">+</span> components/StreakCard.tsx
          </div>
          <div>
            <span className="text-emerald-400">+</span> lib/storage.ts
          </div>
          <div className="text-zinc-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
            installing dependencies…
          </div>
        </div>
      ),
    },
    {
      no: "03",
      icon: <Eye className="h-5 w-5" />,
      label: "Iterate",
      title: "Edit. Share. Ship.",
      copy: "Open the live preview, edit any file, invite collaborators with one link, push to GitHub when it&rsquo;s ready.",
      mock: (
        <div className="rounded-lg border border-white/10 bg-zinc-950 overflow-hidden">
          <div className="flex items-center gap-1.5 border-b border-white/10 px-2 py-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-400/70" />
            <span className="h-2 w-2 rounded-full bg-amber-400/70" />
            <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
            <span className="ml-2 font-mono text-[10px] text-zinc-500">
              localhost:3000
            </span>
          </div>
          <div className="p-3 space-y-2">
            <div className="h-2 w-2/3 rounded bg-zinc-800" />
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-3 rounded ${
                    i % 3 === 0 ? "bg-blue-500/70" : "bg-zinc-800"
                  }`}
                />
              ))}
            </div>
            <div className="h-2 w-1/2 rounded bg-zinc-800" />
          </div>
        </div>
      ),
    },
  ];

  return (
    <section
      ref={sectionRef}
      className="relative px-4 sm:px-6 lg:px-12 py-28 lg:py-40 overflow-hidden border-t border-black/5 dark:border-white/5"
    >
      <SectionAtmosphere variant="default" side="left" />
      <div className="relative max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-blue-500">
            ◆ how it works
          </span>
          <span className="h-px flex-1 bg-linear-to-r from-blue-500/40 to-transparent" />
        </div>
        <h2
          ref={headingRef}
          className="font-semibold tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05] max-w-4xl"
        >
          <SplitWords>From thought to running app</SplitWords>
          <br />
          <SplitWords className="bg-linear-to-r from-blue-500 via-purple-500 to-cyan-500 bg-clip-text text-transparent">
            in under sixty seconds.
          </SplitWords>
        </h2>

        <div className="relative mt-20 grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-10">
          {steps.map((s) => (
            <div
              key={s.no}
              data-step
              className="relative rounded-2xl border border-border/60 bg-white dark:bg-white/2.5 p-6 lg:p-7 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_30px_60px_-30px_rgba(0,0,0,0.5)] contain-[layout_paint]"
            >
              <div className="flex items-center justify-between mb-6">
                <span className="font-mono text-xs text-muted-foreground">
                  {s.no}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-blue-500">{s.icon}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    {s.label}
                  </span>
                </div>
              </div>
              <h3 className="text-xl font-medium mb-2 leading-snug">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                {s.copy}
              </p>
              <div className="rounded-xl border border-white/5 bg-zinc-950/80 p-4">
                {s.mock}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 2. STACK / CAPABILITIES (BENTO) ───────────────────────────────────────

function StackBento() {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useSplitHeadingReveal(headingRef);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      // Gentle entry on the bento items themselves. fromTo with
      // immediateRender:false is critical — gsap.from() sets the target
      // to opacity:0 at mount time, and if the ScrollTrigger never fires
      // (mismatched scroller, layout not yet settled) the cards remain
      // invisible. fromTo + immediateRender:false leaves the cards at
      // their natural state until the trigger fires.
      const items = el.querySelectorAll<HTMLElement>("[data-bento-grid] > *");
      if (items.length === 0) return;
      gsap.fromTo(
        items,
        { y: 40, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          ease: "expo.out",
          stagger: { each: 0.08, from: "start" },
          immediateRender: false,
          scrollTrigger: { trigger: el, start: "top 85%", once: true },
        },
      );
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative px-4 sm:px-6 lg:px-12 py-28 lg:py-40 overflow-hidden border-t border-black/5 dark:border-white/5"
    >
      <SectionAtmosphere variant="violet" side="right" />
      <div className="relative max-w-6xl mx-auto">
        <div className="flex items-end justify-between flex-wrap gap-6 mb-10">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-fuchsia-400">
                ◆ what&apos;s inside
              </span>
              <span className="h-px w-32 bg-linear-to-r from-fuchsia-500/40 to-transparent" />
            </div>
            <h2
              ref={headingRef}
              className="font-semibold tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05] max-w-3xl"
            >
              <SplitWords>Production-grade stack.</SplitWords>
              <br />
              <SplitWords className="text-muted-foreground">No surprises.</SplitWords>
            </h2>
          </div>
          <p className="font-mono text-xs text-muted-foreground max-w-xs leading-relaxed">
            <span aria-hidden>{"// "}</span>the same tools you&apos;d reach for on day-one of a real
            project, wired together so they just work.
          </p>
        </div>

        <BentoGrid className="md:auto-rows-[22rem] md:grid-cols-3">
          {bentoItems.map((item, i) => (
            <BentoGridItem
              key={item.title}
              title={item.title}
              description={item.description}
              header={item.header}
              icon={item.icon}
              className={cn(
                // Mirror the source pattern: the 4th and 7th cells widen to
                // create the editorial rhythm. We have six items, so wide is
                // index 0 and 3 — first row anchor + start of second row.
                i === 0 || i === 3 ? "md:col-span-2" : "",
              )}
            />
          ))}
        </BentoGrid>
      </div>
    </section>
  );
}

// ─── Bento headers — small, self-contained visuals per card. Each is a
// stateless component so React reuses them across re-renders; the parent's
// GSAP tween animates the wrapper, not these. The headers paint subtle
// motion (pulses, marquees) that runs in CSS — cheap, no JS frame cost.

function FrameworkHeader() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black">
      <div className="absolute inset-0 opacity-60" style={{
        backgroundImage:
          "linear-gradient(to right, rgba(59,130,246,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(59,130,246,0.08) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }} />
      <div className="absolute inset-x-4 bottom-4 top-4 flex items-end">
        <pre className="font-mono text-[10.5px] leading-normal text-zinc-700 dark:text-zinc-300/90">{`export default function Page() {
  return (
    <main className="grid">
      <Hero />
      <Features />
    </main>
  )
}`}</pre>
      </div>
      <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-blue-500">live</span>
      </div>
    </div>
  );
}

function SandboxHeader() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-zinc-950">
      <div className="absolute inset-0" style={{
        background:
          "radial-gradient(ellipse at 30% 20%, rgba(168,85,247,0.18), transparent 60%), radial-gradient(ellipse at 80% 90%, rgba(59,130,246,0.16), transparent 55%)",
      }} />
      <div className="absolute inset-3 rounded-lg border border-white/10 bg-black/40 backdrop-blur-sm overflow-hidden">
        <div className="flex items-center gap-1.5 border-b border-white/10 px-2 py-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-400/70" />
          <span className="h-2 w-2 rounded-full bg-amber-400/70" />
          <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
          <span className="ml-2 font-mono text-[9px] text-white/40">sandbox.e2b.app</span>
        </div>
        <div className="p-3 font-mono text-[10px] leading-relaxed text-zinc-300 space-y-0.5">
          <div><span className="text-emerald-400">$</span> next dev --turbopack</div>
          <div className="text-zinc-500">  ▲ Next.js 16.0.0</div>
          <div className="text-zinc-500">  - Local: http://localhost:3000</div>
          <div className="text-emerald-400">  ✓ Ready in 482ms</div>
        </div>
      </div>
    </div>
  );
}

function CollabHeader() {
  // Three "cursors" drifting across a faux document. Pure CSS keyframes
  // so it doesn't fight the page-level GSAP scrubs.
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-gradient-to-br from-emerald-50 to-cyan-50 dark:from-emerald-950/40 dark:to-cyan-950/40">
      <div className="absolute inset-4 space-y-2">
        <div className="h-2 w-3/4 rounded bg-zinc-200 dark:bg-white/10" />
        <div className="h-2 w-1/2 rounded bg-zinc-200 dark:bg-white/10" />
        <div className="h-2 w-2/3 rounded bg-zinc-200 dark:bg-white/10" />
        <div className="h-2 w-5/12 rounded bg-zinc-200 dark:bg-white/10" />
      </div>
      {[
        { color: "bg-emerald-500", label: "ayu", left: "20%", top: "30%", delay: "0s" },
        { color: "bg-fuchsia-500", label: "ken", left: "55%", top: "55%", delay: "1.2s" },
        { color: "bg-amber-500", label: "rio", left: "35%", top: "70%", delay: "2.4s" },
      ].map((c) => (
        <div
          key={c.label}
          className="absolute flex items-start gap-0 animate-pulse"
          style={{ left: c.left, top: c.top, animationDelay: c.delay, animationDuration: "3s" }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" className={`${c.color.replace("bg-", "text-")} drop-shadow`} fill="currentColor">
            <path d="M0 0 L0 11 L3 8 L5 13 L7 12 L5 7 L9 7 Z" />
          </svg>
          <span className={`ml-0.5 rounded px-1 py-px font-mono text-[8px] text-white ${c.color}`}>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

function ModelHeader() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100 dark:from-indigo-950/60 dark:via-purple-950/60 dark:to-pink-950/60">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute inset-0 rounded-full border border-indigo-400/40 dark:border-indigo-300/30 animate-ping"
              style={{
                width: `${(i + 1) * 40}px`,
                height: `${(i + 1) * 40}px`,
                left: `${-(i + 1) * 20}px`,
                top: `${-(i + 1) * 20}px`,
                animationDelay: `${i * 0.6}s`,
                animationDuration: "3s",
              }}
            />
          ))}
          <div className="relative h-10 w-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/40 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
        </div>
      </div>
      <div className="absolute bottom-3 left-3 right-3 font-mono text-[10px] text-indigo-700 dark:text-indigo-300 flex items-center justify-between">
        <span>kimi-k2.5</span>
        <span className="opacity-60">128k ctx</span>
      </div>
    </div>
  );
}

function SpeedHeader() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-gradient-to-br from-amber-50 to-orange-100 dark:from-amber-950/50 dark:to-orange-950/50">
      <div className="absolute inset-0 flex items-end justify-around px-4 pb-6 gap-1.5">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-gradient-to-t from-amber-500 to-orange-400 dark:from-amber-400 dark:to-orange-300 animate-pulse"
            style={{
              height: `${20 + ((i * 13) % 70)}%`,
              animationDelay: `${i * 0.08}s`,
              animationDuration: "1.6s",
            }}
          />
        ))}
      </div>
      <div className="absolute top-3 left-3 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-700 dark:text-amber-200">
        200ms · hmr
      </div>
    </div>
  );
}

function GitHeader() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-zinc-950">
      <div className="absolute inset-0" style={{
        background:
          "radial-gradient(circle at 50% 50%, rgba(99,102,241,0.18), transparent 60%)",
      }} />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 120" preserveAspectRatio="none">
        <defs>
          <linearGradient id="git-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(99,102,241)" stopOpacity="0" />
            <stop offset="50%" stopColor="rgb(99,102,241)" stopOpacity="1" />
            <stop offset="100%" stopColor="rgb(99,102,241)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M 10 90 Q 60 90 80 60 Q 100 30 140 30 L 190 30" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" fill="none" />
        <path d="M 10 90 Q 60 90 80 60 Q 100 30 140 30 L 190 30" stroke="url(#git-line)" strokeWidth="2" fill="none" strokeDasharray="100 200" className="origin-center">
          <animate attributeName="stroke-dashoffset" from="0" to="-300" dur="3s" repeatCount="indefinite" />
        </path>
        {[
          { cx: 10, cy: 90, c: "rgb(96,165,250)" },
          { cx: 80, cy: 60, c: "rgb(168,85,247)" },
          { cx: 140, cy: 30, c: "rgb(52,211,153)" },
          { cx: 190, cy: 30, c: "rgb(244,114,182)" },
        ].map((p, i) => (
          <circle key={i} cx={p.cx} cy={p.cy} r={4} fill={p.c} />
        ))}
      </svg>
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between font-mono text-[10px]">
        <span className="text-zinc-400">main</span>
        <span className="text-emerald-400">pushed ✓</span>
      </div>
    </div>
  );
}

// Items used by the BentoGrid above. Order matters — see col-span comment.
const bentoItems = [
  {
    title: "Next.js 16 · React 19 · Turbopack",
    description:
      "Every project ships with the App Router, server actions, streaming SSR, and the same toolchain Vercel runs in production.",
    header: <FrameworkHeader />,
    icon: <Code2 className="h-4 w-4 text-blue-500" />,
  },
  {
    title: "Live E2B sandbox",
    description: "A real Linux VM running your dev server, dispensable in seconds.",
    header: <SandboxHeader />,
    icon: <Boxes className="h-4 w-4 text-purple-500" />,
  },
  {
    title: "Real-time collaboration",
    description: "Yjs CRDTs sync every keystroke. Share a link, edit together.",
    header: <CollabHeader />,
    icon: <Users2 className="h-4 w-4 text-emerald-500" />,
  },
  {
    title: "Moonshot Kimi K2.5",
    description: "Plans before it edits. Refactors before it ships. 128k context window.",
    header: <ModelHeader />,
    icon: <Sparkles className="h-4 w-4 text-indigo-500" />,
  },
  {
    title: "Hot reload, real fast",
    description: "Watcher polling tuned to 200ms inside the sandbox.",
    header: <SpeedHeader />,
    icon: <Zap className="h-4 w-4 text-amber-500" />,
  },
  {
    title: "Git, MCP, deploy",
    description: "Push to GitHub. Connect Playwright. Ship to Vercel — all from one chat.",
    header: <GitHeader />,
    icon: <GitBranch className="h-4 w-4 text-fuchsia-500" />,
  },
];

// ─── 3. THANKS — single-row wordmark marquee ───────────────────────────────
//
// One horizontal marquee row of large partner wordmarks. Every other
// wordmark is "outlined" (transparent fill + 1px text-stroke) so the row
// reads as a rhythm of filled→outlined→filled. Side fades melt the strip
// into the page background. Pure CSS animation, no GSAP, no images.

const partners = [
  {
    role: "model",
    wordmark: "Kimi K2.5",
    thanks: "for the model that plans before it edits.",
    accent: "from-indigo-400/40 to-blue-500/30",
    ink: "text-indigo-200",
  },
  {
    role: "inference",
    wordmark: "Bedrock",
    thanks: "for serving the model with the latency we needed.",
    accent: "from-amber-400/40 to-orange-500/30",
    ink: "text-amber-200",
  },
  {
    role: "orchestration",
    wordmark: "LangGraph",
    thanks: "for the durable agent runtime that survives a reload.",
    accent: "from-emerald-400/40 to-teal-500/30",
    ink: "text-emerald-200",
  },
  {
    role: "sandbox",
    wordmark: "E2B",
    thanks: "for the live Linux microVM that boots in a second.",
    accent: "from-violet-400/40 to-fuchsia-500/30",
    ink: "text-violet-200",
  },
  {
    role: "framework",
    wordmark: "Next.js",
    thanks: "for the framework every generated project ships on.",
    accent: "from-zinc-200/40 to-zinc-500/30",
    ink: "text-zinc-100",
  },
  {
    role: "host",
    wordmark: "▲ Vercel",
    thanks: "for the deploys that go live before we finish typing.",
    accent: "from-zinc-200/40 to-blue-500/30",
    ink: "text-zinc-100",
  },
  {
    role: "auth",
    wordmark: "Clerk",
    thanks: "for the sign-in flow we never had to design.",
    accent: "from-purple-400/40 to-indigo-500/30",
    ink: "text-purple-200",
  },
  {
    role: "data",
    wordmark: "Prisma",
    thanks: "for the schema that survives every refactor.",
    accent: "from-cyan-300/40 to-sky-500/30",
    ink: "text-cyan-100",
  },
  {
    role: "ui",
    wordmark: "shadcn",
    thanks: "for the components we copy-paste with pride.",
    accent: "from-rose-400/40 to-pink-500/30",
    ink: "text-rose-200",
  },
  {
    role: "collab",
    wordmark: "Yjs",
    thanks: "for the CRDTs that let many cursors share one file.",
    accent: "from-lime-300/40 to-emerald-500/30",
    ink: "text-lime-100",
  },
  {
    role: "ide",
    wordmark: "Monaco",
    thanks: "for the editor that makes the code feel alive.",
    accent: "from-sky-400/40 to-indigo-500/30",
    ink: "text-sky-200",
  },
  {
    role: "mcp",
    wordmark: "Playwright",
    thanks: "for the headless browser the agent drives like a pro.",
    accent: "from-orange-400/40 to-rose-500/30",
    ink: "text-orange-200",
  },
];

type Partner = (typeof partners)[number];

function PartnerWordmark({ p, outlined }: { p: Partner; outlined: boolean }) {
  // Two visual treatments alternating across the marquee:
  // - filled: solid gradient text
  // - outlined: transparent fill + 1px text-stroke
  // The marquee reads as a wall of names, breathing because every other
  // item is empty inside its own letters.
  return (
    <span
      className={cn(
        "shrink-0 select-none whitespace-nowrap font-semibold tracking-[-0.03em] leading-none",
        "text-[clamp(2.5rem,7vw,5.5rem)]",
        outlined
          ? "text-transparent [-webkit-text-stroke:1px_currentColor] text-foreground/70 dark:text-white/55"
          : "bg-gradient-to-br bg-clip-text text-transparent " + p.accent,
      )}
    >
      {p.wordmark}
    </span>
  );
}

function ShowcaseStrip() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useSplitHeadingReveal(headingRef);

  return (
    <section className="relative overflow-hidden border-t border-black/5 dark:border-white/5 px-4 sm:px-6 lg:px-12 py-28 lg:py-40">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-px h-px hidden dark:block"
        style={{
          background:
            "linear-gradient(to right, transparent, rgba(103,232,249,0.55), transparent)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden dark:block"
        style={{
          background:
            "radial-gradient(ellipse 70% 40% at 50% 0%, rgba(34,211,238,0.08), transparent 70%)",
        }}
      />

      <div className="relative max-w-6xl mx-auto">
        <div className="flex items-end justify-between flex-wrap gap-6 mb-16 lg:mb-20">
          <div>
            <div className="flex items-center gap-3 mb-5">
              <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-cyan-400">
                ◆ thank you
              </span>
              <span className="h-px w-20 bg-linear-to-r from-cyan-500/50 to-transparent" />
            </div>
            <h2
              ref={headingRef}
              className="font-semibold tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05] max-w-3xl"
            >
              <SplitWords>Built on the shoulders of</SplitWords>{" "}
              <SplitWords className="bg-linear-to-r from-blue-400 via-cyan-300 to-emerald-300 bg-clip-text text-transparent">
                exceptional teams.
              </SplitWords>
            </h2>
          </div>
          <p className="font-mono text-xs text-muted-foreground max-w-xs leading-relaxed">
            <span aria-hidden>{"// "}</span>the platforms, models, and open-source
            projects that codevibe leans on every single request.
          </p>
        </div>

        {/* Single-row marquee — large wordmarks alternating between filled
            (gradient text) and outlined (1px stroke, transparent fill). Side
            fades melt the strip into the page background. */}
        <div className="relative overflow-hidden">
          <Marquee pauseOnHover className="[--duration:60s] [--gap:3rem] py-4">
            {partners.map((p, i) => (
              <div key={p.wordmark} className="flex items-center gap-12">
                <PartnerWordmark p={p} outlined={i % 2 === 1} />
                {/* small diamond separator — pure type, no images */}
                <span aria-hidden className="text-muted-foreground/40 text-2xl">
                  ◆
                </span>
              </div>
            ))}
          </Marquee>

          <div className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-white dark:from-[#070708] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-white dark:from-[#070708] to-transparent" />
        </div>
      </div>
    </section>
  );
}

// ─── 4. NUMBERS / STATS COUNTUP ─────────────────────────────────────────────

function StatsRow() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      el.querySelectorAll<HTMLElement>("[data-stat]").forEach((node) => {
        const end = Number(node.dataset.target ?? "0");
        const suffix = node.dataset.suffix ?? "";
        const obj = { val: 0 };
        gsap.to(obj, {
          val: end,
          duration: 1.6,
          ease: "expo.out",
          onUpdate: () => {
            node.textContent = formatStat(obj.val) + suffix;
          },
          scrollTrigger: { trigger: node, start: "top 85%", once: true },
        });
      });
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative px-4 sm:px-6 lg:px-12 py-24 lg:py-32 border-t border-black/5 dark:border-white/5 overflow-hidden"
    >
      <SectionAtmosphere variant="warm" side="left" />
      <div className="relative max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 lg:gap-10">
        {[
          { v: 47, s: "s", label: "median time to first running app" },
          { v: 18, s: "k", label: "files generated this month" },
          { v: 99, s: ".9%", label: "of sandboxes boot in under 3s" },
          { v: 6, s: "", label: "MCP servers wired in by default" },
        ].map((stat, i) => (
          <div key={i} className="relative">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
              ◆ {String(i + 1).padStart(2, "0")}
            </div>
            <div
              data-stat
              data-target={stat.v}
              data-suffix={stat.s}
              className="font-semibold tracking-tight text-5xl lg:text-7xl bg-linear-to-br from-foreground to-muted-foreground/60 bg-clip-text text-transparent"
            >
              0{stat.s}
            </div>
            <p className="mt-3 text-sm text-muted-foreground leading-snug">
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatStat(n: number): string {
  if (n >= 100) return Math.round(n).toString();
  if (n >= 10) return n.toFixed(1).replace(/\.0$/, "");
  return n.toFixed(1).replace(/\.0$/, "");
}

// ─── 5. CTA ─────────────────────────────────────────────────────────────────

function ClosingCTA({
  onStart,
}: {
  onStart: (prompt: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [prompt, setPrompt] = useState("");
  const { isSignedIn, isLoaded } = useAuth();
  useSplitHeadingReveal(headingRef, { stagger: 0.08, start: "top 78%" });

  // Match the hero's stash-across-auth flow so a closing-CTA prompt
  // survives the Clerk sign-in modal too. Keys match app/page.tsx —
  // the home page picks up the stashed prompt on next load.
  const PENDING_PROMPT_KEY = "codevibe.pendingPrompt";
  const PENDING_FLAG_KEY = "codevibe.pendingSignIn";
  const stash = (text: string) => {
    if (!text.trim()) return;
    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, text);
      sessionStorage.setItem(PENDING_FLAG_KEY, "1");
    } catch {}
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      gsap.from(el.querySelectorAll("[data-cta-line]"), {
        opacity: 0,
        y: 20,
        duration: 0.8,
        stagger: 0.08,
        ease: "expo.out",
        scrollTrigger: { trigger: el, start: "top 70%", once: true },
      });
      gsap.fromTo(
        el.querySelector("[data-cta-input]"),
        { scale: 0.94, opacity: 0, y: 16 },
        {
          scale: 1,
          opacity: 1,
          y: 0,
          duration: 0.9,
          ease: "expo.out",
          immediateRender: false,
          scrollTrigger: { trigger: el, start: "top 70%", once: true },
        },
      );
    }, el);
    return () => ctx.revert();
  }, []);

  const submit = () => {
    if (!prompt.trim()) return;
    if (!isSignedIn) return;
    onStart(prompt.trim());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section
      ref={ref}
      className="relative overflow-hidden border-t border-black/5 dark:border-white/5 px-4 sm:px-6 lg:px-12 py-32 lg:py-44"
    >
      <SectionAtmosphere variant="default" side="right" />
      <div className="relative max-w-6xl mx-auto text-center">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground mb-8" data-cta-line>
          ◆ ready when you are
        </div>
        <h2
          ref={headingRef}
          className="font-semibold tracking-tight text-5xl sm:text-7xl lg:text-[8.5rem] leading-[0.95]"
        >
          <SplitWords>Stop sketching.</SplitWords>
          <br />
          <SplitWords className="bg-linear-to-r from-blue-500 via-purple-500 to-cyan-500 bg-clip-text text-transparent">
            Start building.
          </SplitWords>
        </h2>
        <p
          data-cta-line
          className="mt-8 max-w-xl mx-auto text-base sm:text-lg text-muted-foreground leading-relaxed"
        >
          One sentence is enough. Drop your idea in the box — the agent will
          pick it up from here.
        </p>

        {/* Closing-CTA prompt box. Same animated outline + rounded geometry
            as the hero, but with copy that matches the "send-off" tone of
            the bottom of the page. */}
        <div className="mt-14 mx-auto w-full max-w-2xl text-left" data-cta-input>
          <div className="relative group">
            <div className="pointer-events-none absolute -inset-3 rounded-3xl bg-linear-to-r from-blue-500/30 via-purple-500/30 to-cyan-500/30 opacity-40 blur-3xl group-focus-within:opacity-70 transition-opacity duration-500" />

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!isSignedIn) {
                  stash(prompt);
                  return;
                }
                submit();
              }}
              className="cv-animated-border relative flex items-center gap-3 bg-background/90 dark:bg-[#0f0f12]/95 backdrop-blur-xl rounded-2xl border border-border/60 px-5 py-3 shadow-2xl shadow-blue-500/10 dark:shadow-blue-500/20 transition-all"
            >
              <Sparkles className="w-6 h-6 text-blue-500/80 shrink-0" />
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ship it. Type the first sentence of your next project…"
                className="flex-1 min-h-14 max-h-72 resize-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent dark:bg-transparent px-0 py-3 text-lg sm:text-xl leading-7 placeholder:text-muted-foreground/70"
                rows={1}
              />
              {isLoaded && !isSignedIn ? (
                <SignInButton mode="modal">
                  <Button
                    type="button"
                    size="icon"
                    onClick={() => stash(prompt)}
                    className="h-11 w-11 rounded-xl shrink-0 bg-linear-to-br from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white shadow-lg shadow-blue-500/30 transition-all"
                  >
                    <ArrowRight className="w-5 h-5" />
                  </Button>
                </SignInButton>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  disabled={!prompt.trim()}
                  className="h-11 w-11 rounded-xl shrink-0 bg-linear-to-br from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:shadow-none transition-all"
                >
                  <ArrowRight className="w-5 h-5" />
                </Button>
              )}
            </form>
          </div>

          <div className="mt-5 flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-mono">
              <Layers className="h-3.5 w-3.5" />
              takes one sentence
            </span>
            <span className="h-3 w-px bg-border" />
            <span className="font-mono">
              <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[10px] font-mono">Enter</kbd> to send
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Public component ──────────────────────────────────────────────────────

export default function LandingSections() {
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { openSignIn } = useClerk();

  const handleStart = (prompt: string) => {
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    const id = crypto.randomUUID();
    // Forward the prompt via search-param — the chat route already auto-sends
    // any incoming `?prompt=` value on mount (same handoff the hero uses).
    const trimmed = prompt.trim();
    const href = trimmed
      ? `/chat/${id}?prompt=${encodeURIComponent(trimmed)}`
      : `/chat/${id}`;
    router.push(href);
  };

  // Bind every ScrollTrigger on this page to the route's own scroll
  // container instead of window. useLayoutEffect runs before the
  // children's useEffect that registers their triggers — so by the
  // time a child trigger is created, the default scroller is set.
  useLayoutEffect(() => {
    const scroller = getScroller();
    if (!scroller) return;
    ScrollTrigger.defaults({ scroller });
    // Recompute trigger positions whenever the scroller resizes
    // (sidebar collapse, viewport rotate, etc).
    const ro = new ResizeObserver(() => ScrollTrigger.refresh());
    ro.observe(scroller);
    return () => {
      ro.disconnect();
      ScrollTrigger.defaults({ scroller: undefined });
    };
  }, []);

  // Refresh ScrollTrigger after fonts load to fix any measurement drift.
  useEffect(() => {
    const refresh = () => ScrollTrigger.refresh();
    if (document.fonts?.ready) {
      document.fonts.ready.then(refresh);
    }
    window.addEventListener("load", refresh);
    return () => window.removeEventListener("load", refresh);
  }, []);

  return (
    <>
      <HowItWorks />
      <StackBento />
      <ShowcaseStrip />
      <StatsRow />
      <ClosingCTA onStart={handleStart} />
      <footer className="relative px-4 sm:px-6 lg:px-12 py-10 border-t border-black/5 dark:border-white/5 text-center">
        <p className="font-mono text-xs text-muted-foreground">
          © codevibe ·{" "}
          <span className="text-blue-500">made with the same agent</span>
        </p>
      </footer>
    </>
  );
}
