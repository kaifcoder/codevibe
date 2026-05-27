import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { checkInternalAuth } from '@/lib/internal-auth';
import { decrypt, encrypt } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

// GET → return decrypted credentials for the server. Used by the agent to
// read the bearer token (for bearer auth) or the OAuth access/refresh tokens
// + client info (for oauth auth).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = checkInternalAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

  const server = await prisma.mcpServerConfig.findFirst({
    where: { id, userId },
  });
  if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const cred =
    server.authType === 'oauth'
      ? await prisma.mcpOAuthCredential.findUnique({ where: { serverId: id } })
      : null;

  return NextResponse.json({
    id: server.id,
    name: server.name,
    url: server.url,
    authType: server.authType,
    bearerToken:
      server.authType === 'bearer' && server.encryptedBearerToken
        ? safeDecrypt(server.encryptedBearerToken)
        : null,
    oauth: cred
      ? {
          clientInfo: cred.encryptedClientInfo ? safeDecryptJson(cred.encryptedClientInfo) : null,
          tokens: cred.encryptedTokens ? safeDecryptJson(cred.encryptedTokens) : null,
        }
      : null,
  });
}

// POST → write back refreshed OAuth tokens or a newly registered client info.
// Body: { userId, kind: 'tokens' | 'clientInfo', value: object }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = checkInternalAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  let body: { userId?: string; kind?: string; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.userId || !body.kind || body.value === undefined) {
    return NextResponse.json({ error: 'Missing userId/kind/value' }, { status: 400 });
  }

  // Validate ownership before writing.
  const server = await prisma.mcpServerConfig.findFirst({
    where: { id, userId: body.userId },
    select: { id: true, authType: true },
  });
  if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (server.authType !== 'oauth') {
    return NextResponse.json({ error: 'Server is not OAuth' }, { status: 400 });
  }

  if (body.kind !== 'tokens' && body.kind !== 'clientInfo') {
    return NextResponse.json({ error: 'Unsupported kind' }, { status: 400 });
  }

  const enc = encrypt(JSON.stringify(body.value));
  const data =
    body.kind === 'tokens'
      ? { encryptedTokens: enc }
      : { encryptedClientInfo: enc };

  await prisma.mcpOAuthCredential.upsert({
    where: { serverId: id },
    create: { serverId: id, ...data },
    update: data,
  });

  return NextResponse.json({ ok: true });
}

function safeDecrypt(payload: string): string | null {
  try {
    return decrypt(payload);
  } catch (err) {
    console.error('[mcp-internal] decrypt failed:', err);
    return null;
  }
}

function safeDecryptJson(payload: string): unknown {
  try {
    return JSON.parse(decrypt(payload));
  } catch (err) {
    console.error('[mcp-internal] decrypt JSON failed:', err);
    return null;
  }
}
