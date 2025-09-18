# Real-time AI Agent Setup Guide (SSE Implementation)

## Overview

This guide explains the Server-Sent Events (SSE) implementation for real-time communication between the AI agent and frontend, replacing the previous tRPC subscription system for better reliability and browser compatibility.

## Architecture

### 1. Server-Sent Events (SSE) Implementation
- **Endpoint**: `/api/stream` - Handles real-time event streaming
- **Technology**: HTML5 EventSource API with automatic reconnection
- **Advantages**: Better browser compatibility, simpler implementation, built-in reconnection

### 2. Real-time Communication Flow

```
1. User Message → tRPC Mutation → Agent Processing
2. Agent Events → Global EventEmitter → SSE Stream → Frontend Updates
3. UI Updates: Status, Progress, Sandbox Creation, Completion
```

### 3. Key Components

#### Server-Side Events (`/app/api/stream/route.ts`)
```typescript
// Global event emitter for real-time updates
const globalEventEmitter = new EventEmitter();

// SSE endpoint with proper cleanup and heartbeat
export async function GET(request: NextRequest) {
  const sessionId = searchParams.get('sessionId');
  
  const stream = new ReadableStream({
    start(controller) {
      // Session-specific event filtering
      // Automatic cleanup on disconnect
      // Heartbeat for connection health
    }
  });
}
```

#### Frontend Integration (`/app/chat/[id]/page.tsx`)
```typescript
// EventSource connection with error handling
const eventSource = new EventSource(`/api/stream?sessionId=${sessionId}`);

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Handle real-time updates: status, partial content, tools, etc.
};
```

## Setup Instructions

### 1. No Additional Configuration Required

The SSE implementation works out of the box with no environment variables or additional setup.

### 2. Event Types Supported

- **status**: Agent processing state changes
- **partial**: Streaming content updates (typewriter effect)
- **tool**: Tool usage notifications  
- **sandbox**: Sandbox creation/access events
- **complete**: Final response with results
- **error**: Error handling and user feedback
- **heartbeat**: Connection health monitoring (every 30 seconds)

### 3. Fallback System Integration

#### Automatic Fallback Logic
```typescript
// 1. Try Inngest background job first
try {
  await inngest.send({ name: "agent.invoke", data: { ... } });
} catch (error) {
  // 2. Automatic fallback to direct agent execution
  fallbackAgent.invoke(message, sandboxId, (update) => {
    // Updates automatically emitted via SSE
  });
}
```

#### Manual Fallback Control
Users can toggle between Inngest and fallback modes using the UI control in the chat interface.

## Features

### 1. Intelligent Sandbox Detection

Automatically determines when sandboxes are needed:

```typescript
const codeKeywords = [
  'code', 'function', 'debug', 'fix', 'create file',
  'install', 'run', 'execute', 'build', 'test'
];

const needsSandbox = hasCodeKeywords(message) || existingSandboxId;
```

### 2. Real-time UI Updates

#### Status Indicators
- 🔄 Agent processing
- ⏳ Waiting for response  
- 🚀 Sandbox created
- ✅ Task completed
- ❌ Error occurred

#### Activity Feed
- Live updates of agent actions
- Tool usage notifications
- Sandbox access links
- Streaming response content

### 3. Connection Management

#### Automatic Reconnection
EventSource provides built-in reconnection logic. No manual implementation needed.

#### Cleanup on Navigation
```typescript
useEffect(() => {
  return () => {
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe(); // Closes EventSource
    }
  };
}, []);
```

## API Reference

### SSE Endpoint: `/api/stream`

**Parameters**:
- `sessionId` (required): Unique session identifier for event filtering

**Response Format**:
```typescript
{
  type: 'status' | 'partial' | 'tool' | 'complete' | 'error' | 'sandbox' | 'heartbeat';
  data: {
    sessionId: string;
    status?: string;
    message?: string;
    content?: string;
    tool?: string;
    response?: string;
    sandboxUrl?: string;
    error?: string;
    hasSandbox?: boolean;
    sandboxId?: string;
    isNew?: boolean;
  }
}
```

### Event Emitter Integration

```typescript
// Emit events from anywhere in the application
import { globalEventEmitter } from '@/app/api/stream/route';

globalEventEmitter.emit('agent:status', {
  sessionId: 'session-123',
  status: 'processing',
  message: 'Starting analysis...'
});
```

## Migration from tRPC Subscriptions

### Why SSE Over tRPC Subscriptions?

1. **Better Browser Compatibility**: EventSource is more widely supported
2. **Simpler Implementation**: Less complex than tRPC observable setup
3. **Built-in Reconnection**: Automatic reconnection without custom logic
4. **Better Error Handling**: More predictable error states
5. **Lower Overhead**: Less complex infrastructure requirements

### Migration Example

**Before (tRPC)**:
```typescript
const subscription = trpc.subscribe.subscribe({ sessionId }, {
  onData: (data) => { ... },
  onError: (error) => { ... }
});
```

**After (SSE)**:
```typescript
const eventSource = new EventSource(`/api/stream?sessionId=${sessionId}`);
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Handle updates
};
```

## Troubleshooting

### Common Issues

1. **Connection Not Establishing**
   - Check browser console for CORS errors
   - Verify `/api/stream` endpoint accessibility
   - Ensure sessionId parameter is provided

2. **Events Not Received**
   - Verify global event emitter import paths
   - Check event emission in fallback agent
   - Monitor server logs for event processing

3. **Performance Issues**
   - Monitor heartbeat frequency (30s default)
   - Check for memory leaks in event listeners
   - Verify proper cleanup on unmount

### Debug Commands

```typescript
// Enable debug logging
console.log(`Agent update: ${update.type}`, update.data);

// Test SSE connection manually
const testEventSource = new EventSource('/api/stream?sessionId=test');
testEventSource.onmessage = console.log;
```

## Production Considerations

### 1. Error Monitoring
- Monitor SSE connection success rates
- Track event delivery latency
- Alert on high error rates

### 2. Scaling
- EventEmitter is in-memory, consider Redis for multi-instance deployments
- Monitor memory usage of active connections
- Implement connection limits if needed

### 3. Security
- Validate sessionId format
- Implement rate limiting if necessary
- Monitor for abuse patterns

This SSE implementation provides a robust, reliable real-time communication system for the AI agent interface with better browser support and simpler maintenance than the previous tRPC subscription approach.
