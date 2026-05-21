import { NextRequest, NextResponse } from 'next/server';

const PROXY_URL = process.env.N8N_PROXY_URL ?? 'http://localhost:1235';

export async function POST(req: NextRequest) {
  let sandboxUrl: string | undefined;
  try {
    const body = await req.json();
    sandboxUrl = body.sandboxUrl;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  if (!sandboxUrl || !/^https?:\/\//.test(sandboxUrl)) {
    return NextResponse.json({ error: 'sandboxUrl required (http/https URL)' }, { status: 400 });
  }

  try {
    const r = await fetch(`${PROXY_URL}/__register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandboxUrl }),
    });
    const data = await r.json();
    if (!r.ok) {
      return NextResponse.json({ error: data.error ?? 'proxy rejected target' }, { status: 502 });
    }
    return NextResponse.json({ ...data, proxyUrl: PROXY_URL });
  } catch (err) {
    return NextResponse.json(
      { error: `proxy unreachable at ${PROXY_URL}: ${(err as Error).message}. Run "npm run n8n-proxy".` },
      { status: 502 },
    );
  }
}

export async function GET() {
  try {
    const r = await fetch(`${PROXY_URL}/__health`);
    const data = await r.json();
    return NextResponse.json({ ...data, proxyUrl: PROXY_URL });
  } catch (err) {
    return NextResponse.json(
      { error: `proxy unreachable at ${PROXY_URL}: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
