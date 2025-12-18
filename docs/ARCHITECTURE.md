# CodeVibe Architecture

## Overview

CodeVibe is a collaborative AI-powered code editor with real-time synchronization, sandbox execution, and multi-user collaboration capabilities. The system integrates Next.js, Yjs CRDT, E2B sandboxes, and PostgreSQL to provide a seamless development experience.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐    │
│  │  Chat Panel  │  │ Code Editor  │  │   File Tree       │    │
│  │              │  │  (Monaco)    │  │                   │    │
│  └──────────────┘  └──────────────┘  └───────────────────┘    │
│         │                  │                    │               │
│         └──────────────────┴────────────────────┘               │
│                            │                                     │
└────────────────────────────┼─────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐   ┌──────────────┐    ┌──────────────┐
│ Yjs Server   │   │  API Routes  │    │  tRPC API    │
│ (Port 1234)  │   │   (SSE)      │    │              │
└──────────────┘   └──────────────┘    └──────────────┘
        │                  │                    │
        │                  │                    ▼
        │                  │           ┌──────────────┐
        │                  │           │  PostgreSQL  │
        │                  │           │   (Prisma)   │
        │                  │           └──────────────┘
        │                  │
        │                  ▼
        │          ┌──────────────┐
        │          │ LangChain    │
        │          │  AI Agent    │
        │          └──────────────┘
        │                  │
        │                  ▼
        │          ┌──────────────┐
        └─────────▶│ E2B Sandbox  │◀──── Code Execution
                   │ (25 min TTL) │
                   └──────────────┘
```

## Core Components

### 1. Frontend Architecture

#### Chat Interface (`/src/app/chat/[id]/page.tsx`)
- **Purpose**: Main application entry point combining chat, code editor, and preview
- **Key Features**:
  - Session management and persistence
  - Real-time updates via Server-Sent Events (SSE)
  - File tree management
  - Sandbox lifecycle management
  - Multi-tab interface (Code, Live Preview)

#### Code Editor (`/src/components/CodeEditor.tsx`)
- **Technology**: Monaco Editor with Yjs binding
- **Features**:
  - Real-time collaborative editing
  - Syntax highlighting
  - Connection status indicators
  - User presence awareness
  - Automatic conflict resolution via CRDT

#### File Tree (`/src/components/FileTree.tsx`)
- **Purpose**: Visual file system browser
- **Features**:
  - Hierarchical folder structure
  - File type icons
  - Streaming indicators
  - Auto-expand on file selection

### 2. Real-Time Collaboration System

#### Yjs Integration
```typescript
// Architecture: CRDT-based collaboration
Yjs Document ↔ HocuspocusProvider (WebSocket) ↔ Yjs Server
     ↕
MonacoBinding
     ↕
Monaco Editor
```

**Key Files**:
- `/src/lib/collaboration/initCollaboration.ts` - Provider setup
- `/src/lib/collaboration/bindMonaco.ts` - Editor binding
- `/src/lib/collaboration/updateYjsDocument.ts` - Programmatic updates
- `/yjs-server.js` - WebSocket server (port 1234)

**Flow**:
1. Each file has unique room: `${sessionId}-${filePath}`
2. Users connect to room via WebSocket
3. Changes sync via Yjs CRDT protocol
4. Monaco editor reflects changes in real-time
5. Awareness protocol shows user cursors/selections

### 3. AI Agent Integration

#### Agent Architecture
```
User Input → tRPC API → LangChain Agent → E2B Tools → Sandbox
                              ↓
                      Code Patch Events
                              ↓
                      SSE Stream → Frontend
                              ↓
                    Yjs Document Update
                              ↓
                      Monaco Editor Display
```

#### Agent Tools (`/src/lib/e2b-tools.ts`)
- `e2b_write_file` - Create/overwrite files
- `e2b_edit_file` - Partial file edits
- `e2b_read_file` - Read file contents
- `e2b_run_command` - Execute shell commands
- `e2b_list_files_recursive` - List directory contents

**Event Flow**:
1. Agent decides to modify file
2. Emits `agent:codePatch` event with action: 'start'
3. Emits `agent:codePatch` event with action: 'patch' + content
4. Frontend updates Yjs document
5. Monaco shows changes in real-time
6. Emits `agent:codePatch` event with action: 'complete'
7. Content syncs to E2B filesystem

### 4. Server-Sent Events (SSE)

#### Event Stream (`/src/app/api/stream/route.ts`)
```typescript
Event Types:
- connected        // Initial connection
- heartbeat        // Keep-alive (30s interval)
- status          // Agent status updates
- partial         // Streaming AI responses
- tool            // Tool execution notifications
- code_patch      // File editing events
- file_update     // Direct E2B writes (legacy)
- file_tree_sync  // Filesystem sync completion
- sandbox         // Sandbox creation/updates
- reasoning       // Agent reasoning steps
- complete        // Task completion
- error           // Error notifications
```

**Architecture**:
- One SSE connection per session
- Global EventEmitter for cross-module communication
- Automatic reconnection with exponential backoff
- Event filtering by sessionId

### 5. E2B Sandbox Integration

#### Sandbox Lifecycle
```
Create Sandbox → Filesystem Sync → Execute Code → Auto-kill (25 min)
       ↓                ↓                ↓              ↓
  Session DB    File Tree State    Live Preview    Cleanup
