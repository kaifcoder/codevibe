"use client"

import { BotIcon, MessagesSquareIcon, Trash2Icon, MoreHorizontalIcon, PlusIcon, SettingsIcon, Sun, Moon, Monitor, Palette, UserIcon, LogOutIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useAuth, useUser, useClerk } from "@clerk/nextjs"
import { useTheme } from "next-themes"
import { useSettings } from "@/contexts/settings-context"

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
  SidebarTrigger,
} from "@/components/ui/sidebar"
import Link from "next/link"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  const { isSignedIn, isLoaded } = useAuth()
  const { open: openSettings } = useSettings()
  const { user } = useUser()
  const { openUserProfile, signOut } = useClerk()
  const { setTheme } = useTheme()

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
    // Load recent chats from database only if signed in
    const loadRecentChats = async () => {
      // Clear chats if not signed in
      if (!isLoaded || !isSignedIn) {
        setRecentChats([])
        return
      }
      
      try {
        // Fetch sessions from the database API
        const response = await fetch('/api/sessions')
        if (!response.ok) {
          console.error('[Sidebar] Failed to fetch sessions:', response.statusText)
          setRecentChats([])
          return
        }
        
        const sessions = await response.json() as Array<{
          id: string
          title?: string | null
          updatedAt?: string | null
          createdAt?: string | null
        }>

        // Map to ChatSession format
        const chats: ChatSession[] = sessions
          .map((session) => {
            const title = session.title || 'New Chat'
            const timestamp = new Date(session.updatedAt || session.createdAt || Date.now()).getTime()

            return {
              id: session.id,
              title: title.length > 50 ? title.slice(0, 50) + '...' : title,
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
  }, [isLoaded, isSignedIn])

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="relative flex items-center gap-1">
              <SidebarMenuButton
                asChild
                className="data-[slot=sidebar-menu-button]:p-1.5! flex-1 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:group-hover:opacity-0 transition-opacity"
              >
                <Link href="/">
                  <BotIcon className="size-5!" />
                  <span className="text-base font-semibold">CodeVibe</span>
                </Link>
              </SidebarMenuButton>
              <SidebarTrigger className="shrink-0 group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:inset-0 group-data-[collapsible=icon]:m-auto group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:group-hover:opacity-100 transition-opacity" />
            </div>
          </SidebarMenuItem>
          {isLoaded && isSignedIn && (
            <SidebarMenuItem className="mt-5">
              <SidebarMenuButton
                asChild
                tooltip="New Chat"
                className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
              >
                <Link href="/">
                  <PlusIcon className="size-4!" />
                  <span className="font-medium">New Chat</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {isLoaded && isSignedIn ? (
          <SidebarGroup>
            <SidebarGroupLabel>Recent Chats</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {recentChats.length === 0 ? (
                  <SidebarMenuItem>
                    <div className="px-2 py-1.5 text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">
                      No recent chats
                    </div>
                  </SidebarMenuItem>
                ) : (
                  recentChats.map((chat) => (
                    <SidebarMenuItem key={chat.id}>
                      <SidebarMenuButton asChild isActive={pathname === `/chat/${chat.id}`}>
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
                            onClick={(e) => handleDeleteChat(chat.id, e as React.MouseEvent)}
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
        ) : (
          <SidebarGroup>
            <SidebarGroupContent>
              <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                Sign in to see your chats
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      
      {isLoaded && isSignedIn && (
        <SidebarFooter>
          <div className="flex items-center group-data-[collapsible=icon]:justify-center">
            <a
              href="https://github.com/kaifcoder/codevibe"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub repository"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-4 w-4 shrink-0"
                aria-hidden="true"
              >
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.16-.02-2.11-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18.91-.25 1.89-.38 2.86-.38.97 0 1.95.13 2.86.38 2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
              </svg>
              <span className="truncate group-data-[collapsible=icon]:hidden">GitHub</span>
            </a>
          </div>
          <div className="flex items-center gap-2 group-data-[collapsible=icon]:flex-col-reverse group-data-[collapsible=icon]:gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex flex-1 min-w-0 items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:p-1"
                  aria-label={user?.fullName || user?.primaryEmailAddress?.emailAddress || "Account"}
                >
                  <Avatar className="h-8 w-8 rounded-full shrink-0">
                    {user?.imageUrl && <AvatarImage src={user.imageUrl} alt={user?.fullName || "User"} />}
                    <AvatarFallback className="rounded-full text-xs">
                      {(user?.fullName || user?.primaryEmailAddress?.emailAddress || "U")
                        .split(" ")
                        .map((s) => s[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight min-w-0 group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-medium">
                      {user?.fullName || user?.primaryEmailAddress?.emailAddress || "Account"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user?.fullName ? user?.primaryEmailAddress?.emailAddress : "Free"}
                    </span>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium truncate">
                    {user?.fullName || user?.primaryEmailAddress?.emailAddress || "Account"}
                  </p>
                  {user?.fullName && (
                    <p className="text-xs text-muted-foreground truncate">
                      {user?.primaryEmailAddress?.emailAddress}
                    </p>
                  )}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => openUserProfile()}>
                  <UserIcon className="h-4 w-4 mr-2" />
                  Manage account
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => signOut({ redirectUrl: "/" })}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOutIcon className="h-4 w-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Settings"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <SettingsIcon className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" className="ml-3 w-56">
                <DropdownMenuItem onSelect={() => openSettings("apps")}>
                  <SettingsIcon className="h-4 w-4 mr-2" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Palette className="h-4 w-4 mr-2" />
                    Theme
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => setTheme("light")}>
                      <Sun className="h-4 w-4 mr-2" />
                      Light
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme("dark")}>
                      <Moon className="h-4 w-4 mr-2" />
                      Dark
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme("system")}>
                      <Monitor className="h-4 w-4 mr-2" />
                      System
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleClearAll}
                  disabled={recentChats.length <= 1}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2Icon className="h-4 w-4 mr-2" />
                  Delete all chats
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

          </div>
        </SidebarFooter>
      )}
      
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