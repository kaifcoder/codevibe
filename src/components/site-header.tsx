import { Button } from "@/components/ui/button"
import {
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function SiteHeader() {
  return (
    <>
      <SignedOut>
        <header className="sticky top-0 z-10 flex h-(--header-height) shrink-0 items-center gap-2 bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
          <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" asChild size="sm" className="hidden sm:flex">
                <a
                  href="https://github.com/kaifcoder/codevibe"
                  rel="noopener noreferrer"
                  target="_blank"
                  className="dark:text-foreground"
                >
                  GitHub
                </a>
              </Button>
              <SignInButton mode="modal">
                <Button variant="ghost" size="sm" className="cursor-pointer">
                  Sign In
                </Button>
              </SignInButton>
            </div>
          </div>
        </header>
      </SignedOut>

      {/* Mobile-only header for signed-in users — gives them a way to open
          the sidebar (sessions list, theme, sign out). Hidden on md+ since
          the desktop sidebar trigger is part of the sidebar itself. */}
      <SignedIn>
        <header className="md:hidden sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
          <SidebarTrigger className="h-9 w-9" />
          <span className="font-semibold text-sm">CodeVibe</span>
          <div className="ml-auto">
            <UserButton afterSignOutUrl="/" />
          </div>
        </header>
      </SignedIn>
    </>
  )
}
