"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useClerk } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
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
      // once:true — the bento entry tween should play exactly once per
      // mount. With toggleActions:"play none none reverse" and a fast
      // trackpad flick the section enters/leaves several times in a few
      // frames; GSAP keeps re-starting the tween mid-flight and the cards
      // visibly jitter. Once it has played, we don't need to fight scroll
      // anymore — the cards are static.
      // Also dropped rotateX: 8 — promoting six cards into 3D space adds
      // a layer per card and rasterizes the rotated text on every frame.
      gsap.from(el.querySelectorAll("[data-bento]"), {
        y: 70,
        opacity: 0,
        duration: 0.9,
        ease: "expo.out",
        stagger: { each: 0.08, from: "start" },
        scrollTrigger: { trigger: el, start: "top 75%", once: true },
      });
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

        <div className="grid grid-cols-12 auto-rows-[140px] gap-3 lg:gap-4">
          <BentoCard
            className="col-span-12 md:col-span-7 row-span-2"
            tag="framework"
            icon={<Code2 className="h-5 w-5" />}
            title="Next.js 16 · React 19 · Turbopack"
            copy="Every project ships with the App Router, server actions, streaming SSR, and the same toolchain Vercel runs in production."
            visual={
              <div className="absolute inset-0 flex items-end justify-end p-6 opacity-90">
                <pre className="font-mono text-[10.5px] leading-normal text-zinc-300/90 max-w-[28ch]">{`export default function Page() {
                return (
                  <main className="grid">
                    <Hero />
                    <Features />
                  </main>
                )
              }`}</pre>
              </div>
            }
          />
          <BentoCard
            className="col-span-6 md:col-span-5"
            tag="sandbox"
            icon={<Boxes className="h-5 w-5" />}
            title="Live E2B sandbox"
            copy="A real Linux VM running your dev server, dispensable in seconds."
          />
          <BentoCard
            className="col-span-6 md:col-span-5"
            tag="collab"
            icon={<Users2 className="h-5 w-5" />}
            title="Real-time collaboration"
            copy="Yjs CRDTs sync every keystroke. Share a link, edit together."
          />

          <BentoCard
            className="col-span-6 md:col-span-4"
            tag="model"
            icon={<Sparkles className="h-5 w-5" />}
            title="Moonshot K2.5"
            copy="Plans before it edits. Refactors before it ships."
          />
          <BentoCard
            className="col-span-6 md:col-span-4"
            tag="speed"
            icon={<Zap className="h-5 w-5" />}
            title="Hot reload, real fast"
            copy="Watcher polling tuned to 200ms inside the sandbox."
          />
          <BentoCard
            className="col-span-12 md:col-span-4"
            tag="git"
            icon={<GitBranch className="h-5 w-5" />}
            title="Git, MCP, deploy"
            copy="Push to GitHub. Connect Playwright. Ship to Vercel."
          />
        </div>
      </div>
    </section>
  );
}

function BentoCard({
  className = "",
  tag,
  icon,
  title,
  copy,
  visual,
}: {
  className?: string;
  tag: string;
  icon: React.ReactNode;
  title: string;
  copy: string;
  visual?: React.ReactNode;
}) {
  return (
    <div
      data-bento
      className={`group relative rounded-2xl border border-border/60 bg-white dark:bg-white/2.5 p-5 lg:p-6 overflow-hidden transition-colors hover:border-blue-500/40 contain-[layout_paint] ${className}`}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          background:
            "radial-gradient(400px circle at var(--mx,50%) var(--my,50%), rgba(99,102,241,0.10), transparent 40%)",
        }}
      />
      <div className="relative flex items-center justify-between mb-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {tag}
        </span>
        <span className="text-blue-500/80">{icon}</span>
      </div>
      <h3 className="relative font-medium text-base lg:text-lg leading-snug mb-1.5">
        {title}
      </h3>
      <p className="relative text-sm text-muted-foreground leading-relaxed">
        {copy}
      </p>
      {visual}
    </div>
  );
}

// ─── 3. THANKS — pinned horizontal credits strip ───────────────────────────
//
// Was originally a "what people are building" showcase. Re-purposed into a
// thank-you to the platforms that actually run codevibe in production.
// The pin + horizontal-scroll mechanic stays — it's the section's signature
// — only the cards change. Order roughly mirrors the request path: model →
// orchestration → runtime → app framework → host → auth → data → UI.

