import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from "@/server/db";
import { getSandbox } from '@/lib/sandbox-utils';


// Lightweight check: is the session's recorded sandbox still alive?
// Used by the chat page to detect external kills (e2b dashboard, manual
// Sandbox.kill, idle eviction) before the 25-minute client-side timer fires.
// Returns { alive: boolean, sandboxId: string | null }.
export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const shareToken = request.nextUrl.searchParams.get('token');

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, isPublic: true, shareToken: true, sandboxId: true },
    });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const { userId } = await auth();
    const isOwner = !!userId && session.userId === userId;
    const isCollab =
      !isOwner
      && session.isPublic
      && !!shareToken
      && shareToken === session.shareToken;
    if (!isOwner && !isCollab) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!session.sandboxId) {
      return NextResponse.json({ alive: false, sandboxId: null });
    }

    const sandbox = await getSandbox(session.sandboxId);
    return NextResponse.json({ alive: !!sandbox, sandboxId: session.sandboxId });
  } catch (error) {
    console.error('Error checking sandbox health:', error);
    return NextResponse.json(
      {
        error: 'Failed to check sandbox health',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
