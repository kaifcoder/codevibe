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

// /api/download-project follows the same pattern: owner (Clerk) or
// collaborator (sessionId + shareToken in body). Route validates.
function isProjectDownload(req: Request): boolean {
  const url = new URL(req.url)
  return url.pathname === '/api/download-project'
}

// /api/deploy-to-vercel — same owner-or-collaborator pattern. The route
// re-validates the session and the user's Vercel token comes from their own
// browser, so middleware just steps aside.
function isVercelDeploy(req: Request): boolean {
  const url = new URL(req.url)
  return url.pathname === '/api/deploy-to-vercel'
}

// /api/rewarm-sandbox — owner or collaborator can re-provision an expired
// sandbox. Route re-validates against the session row.
function isSandboxRewarm(req: Request): boolean {
  const url = new URL(req.url)
  return url.pathname === '/api/rewarm-sandbox'
}

// /api/sandbox-health — owner or collaborator can poll whether the session's
// sandbox is still alive. Route re-validates against the session row.
function isSandboxHealth(req: Request): boolean {
  const url = new URL(req.url)
  return url.pathname === '/api/sandbox-health'
}

// /api/agent-ready — anonymous probe so the home page can show "Waking up
// the backend" before the user signs in. No session data leaves the route;
// it just forwards a HEAD-style GET to the LangGraph dyno.
function isAgentReady(req: Request): boolean {
  const url = new URL(req.url)
  return url.pathname === '/api/agent-ready'
}

// GET /api/session/<id> stays accessible without `?token=` for owners hitting
// it from a normal Clerk session. Non-owners get 403 from the route handler.
function isPublicSessionRead(req: Request): boolean {
  if (req.method !== 'GET') return false
  const url = new URL(req.url)
  return /^\/api\/session\/[^/]+\/?$/.test(url.pathname)
}

// /api/mcp/internal/* and /api/ingest/* are server-to-server routes used by
// the langgraph-api container to read/write MCP credentials and emit
// usage/abuse signals. They authenticate via a shared INTERNAL_AGENT_SECRET
// (route handler validates), not via Clerk.
function isInternalMcpRoute(req: Request): boolean {
  const url = new URL(req.url)
  return (
    url.pathname.startsWith('/api/mcp/internal/')
    || url.pathname.startsWith('/api/ingest/')
  )
}

export default clerkMiddleware(async (auth, req) => {
  if (
    isPublicRoute(req)
    || isShareTokenedRequest(req)
    || isSandboxWrite(req)
    || isProjectDownload(req)
    || isVercelDeploy(req)
    || isSandboxRewarm(req)
    || isSandboxHealth(req)
    || isAgentReady(req)
    || isPublicSessionRead(req)
    || isInternalMcpRoute(req)
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