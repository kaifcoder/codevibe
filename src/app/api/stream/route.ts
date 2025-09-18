import { NextRequest } from 'next/server';
import { EventEmitter } from 'events';
import { appendSessionMessages } from '@/lib/session-memory';

// Create a global event emitter for real-time updates
const globalEventEmitter = new EventEmitter();

// Type definitions for streaming events
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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return new Response('Missing sessionId parameter', { status: 400 });
  }

  // Create a ReadableStream for Server-Sent Events
  const stream = new ReadableStream({
    start(controller) {
      // Send headers to establish SSE connection
      const encoder = new TextEncoder();
      
      const send = (data: string) => {
        controller.enqueue(encoder.encode(data));
      };

      // Initial connection message
      send(`data: ${JSON.stringify({ type: 'connected', sessionId })}

`);

      // Event handlers for different types of updates
      const handleAgentUpdate = (data: AgentEventData) => {
        if (data.sessionId === sessionId) {
          send(`data: ${JSON.stringify({
            type: 'status',
            data: {
              sessionId: data.sessionId,
              status: data.status,
              message: data.message,
              hasSandbox: data.hasSandbox,
            }
          })}

`);
        }
      };

      const handlePartialContent = (data: AgentEventData) => {
        if (data.sessionId === sessionId) {
          send(`data: ${JSON.stringify({
            type: 'partial',
            data: {
              sessionId: data.sessionId,
              content: data.content,
              fullContent: data.fullContent,
            }
          })}

`);
        }
      };

      const handleToolUsed = (data: AgentEventData) => {
        if (data.sessionId === sessionId) {
          send(`data: ${JSON.stringify({
            type: 'tool',
            data: {
              sessionId: data.sessionId,
              tool: data.tool,
            }
          })}

`);
        }
      };

      const handleSandboxStatus = (data: AgentEventData) => {
        if (data.sessionId === sessionId) {
          send(`data: ${JSON.stringify({
            type: 'sandbox',
            data: {
              sessionId: data.sessionId,
              sandboxId: data.sandboxId,
              sandboxUrl: data.sandboxUrl,
              isNew: data.isNew,
            }
          })}

`);
        }
      };

      const handleComplete = (data: AgentEventData) => {
        if (data.sessionId === sessionId) {
          send(`data: ${JSON.stringify({
            type: 'complete',
            data: {
              sessionId: data.sessionId,
              response: data.response,
              sandboxUrl: data.sandboxUrl,
              hasSandbox: data.hasSandbox,
            }
          })}

`);
          if (data.response) {
            appendSessionMessages(sessionId, [{ role: 'ai', content: String(data.response), ts: Date.now() }]);
          }
        }
      };

      const handleError = (data: AgentEventData) => {
        if (data.sessionId === sessionId) {
          send(`data: ${JSON.stringify({
            type: 'error',
            data: {
              sessionId: data.sessionId,
              error: data.error,
            }
          })}

`);
        }
      };

      // Listen for different types of events
      globalEventEmitter.on('agent:status', handleAgentUpdate);
      globalEventEmitter.on('agent:partial', handlePartialContent);
      globalEventEmitter.on('agent:tool', handleToolUsed);
      globalEventEmitter.on('agent:sandbox', handleSandboxStatus);
      globalEventEmitter.on('agent:complete', handleComplete);
      globalEventEmitter.on('agent:error', handleError);

      // Keep connection alive with periodic heartbeat
      const heartbeat = setInterval(() => {
        send(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}

`);
      }, 30000);

      // Cleanup when client disconnects
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        globalEventEmitter.off('agent:status', handleAgentUpdate);
        globalEventEmitter.off('agent:partial', handlePartialContent);
        globalEventEmitter.off('agent:tool', handleToolUsed);
        globalEventEmitter.off('agent:sandbox', handleSandboxStatus);
        globalEventEmitter.off('agent:complete', handleComplete);
        globalEventEmitter.off('agent:error', handleError);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// Export the event emitter for use in other parts of the application
export { globalEventEmitter };
