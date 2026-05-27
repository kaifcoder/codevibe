import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import {
  deleteUserServer,
  decryptBearer,
  getUserServer,
  invalidateUserMcpToolsCache,
  probeMcpServer,
  type AuthType,
} from '@/lib/mcp-user-store';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const ok = await deleteUserServer(userId, id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  invalidateUserMcpToolsCache(userId);
  return NextResponse.json({ ok: true });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Re-test an existing server (button on the row).
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const row = await getUserServer(userId, id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const probe = await probeMcpServer(
    row.url,
    row.authType as AuthType,
    decryptBearer(row),
    row.id,
  );
  return NextResponse.json(probe);
}
