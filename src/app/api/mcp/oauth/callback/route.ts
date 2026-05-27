import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { auth as mcpAuth } from '@modelcontextprotocol/sdk/client/auth.js';
import { createDbOAuthProvider } from '@/lib/mcp-oauth-provider';
import {
  getUserServer,
  invalidateUserMcpToolsCache,
  oauthRedirectUrl,
} from '@/lib/mcp-user-store';

export const dynamic = 'force-dynamic';

// Shared OAuth callback for all user-added MCP servers. The serverId arrives
// in the `state` param (set by the provider's state() method); we look it up
// to find the right server, validate the user owns it, and finish the token
// exchange. This lets us register exactly ONE redirect URI per environment
// upstream — important for OAuth servers (e.g. SAP IAS) that reject any URI
// not on a strict allowlist.
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  if (!userId) {
    return NextResponse.redirect(new URL('/?settings=apps&connectError=unauthorized', appUrl));
  }

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const errParam = req.nextUrl.searchParams.get('error');

  if (errParam) {
    return NextResponse.redirect(
      new URL(`/?settings=apps&connectError=${encodeURIComponent(errParam)}`, appUrl),
    );
  }
  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
  }

  // `state` is the serverId we set in OAuthClientProvider.state().
  const serverId = state;
  const row = await getUserServer(userId, serverId);
  if (!row || row.authType !== 'oauth') {
    return NextResponse.redirect(
      new URL('/?settings=apps&connectError=invalid_server', appUrl),
    );
  }

  const provider = createDbOAuthProvider({
    serverId,
    redirectUrl: oauthRedirectUrl(serverId),
  });

  try {
    const result = await mcpAuth(provider, {
      serverUrl: row.url,
      authorizationCode: code,
    });
    if (result !== 'AUTHORIZED') {
      return NextResponse.redirect(
        new URL(
          `/?settings=apps&connectError=${encodeURIComponent(`unexpected_result_${result}`)}`,
          appUrl,
        ),
      );
    }
    invalidateUserMcpToolsCache(userId);
    return NextResponse.redirect(new URL(`/?settings=apps&connected=${serverId}`, appUrl));
  } catch (err) {
    console.error(`[mcp-oauth callback ${serverId}] token exchange failed:`, err);
    return NextResponse.redirect(
      new URL('/?settings=apps&connectError=token_exchange_failed', appUrl),
    );
  }
}
