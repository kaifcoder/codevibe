# CodeVibe - AI Coding Agent Instructions

## Project Overview

CodeVibe is a collaborative AI-powered code editor with real-time synchronization. It combines:
- **Real-time collaboration** via Yjs CRDT (WebSocket on port 1234)
- **E2B sandboxed execution** for running Next.js apps (25-minute TTL)
- **LangGraph AI agent** using GPT-5 from SAP AI SDK
- **MCP integration** for Playwright browser automation and Next.js docs
- **tRPC + Prisma** for type-safe APIs and PostgreSQL persistence

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
- Uses **LangGraph StateGraph** with workflow caching per `${sbxId}-${enableMCP}`
- MCP tools initialized once and cached (see `nextjsDocsToolsCache`, `playwrightToolsCache`)
- Memory system via `@langchain/langgraph` InMemoryStore (use PostgresSaver for production)
- Agent prompt in `src/lib/nextjs-agent-prompt.ts` - enforces "build in page.tsx first, no separate components"

**Pattern**: Never modify workflow initialization - tools are cached globally. To add new tools, extend `baseTools` array.

### 2. Event-Driven Communication (`src/lib/event-emitter.ts`)
- **Singleton EventEmitter** using `Symbol.for('codevibe.globalEventEmitter')` to survive hot reloads
- Events: `agent:codePatch`, `agent:status`, `agent:sandbox`, `agent:fileTreeSync`
- SSE stream at `/api/stream` listens to global emitter and filters by `sessionId`

**Pattern**: All cross-module communication goes through `globalEventEmitter`. Never create new EventEmitter instances.

### 3. E2B Sandbox Tools (`src/lib/e2b-tools.ts`)
- Factory pattern: `makeE2BTools(sbxId, sessionId)` creates tools bound to specific sandbox
- **Code patch flow**: `e2b_write_file` emits `start` → `patch` (with content) → `complete` events
- Frontend listens to `agent:codePatch` → updates Yjs → Monaco displays → syncs to E2B on `complete`
- **Sandbox expiry handling**: Returns `null` from `getSandbox()` if 404, emits `agent:sandboxDeleted`

**Pattern**: Never write directly to E2B in tools - emit events. Frontend handles Yjs → E2B sync.

### 4. Yjs Collaboration (`src/lib/collaboration/`)
- Room naming: `${sessionId}-${filePath}` for per-file collaboration
- HocuspocusProvider connects to `ws://localhost:1234` (see `yjs-server.js`)
- MonacoBinding syncs Y.Text ↔ Monaco model (see `bindMonaco.ts`)
- Programmatic updates use `updateYjsDocument.ts` to update without cursor jumps

**Pattern**: Each file has own Yjs document. When switching files, dispose old binding and create new one.

### 5. Database Schema (`prisma/schema.prisma`)
- **Custom Prisma output**: `../src/generated/prisma` - import from `@/generated/prisma`
- Session model stores: `messages` (JSON), `fileTree` (JSON), `sandboxId`, `sandboxUrl`, `sandboxCreatedAt`
- **Null byte sanitization**: Postgres rejects `\0` - all JSON must be sanitized before save

**Pattern**: Always use `JSON.parse(JSON.stringify(data).replace(/\\u0000/g, ''))` for Prisma JSON fields.

### 6. tRPC Setup (`src/trpc/`)
- Routers in `src/trpc/routers/` - see `session.ts` for CRUD pattern
- Client-side: `@/trpc/client` exports typed hooks (`api.session.getSession.useQuery`)
- Server actions: Import from `@/trpc/server` for RSC/Server Actions

**Pattern**: Never create raw Prisma queries in components - always use tRPC procedures.

## Development Workflows

### Starting Dev Server
```bash
npm run dev          # Next.js on port 3000
npm run yjs          # Yjs WebSocket server on port 1234 (run separately)
npx prisma studio    # Database GUI on port 5555
```

**Critical**: Yjs server must run separately. Agent will never run `npm run dev` in E2B sandboxes (see prompt line 235).

### Database Changes
```bash
npx prisma migrate dev --name <migration_name>  # Creates migration + regenerates client
```

Output goes to `src/generated/prisma` - commit migration files, not generated code.

### Adding MCP Tools
1. Install MCP server: `npx -y @playwright/mcp@latest`
2. Create config in `src/lib/mcp-client.ts`: `{ command: 'npx', args: ['-y', '@your/mcp'], env: {...} }`
3. Cache tools in `nextjs-coding-agent.ts` initialization

**Pattern**: MCP clients are singletons - use `mcpClients` Map to avoid reconnections.

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

### 3. Memory System Usage
- Tools: `get_session_memory('preferences'|'context'|'tasks')`, `save_session_memory()`
- Namespace: `sessionId` from LangGraph config
- Informational queries (what/why/explain) → use memory tools, NO file changes

**Pattern**: Agent recalls past work via memory, not by re-reading files.

## Critical Gotchas

1. **Null bytes in JSON**: Postgres rejects them - sanitize before `prisma.session.update()`
2. **Sandbox expiration**: E2B kills sandboxes after 25 minutes - UI shows countdown
3. **Yjs room lifecycle**: Dispose MonacoBinding before switching files to prevent memory leaks
4. **GPT-5 temperature**: Only supports `temperature: 1` (hardcoded in `AzureOpenAiChatClient`)
5. **Prisma client location**: Import from `@/generated/prisma`, not `@prisma/client`
6. **SSE heartbeat**: 30-second interval prevents connection timeout - don't remove from `/api/stream`

## When Debugging

- **Sandbox issues**: Check `/api/session/[token]` for `sandboxId` persistence
- **Yjs sync failures**: Verify Yjs server running on port 1234 (`npm run yjs`)
- **Agent not responding**: Check SSE connection in Network tab, look for `agent:status` events
- **File not appearing**: Trigger manual sync with refresh button in FileTree (calls `/api/sync-filesystem`)
- **Memory not persisting**: InMemoryStore clears on server restart - use PostgresSaver for production

## References

- [ARCHITECTURE.md](../docs/ARCHITECTURE.md) - Complete system design
- [YJS_E2B_SYNC.md](../docs/YJS_E2B_SYNC.md) - Bidirectional sync details
- [Agent prompt](../src/lib/nextjs-agent-prompt.ts) - Full agent instructions
- [E2B tools](../src/lib/e2b-tools.ts) - Sandbox tool implementations