```

#### Key Features:
- **Creation**: On-demand when code execution needed
- **Filesystem Sync**: Bidirectional sync between Yjs and E2B
- **Filtering**: Excludes binary files, lock files, unwanted directories
- **Expiration**: 25-minute TTL, UI shows expiration warning
- **Cleanup**: Killed on session deletion

#### Sync Flow (`/src/app/api/sync-filesystem/route.ts`)
```
E2B Filesystem → Filter Files → Process Content → Emit Event
                                                        ↓
                                              Frontend State Update
```

**Filtered Content**:
- Binary files (.ico, .png, .jpg, .woff, .pdf, etc.)
- Lock files (.lock, package-lock.json, yarn.lock, etc.)
- System directories (node_modules, .git, .next, dist, build)
- UI component folders (components/ui, nextjs-app)

### 6. File Synchronization Architecture

#### Three-Way Sync System
```
       User Edits                Agent Edits
            ↓                          ↓
       Monaco Editor              Code Patches
            ↓                          ↓
            └──────────┬───────────────┘
                       ↓
                 Yjs Document (Source of Truth)
                       ↓
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
   User Display   Other Users    E2B Filesystem
                                 (1s debounce)
```

#### Sync Points:

**1. User → Yjs → E2B**
- User edits in Monaco
- Yjs binding captures changes
- Debounced 1s write to E2B via `/api/write-to-sandbox`

**2. Agent → Yjs → E2B**
- Agent emits code patches
- Frontend updates Yjs immediately
- On 'complete', syncs to E2B immediately

**3. E2B → Frontend (Initial Sync)**
- On sandbox creation, triggers filesystem sync
- Blocks code tab until complete
- Updates file tree and Yjs documents

### 7. Database Schema (PostgreSQL + Prisma)

```prisma
model Session {
  id                String    @id
  userId            Int?
  sandboxId         String?   // E2B sandbox ID
  sandboxUrl        String?   // Sandbox preview URL
  sandboxCreatedAt  DateTime? // For expiration tracking
  messages          Json?     // Chat history
  fileTree          Json?     // File system state
  createdAt         DateTime
  updatedAt         DateTime
}
```

**Key Operations**:
- Session CRUD via tRPC
- Automatic null byte sanitization (PostgreSQL limitation)
- Session persistence across refreshes
- Sandbox cleanup on deletion

### 8. API Routes

#### `/api/session/[token]` - Session Management
- GET: Retrieve session data
- PATCH: Update session (messages, fileTree, sandbox data)
- DELETE: Delete session + kill sandbox

#### `/api/stream` - Server-Sent Events
- Establishes SSE connection for real-time updates
- Filters events by sessionId
- Automatic cleanup on disconnect

#### `/api/sync-filesystem` - Filesystem Sync
- POST: Triggers E2B → Frontend sync
- Returns filtered file tree
- Emits `agent:fileTreeSync` event

#### `/api/write-to-sandbox` - E2B Write
- POST: Write file content to E2B sandbox
- Creates directories automatically
- Used for user edits and agent completion

### 9. State Management

#### Session State
- `sessionId` - Unique session identifier
- `sandboxId` - E2B sandbox reference
- `sandboxUrl` - Preview iframe URL
- `messages` - Chat history
- `fileTree` - File system structure

#### Editor State
- `selectedFile` - Currently open file
- `openFiles` - Array of open tabs
- `connectionStatus` - Yjs connection state
- `connectedUsers` - Active collaborators
- `isSyncingFilesystem` - Blocks UI during sync
- `isSyncingToE2B` - Shows sync indicator

#### UI State
- `showSecondPanel` - Toggle preview pane
- `activeTab` - 'code' | 'live preview'
- `isStreaming` - Agent activity indicator

## Data Flow Examples

### Example 1: Agent Writes Code
```
1. User: "Create a button component"
2. Frontend → tRPC → Agent invocation
3. Agent analyzes → Decides to use e2b_write_file
4. Tool emits: agent:codePatch (start) → Frontend switches to file
5. Tool emits: agent:codePatch (patch + content) → Frontend updates Yjs
6. Yjs → Monaco (real-time display)
7. Tool emits: agent:codePatch (complete + content) → Frontend syncs to E2B
8. E2B writes file → Code available for execution
```

### Example 2: User Edits File
```
1. User types in Monaco Editor
2. MonacoBinding captures change → Yjs Document
3. Yjs → Other users' Monaco editors (real-time)
4. Debounced 1s timer triggers
5. Frontend → /api/write-to-sandbox
6. E2B filesystem updated
```

### Example 3: Multi-User Collaboration
```
User A                    Yjs Server                User B
  │                           │                        │
  ├─ Types "hello" ──────────▶│                        │
  │                           ├─────────────────────▶  │
  │                           │                        ├─ Sees "hello"
  │                           │                        │
  │                           │  ◀───── Types "world" ─┤
  │  ◀─────────────────────────┤                        │
  ├─ Sees "world"              │                        │
  │                           │                        │
  └─ Final: "helloworld" ─────┴───── Final: "helloworld"
