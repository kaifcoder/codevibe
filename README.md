# CodeVibe

> An AI-powered collaborative code editor where you describe what you want and watch it get built in real time.

CodeVibe turns natural language into production-ready Next.js applications. Describe an app, watch an AI agent build it file by file with a live preview, and collaborate with others in the same session — all from your browser.

## How It Works

1. **Describe** — Type what you want to build (e.g., "a personal finance tracker with charts")
2. **Watch** — The AI agent reasons through the architecture, writes components sequentially, and spins up a live preview
3. **Collaborate** — Multiple users can join the same session, see each other's cursors, and edit simultaneously via CRDTs
4. **Iterate** — Ask the AI to fix bugs, add features, or change styling — all visible in real time

## Features

- **AI Code Generation** — Claude Sonnet 4 with extended thinking builds entire Next.js apps from prompts
- **Live Preview** — See your app running in a sandboxed environment as it's being built
- **Real-Time Collaboration** — Yjs-powered CRDT sync with cursor presence and conflict-free editing
- **Streaming Code** — Watch code appear character by character across three synced panels (chat, editor, preview)
- **File Explorer** — Auto-updating project structure as the agent creates files
- **Session Sharing** — Share a link and let others join your session instantly
- **Mobile Support** — Tab-based interface designed for mobile editing
- **Tool Visibility** — Every file write, shell command, and AI decision is visible in the chat

## Architecture

```
User Prompt → useStream → LangGraph Agent Server (port 2024)
                                    ↓
                          Claude Sonnet 4 (extended thinking)
                                    ↓
                          E2B Sandbox Tools (write, read, run, list)
                                    ↓
              codePatch events ← config.writer() → fileTreeSync events
                    ↓                                      ↓
           Monaco Editor (Yjs bound)              File Tree UI
                    ↓
           Yjs ↔ Hocuspocus (port 1234) ↔ Other Users' Editors
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Editor | Monaco Editor, y-monaco |
| Collaboration | Yjs, Hocuspocus, WebSocket |
| AI Agent | LangGraph, @langchain/anthropic (Claude Sonnet 4) |
| Sandbox | E2B Code Interpreter |
| State | Zustand (client), LangGraph persistence (agent) |
| API | tRPC (type-safe), Next.js API routes |
| Database | Prisma, PostgreSQL |
| Auth | Clerk |
| UI Components | Shadcn UI, Framer Motion, Lucide Icons |

## Getting Started

### Prerequisites

- Node.js 21+
- PostgreSQL database
- API keys: E2B, Clerk, Anthropic (via LangGraph)

### Setup

```bash
git clone https://github.com/kaifcoder/codevibe.git
cd codevibe
npm install
```

### Environment Variables

```env
DATABASE_URL=postgresql://...
E2B_API_KEY=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_WS_URL=ws://localhost:1234        # optional
NEXT_PUBLIC_LANGGRAPH_URL=http://localhost:2024 # optional
```

### Run

You need three processes running:

```bash
# Terminal 1 — Next.js dev server
npm run dev

# Terminal 2 — LangGraph Agent Server
npm run agent

# Terminal 3 — Yjs WebSocket server (collaboration)
npm run yjs
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Other Commands

```bash
npm run build                        # Production build
npm run lint                         # ESLint
npx prisma studio                    # Database GUI
npx prisma migrate dev --name <name> # Create migration
```

## Project Structure

```
src/
├── app/                         # Next.js App Router
│   ├── chat/[id]/page.tsx       # Main editor interface
│   ├── api/sync-filesystem/     # E2B → Frontend file sync
│   ├── api/write-to-sandbox/    # Editor → E2B write
│   └── api/session/[token]/     # Session CRUD
├── lib/
│   ├── agent.ts                 # LangGraph agent definition
│   ├── e2b-tools.ts             # Sandbox tools (write, read, run, list, delete)
│   ├── nextjs-agent-prompt.ts   # Agent system prompt
│   ├── mcp-client.ts            # MCP tool integration
│   └── collaboration/           # Yjs + Hocuspocus setup
├── hooks/
│   ├── use-agent-stream.ts      # useStream wrapper with custom events
│   └── use-collaboration.ts     # Yjs session management per file
├── components/                  # UI components
├── stores/chat-store.ts         # Zustand state management
└── trpc/                        # tRPC routers and client
```

## Agent Tools

| Tool | Purpose |
|------|---------|
| `e2b_write_file` | Create/overwrite files (streams to editor) |
| `e2b_read_file` | Read file contents |
| `e2b_run_command` | Execute shell commands |
| `e2b_list_files` | List directory contents |
| `e2b_list_files_recursive` | Full project tree scan |
| `e2b_delete_file` | Delete files/directories |
| Playwright MCP | Browser automation |
| Next.js Docs MCP | Documentation lookup |

## Contributing

Contributions welcome! Check [open issues](https://github.com/kaifcoder/codevibe/issues), fork the repo, and submit a PR.

## License

[MIT](LICENSE)

---

Built by [@kaifcoder](https://github.com/kaifcoder)
