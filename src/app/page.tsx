"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  ArrowRight,
  ListTodo,
  Timer,
  CloudSun,
  Sparkles,
  ChevronDown,
} from "lucide-react"
import { useAuth, SignInButton, useClerk } from "@clerk/nextjs"
import { useAgentReady } from "@/hooks/use-agent-ready"
import { BackendWarmingBanner } from "@/components/BackendWarmingBanner"
import LandingSections from "@/components/landing/LandingSections"



export default function HomePage() {
  const [prompt, setPrompt] = useState("")
  const agentReady = useAgentReady()
  const [particles, setParticles] = useState<Array<{ id: string; left: string; top: string; duration: number; delay: number }>>([])
  const { isSignedIn, isLoaded } = useAuth()
  const { openSignIn } = useClerk()

  const router = useRouter()

  // Persist the in-flight prompt across the Clerk sign-up flow. Email
  // verification can redirect away and back, which wipes useState. We stash
  // the prompt + a "pending sign-in" flag in sessionStorage when auth is
  // triggered, and pick it up again once Clerk hydrates as signed in.
  const PENDING_PROMPT_KEY = "codevibe.pendingPrompt"
  const PENDING_FLAG_KEY = "codevibe.pendingSignIn"

  const stashPendingPrompt = (text: string) => {
    if (!text.trim()) return
    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, text)
      sessionStorage.setItem(PENDING_FLAG_KEY, "1")
    } catch {
      // sessionStorage may be unavailable (private mode, quota) — degrade
      // silently; the user just loses the prompt the way they did before.
    }
  }

  // Restore (or auto-navigate with) any prompt that survived an auth round-trip.
  useEffect(() => {
    if (!isLoaded) return
    let pending: string | null = null
    let flag: string | null = null
    try {
      pending = sessionStorage.getItem(PENDING_PROMPT_KEY)
      flag = sessionStorage.getItem(PENDING_FLAG_KEY)
    } catch {
      return
    }

    if (isSignedIn && flag && pending?.trim()) {
      try {
        sessionStorage.removeItem(PENDING_PROMPT_KEY)
        sessionStorage.removeItem(PENDING_FLAG_KEY)
      } catch {}
      const chatId = crypto.randomUUID()
      router.replace(`/chat/${chatId}?prompt=${encodeURIComponent(pending)}`)
      return
    }

    // Still logged out (modal closed without auth, or returned mid-flow) —
    // refill the textarea so the user doesn't have to retype.
    if (!isSignedIn && pending && !prompt) {
      setPrompt(pending)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn])

  useEffect(() => {
    // Generate particles only on client side to avoid hydration mismatch
    setParticles(
      Array.from({ length: 20 }, (_, i) => ({
        id: `particle-${i}-${Date.now()}`,
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        duration: 3 + Math.random() * 2,
        delay: Math.random() * 5,
      }))
    )
  }, [])

  const generateChatId = () => {
    return crypto.randomUUID()
  }

  const phrases = [
    "What do you want to build today?",
    "Got an idea? Let's bring it to life.",
    "Describe an app. Ship a prototype.",
    "Turn a sentence into a real product.",
    "What should we build next?",
  ]
  const [phraseIdx, setPhraseIdx] = useState(0)
  const [typed, setTyped] = useState("")

  useEffect(() => {
    const phrase = phrases[phraseIdx]
    setTyped("")
    let i = 0
    const typeInterval = setInterval(() => {
      i++
      setTyped(phrase.slice(0, i))
      if (i >= phrase.length) clearInterval(typeInterval)
    }, 45)

    const advanceTimeout = setTimeout(() => {
      setPhraseIdx((p) => (p + 1) % phrases.length)
    }, 7000)

    return () => {
      clearInterval(typeInterval)
      clearTimeout(advanceTimeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phraseIdx])

  const handleStartChat = () => {
    if (!prompt.trim()) return
    if (!isSignedIn) return // Don't proceed if not signed in

    const chatId = generateChatId()

    // Hand off the initial prompt via URL search param — the chat page
    // reads it on mount, auto-sends it, then strips it from the URL.
    router.push(`/chat/${chatId}?prompt=${encodeURIComponent(prompt)}`)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (!isSignedIn) {
        stashPendingPrompt(prompt)
        openSignIn()
        return
      }
      handleStartChat()
    }
  }


  const suggestions = [
    {
      icon: <ListTodo className="w-4 h-4" />,
      label: "Todo app",
      prompt: "A todo app with drag-and-drop reordering, due dates, and categories.",
    },
    {
      icon: <Timer className="w-4 h-4" />,
      label: "Pomodoro timer",
      prompt: "A pomodoro timer with customizable work/break intervals and session history.",
    },
    {
      icon: <CloudSun className="w-4 h-4" />,
      label: "Weather dashboard",
      prompt: "A weather dashboard with current conditions and a 5-day forecast for any city.",
    },
  ]

  return (
    // The layout's wrapper applies overflow-hidden, so the page itself is
    // the scroll container. h-full + overflow-y-auto turns the route into
    // its own vertical scroller — hero is the first viewport, sections
    // follow below.
    <div
      id="cv-scroll-root"
      className="relative h-full overflow-y-auto overscroll-contain rounded-b-lg bg-white dark:bg-[#070708] dark:text-white"
    >
      {/* ─── Global atmosphere — one shared layer for the whole route ──── */}
      {/* Fine line grid (0.5px) — readable but disappears against content. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 hidden dark:block"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.035) 0.5px, transparent 0.5px), linear-gradient(to bottom, rgba(255,255,255,0.035) 0.5px, transparent 0.5px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(ellipse at 50% 30%, black 30%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at 50% 30%, black 30%, transparent 80%)",
        }}
      />
      {/* SVG noise grain — one shared sprite, very low opacity. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 hidden dark:block opacity-[0.045] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          backgroundSize: "160px 160px",
        }}
      />
      {/* Subtle top-of-page color seam so the hero isn't isolated. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-px z-0 hidden dark:block bg-linear-to-r from-transparent via-blue-500/40 to-transparent"
      />

      <div className="absolute top-0 inset-x-0 z-50">
        <BackendWarmingBanner warming={agentReady.warming} />
      </div>

      {/* ─── HERO (preserved, just wrapped to be exactly one viewport) ─── */}
      <section className="relative min-h-[calc(100svh-3rem)] flex overflow-hidden">
        {/* Hero atmosphere — one rim-light orb + particles. The global noise */}
        {/* + line grid live on the route wrapper (above) and bleed through. */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{
            x: [0, 60, 0],
            y: [0, 30, 0],
            scale: [1, 1.15, 1],
          }}
          transition={{
            duration: 24,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute -top-48 left-1/2 -translate-x-1/2 w-2xl h-[42rem] bg-blue-500/15 dark:bg-blue-500/[0.07] rounded-full blur-[120px]"
        />

        {/* Floating Particles */}
        {particles.map((particle) => (
          <motion.div
            key={particle.id}
            animate={{
              y: [-20, -100],
              opacity: [0, 1, 0],
            }}
            transition={{
              duration: particle.duration,
              repeat: Infinity,
              delay: particle.delay,
              ease: "easeOut",
            }}
            className="absolute w-1 h-1 bg-blue-400/40 dark:bg-blue-500/30 rounded-full"
            style={{
              left: particle.left,
              top: particle.top,
            }}
          />
        ))}
      </div>

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Main Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
          className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 py-8 lg:py-16"
        >
          <div className="w-full max-w-2xl mx-auto">
            {/* Main Heading */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.6 }}
              className="text-center mb-8 lg:mb-12"
            >

              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold dark:text-white mb-3 px-4 leading-tight min-h-[2.5em] flex items-center justify-center">
                <span>
                  {typed}
                  <span
                    aria-hidden
                    className="inline-block w-0.5 h-[0.9em] bg-current ml-1 align-[-0.1em] animate-pulse"
                  />
                </span>
              </h1>
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 max-w-xl mx-auto px-4">
                Describe your idea and watch it come to life with AI assistance
              </p>
            </motion.div>

            {/* Prompt Input Box */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="mb-4 lg:mb-6"
            >
              <div className="relative group">
                {/* Soft ambient halo — kept subtle, no rounded-4xl. The actual */}
                {/* animated outline is the cv-animated-border on the form below. */}
                <div className="pointer-events-none absolute -inset-3 rounded-3xl bg-linear-to-r from-blue-500/30 via-purple-500/30 to-cyan-500/30 opacity-40 blur-3xl group-focus-within:opacity-70 transition-opacity duration-500" />

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!isSignedIn) {
                      stashPendingPrompt(prompt)
                      openSignIn()
                      return
                    }
                    handleStartChat()
                  }}
                  className="cv-animated-border relative flex items-center gap-3 bg-background/90 dark:bg-[#0f0f12]/95 backdrop-blur-xl rounded-2xl border border-border/60 px-5 py-3 shadow-2xl shadow-blue-500/10 dark:shadow-blue-500/20 transition-all"
                >
                  <Sparkles className="w-6 h-6 text-blue-500/80 shrink-0" />
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Describe an app or site you want to create..."
                    className="flex-1 min-h-14 max-h-72 resize-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent dark:bg-transparent px-0 py-3 text-lg sm:text-xl leading-7 placeholder:text-muted-foreground/70"
                    rows={1}
                  />
                  {isLoaded && !isSignedIn ? (
                    <SignInButton mode="modal">
                      <Button
                        type="button"
                        size="icon"
                        onClick={() => stashPendingPrompt(prompt)}
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
              <p className="text-xs text-muted-foreground mt-3 text-center">
                Press <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[10px] font-mono">Enter</kbd> to send · <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[10px] font-mono">Shift</kbd> + <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[10px] font-mono">Enter</kbd> for new line
              </p>
            </motion.div>

            {/* Suggestions */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.6 }}
              className="space-y-3"
            >
              <p className="text-center text-xs uppercase tracking-wider font-medium text-muted-foreground">
                Try these examples
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {suggestions.map((suggestion) => (
                  <Button
                    key={`suggestion-${suggestion.label}`}
                    variant="ghost"
                    onClick={() => setPrompt(suggestion.prompt)}
                    className="group/pill flex items-center gap-2 h-auto px-4 py-2 bg-muted/40 hover:bg-muted/70 border border-border/40 hover:border-blue-500/40 rounded-full text-muted-foreground hover:text-foreground transition-all duration-200 text-sm font-normal backdrop-blur-sm"
                  >
                    <span className="text-blue-500/70 group-hover/pill:text-blue-500 transition-colors">
                      {suggestion.icon}
                    </span>
                    <span className="truncate max-w-35 sm:max-w-none">{suggestion.label}</span>
                  </Button>
                ))}
              </div>
            </motion.div>
          </div>
        </motion.div>

        {/* Scroll cue — small affordance that there's more below the fold */}
        <motion.button
          type="button"
          onClick={() => {
            // Scroll the page (the route's own scroller) to the next viewport.
            // Falls back to window for browsers without the new scrollIntoView.
            const next = document.getElementById("landing-sections")
            if (next) next.scrollIntoView({ behavior: "smooth", block: "start" })
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.6 }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 text-muted-foreground/70 hover:text-foreground transition-colors"
          aria-label="Scroll to learn more"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.25em]">scroll</span>
          <ChevronDown className="w-4 h-4 animate-bounce" />
        </motion.button>
      </div>
      </section>

      {/* ─── SCROLL-REVEAL SECTIONS ───────────────────────────────────── */}
      <div id="landing-sections">
        <LandingSections />
      </div>
    </div>
  )
}
