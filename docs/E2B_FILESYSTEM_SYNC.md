# E2B Filesystem Sync

This feature enables real-time synchronization between the e2b sandbox filesystem and the CodeVibe code editor.

## Features

- **Real-time Sync**: Automatically syncs files when the agent creates or modifies them
- **Manual Sync**: Click the refresh button in the file tree to manually sync the filesystem
- **Smart Filtering**: Automatically excludes `node_modules`, `.git`, `.next`, `dist`, `build`, and `.cache` directories
- **File Content**: Loads file contents for files under 100KB for immediate editing
- **Live Updates**: Uses Server-Sent Events (SSE) to push updates to the frontend in real-time

## How It Works

### Agent Tool: `e2b_list_files_recursive`

The agent can use the `e2b_list_files_recursive` tool to scan the entire sandbox filesystem and emit a file tree sync event:

```typescript
// Agent calls this tool
e2b_list_files_recursive({
  rootPath: '/home/user',  // optional, defaults to /home/user
  excludePaths: ['custom-exclude']  // optional, additional paths to exclude
})
```

### Manual Sync Button

Users can click the refresh button in the file tree panel to manually trigger a filesystem sync:

1. Click the refresh icon above the file tree
2. The sync API endpoint (`/api/sync-filesystem`) is called
3. The complete file tree is scanned from the e2b sandbox
4. A `file_tree_sync` event is emitted via SSE
5. The frontend receives the event and updates the file tree

### Architecture

```
┌─────────────┐
│   Agent     │
│  (AI Code)  │
└──────┬──────┘
       │ 1. Calls e2b_list_files_recursive
       │    or user clicks sync button
       ▼
┌─────────────┐
│  E2B Tools  │──────┐
│   or API    │      │ 2. Scans filesystem
└─────────────┘      │    (excluding node_modules)
                     │
                     ▼
              ┌──────────────┐
              │Event Emitter │
              │ (SSE Stream) │
              └──────┬───────┘
                     │ 3. Emits file_tree_sync event
                     ▼
              ┌──────────────┐
              │   Frontend   │
              │  (React UI)  │
              └──────────────┘
                     │ 4. Updates file tree state
                     ▼
              ┌──────────────┐
              │  FileTree    │
              │  Component   │
              └──────────────┘
```

## Implementation Details

### Backend

- **Tool**: [src/lib/e2b-tools.ts](../src/lib/e2b-tools.ts) - `e2b_list_files_recursive`
- **API**: [src/app/api/sync-filesystem/route.ts](../src/app/api/sync-filesystem/route.ts)
- **SSE Stream**: [src/app/api/stream/route.ts](../src/app/api/stream/route.ts) - handles `file_tree_sync` events
- **Event Emitter**: [src/lib/event-emitter.ts](../src/lib/event-emitter.ts)

### Frontend

- **Chat Page**: [src/app/chat/[id]/page.tsx](../src/app/chat/[id]/page.tsx) - handles SSE events and updates file tree state
- **FileTree Component**: [src/components/FileTree.tsx](../src/components/FileTree.tsx) - displays the synced file tree

## Usage

### For Developers

When the agent creates files or makes changes, it can call:

```typescript
await e2b_list_files_recursive()
```

This will sync the entire filesystem to the editor.

### For Users

1. The file tree automatically updates when the agent modifies files
2. To manually refresh, click the refresh icon (⟳) above the file tree
3. Files will appear in the left sidebar, organized in folders
4. Click any file to open it in the editor

## Excluded Directories

By default, these directories are excluded from sync:
- `node_modules`
- `.git`
- `.next`
- `dist`
- `build`
- `.cache`

You can add custom exclusions by passing the `excludePaths` parameter to the tool.

## File Size Limits

- Files larger than 100KB are listed in the tree but their content is not automatically loaded
- This prevents performance issues with large files like images or binaries
- Users can still open these files manually if needed
