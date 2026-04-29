# CLAUDE.md - CodeVibe Project Context

## Quick Start

```bash
npm run dev          # Next.js dev server on port 3000
npm run yjs          # Yjs WebSocket server on port 1234 (MUST run separately)
npm run build        # Production build
npm run lint         # ESLint
npx prisma studio    # Database GUI on port 5555
npx prisma migrate dev --name <name>  # Create migration + regenerate client
```

## Project Summary

CodeVibe is a collaborative AI-powered code editor with real-time synchronization. Users type prompts, an AI agent (GPT-5 via SAP AI SDK) generates Next.js code in an E2B sandbox, and multiple users can edit simultaneously via Yjs CRDTs.

**Tech Stack**: Next.js 16 (App Router, React 19, Turbopack) | TypeScript | tRPC | Prisma (PostgreSQL) | Clerk Auth | Zustand | Yjs + Hocuspocus | E2B Sandboxes | LangGraph | MCP

## Architecture

```
User/Agent Edits → Monaco Editor → Yjs Document (source of truth) → E2B Filesystem
                                          ↓
                                  Other Users' Editors
```

Three-way sync: Monaco ↔ Yjs ↔ E2B. Yjs is the single source of truth.

## Key Directories

```
src/
├── app/                    # Next.js App Router pages & API routes
│   ├── chat/[id]/page.tsx  # Main editor interface
│   ├── api/stream/         # SSE for real-time events
│   ├── api/sync-filesystem/# E2B → Frontend sync
│   ├── api/write-to-sandbox/# Monaco → E2B write
│   ├── api/session/[token]/# Session CRUD
│   └── api/trpc/           # tRPC handler
├── lib/
│   ├── nextjs-coding-agent.ts   # LangGraph agent (createReactAgent)
│   ├── nextjs-agent-prompt.ts   # Agent system prompt
│   ├── e2b-tools.ts             # 6 E2B sandbox tools
│   ├── fallback-agent.ts        # Direct agent invocation
│   ├── mcp-client.ts            # MCP client factory (Playwright, Next.js Docs)
│   ├── agent-memory.ts          # InMemoryStore + memory tools
│   ├── event-emitter.ts         # Global singleton event emitter
│   ├── sandbox-utils.ts         # E2B connection helpers
│   └── collaboration/           # Yjs + Monaco binding
├── components/              # React components (ChatPanel, CodeEditor, FileTree)
├── stores/chat-store.ts     # Zustand state management
├── trpc/                    # tRPC routers, client, server
├── generated/prisma/        # Auto-generated Prisma client (DO NOT EDIT)
└── server/db.ts             # Prisma singleton
```

## Important Conventions

### Imports
```typescript
// Prisma - NEVER use @prisma/client
import { Session } from "@/generated/prisma"

// Shadcn UI
import { Button } from "@/components/ui/button"

// tRPC
import { api } from "@/trpc/client"   // client-side
import { api } from "@/trpc/server"   // server-side (RSC)
```

### Database
- Prisma client output: `src/generated/prisma` (custom path)
- **Always sanitize null bytes**: `JSON.parse(JSON.stringify(data).replace(/\\u0000/g, ''))`
- Never use raw Prisma queries in components - use tRPC procedures

### Event System
- All cross-module communication via `globalEventEmitter` singleton
- Events use `Symbol.for('codevibe.globalEventEmitter')` to survive hot reloads
- Never create new EventEmitter instances

### Yjs Collaboration
- Room naming: `${sessionId}-${filePath}` (one Y.Doc per file)
- Dispose MonacoBinding before switching files (prevents memory leaks)
- WebSocket on port 1234 (`npm run yjs`)

### Agent Pattern
- Uses `createReactAgent()` from LangChain (prebuilt, not custom StateGraph)
- Model: GPT-5 (2025-08-07) via `AzureOpenAiChatClient`, fixed `temperature: 1`
- Tools: memory tools + E2B tools + Playwright MCP + Next.js Docs MCP
- MCP tools cached globally - never recreate
- Recursion limit: 40; Message compaction: last 10 msgs, max 1500 chars each

### File Sync Boundaries
- **Include**: `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.md`, `.json`, `.toml`
- **Exclude**: `node_modules/`, `.git/`, `.next/`, `dist/`, `build/`, `.cache/`, `components/ui/`, lock files, binaries

## E2B Tools (src/lib/e2b-tools.ts)

| Tool | Purpose |
|------|---------|
| `e2b_run_command` | Execute shell commands in sandbox |
| `e2b_write_file` | Create/overwrite files (emits codePatch events) |
| `e2b_read_file` | Read file contents |
| `e2b_list_files` | List directory contents |
| `e2b_delete_file` | Delete files/directories |
| `e2b_list_files_recursive` | Full file tree scan |

## Event System

| Event | Payload |
|-------|---------|
| `agent:status` | `{ status, message, hasSandbox }` |
| `agent:partial` | `{ content, fullContent }` |
| `agent:tool` | `{ tool, args, result, status }` |
| `agent:sandbox` | `{ sandboxId, sandboxUrl, isNew }` |
| `agent:complete` | `{ response, sandboxUrl, hasSandbox }` |
| `agent:error` | `{ error }` |
| `agent:reasoning` | `{ reasoning }` |
| `agent:codePatch` | `{ filePath, content, action }` |
| `agent:fileTreeSync` | `{ fileTree }` |
| `heartbeat` | `{ timestamp }` |

## Environment Variables

```
DATABASE_URL=postgresql://...
E2B_API_KEY=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_WS_URL=ws://...          # Optional, defaults to ws://localhost:1234
NEXT_PUBLIC_APP_URL=...              # For share links
```

## Common Gotchas

1. **Null bytes**: PostgreSQL rejects `\0` in JSON - always sanitize before Prisma writes
2. **Sandbox TTL**: E2B kills sandboxes after 25 minutes - UI shows countdown
3. **Yjs server**: Must run separately (`npm run yjs`) - it's NOT part of `npm run dev`
4. **Prisma imports**: Use `@/generated/prisma`, NOT `@prisma/client`
5. **Temperature**: GPT-5 only supports `temperature: 1` (hardcoded)
6. **SSE heartbeat**: 30s interval in `/api/stream` - don't remove (prevents timeout)
7. **MCP clients**: Singletons with auto-reconnect - never recreate manually
8. **InMemoryStore**: Clears on server restart - use PostgresSaver for production
9. **Message compaction**: Last 10 messages, max 1500 chars - prevents recursion limit
10. **Recursive scan excludes**: `node_modules`, `.git`, `.next`, `dist`, `build`, `.cache`, `components/ui`

## Debugging

| Problem | Check |
|---------|-------|
| Sandbox issues | `/api/session/[token]` for `sandboxId` persistence |
| Yjs sync fails | Yjs server running on port 1234 (`npm run yjs`) |
| Agent not responding | SSE connection in Network tab, `agent:status` events |
| File not appearing | Manual sync via refresh button (calls `/api/sync-filesystem`) |
| Memory not persisting | InMemoryStore clears on restart |
| MCP tools missing | Console for MCP client health/reconnection logs |
| Auth issues | Clerk env vars + middleware at `src/proxy.ts` |

## Sandbox Template

- Template ID: `qyuxe68w3luzarizh7ju` (name: `codevibe-test`)
- Pre-installs: Node 21, Next.js, ALL shadcn/ui components
- Runs: `next dev --turbopack` on port 3000
- Location: `sandbox-templates/nextjs/`