function ShowcaseStrip() {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useSplitHeadingReveal(headingRef);

  useEffect(() => {
    const section = sectionRef.current;
    const track = trackRef.current;
    if (!section || !track) return;
    // Hint the compositor: promote the track to its own GPU layer so the
    // pinned-x animation never repaints the section. Without this, GSAP's
    // x: -<n> falls back to a normal main-thread paint on each frame.
    track.style.willChange = "transform";
    const ctx = gsap.context(() => {
      // Pin the section and translate the track horizontally as the user
      // scrolls vertically. Distance is set off how far the track exceeds
      // the viewport width.
      const getDistance = () => track.scrollWidth - window.innerWidth + 64;
      gsap.to(track, {
        x: () => -getDistance(),
        ease: "none",
        // scrub:true (no smoothing lag) instead of scrub:0.6 — the prior
        // tween-toward-target behaviour layered easing on top of the user's
        // own scroll, which felt laggy on slower trackpads. Direct sync is
        // both cheaper and feels tighter.
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: () => `+=${getDistance()}`,
          pin: true,
          scrub: true,
          invalidateOnRefresh: true,
          anticipatePin: 1,
        },
      });
    }, section);
    return () => ctx.revert();
  }, []);

  // Tags use a different role per card so the eye finds variety. The
  // accent gradient is held to a corner — the cards aren't billboards.
  const partners = [
    {
      role: "model",
      name: "Moonshot AI",
      wordmark: "Kimi K2.5",
      thanks: "for the model that plans before it edits.",
      accent: "from-indigo-400/40 to-blue-500/30",
      ink: "text-indigo-200",
    },
    {
      role: "inference",
      name: "AWS Bedrock",
      wordmark: "Bedrock",
      thanks: "for serving the model with the latency we needed.",
      accent: "from-amber-400/40 to-orange-500/30",
      ink: "text-amber-200",
    },
    {
      role: "orchestration",
      name: "LangChain",
      wordmark: "LangGraph",
      thanks: "for the durable agent runtime that survives a reload.",
      accent: "from-emerald-400/40 to-teal-500/30",
      ink: "text-emerald-200",
    },
    {
      role: "sandbox",
      name: "E2B",
      wordmark: "E2B",
      thanks: "for the live Linux microVM that boots in a second.",
      accent: "from-violet-400/40 to-fuchsia-500/30",
      ink: "text-violet-200",
    },
    {
      role: "framework",
      name: "Next.js",
      wordmark: "Next.js",
      thanks: "for the framework every generated project ships on.",
      accent: "from-zinc-200/40 to-zinc-500/30",
      ink: "text-zinc-100",
    },
    {
      role: "host",
      name: "Vercel",
      wordmark: "▲ Vercel",
      thanks: "for the deploys that go live before we finish typing.",
      accent: "from-zinc-200/40 to-blue-500/30",
      ink: "text-zinc-100",
    },
    {
      role: "auth",
      name: "Clerk",
      wordmark: "Clerk",
      thanks: "for the sign-in flow we never had to design.",
      accent: "from-purple-400/40 to-indigo-500/30",
      ink: "text-purple-200",
    },
    {
      role: "data",
      name: "Prisma",
      wordmark: "Prisma",
      thanks: "for the schema that survives every refactor.",
      accent: "from-cyan-300/40 to-sky-500/30",
      ink: "text-cyan-100",
    },
    {
      role: "ui",
      name: "shadcn/ui",
      wordmark: "shadcn",
      thanks: "for the components we copy-paste with pride.",
      accent: "from-rose-400/40 to-pink-500/30",
      ink: "text-rose-200",
    },
    {
      role: "collab",
      name: "Yjs",
      wordmark: "Yjs",
      thanks: "for the CRDTs that let many cursors share one file.",
      accent: "from-lime-300/40 to-emerald-500/30",
      ink: "text-lime-100",
    },
  ];

  return (
    <section
      ref={sectionRef}
      className="relative h-screen overflow-hidden border-t border-black/5 dark:border-white/5 text-white"
    >
      {/* This section is pinned for a long scroll distance — every paint */}
      {/* under it costs CPU/GPU each frame. Skip the section-wide rim-light */}
      {/* orb (it would repaint the full viewport on every scroll tick) and */}
      {/* use a static gradient + the global noise/grid that already bleed */}
      {/* through. Just the hairline divider stays for the panel-edge cue. */}
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
      <div className="relative h-full flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 lg:px-12 pt-16 lg:pt-24 pb-6 lg:pb-10">
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
          <div className="hidden md:flex items-center gap-3 font-mono text-xs text-white/60">
            <span>scroll</span>
            <span className="inline-block h-px w-12 bg-white/30" />
            <span>→</span>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex items-center">
          <div
            ref={trackRef}
            // contain:layout+paint isolates each card's repaints from the
            // section. transform:translateZ(0) on the track promotes it to
            // its own GPU layer so the x-translate runs on the compositor.
            className="flex gap-6 lg:gap-8 pl-4 sm:pl-6 lg:pl-12 transform-[translateZ(0)] contain-[layout_paint]"
          >
            {partners.map((p, i) => (
              <article
                key={p.name}
                // No backdrop-blur — its scroll cost is enormous (the GPU
                // re-rasterizes the blur over each card every frame). A
                // solid bg-zinc-950 reads almost identically against the
                // dark route background and scrolls at 60fps.
                className="relative shrink-0 w-[78vw] sm:w-[60vw] md:w-[42vw] lg:w-[34vw] xl:w-[28vw] aspect-4/5 rounded-3xl overflow-hidden border border-white/10 bg-zinc-950 contain-[layout_paint]"
              >
                {/* Accent gradient cornered to top-right — frames the card */}
                {/* without burying the type in saturation. blur-2xl (not 3xl) */}
                {/* halves the kernel cost without losing the glow. */}
                <div
                  className={`absolute -top-20 -right-20 h-64 w-64 rounded-full blur-2xl bg-linear-to-br ${p.accent}`}
                />

                <div className="relative h-full p-7 lg:p-8 flex flex-col">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/55">
                      {p.role}
                    </span>
                    <span className="font-mono text-[10px] text-white/45">
                      /{String(i + 1).padStart(2, "0")}
                    </span>
                  </div>

                  {/* Big wordmark anchors the card. Hairline above gives */}
                  {/* it editorial weight without needing a logo asset. */}
                  <div className="mt-auto">
                    <span className="block h-px w-10 bg-white/30 mb-5" />
                    <div
                      className={`font-semibold tracking-[-0.02em] text-4xl lg:text-5xl xl:text-6xl leading-none mb-5 ${p.ink}`}
                    >
                      {p.wordmark}
                    </div>
                    <p className="text-sm text-white/70 leading-relaxed max-w-[24ch]">
                      {p.thanks}
                    </p>
                  </div>
                </div>
              </article>
            ))}
            {/* spacer so last card has breathing room before the pin releases */}
            <div className="shrink-0 w-12" />
          </div>
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
  onStart: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useSplitHeadingReveal(headingRef, { stagger: 0.08, start: "top 78%" });

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
      gsap.from(el.querySelector("[data-cta-button]"), {
        scale: 0.9,
        opacity: 0,
        duration: 0.7,
        ease: "back.out(1.6)",
        scrollTrigger: { trigger: el, start: "top 70%", once: true },
      });
    }, el);
    return () => ctx.revert();
  }, []);

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
          Type one sentence at the top of this page. Watch the agent build the
          rest. Edit anything. Ship when it&rsquo;s ready.
        </p>
        <div className="mt-12 flex items-center justify-center gap-4" data-cta-button>
          <Button
            size="lg"
            onClick={onStart}
            className="group relative h-14 px-8 rounded-full bg-linear-to-br from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white text-base font-medium shadow-2xl shadow-blue-500/30 transition-all"
          >
            <span className="relative flex items-center gap-2">
              Start building
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Button>
          <span className="hidden sm:inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <Layers className="h-3.5 w-3.5" />
            takes one sentence
          </span>
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

  const handleStart = () => {
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    const id = crypto.randomUUID();
    router.push(`/chat/${id}`);
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
