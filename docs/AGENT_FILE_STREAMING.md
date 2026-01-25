# Agent File Streaming & Locking

## Overview

The agent file streaming feature allows the AI agent to edit files in real-time while providing visual feedback to the user. When the agent is editing a file, it is automatically locked to prevent concurrent modifications.

## How It Works

### 1. File Locking State Management

The chat page maintains two pieces of state:
- `lockedFiles: Set<string>` - Tracks which files are currently locked
- `agentEditingFile: string | null` - Tracks the file currently being edited by the agent

```tsx
const [lockedFiles, setLockedFiles] = useState<Set<string>>(new Set());
const [agentEditingFile, setAgentEditingFile] = useState<string | null>(null);
```

### 2. Lock/Unlock Helper Functions

Three helper functions manage file locking:

```tsx
const lockFile = useCallback((filePath: string) => {
  setLockedFiles(prev => new Set(prev).add(filePath));
  setAgentEditingFile(filePath);
}, []);

const unlockFile = useCallback((filePath: string) => {
  setLockedFiles(prev => {
    const newSet = new Set(prev);
    newSet.delete(filePath);
    return newSet;
  });
  if (agentEditingFile === filePath) setAgentEditingFile(null);
}, [agentEditingFile]);

const isFileLocked = useCallback((filePath: string) => {
  return lockedFiles.has(filePath);
}, [lockedFiles]);
```

### 3. Server-Sent Events (SSE)

The agent emits `file_update` events through SSE when it modifies files:

```typescript
// Event structure
{
  type: 'file_update',
  data: {
    sessionId: string,
    filePath: string,
    content?: string,
    action: 'start' | 'update' | 'complete'
  }
}
```

**Actions:**
- `start` - Agent begins editing a file (locks it)
- `update` - Agent provides updated content (optional, not currently used)
- `complete` - Agent finishes editing (unlocks file and saves final content)

### 4. Event Emission Flow

When the agent uses file tools (`e2b_write_file` or `e2b_edit_file`):

1. **Start**: Emit `agent:fileUpdate` event with `action: 'start'`
2. **Write/Edit**: Perform the file operation in the sandbox
3. **Complete**: Emit `agent:fileUpdate` event with `action: 'complete'` and final content
4. **Error**: If operation fails, emit `complete` to unlock the file

### 5. Visual Feedback

#### In CodeEditor Component

When a file is locked and being edited by the agent:
- Blue ring border appears around the editor
- Header shows "AI Editing..." indicator with blue background
- Editor becomes read-only (`readOnly: true`)
- Cursor style changes to thin underline

```tsx
<Card className={`... ${agentEditing ? 'ring-2 ring-blue-500' : ''}`}>
  <div className={`... ${agentEditing ? 'bg-blue-500/10' : 'bg-muted/30'}`}>
    {agentEditing && (
      <span className="text-xs font-medium text-blue-500">
        AI Editing...
      </span>
    )}
  </div>
</Card>
```

#### In FileTree Component

Locked files show:
- Lock icon (🔒)
- "AI" badge in blue
- Reduced opacity (60%)
- Not clickable (`cursor-not-allowed`)
- Blue pulse animation while being edited

```tsx
{lockedFiles?.has(node.path) && (
  <>
    <Lock className="w-3 h-3 text-blue-500" />
    <span className="text-[10px] text-blue-500 font-semibold">AI</span>
  </>
)}
```

### 6. Content Synchronization

When the agent completes editing:
1. SSE event includes the final file content
2. Frontend updates the `fileTree` state with new content
3. If the file is currently open in the editor, Monaco updates automatically via Yjs
4. Changes are persisted to the database via auto-save

## Implementation Files

- **Frontend State**: [src/app/chat/[id]/page.tsx](../src/app/chat/[id]/page.tsx) (lines 54-57, 666-684)
- **SSE Handling**: [src/app/chat/[id]/page.tsx](../src/app/chat/[id]/page.tsx) (lines 394-428)
- **SSE Route**: [src/app/api/stream/route.ts](../src/app/api/stream/route.ts) (handleFileUpdate)
- **Agent Tools**: [src/lib/e2b-tools.ts](../src/lib/e2b-tools.ts) (writeFile, editFile)
- **Agent Workflow**: [src/lib/nextjs-coding-agent.ts](../src/lib/nextjs-coding-agent.ts)
- **CodeEditor UI**: [src/components/CodeEditor.tsx](../src/components/CodeEditor.tsx) (lines 273-286, 321-322)
- **FileTree UI**: [src/components/FileTree.tsx](../src/components/FileTree.tsx) (lines 130-157)

## Testing

To test the feature:

1. Start a chat session with a sandbox
2. Ask the agent to create or modify a file (e.g., "Create a new component in app/components/Hero.tsx")
3. Watch for:
   - File tree shows lock icon and "AI" badge
   - If file is open, editor shows blue ring and "AI Editing..." header
   - Editor becomes read-only
   - After completion, lock releases and content updates

## Error Handling

If the agent encounters an error during file editing:
- `complete` action is emitted to unlock the file
- File content remains in its pre-edit state
- User can manually edit the file again

## Future Enhancements

- **Progress Updates**: Use `update` action to show incremental changes
- **Timeout Protection**: Auto-unlock files after 2 minutes of inactivity
- **Multi-file Locking**: Support locking multiple files for complex refactors
- **Lock Queue**: Queue user edits while agent is working, apply after unlock
