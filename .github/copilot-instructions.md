# CodeVibe - AI Coding Agent Instructions

## Project Overview

CodeVibe is a collaborative AI-powered code editor with real-time synchronization. It combines:
- **Real-time collaboration** via Yjs CRDT (WebSocket on port 1234)
- **E2B sandboxed execution** for running Next.js apps (25-minute TTL)
- **LangGraph AI agent** using GPT-5 (2025-08-07)
- **MCP integration** for Playwright browser automation and Next.js docs
- **tRPC + Prisma** for type-safe APIs and PostgreSQL persistence
- **Clerk authentication** for user management and session ownership
- **Zustand** for client-side state management
- **Next.js 16** with App Router, React 19, and Turbopack

## Architecture: Three-Way Sync System

The core complexity is **three-way synchronization** between Monaco Editor, Yjs CRDT, and E2B filesystem:

```
User/Agent Edits → Monaco Editor → Yjs Document (source of truth) → E2B Filesystem
                                          ↓
                                  Other Users' Editors
```

**Critical flow**: Agent writes via `e2b_write_file` → emits `agent:codePatch` events → Frontend updates Yjs → Monaco displays → debounced sync to E2B (1s).

## Key Files & Patterns

### 1. AI Agent Architecture (`src/lib/nextjs-coding-agent.ts`)
- Uses **LangChain `createReactAgent()`** (prebuilt agent, not custom StateGraph)
- Model: `AzureOpenAiChatClient` GPT-5 (2025-08-07) with `temperature: 1`
- Tools: `[memoryTools, e2bTools, playwrightTools, nextjsDocsTools]`
- MCP tools initialized once and cached (see `nextjsDocsToolsCache`, `playwrightToolsCache`)
- Memory: `MemorySaver` checkpointer (InMemory - use PostgresSaver for production)
- Recursion limit: 40 iterations
- Message compaction: Keeps last 10 messages, max 1500 chars per message

**Public API**:
- `invokeNextJsAgent()` - Synchronous invoke with message compaction
- `streamNextJsAgent()` - Async generator for real-time streaming

**Pattern**: Never modify workflow initialization - tools are cached globally. To add new tools, extend `baseTools` array.

### 2. Event-Driven Communication (`src/lib/event-emitter.ts`)
- **Singleton EventEmitter** using `Symbol.for('codevibe.globalEventEmitter')` to survive hot reloads
- SSE stream at `/api/stream` listens to global emitter and filters by `sessionId`

**Complete Event List**:
| Event | Payload | Origin |
|-------|---------|--------|
| `agent:status` | `{ status, message, hasSandbox }` | Agent invocation |
| `agent:partial` | `{ content, fullContent }` | Agent streaming response |
| `agent:tool` | `{ tool, args, result, status }` | Tool execution |
| `agent:sandbox` | `{ sandboxId, sandboxUrl, isNew }` | Sandbox creation |
| `agent:complete` | `{ response, sandboxUrl, hasSandbox }` | Agent task complete |
| `agent:error` | `{ error }` | Error handler |
| `agent:reasoning` | `{ reasoning }` | Agent thinking steps |
| `agent:fileUpdate` | `{ filePath, content, action }` | File locking (legacy) |
| `agent:codePatch` | `{ filePath, content, action }` | File write (start/patch/complete) |
| `agent:fileTreeSync` | `{ fileTree }` | Filesystem sync |
| `heartbeat` | `{ timestamp }` | Keep-alive every 30s |

**Pattern**: All cross-module communication goes through `globalEventEmitter`. Never create new EventEmitter instances.

### 3. E2B Sandbox Tools (`src/lib/e2b-tools.ts`)
- Factory pattern: `makeE2BTools(sbxId, sessionId)` creates tools bound to specific sandbox

**Available Tools**:
| Tool | Purpose | Events |
|------|---------|--------|
| `e2b_run_command` | Execute shell commands | None |
| `e2b_write_file` | Create/overwrite files (auto-creates dirs) | `agent:codePatch` (start→patch→complete) |
| `e2b_read_file` | Read file contents | None |
| `e2b_list_files` | List directory contents | None |
| `e2b_delete_file` | Delete files/directories | None |
| `e2b_list_files_recursive` | Recursive scan (excludes binaries) | `agent:fileTreeSync` |

**Excluded from recursive scan**: `node_modules`, `.git`, `.next`, `dist`, `build`, `.cache`, `components/ui`, `nextjs-app`

**Pattern**: Never write directly to E2B in tools - emit events. Frontend handles Yjs → E2B sync.

