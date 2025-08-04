/* eslint-disable @typescript-eslint/no-explicit-any */
"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  ArrowRight,
  FileText,
  Calculator,
  ScanLine,
} from "lucide-react"



export default function HomePage() {
  const [prompt, setPrompt] = useState("")
  
  const router = useRouter()

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
    <div className="flex h-full rounded-b-lg dark:bg-[#0f0f0f] dark:text-white">

      <div className="flex-1 flex flex-col min-w-0">
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
              className="text-center mb-6 lg:mb-8"
            >
              <h1 className="text-2xl sm:text-3xl lg:text-3xl font-medium dark:text-white mb-6 lg:mb-8 px-4">
                Hi Kaif, what do you want to make?
              </h1>
            </motion.div>

            {/* Prompt Input Box */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="mb-4 lg:mb-6"
            >
              <div className="relative dark:bg-[#1a1a1a] border dark:border-[#333] rounded-lg overflow-hidden">
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Describe an app or site you want to create..."
                  className="w-full min-h-[100px] sm:min-h-[120px] px-3 sm:px-4 py-3 sm:py-4 text-sm sm:text-base dark:bg-transparent border-0 resize-none focus:ring-0 focus:outline-none dark:text-white dark:placeholder-gray-400"
                  rows={4}
                />

                {/* Bottom Bar */}
                <div className="flex items-center justify-end px-3 sm:px-4 py-2 sm:py-3 border-t dark:border-[#333] dark:bg-[#1a1a1a]">
                  <div className="flex items-center space-x-2 flex-shrink-0">
                 
                    <Button
                      onClick={handleStartChat}
                      disabled={!prompt.trim()}
                      className="bg-blue-600 hover:bg-blue-700 dark:text-white px-3 sm:px-4 py-1 text-xs sm:text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed h-6 sm:h-8"
                    >
                      Start chat
                    <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4" />
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
              className="flex flex-wrap gap-2 sm:gap-3 justify-center mb-8 lg:mb-12"
            >
              {suggestions.map((suggestion, index) => (
                <Button
                  key={index}
                  variant="ghost"
                  onClick={() => setPrompt(suggestion.text)}
                  className="flex items-center space-x-1 sm:space-x-2 px-2 sm:px-4 py-1.5 sm:py-2 dark:bg-[#1a1a1a] border dark:border-[#333] rounded-lg dark:hover:bg-[#2a2a2a] dark:text-gray-300 dark:hover:text-white transition-colors text-xs sm:text-sm"
                >
                  {suggestion.icon}
                  <span className="truncate max-w-[120px] sm:max-w-none">{suggestion.text}</span>
                </Button>
              ))}
            </motion.div>
          </div>
        </motion.div>
        
      </div>
    </div>
  )
}