```

## Key Design Decisions

### 1. Yjs as Source of Truth
- **Why**: CRDT provides automatic conflict resolution
- **Benefit**: Simultaneous editing without conflicts
- **Trade-off**: E2B is eventually consistent (1s delay)

### 2. Server-Sent Events for Updates
- **Why**: One-way server → client communication
- **Benefit**: Simple, reliable, built into browsers
- **Alternative**: WebSockets (more complex, bidirectional)

### 3. Immediate Agent Sync on Complete
- **Why**: Agent expects code to be executable immediately
- **Benefit**: No delay between write and execution
- **Implementation**: Direct sync on 'complete' event

### 4. Filesystem Sync Blocking
- **Why**: Prevents race conditions on startup
- **Benefit**: Ensures consistent state before editing
- **UX**: Shows spinner, disables code tab temporarily

### 5. No File Locking
- **Why**: Yjs handles concurrent edits automatically
- **Benefit**: True collaborative editing (like Google Docs)
- **Trade-off**: User and agent can edit simultaneously

## Performance Optimizations

1. **Debounced E2B Writes**: 1s delay reduces API calls
2. **Selective Yjs Updates**: Only update active file's Yjs document
3. **Lazy Import**: Collaboration library loaded on-demand
4. **SSE Heartbeat**: 30s interval keeps connection alive
5. **File Filtering**: Excludes binaries to reduce payload
6. **Session Persistence**: Reduces database writes

## Security Considerations

1. **Sandbox Isolation**: E2B sandboxes are isolated environments
2. **Session Tokens**: Share sessions via tokens for collaboration
3. **Input Sanitization**: Null byte removal for PostgreSQL
4. **Automatic Cleanup**: 25-minute sandbox expiration
5. **CORS**: Yjs server on localhost only

## Monitoring & Debugging

### Console Logging
- `[Agent]` - Agent events and actions
- `[DB]` - Database operations
- `[SSE]` - Server-sent events
- `[Sync]` - Filesystem synchronization
- `[updateYjsDocument]` - Yjs updates
- `[State]` - State changes

### Key Metrics
- SSE connection status
- Yjs sync latency
- E2B write success rate
- Session persistence rate
- Sandbox expiration rate

## Future Enhancements

1. **WebRTC for Yjs**: Replace WebSocket with WebRTC for peer-to-peer
2. **Differential Sync**: Only sync changed files to E2B
3. **Version History**: Track file changes over time
4. **Better Expiration Handling**: Auto-save before expiration
5. **Multi-Sandbox Support**: Multiple sandboxes per session
6. **Enhanced Presence**: Show who's editing what file
7. **Conflict UI**: Visual merge conflict resolution

## Technology Stack

### Frontend
- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Editor**: Monaco Editor
- **UI**: shadcn/ui + Tailwind CSS
- **State**: React Hooks
- **Real-time**: Yjs + Hocuspocus

### Backend
- **API**: Next.js API Routes + tRPC
- **Database**: PostgreSQL + Prisma ORM
- **Events**: Node.js EventEmitter
- **AI**: LangChain
- **Sandbox**: E2B Code Interpreter

### Infrastructure
- **Collaboration**: Yjs Server (WebSocket)
- **Hosting**: Vercel (Next.js) + E2B Cloud
- **Database**: PostgreSQL (managed)

## Environment Variables

```env
DATABASE_URL=postgresql://...
E2B_API_KEY=...
OPENAI_API_KEY=...  # or other LLM provider
```

## Development Workflow

1. **Start Yjs Server**: `npm run yjs` (port 1234)
2. **Start Next.js**: `npm run dev` (port 3000)
3. **Database Migrations**: `npx prisma migrate dev`
4. **Type Generation**: `npx prisma generate`

## Testing Strategy

- **Unit Tests**: Component logic and utilities
- **Integration Tests**: API routes and tRPC procedures
- **E2E Tests**: Full user workflows
- **Manual Testing**: Multi-user collaboration scenarios

---

**Document Version**: 1.0  
**Last Updated**: December 19, 2025  
**Maintained By**: CodeVibe Development Team
