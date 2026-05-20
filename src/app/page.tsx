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
} from "lucide-react"
import { useAuth, SignInButton, useClerk } from "@clerk/nextjs"



export default function HomePage() {
  const [prompt, setPrompt] = useState("")
  const [particles, setParticles] = useState<Array<{ id: string; left: string; top: string; duration: number; delay: number }>>([])
  const { isSignedIn, isLoaded } = useAuth()
  const { openSignIn } = useClerk()
  
  const router = useRouter()

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
    <div className="flex h-full rounded-b-lg bg-gradient-to-b from-white to-gray-50 dark:from-[#0a0a0a] dark:to-[#0f0f0f] dark:text-white relative overflow-hidden">
      {/* Animated Background Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Gradient Orbs */}
        <motion.div
          animate={{
            x: [0, 100, 0],
            y: [0, 50, 0],
            scale: [1, 1.2, 1],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute -top-40 -left-40 w-80 h-80 bg-blue-400/20 dark:bg-blue-600/10 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, -100, 0],
            y: [0, 100, 0],
            scale: [1, 1.3, 1],
          }}
          transition={{
            duration: 25,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-400/20 dark:bg-purple-600/10 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, -50, 0],
            y: [0, -50, 0],
            scale: [1, 1.1, 1],
          }}
          transition={{
            duration: 18,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute top-1/2 right-1/4 w-72 h-72 bg-cyan-400/20 dark:bg-cyan-600/10 rounded-full blur-3xl"
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
        
        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px] dark:bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)]" />
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
                {/* Soft animated glow */}
                <div className="pointer-events-none absolute -inset-1 rounded-4xl bg-linear-to-r from-blue-500 via-purple-500 to-blue-500 opacity-40 blur-2xl group-focus-within:opacity-70 transition-opacity duration-500" />
                <div className="pointer-events-none absolute -inset-px rounded-4xl bg-linear-to-r from-blue-500/40 via-purple-500/40 to-blue-500/40 opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!isSignedIn) {
                      openSignIn()
                      return
                    }
                    handleStartChat()
                  }}
                  className="relative flex items-center gap-3 bg-background/80 dark:bg-[#0f0f12]/90 backdrop-blur-xl rounded-4xl border border-border/80 px-6 py-4 shadow-2xl shadow-blue-500/10 dark:shadow-blue-500/20 focus-within:border-blue-500/60 transition-all"
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
                        className="h-12 w-12 rounded-full shrink-0 bg-linear-to-br from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white shadow-lg shadow-blue-500/30 transition-all"
                      >
                        <ArrowRight className="w-5 h-5" />
                      </Button>
                    </SignInButton>
                  ) : (
                    <Button
                      type="submit"
                      size="icon"
                      disabled={!prompt.trim()}
                      className="h-12 w-12 rounded-full shrink-0 bg-linear-to-br from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:shadow-none transition-all"
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
        
      </div>
    </div>
  )
}
