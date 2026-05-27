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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const row = await getUserServer(userId, id);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  if (!row || row.authType !== 'oauth') {
    return NextResponse.redirect(
      new URL('/?settings=apps&connectError=invalid_server', appUrl),
    );
  }

  const code = req.nextUrl.searchParams.get('code');
  const errParam = req.nextUrl.searchParams.get('error');
  if (errParam) {
    return NextResponse.redirect(
      new URL(`/?settings=apps&connectError=${encodeURIComponent(errParam)}`, appUrl),
    );
  }
  if (!code) {
    return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
  }

  const provider = createDbOAuthProvider({
    serverId: id,
    redirectUrl: oauthRedirectUrl(id),
  });

  try {
    const result = await mcpAuth(provider, {
      serverUrl: row.url,
      authorizationCode: code,
    });
    if (result !== 'AUTHORIZED') {
      return NextResponse.redirect(
        new URL(`/?settings=apps&connectError=${encodeURIComponent(`unexpected_result_${result}`)}`, appUrl),
      );
    }
    invalidateUserMcpToolsCache(userId);
    return NextResponse.redirect(new URL(`/?settings=apps&connected=${id}`, appUrl));
  } catch (err) {
    console.error(`[mcp-server ${id} /callback] token exchange failed:`, err);
    return NextResponse.redirect(
      new URL('/?settings=apps&connectError=token_exchange_failed', appUrl),
    );
  }
}
