import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { auth as mcpAuth } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  createDbOAuthProvider,
  consumePendingAuthorizationUrl,
  isServerAuthorized,
} from '@/lib/mcp-oauth-provider';
import { getUserServer, oauthRedirectUrl } from '@/lib/mcp-user-store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const row = await getUserServer(userId, id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.authType !== 'oauth') {
    return NextResponse.json({ error: 'Server is not configured for OAuth.' }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  if (await isServerAuthorized(id)) {
    return NextResponse.redirect(new URL(`/?settings=apps&connected=${id}`, appUrl));
  }

  const provider = createDbOAuthProvider({
    serverId: id,
    redirectUrl: oauthRedirectUrl(id),
  });

  try {
    const result = await mcpAuth(provider, { serverUrl: row.url });
    if (result === 'AUTHORIZED') {
      return NextResponse.redirect(new URL(`/?settings=apps&connected=${id}`, appUrl));
    }
    const authUrl = consumePendingAuthorizationUrl(id);
    if (!authUrl) {
      return NextResponse.json(
        { error: 'auth() returned REDIRECT but no URL captured' },
        { status: 500 },
      );
    }
    return NextResponse.redirect(authUrl.toString());
  } catch (err) {
    console.error(`[mcp-server ${id} /auth] failed:`, err);
    const message = err instanceof Error ? err.message : 'OAuth start failed';
    return NextResponse.redirect(
      new URL(`/?settings=apps&connectError=${encodeURIComponent(message)}`, appUrl),
    );
  }
}
