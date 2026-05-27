import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import {
  listUserServers,
  createUserServer,
  validateInput,
  probeMcpServer,
  invalidateUserMcpToolsCache,
  ensureLoopbackServerSeeded,
  type AuthType,
} from '@/lib/mcp-user-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await ensureLoopbackServerSeeded(userId);
    const servers = await listUserServers(userId);
    return NextResponse.json({ servers });
  } catch (err) {
    console.error('[GET /api/mcp/servers] failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to list servers';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const input = body as {
    name?: string;
    url?: string;
    authType?: AuthType;
    bearerToken?: string;
  };
  const normalized = {
    name: (input.name ?? '').trim(),
    url: (input.url ?? '').trim(),
    authType: input.authType ?? 'none',
    bearerToken: input.bearerToken,
  };
  const validationError = validateInput(normalized);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const probe =
    normalized.authType === 'oauth'
      ? { ok: true as const, toolCount: 0 }
      : await probeMcpServer(normalized.url, normalized.authType, normalized.bearerToken);
  if (!probe.ok) {
    return NextResponse.json(
      { error: `Connection failed: ${probe.error}` },
      { status: 422 },
    );
  }

  const server = await createUserServer(userId, normalized);
  invalidateUserMcpToolsCache(userId);
  return NextResponse.json({
    server,
    toolCount: probe.toolCount,
    // For OAuth servers the UI navigates here to start the redirect flow.
    authUrl: server.authType === 'oauth' ? `/api/mcp/servers/${server.id}/auth` : null,
  });
}
