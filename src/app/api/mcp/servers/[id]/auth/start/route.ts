import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { auth as mcpAuth } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  createDbOAuthProvider,
  consumePendingAuthorizationUrl,
  isServerAuthorized,
} from '@/lib/mcp-oauth-provider';
import {
  getUserServer,
  invalidateUserMcpToolsCache,
  isLoopbackServer,
  oauthRedirectUrl,
} from '@/lib/mcp-user-store';

export const dynamic = 'force-dynamic';

// Step 1 of the loopback OAuth flow. Frontend POSTs here, we run DCR + build
// the authorize URL, return it as JSON. Frontend opens that URL in a new tab.
// Used for OAuth servers (e.g. SAP Jira) whose IdP doesn't allowlist our
// real redirect URI — we register loopback instead.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const row = await getUserServer(userId, id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.authType !== 'oauth') {
    return NextResponse.json({ error: 'Server is not configured for OAuth' }, { status: 400 });
  }
  if (!isLoopbackServer(row.url)) {
    return NextResponse.json(
      { error: 'This server uses the standard redirect flow; use /auth instead.' },
      { status: 400 },
    );
  }

  if (await isServerAuthorized(id)) {
    return NextResponse.json({ ok: true, alreadyAuthorized: true });
  }

  const provider = createDbOAuthProvider({
    serverId: id,
    redirectUrl: oauthRedirectUrl(id, row.url),
  });

  try {
    const result = await mcpAuth(provider, { serverUrl: row.url });
    if (result === 'AUTHORIZED') {
      invalidateUserMcpToolsCache(userId);
      return NextResponse.json({ ok: true, alreadyAuthorized: true });
    }
    const authUrl = consumePendingAuthorizationUrl(id);
    if (!authUrl) {
      return NextResponse.json(
        { error: 'auth() returned REDIRECT but no URL captured' },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, authUrl: authUrl.toString() });
  } catch (err) {
    console.error(`[mcp-server ${id} /auth/start] failed:`, err);
    const message = err instanceof Error ? err.message : 'OAuth start failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
