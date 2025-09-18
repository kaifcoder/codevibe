import { NextRequest } from 'next/server';
import { EventEmitter } from 'events';

// Re-use the same global emitter defined for SSE route by lazy importing it.
// If not yet initialized, create a new one (works in single-process dev; for multi-instance use a shared bus like Redis Pub/Sub).
// Augment global type for typed reuse
declare global {
  // global augmentation for shared emitter
  // (Used only for dev single-process convenience)
  var __CODEVIBE_AGENT_EMITTER__: EventEmitter | undefined;
}

const globalEventEmitter: EventEmitter = global.__CODEVIBE_AGENT_EMITTER__ ?? new EventEmitter();
global.__CODEVIBE_AGENT_EMITTER__ ??= globalEventEmitter;

interface AgentEventData {
  sessionId: string;
  status?: string;
  message?: string;
  content?: string;
  fullContent?: string;
  tool?: string;
  response?: string;
  sandboxUrl?: string;
  error?: string;
  hasSandbox?: boolean;
  sandboxId?: string;
  isNew?: boolean;
}

// Maintain a simple per-request event index (not persisted; resume not yet implemented)

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');
  const lastEventId = searchParams.get('lastEventId'); // placeholder for future resume

  if (!sessionId) {
    return new Response('Missing sessionId parameter', { status: 400 });
  }

  let eventIndex = 0;
  if (lastEventId) {
    // In a future enhancement we could replay from a durable log. For now we just acknowledge.
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };

      const wrap = (type: string, data: unknown) => {
        write({
          eventIndex: ++eventIndex,
            type,
            sessionId,
            ts: Date.now(),
            data,
        });
      };

      // Initial handshake
      wrap('connected', { sessionId });

      const handleStatus = (data: AgentEventData) => {
        if (data.sessionId === sessionId) {
          wrap('status', { status: data.status, message: data.message, hasSandbox: data.hasSandbox });
        }
      };
      const handlePartial = (data: AgentEventData) => {
        if (data.sessionId === sessionId) {
          wrap('partial', { content: data.content, fullContent: data.fullContent });
        }
      };
      const handleTool = (data: AgentEventData) => {
        if (data.sessionId === sessionId) {
          wrap('tool', { tool: data.tool });
        }
      };
      const handleSandbox = (data: AgentEventData) => {
        if (data.sessionId === sessionId) {
          wrap('sandbox', { sandboxId: data.sandboxId, sandboxUrl: data.sandboxUrl, isNew: data.isNew });
        }
      };
      const handleComplete = (data: AgentEventData) => {
        if (data.sessionId === sessionId) {
          wrap('complete', { response: data.response, sandboxUrl: data.sandboxUrl, hasSandbox: data.hasSandbox });
        }
      };
      const handleError = (data: AgentEventData) => {
        if (data.sessionId === sessionId) {
          wrap('error', { error: data.error });
        }
      };

      globalEventEmitter.on('agent:status', handleStatus);
      globalEventEmitter.on('agent:partial', handlePartial);
      globalEventEmitter.on('agent:tool', handleTool);
      globalEventEmitter.on('agent:sandbox', handleSandbox);
      globalEventEmitter.on('agent:complete', handleComplete);
      globalEventEmitter.on('agent:error', handleError);

      const heartbeat = setInterval(() => {
        wrap('heartbeat', { })
      }, 30000);

      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        globalEventEmitter.off('agent:status', handleStatus);
        globalEventEmitter.off('agent:partial', handlePartial);
        globalEventEmitter.off('agent:tool', handleTool);
        globalEventEmitter.off('agent:sandbox', handleSandbox);
        globalEventEmitter.off('agent:complete', handleComplete);
        globalEventEmitter.off('agent:error', handleError);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no', // nginx
      'Connection': 'keep-alive',
    }
  });
}

// Export emitter for potential reuse (mirrors SSE route pattern)
export { globalEventEmitter };