### 4. Yjs Collaboration (`src/lib/collaboration/`)
- `initCollaboration.ts` - Y.Doc + HocuspocusProvider setup per room
- `bindMonaco.ts` - MonacoBinding syncs Y.Text ↔ Monaco model
- `updateYjsDocument.ts` - Programmatic updates (reuses existing room or creates temp provider)
- Room naming: `${sessionId}-${filePath}` for per-file collaboration
- Awareness: Built-in user presence tracking with auto-generated colors
- WebSocket URL: Auto-detect from `window.location` or `NEXT_PUBLIC_WS_URL`

**Pattern**: Each file has own Yjs document. When switching files, dispose old binding and create new one.

### 5. Database Schema (`prisma/schema.prisma`)
- **Custom Prisma output**: `../src/generated/prisma` - import from `@/generated/prisma`
- Session model stores: `messages` (JSON), `fileTree` (JSON), `sandboxId`, `sandboxUrl`, `sandboxCreatedAt`, `userId`
- **Null byte sanitization**: Postgres rejects `\0` - all JSON must be sanitized before save
- Indexes on `shareToken` and `userId`

**Pattern**: Always use `JSON.parse(JSON.stringify(data).replace(/\\u0000/g, ''))` for Prisma JSON fields.

### 6. tRPC Setup (`src/trpc/`)
- Context: `userId` from Clerk auth + `prisma` client (`src/trpc/init.ts`)
- `baseProcedure` (public) + `protectedProcedure` (requires Clerk auth)

**Session Router** (`src/trpc/routers/session.ts`):
- `createSession` - Create new session (protected)
- `getSession` - Get by ID (public)
- `getSessionByShareToken` - Get public session
- `updateSession` - Update session data (protected)
- `shareSession` - Make public + generate share link (protected)
- `deleteSession` - Delete + kill sandbox (protected)
- `listSessions` - List user's sessions (protected)

**App Router** (`src/trpc/routers/_app.ts`):
- `invoke` - Agent invocation (text-only)
- `invokeWithSandbox` - Agent with sandbox

**Pattern**: Never create raw Prisma queries in components - always use tRPC procedures.

### 7. MCP Integration (`src/lib/mcp-client.ts`)
| Server | Command | Purpose |
|--------|---------|---------|
| Playwright | `npx -y @playwright/mcp@latest` | Browser automation, screenshots, debugging |
| Next.js Docs | `npx @taiyokimura/nextjs-docs-mcp@latest` | Framework reference and examples |

- MCP clients cached globally with health tracking
- Automatic reconnection on failure
- Timeout-safe initialization with error fallback

**Pattern**: MCP clients are singletons - use `mcpClients` Map to avoid reconnections.

### 8. Memory System (`src/lib/agent-memory.ts`)
- Uses `InMemoryStore` from LangGraph (clears on server restart)
- Three categories: `preferences`, `context`, `tasks`

**Memory Tools** (available to agent):
- `get_session_memory(category)` - Retrieve stored data
- `save_session_memory(category, data)` - Persist data
- `search_session_memories(query)` - Find relevant info

**Chat Message Tracking**:
- `getSessionMessages()` / `appendSessionMessages()` - Message history (max 40 per session)
- `getWorkSummary()` - Track created/modified files

**Pattern**: Agent recalls past work via memory, not by re-reading files.

### 9. State Management (`src/stores/chat-store.ts`)
Zustand store with:
- Session state: `sessionId`, `messages`, `isStreaming`
- File state: `fileTree`, `selectedFile`, `openFiles`
- Sandbox state: `sandboxId`, `sandboxUrl`, `sandboxCreatedAt`, `isSandboxExpired`
- UI state: `activeTab`, `showSecondPanel`, `mobileActivePanel`
- Sync state: `isSyncingToE2B`, `isSyncingFilesystem`, `iframeLoading`
- Collaboration: `connectionStatus`, `connectedUsers`

