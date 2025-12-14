# WebSocket Architecture for Collaborative Platform

## Overview
This document outlines the architecture for adding WebSocket support to enable collaborative features (Yjs) and real-time streaming.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Client (Browser)                      │
├─────────────────────────────────────────────────────────┤
│  tRPC Client          WebSocket Client                  │
│  (commands)           (real-time data)                   │
└────────┬─────────────────────┬──────────────────────────┘
         │                     │
         │                     │
┌────────▼─────────────────────▼──────────────────────────┐
│                    Next.js Server                        │
├─────────────────────────────────────────────────────────┤
│  /api/trpc           /api/ws                            │
│  - invoke            - Agent streaming                   │
│  - queries           - Yjs sync                          │
│  - mutations         - Presence                          │
│                      - Collaborative editing             │
└─────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Add WebSocket Server (Current)
Keep SSE for now, add WebSocket infrastructure:

```bash
npm install ws @hocuspocus/server y-protocols yjs
```

Create `/src/lib/websocket-server.ts`:
```typescript
import { WebSocketServer } from 'ws';
import { Server as HocuspocusServer } from '@hocuspocus/server';

// Yjs collaborative server
export const hocuspocus = Server.configure({
  name: 'codevibe',
  // Add extensions for persistence, auth, etc.
});

// Custom WebSocket handling
export function setupWebSocketServer(server: any) {
  const wss = new WebSocketServer({ server, path: '/api/ws' });
  
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const type = url.searchParams.get('type');
    
    // Route to different handlers
    if (type === 'yjs') {
      // Handle Yjs collaboration
      hocuspocus.handleConnection(ws, req);
    } else if (type === 'agent') {
      // Handle agent streaming
      handleAgentStream(ws, url.searchParams.get('sessionId')!);
    }
  });
}
```

### Phase 2: Migrate SSE to WebSocket (When Ready)
Replace `/api/stream` with WebSocket channel:

```typescript
// Client side
const ws = new WebSocket(`ws://localhost:3000/api/ws?type=agent&sessionId=${sessionId}`);

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Same handling as current SSE
  handleAgentUpdate(data);
};
```

### Phase 3: Add Collaborative Features
Integrate Yjs for:
- **Code editor sync** - Multiple users editing same file
- **Cursor presence** - See where others are working
- **File tree sync** - Real-time file changes
- **Chat sync** - Collaborative chat sessions

```typescript
// Example: Collaborative code editor
import { useYjs } from '@/hooks/use-yjs';

function CodeEditor() {
  const { provider, doc } = useYjs('room-123', 'code');
  
  // Monaco/CodeMirror bindings with Yjs
  // Users see each other's changes in real-time
}
```

## Deployment Considerations

### Development (Current)
- SSE works perfectly for local development
- Easy debugging

### Production Options

#### Option 1: Vercel + Pusher/Ably (Recommended for MVP)
```bash
npm install pusher-js @hocuspocus/extension-webhook
```
- Vercel for Next.js (serverless)
- Pusher/Ably for WebSocket (managed service)
- Hocuspocus webhooks for Yjs sync

**Pros:**
- Serverless benefits
- Managed WebSocket infrastructure
- Scales automatically
- No server management

**Cons:**
- Additional cost for Pusher/Ably
- Slight latency vs self-hosted

#### Option 2: Self-hosted (Railway/Render/Digital Ocean)
- Deploy Next.js with custom server
- Run WebSocket server alongside
- Full control, single binary

**Pros:**
- Lower cost at scale
- Full control
- Direct WebSocket connections

**Cons:**
- Server management required
- Need to handle scaling

#### Option 3: Hybrid Approach
- Vercel for web app
- Separate WebSocket server on Railway/Render
- CORS configured between them

## Migration Path (Zero Downtime)

1. **Add WebSocket alongside SSE** (both work)
2. **Feature flag** - Let users opt into WS
3. **Monitor** - Ensure WS is stable
4. **Gradual rollout** - Move users to WS
5. **Remove SSE** - Once 100% on WS

```typescript
// Feature flag example
const useWebSocket = process.env.NEXT_PUBLIC_USE_WEBSOCKET === 'true';

if (useWebSocket) {
  // Use WS connection
  connectWebSocket(sessionId);
} else {
  // Use SSE connection (fallback)
  connectSSE(sessionId);
}
```

## Current Recommendation

**Keep SSE for now**, add WebSocket infrastructure when you're ready to implement:

1. **Immediate**: Continue with SSE - works great
2. **Next Sprint**: Add Yjs/WebSocket server setup
3. **Future**: Migrate agent streaming to WS when collaborative features are live

This way:
- ✅ No wasted work (SSE → WS is simple migration)
- ✅ Learn WebSocket needs from Yjs first
- ✅ Single WS connection for all real-time features
- ✅ Better performance (one connection vs multiple)

## Example: Combined WebSocket Messages

```typescript
// Single WebSocket handles everything
ws.send(JSON.stringify({
  type: 'agent:partial',
  sessionId: 'session-123',
  content: 'Generated code...'
}));

ws.send(JSON.stringify({
  type: 'yjs:update',
  room: 'room-456',
  update: yUpdate
}));

ws.send(JSON.stringify({
  type: 'presence',
  userId: 'user-789',
  cursor: { line: 42, col: 10 }
}));
```

## Next Steps

1. **Research Yjs setup** - Understand requirements
2. **Choose deployment strategy** - Managed vs self-hosted
3. **Set up WebSocket server** - When collaborative features start
4. **Migrate agent streaming** - After Yjs is stable
5. **Remove SSE code** - Final cleanup

---

**Key Insight**: WebSocket is needed for Yjs anyway, so when you add it for collaboration, you can easily migrate agent streaming to the same connection. No need to rush it now.
