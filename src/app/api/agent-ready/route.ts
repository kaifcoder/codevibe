import { NextResponse } from 'next/server';

// Probe the LangGraph agent's /info to confirm the dyno is past the cold-start
// window. Separate from /api/warmup (which fans out to all backends with a
// short per-target timeout) because the agent boot is the long pole — Render
// dynos take 30–90s to spin up langgraph + load the graph definition. Clients
// poll this until ready=true to gate the first chat submit.

const AGENT_URL = process.env.NEXT_PUBLIC_LANGGRAPH_URL || 'http://localhost:2024';
const PROBE_TIMEOUT_MS = 5_000;

export async function GET() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const r = await fetch(`${AGENT_URL}/info`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'manual',
    });
    // /info returns 200 once the graph registry is loaded. Anything else means
    // the dyno is still booting (502/503) or the URL is wrong.
    const ready = r.status === 200;
    return NextResponse.json(
      { ready, status: r.status, ms: Date.now() - startedAt },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      { ready: false, error: (err as Error).message, ms: Date.now() - startedAt },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    clearTimeout(timer);
  }
}
