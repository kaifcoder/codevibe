# Yjs ↔ E2B Filesystem Sync

Bidirectional synchronization between the collaborative code editor (Yjs) and the e2b sandbox filesystem.

## How It Works

### Editor → E2B (Auto-save)

When you edit code in Monaco editor:

1. **Yjs Updates**: Changes are synced in real-time via Yjs to all connected users
2. **Debounced Save**: After 1 second of inactivity, changes are automatically written to e2b filesystem
3. **Visual Feedback**: "Syncing to E2B" indicator appears during the save operation
4. **Duplicate Prevention**: Only saves if content actually changed since last save

**Implementation:**
- Auto-save triggered in `handleCodeChange` callback
- API endpoint: `POST /api/write-to-sandbox`
- Debounce: 1000ms
- Status indicator in file tabs area

### E2B → Editor (Manual sync)

When files are created/modified in the sandbox:

1. **Manual Sync**: Click the refresh icon (⟳) above the file tree
2. **API Call**: Fetches complete file tree from e2b sandbox
3. **SSE Event**: Emits `file_tree_sync` event to all connected clients
4. **UI Update**: File tree and file contents update automatically

**Implementation:**
- Manual trigger button in FileTree header
- API endpoint: `POST /api/sync-filesystem`
- SSE event type: `file_tree_sync`
- Auto-loads file contents for files < 100KB

## Features

✅ **Real-time Collaboration**: Multiple users can edit the same file via Yjs  
✅ **Auto-save to Sandbox**: Changes persist to e2b filesystem automatically  
✅ **Manual Sync**: Pull latest changes from sandbox filesystem  
✅ **Visual Indicators**: See when syncing is happening  
✅ **Smart Debouncing**: Prevents excessive API calls  
✅ **Null Byte Sanitization**: Handles binary files safely  

## API Endpoints

### `/api/write-to-sandbox` (POST)
Writes editor content to e2b sandbox filesystem.

**Request:**
```json
{
  "sandboxId": "sbx_abc123",
  "filePath": "app/page.tsx",
  "content": "export default function Page() { ... }"
}
```

**Response:**
```json
{
  "success": true,
  "message": "File written to app/page.tsx"
}
```

### `/api/sync-filesystem` (POST)
Syncs complete file tree from e2b to editor.

**Request:**
```json
{
  "sandboxId": "sbx_abc123",
  "sessionId": "session-xyz"
}
```

**Response:**
```json
{
  "success": true,
  "fileCount": 15,
  "message": "Filesystem synced successfully"
}
```

## Code Flow

```
┌─────────────┐
│ Monaco      │ ← User types
│ Editor      │
└──────┬──────┘
       │ onChange (immediate)
       ▼
┌─────────────┐
│ Yjs Doc     │ ← Real-time sync to other users
│ (Y.Text)    │
└──────┬──────┘
       │ observe (debounced 200ms)
       ▼
┌─────────────┐
│handleCode   │ ← Updates file tree state
│Change       │
└──────┬──────┘
       │ debounced 1000ms
       ▼
┌─────────────┐
│/api/write   │ ← Writes to e2b sandbox
│-to-sandbox  │
└─────────────┘
```

## Files Modified

- [src/app/chat/[id]/page.tsx](../src/app/chat/[id]/page.tsx) - Added auto-save logic
- [src/app/api/write-to-sandbox/route.ts](../src/app/api/write-to-sandbox/route.ts) - New API endpoint
- [src/app/api/sync-filesystem/route.ts](../src/app/api/sync-filesystem/route.ts) - Existing sync endpoint
- [src/lib/e2b-tools.ts](../src/lib/e2b-tools.ts) - Sanitizes null bytes
- [src/app/api/session/[token]/route.ts](../src/app/api/session/[token]/route.ts) - Sanitizes before DB save

## Usage

### For Users

**Editing Files:**
1. Select a file from the tree
2. Edit in Monaco editor
3. Changes sync to other users instantly via Yjs
4. After 1 second, changes auto-save to e2b sandbox
5. See "Syncing to E2B" indicator during save

**Syncing from Sandbox:**
1. Click refresh icon (⟳) in file tree header
2. Wait for sync to complete
3. File tree updates with latest files from e2b

### For Developers

**Customize Debounce Time:**
```typescript
// In handleCodeChange callback
saveTimeoutRef.current = setTimeout(async () => {
  // Save logic
}, 1000); // Change this value
```

**Track Sync Status:**
```typescript
const [isSyncingToE2B, setIsSyncingToE2B] = useState(false);
// Shows spinner when true
```

## Benefits

- **No Data Loss**: Editor changes persist to sandbox automatically
- **Seamless Collaboration**: Multiple users edit simultaneously via Yjs
- **Performance**: Debouncing prevents excessive filesystem writes
- **User Awareness**: Visual indicators keep users informed
- **Bidirectional**: Pull changes from sandbox or push from editor
