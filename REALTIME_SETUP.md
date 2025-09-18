# Real-time AI Agent with Fallback Mechanism

This implementation provides real-time updates from your AI agent with automatic fallback when Inngest is unavailable.

## 🎯 Key Features

### 🛡️ **Automatic Fallback**
- **Primary**: Inngest background jobs with real-time webhooks
- **Fallback**: Direct agent execution when Inngest fails
- **Seamless**: Automatic detection and fallback without user intervention
- **Manual Override**: Option to force fallback mode

### 🧠 **Intelligent Sandbox Detection**
- **Textual Mode**: For questions like "How do I...", "What is...", "Explain..."
- **Sandbox Mode**: For requests like "Create...", "Build...", "Generate code..."
- **Existing Sandbox**: Reuses sandbox if `sandboxId` is provided

### ⚡ **Real-time Updates**
- 🤖 **Status updates**: Agent started/completed
- ⚡ **Partial content**: Character-by-character streaming
- 🔧 **Tool usage**: When E2B tools are being used  
- 🏗️ **Sandbox events**: Creation/connection status
- ❌ **Error handling**: Real-time error notifications

## � Frontend Integration

### Chat Interface with Real-time Updates
```tsx
// The chat page automatically integrates all features:
- Real-time status indicator
- Method indicator (Inngest/Fallback)
- Sandbox URL access button  
- Fallback mode toggle
- Live agent activity feed
- Streaming message responses
```

### UI Components Added:
1. **Status Bar**: Shows agent status and method
2. **Sandbox Button**: Quick access to live preview
3. **Fallback Toggle**: Manual fallback control
4. **Activity Feed**: Real-time agent operations log
5. **Streaming Chat**: Live response updates

## 📡 API Usage

### Basic Usage (Auto-fallback)
```typescript
// Will try Inngest first, fallback automatically if it fails
const { data } = await trpc.invoke.mutate({
  message: "Create a React component for a todo list",
  sessionId: "unique-session-id",
  useFallback: false // Optional: force fallback
});
```

### Force Fallback Mode
```typescript
const { data } = await trpc.invoke.mutate({
  message: "Explain how React hooks work",
  sessionId: "session-id",
  useFallback: true // Force direct execution
});
```

### With Existing Sandbox
```typescript
const { data } = await trpc.invokeWithSandbox.mutate({
  message: "Add a delete button to the todo component",
  sandboxId: "existing-sandbox-id",
  sessionId: "session-id"
});
```

## 🛠 Architecture

### Fallback Flow
```
User Request → Try Inngest → Success? → Real-time webhooks
                    ↓ Fail
               Fallback Agent → Direct streaming → Local events
```

### Components:
1. **`src/lib/fallback-agent.ts`** - Direct agent execution
2. **`src/trpc/routers/_app.ts`** - API with fallback logic
3. **`src/app/api/agent-events/route.ts`** - Webhook handler
4. **`src/inngest/functions.ts`** - Background job with webhooks
5. **`src/app/chat/[id]/page.tsx`** - Integrated chat interface

## ⚙️ Setup Instructions

### 1. Environment Variables
```bash
# Add to .env.local
NEXT_PUBLIC_APP_URL=http://localhost:3000  # For webhooks (Inngest)
# Inngest credentials (if using Inngest)
INNGEST_EVENT_KEY=your_event_key
INNGEST_SIGNING_KEY=your_signing_key
```

### 2. Configuration Options

#### Force Fallback Mode (UI)
Users can toggle "Fallback Mode" in the chat interface to bypass Inngest entirely.

#### Programmatic Fallback
```typescript
// Always use fallback
const response = await trpc.invoke.mutate({
  message: "Help me understand React",
  useFallback: true
});
```

### 3. Real-time Features

#### Inngest Mode (Primary)
- Background job execution
- Webhook-based real-time updates
- Better scalability
- Persistent execution

#### Fallback Mode
- Direct function execution  
- Immediate streaming responses
- No external dependencies
- Perfect for development/testing

## 🎛 Event Types & UI Indicators

| Event Type | Inngest | Fallback | UI Indicator |
|------------|---------|----------|--------------|
| `status` | ✅ | ✅ | Green dot, status text |
| `partial` | ✅ | ✅ | Live message updates |
| `tool` | ✅ | ✅ | 🔧 Tool notifications |
| `sandbox` | ✅ | ✅ | 🏗️ Sandbox button |
| `complete` | ✅ | ✅ | ✅ Completion status |
| `error` | ✅ | ✅ | ❌ Error messages |

## 🔧 Customization

### Keyword Detection
Both Inngest and fallback modes use the same intelligent detection:

```typescript
// Sandbox triggers
const sandboxKeywords = [
  'create', 'build', 'generate code', 'component'
];

// Textual response triggers  
const textualKeywords = [
  'how to', 'what is', 'explain', 'help me understand'
];
```

### Fallback Agent Configuration
```typescript
// Customize in src/lib/fallback-agent.ts
export class FallbackAgent {
  async invoke(prompt, sandboxId, onUpdate) {
    // Your custom logic here
  }
}
```

## 🐛 Debugging

### Check System Status
The UI shows current status:
- 🟢 **Green dot**: Agent active
- 🔴 **Gray dot**: Ready/idle
- **Method indicator**: `(inngest)` or `(fallback)`

### Monitor Activity Feed
Real-time activity shows:
- Tool executions
- Sandbox operations
- Error messages
- Completion status

### Force Fallback Testing
1. Toggle "Fallback Mode" in UI
2. Send a message
3. Verify direct execution (no background job)

### Inngest Troubleshooting
1. Check environment variables
2. Verify webhook endpoint: `GET /api/agent-events`
3. Monitor Inngest dashboard
4. Check console for fallback messages

## 💡 Usage Examples

### Question (Fallback Recommended)
```
User: "What's the difference between useState and useReducer?"
→ Uses fallback for quick response
→ No sandbox needed
```

### Code Generation (Inngest + Sandbox)
```
User: "Create a React todo app with TypeScript"  
→ Uses Inngest for background processing
→ Creates sandbox automatically
→ Real-time progress updates
```

### Development Mode
```
// Toggle fallback mode for faster development cycles
// No background job overhead
// Immediate responses and debugging
```

### Production Mode
```
// Use Inngest for scalability
// Background processing
// Better error handling and retries
```

This implementation provides the best of both worlds: robust background processing with Inngest when available, and reliable fallback execution when needed!
