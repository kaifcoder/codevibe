import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { auth as mcpAuth } from '@modelcontextprotocol/sdk/client/auth.js';
import { createDbOAuthProvider } from '@/lib/mcp-oauth-provider';
import {
  getUserServer,
  invalidateUserMcpToolsCache,
  isLoopbackServer,
  oauthRedirectUrl,
} from '@/lib/mcp-user-store';

export const dynamic = 'force-dynamic';

// Step 2 of the loopback OAuth flow. Frontend posts the URL the user pasted
// from their browser's address bar (the dead loopback callback page). We
// parse ?code=…, run the token exchange (PKCE verifier is in our DB), save
// the resulting tokens, return ok.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
      { error: 'This server uses the standard redirect flow; this endpoint is loopback-only.' },
      { status: 400 },
    );
  }

  let body: { callbackUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const callbackUrl = (body.callbackUrl ?? '').trim();
  if (!callbackUrl) {
    return NextResponse.json({ error: 'Missing callbackUrl' }, { status: 400 });
  }

  let code: string | null;
  try {
    const u = new URL(callbackUrl);
    code = u.searchParams.get('code');
    const errParam = u.searchParams.get('error');
    if (errParam) {
      return NextResponse.json({ error: `OAuth error in pasted URL: ${errParam}` }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'callbackUrl is not a valid URL' }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: 'Pasted URL has no ?code= parameter' }, { status: 400 });
  }

  const provider = createDbOAuthProvider({
    serverId: id,
    redirectUrl: oauthRedirectUrl(id, row.url),
  });

  try {
    const result = await mcpAuth(provider, {
      serverUrl: row.url,
      authorizationCode: code,
    });
    if (result !== 'AUTHORIZED') {
      return NextResponse.json({ error: `Unexpected auth result: ${result}` }, { status: 500 });
    }
    invalidateUserMcpToolsCache(userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[mcp-server ${id} /auth/finish] token exchange failed:`, err);
    const message = err instanceof Error ? err.message : 'token exchange failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
