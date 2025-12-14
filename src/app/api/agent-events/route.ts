import { NextRequest, NextResponse } from 'next/server';
import { globalEventEmitter } from '@/app/api/stream/route';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, data } = body;

    // Map Inngest event names to tRPC event names
    const eventMap: Record<string, string> = {
      'agent/status.update': 'agent:status',
      'agent/content.partial': 'agent:partial',
      'agent/tool.used': 'agent:tool',
      'agent/complete': 'agent:complete',
      'agent/error': 'agent:error',
      'agent/sandbox.status': 'agent:sandbox',
    };

    const mappedEventName = eventMap[name];
    if (mappedEventName) {
      // Emit the event to all subscribed clients
      globalEventEmitter.emit(mappedEventName, data);
      
      return NextResponse.json({ success: true, forwarded: mappedEventName });
    }

    console.warn(`⚠️ Unknown event type: ${name}`);
    return NextResponse.json({ success: false, error: 'Unknown event type' }, { status: 400 });

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process webhook' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ 
    status: 'Agent Events Webhook Endpoint',
    events: [
      'agent/status.update',
      'agent/content.partial', 
      'agent/tool.used',
      'agent/complete',
      'agent/error',
      'agent/sandbox.status'
    ]
  });
}