### 10. Authentication (Clerk)
- Middleware at `src/proxy.ts` protects routes except `/`, `/sign-*`, `/api/webhooks`
- Session access: GET is public, PATCH/DELETE requires owner (`userId` check)
- Share tokens enable public read-only access with `isPublic` flag

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/stream` | GET | SSE connection for real-time events (filtered by sessionId) |
| `/api/sync-filesystem` | POST | Sync E2B → Frontend file tree |
| `/api/write-to-sandbox` | POST | Write editor content to E2B |
| `/api/session/[token]` | GET/PATCH/DELETE | Session CRUD (GET: public, PATCH/DELETE: owner) |
| `/api/sessions` | GET/DELETE | List/clear all user sessions (Clerk auth required) |
| `/api/trpc/*` | ALL | tRPC handler |

## Development Workflows

### Starting Dev Server
```bash
npm run dev          # Next.js on port 3000
npm run yjs          # Yjs WebSocket server on port 1234 (run separately)
npx prisma studio    # Database GUI on port 5555
```

**Critical**: Yjs server must run separately. Agent will never run `npm run dev` in E2B sandboxes.

### Database Changes
```bash
npx prisma migrate dev --name <migration_name>  # Creates migration + regenerates client
```

Output goes to `src/generated/prisma` - commit migration files, not generated code.

### Adding MCP Tools
1. Install MCP server: `npx -y @playwright/mcp@latest`
2. Create config in `src/lib/mcp-client.ts`: `{ command: 'npx', args: ['-y', '@your/mcp'], env: {...} }`
3. Cache tools in `nextjs-coding-agent.ts` initialization

### Build & Deploy
```bash
npm run build        # Next.js production build
npm run start        # Production server
docker build .       # Containerized deployment
```

## Environment Variables

```
DATABASE_URL=postgresql://...              # Prisma connection
E2B_API_KEY=...                            # E2B sandbox creation
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...      # Clerk auth (client)
CLERK_SECRET_KEY=...                       # Clerk auth (server)
NEXT_PUBLIC_WS_URL=ws://...                # Yjs WebSocket URL (optional)
NEXT_PUBLIC_APP_URL=...                    # For share links
```

## Project-Specific Conventions

### 1. Agent Workflow Pattern (from `nextjs-agent-prompt.ts`)
- **Step 1**: Create skeleton in `app/page.tsx` (layout structure with divs)
- **Step 2**: Add Shadcn UI components (Button, Card, Input from `src/components/ui/`)
- **Step 3**: Add interactivity (useState, event handlers)
- **Step 4**: Debug with Playwright (only for agent's eyes, user sees live sandbox)

**Never**: Create separate component files until feature is complete in `page.tsx`.

### 2. File Sync Boundaries
- **Include**: `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.md`, `.json`, `.toml`
- **Exclude**: Binary files, `node_modules/`, `.next/`, `dist/`, lock files, `components/ui/` (Shadcn managed)

Filter logic in `/api/sync-filesystem/route.ts` - update `filterFileTree()` to change exclusions.

### 3. Imports & Paths
- Prisma client: `import { ... } from "@/generated/prisma"` (NOT `@prisma/client`)
- Shadcn components: `import { Button } from "@/components/ui/button"`
- tRPC client: `import { api } from "@/trpc/client"`
- tRPC server: `import { api } from "@/trpc/server"`

### 4. Sandbox Template (`sandbox-templates/nextjs/`)
- Template ID: `qyuxe68w3luzarizh7ju` (name: `codevibe-test`)
- Pre-installs Node 21, creates Next.js app, installs ALL shadcn components
- Runs `next dev --turbopack` on port 3000

## Critical Gotchas

1. **Null bytes in JSON**: Postgres rejects them - sanitize before `prisma.session.update()`
2. **Sandbox expiration**: E2B kills sandboxes after 25 minutes - UI shows countdown
3. **Yjs room lifecycle**: Dispose MonacoBinding before switching files to prevent memory leaks
4. **GPT-5 temperature**: Only supports `temperature: 1` (hardcoded in `AzureOpenAiChatClient`)
5. **Prisma client location**: Import from `@/generated/prisma`, not `@prisma/client`
6. **SSE heartbeat**: 30-second interval prevents connection timeout - don't remove from `/api/stream`
7. **Message compaction**: Agent keeps last 10 messages (max 1500 chars each) to avoid recursion limits
8. **MCP reconnection**: Clients auto-reconnect on failure - don't recreate manually
9. **Recursive file scan exclusions**: `node_modules`, `.git`, `.next`, `dist`, `build`, `.cache`, `components/ui`
10. **InMemoryStore**: Clears on server restart - use PostgresSaver for production persistence

## When Debugging

- **Sandbox issues**: Check `/api/session/[token]` for `sandboxId` persistence
- **Yjs sync failures**: Verify Yjs server running on port 1234 (`npm run yjs`)
- **Agent not responding**: Check SSE connection in Network tab, look for `agent:status` events
- **File not appearing**: Trigger manual sync with refresh button in FileTree (calls `/api/sync-filesystem`)
- **Memory not persisting**: InMemoryStore clears on server restart - use PostgresSaver for production
- **MCP tools not loading**: Check MCP client health in console, look for reconnection logs
- **Auth issues**: Verify Clerk env vars, check middleware at `src/proxy.ts`

## References

- [ARCHITECTURE.md](../docs/ARCHITECTURE.md) - Complete system design
- [YJS_E2B_SYNC.md](../docs/YJS_E2B_SYNC.md) - Bidirectional sync details
- [E2B_FILESYSTEM_SYNC.md](../docs/E2B_FILESYSTEM_SYNC.md) - Filesystem sync protocol
- [AGENT_FILE_STREAMING.md](../docs/AGENT_FILE_STREAMING.md) - File streaming architecture
- [Agent prompt](../src/lib/nextjs-agent-prompt.ts) - Full agent instructions
- [E2B tools](../src/lib/e2b-tools.ts) - Sandbox tool implementations
