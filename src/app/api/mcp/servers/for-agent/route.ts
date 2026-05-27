import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/server/db';
import { ensureLoopbackServerSeeded } from '@/lib/mcp-user-store';

export const dynamic = 'force-dynamic';

// Returns the server-list shape the agent needs in `config.configurable`.
// No secrets — only ids, names, urls, authType. The agent fetches actual
// tokens via the internal credentials route at tool-call time.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await ensureLoopbackServerSeeded(userId);
    const rows = await prisma.mcpServerConfig.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        url: true,
        authType: true,
      },
    });
    return NextResponse.json({ servers: rows });
  } catch (err) {
    console.error('[GET /api/mcp/servers/for-agent] failed:', err);
    return NextResponse.json({ error: 'Failed to load servers' }, { status: 500 });
  }
}
