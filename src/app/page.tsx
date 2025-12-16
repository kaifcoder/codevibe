"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  ArrowRight,
  FileText,
  Calculator,
  ScanLine,
  Sparkles,
} from "lucide-react"



export default function HomePage() {
  const [prompt, setPrompt] = useState("")
  const [particles, setParticles] = useState<Array<{ id: string; left: string; top: string; duration: number; delay: number }>>([])
  
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
    return `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  const handleStartChat = () => {
    if (!prompt.trim()) return

    const chatId = generateChatId()

    // Store the initial prompt and app type in sessionStorage
    sessionStorage.setItem(`chat_${chatId}_initial`, prompt)

    // Navigate to the chat page
    router.push(`/chat/${chatId}`)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault()
      handleStartChat()
    }
  }


  const suggestions = [
    { icon: <FileText className="w-4 h-4" />, text: "Personal blog" },
    { icon: <Calculator className="w-4 h-4" />, text: "Statistical significance calculator" },
    { icon: <ScanLine className="w-4 h-4" />, text: "Book scanner" },
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
              <div className="inline-flex items-center justify-center mb-4 px-4 py-2 rounded-full bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
                <Sparkles className="w-4 h-4 mr-2 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-medium text-blue-600 dark:text-blue-400">AI-Powered Development</span>
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold dark:text-white mb-4 px-4 leading-tight">
                What do you want to build today?
              </h1>
              <p className="text-base sm:text-lg text-gray-600 dark:text-gray-400 max-w-xl mx-auto px-4">
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
              <div className="relative bg-white dark:bg-[#1a1a1a] border-2 border-gray-200 dark:border-[#333] rounded-xl shadow-lg dark:shadow-none overflow-hidden transition-all duration-200 hover:border-blue-300 dark:hover:border-blue-900 focus-within:border-blue-500 dark:focus-within:border-blue-700 focus-within:shadow-xl">
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Describe an app or site you want to create..."
                  className="w-full min-h-[120px] sm:min-h-[140px] px-4 sm:px-5 py-4 sm:py-5 text-base sm:text-lg dark:bg-transparent border-0 resize-none focus:ring-0 focus:outline-none text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                  rows={4}
                />

                {/* Bottom Bar */}
                <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-t border-gray-200 dark:border-[#333] bg-gray-50 dark:bg-[#161616]">
                  <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                    Press <kbd className="px-2 py-1 bg-white dark:bg-[#2a2a2a] border border-gray-300 dark:border-[#444] rounded text-xs font-mono">⌘</kbd> + <kbd className="px-2 py-1 bg-white dark:bg-[#2a2a2a] border border-gray-300 dark:border-[#444] rounded text-xs font-mono">Enter</kbd> to start
                  </div>
                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <Button
                      onClick={handleStartChat}
                      disabled={!prompt.trim()}
                      className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white px-4 sm:px-6 py-2 sm:py-2.5 text-sm sm:text-base rounded-lg disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-md hover:shadow-lg transition-all duration-200 h-9 sm:h-10 gap-2"
                    >
                      Start Building
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Suggestions */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.6 }}
              className="space-y-3"
            >
              <p className="text-center text-sm font-medium text-gray-700 dark:text-gray-300">
                Try these examples:
              </p>
              <div className="flex flex-wrap gap-2 sm:gap-3 justify-center">
                {suggestions.map((suggestion) => (
                  <Button
                    key={`suggestion-${suggestion.text}`}
                    variant="outline"
                    onClick={() => setPrompt(suggestion.text)}
                    className="flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 bg-white dark:bg-[#1a1a1a] border-2 border-gray-200 dark:border-[#333] rounded-xl hover:border-blue-400 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-[#1a2a3a] text-gray-700 dark:text-gray-300 hover:text-blue-700 dark:hover:text-blue-400 transition-all duration-200 text-sm sm:text-base font-medium shadow-sm hover:shadow-md"
                  >
                    {suggestion.icon}
                    <span className="truncate max-w-[140px] sm:max-w-none">{suggestion.text}</span>
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
