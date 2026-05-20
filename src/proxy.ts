import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher(['/', '/sign-in(.*)', '/sign-up(.*)'])

// Requests that authenticate themselves via a `?token=` share token (instead
// of a Clerk session). The route handlers re-validate the token before doing
// anything sensitive — middleware just needs to step out of the way.
function isShareTokenedRequest(req: Request): boolean {
  const url = new URL(req.url)
  if (!url.searchParams.has('token')) return false
  return (
    url.pathname.startsWith('/chat/')
    || /^\/api\/session\/[^/]+\/?$/.test(url.pathname)
  )
}

// /api/write-to-sandbox is open to both owners (signed in) and collaborators
// (carrying sessionId + shareToken in the body). The route handler validates.
function isSandboxWrite(req: Request): boolean {
  const url = new URL(req.url)
  return url.pathname === '/api/write-to-sandbox'
}

// GET /api/session/<id> stays accessible without `?token=` for owners hitting
// it from a normal Clerk session. Non-owners get 403 from the route handler.
function isPublicSessionRead(req: Request): boolean {
  if (req.method !== 'GET') return false
  const url = new URL(req.url)
  return /^\/api\/session\/[^/]+\/?$/.test(url.pathname)
}

export default clerkMiddleware(async (auth, req) => {
  if (
    isPublicRoute(req)
    || isShareTokenedRequest(req)
    || isSandboxWrite(req)
    || isPublicSessionRead(req)
  ) return
  await auth.protect()
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
    // Always run for Clerk-specific frontend API routes
    '/__clerk/(.*)',
  ],
}