// Example hook for using the real-time agent updates
import { useState, useEffect } from 'react';
import { useTRPC } from '@/trpc/client';

export function useAgentStream(sessionId: string) {
  const [messages, setMessages] = useState<Array<{
    type: 'status' | 'partial' | 'tool' | 'complete' | 'error' | 'sandbox';
    content: string;
    timestamp: Date;
  }>>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);

  const trpc = useTRPC();
  
  useEffect(() => {
    if (!sessionId) return;

    const subscription = trpc.subscribe.subscribe(
      { sessionId },
      {
        onData: (data) => {
          const newMessage = {
            type: data.type,
            content: getContentFromData(data),
            timestamp: new Date(),
          };

          setMessages(prev => [...prev, newMessage]);

          // Handle specific event types
          switch (data.type) {
            case 'status':
              setIsStreaming(data.data.status === 'started');
              break;
            case 'sandbox':
              if (data.data.sandboxUrl) {
                setSandboxUrl(data.data.sandboxUrl);
              }
              break;
            case 'complete':
            case 'error':
              setIsStreaming(false);
              if (data.data.sandboxUrl) {
                setSandboxUrl(data.data.sandboxUrl);
              }
              break;
          }
        },
        onError: (error) => {
          console.error('Subscription error:', error);
          setIsStreaming(false);
        },
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [sessionId, trpc]);

  return {
    messages,
    isStreaming,
    sandboxUrl,
  };
}

function getContentFromData(data: any): string {
  switch (data.type) {
    case 'status':
      return data.data.message || 'Status update';
    case 'partial':
      return data.data.content || '';
    case 'tool':
      return `🔧 ${data.data.tool}`;
    case 'sandbox':
      return `🏗️ Sandbox ${data.data.isNew ? 'created' : 'connected'}: ${data.data.sandboxId}`;
    case 'complete':
      return '✅ Task completed';
    case 'error':
      return `❌ Error: ${data.data.error}`;
    default:
      return JSON.stringify(data.data);
  }
}
