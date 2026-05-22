import { NextResponse } from 'next/server';

// Fans out a quick HEAD/GET to each backend so they cold-start while the user
// is still on the homepage. Server-side fanout avoids CORS + keeps proxy/yjs
// URLs out of the client bundle.

const AGENT_URL = process.env.NEXT_PUBLIC_LANGGRAPH_URL || 'http://localhost:2024';
const N8N_PROXY_URL = process.env.N8N_PROXY_URL || 'http://localhost:1235';

// Yjs is a WebSocket server. Hocuspocus answers HTTP GET / with a plain
// "OK" response — that's enough to trigger the dyno to spin up.
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:1234';
const YJS_HTTP_URL = WS_URL.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');

const PER_TARGET_TIMEOUT_MS = 8000;

async function ping(name: string, url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_TARGET_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const r = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      // We only care that the request lands. Don't follow redirects to
      // keep the warmup fast.
      redirect: 'manual',
    });
    return { name, ok: true, status: r.status, ms: Date.now() - startedAt };
  } catch (err) {
    return { name, ok: false, error: (err as Error).message, ms: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const results = await Promise.all([
    ping('agent', `${AGENT_URL}/info`),
    ping('yjs', `${YJS_HTTP_URL}/health`),
    ping('n8n-proxy', `${N8N_PROXY_URL}/__health`),
  ]);
  return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } });
}
