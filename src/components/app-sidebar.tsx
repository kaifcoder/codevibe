"use client"

import { BotIcon, MessagesSquareIcon, Trash2Icon, MoreHorizontalIcon, Trash } from "lucide-react"
import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
  SidebarFooter,
} from "@/components/ui/sidebar"
import Link from "next/link"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface ChatSession {
  id: string
  title: string
  timestamp: number
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [recentChats, setRecentChats] = useState<ChatSession[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [chatToDelete, setChatToDelete] = useState<string | null>(null)
  const [clearAllDialogOpen, setClearAllDialogOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  const handleDeleteChat = (chatId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setChatToDelete(chatId)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (chatToDelete) {
      try {
        // Delete from database
        await fetch(`/api/session/${chatToDelete}`, {
          method: 'DELETE',
        })
        
        // If we're currently viewing the deleted chat, redirect to home
        if (pathname === `/chat/${chatToDelete}`) {
          router.push('/')
        }
        
        // Trigger reload of chat list
        globalThis.dispatchEvent(new CustomEvent('chatUpdated'))
      } catch (error) {
        console.error('[Sidebar] Failed to delete session:', error)
      }
    }
    setDeleteDialogOpen(false)
    setChatToDelete(null)
  }

  const handleClearAll = () => {
    setClearAllDialogOpen(true)
  }

  const confirmClearAll = async () => {
    try {
      // Delete all sessions from database
      await fetch('/api/sessions', {
        method: 'DELETE',
      })
      
      // Redirect to home page
      router.push('/')
      
      // Trigger reload of chat list
      globalThis.dispatchEvent(new CustomEvent('chatUpdated'))
    } catch (error) {
      console.error('[Sidebar] Failed to clear all sessions:', error)
    }
    setClearAllDialogOpen(false)
  }

  useEffect(() => {
    // Load recent chats from database
    const loadRecentChats = async () => {
      try {
        // Fetch sessions from the database API
        const response = await fetch('/api/sessions')
        if (!response.ok) {
          console.error('[Sidebar] Failed to fetch sessions:', response.statusText)
          return
        }
        
        const sessions = await response.json()
        
        // Map to ChatSession format
        const chats: ChatSession[] = sessions
          .filter((session: any) => {
            // Only show chats that have user messages
            const messages = Array.isArray(session.messages) ? session.messages : []
            return messages.some((m: any) => m.role === 'user')
          })
          .map((session: any) => {
            const messages = Array.isArray(session.messages) ? session.messages : []
            const firstMessage = messages.find((m: any) => m.role === 'user')
            const title = session.title || firstMessage?.content?.slice(0, 50) || 'New Chat'
            const timestamp = new Date(session.createdAt).getTime()
            
            return {
              id: session.id,
              title: title.length > 50 ? title + '...' : title,
              timestamp
            }
          })
          .sort((a: ChatSession, b: ChatSession) => b.timestamp - a.timestamp)
          .slice(0, 10)
        
        setRecentChats(chats)
      } catch (error) {
        console.error('[Sidebar] Error loading sessions:', error)
      }
    }

    loadRecentChats()

    // Debounce the storage change handler to prevent excessive updates
    let timeoutId: NodeJS.Timeout
    const handleStorageChange = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        loadRecentChats()
      }, 300)
    }

    globalThis.addEventListener('storage', handleStorageChange)
    // Also listen for custom event when chat is updated in same tab
    globalThis.addEventListener('chatUpdated', handleStorageChange)

    return () => {
      clearTimeout(timeoutId)
      globalThis.removeEventListener('storage', handleStorageChange)
      globalThis.removeEventListener('chatUpdated', handleStorageChange)
    }
  }, [])

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <Link href="/">
                <BotIcon className="!size-5" />
                <span className="text-base font-semibold">CodeVibe</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Recent Chats</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {recentChats.length === 0 ? (
                <SidebarMenuItem>
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No recent chats
                  </div>
                </SidebarMenuItem>
              ) : (
                recentChats.map((chat) => (
                  <SidebarMenuItem key={chat.id}>
                    <SidebarMenuButton asChild>
                      <Link href={`/chat/${chat.id}`}>
                        <MessagesSquareIcon />
                        <span className="truncate">{chat.title}</span>
                      </Link>
                    </SidebarMenuButton>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction showOnHover>
                          <MoreHorizontalIcon className="h-4 w-4" />
                          <span className="sr-only">More options</span>
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="bottom" align="center">
                        <DropdownMenuItem
                          onClick={(e) => handleDeleteChat(chat.id, e as any)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2Icon className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleClearAll}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              tooltip="Clear All Chats"
            >
              <Trash />
              <span>Clear All Chats</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete this chat conversation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      <AlertDialog open={clearAllDialogOpen} onOpenChange={setClearAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Chats?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete all chat conversations and data from your browser.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmClearAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Clear All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  )
}