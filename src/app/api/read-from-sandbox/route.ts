import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from "@/server/db";
import { getSandbox } from '@/lib/sandbox-utils';

/**
 * Read a single file out of the live E2B sandbox. Mirrors write-to-sandbox's
 * auth so a passive viewer with a share link can still load files, while a
 * stranger can't snoop a private session by guessing the sandbox id.
 *
 * Used by the chat page when the user taps a file that has no content in the
 * in-memory tree (either it was synthesized from a `fileCreated` event, or
 * the original scan ran before the agent created/edited it). The frontend
 * also writes the result back into the tree so subsequent reads are free.
 */
export async function POST(request: NextRequest) {
  try {
    const {
      sandboxId,
      filePath,
      sessionId,
      shareToken,
    }: {
      sandboxId?: string;
      filePath?: string;
      sessionId?: string;
      shareToken?: string;
    } = await request.json();

    if (!sandboxId || !filePath || !sessionId) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 },
      );
    }

    const { userId } = await auth();

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, isPublic: true, shareToken: true, sandboxId: true },
    });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.sandboxId !== sandboxId) {
      return NextResponse.json(
        { error: 'Sandbox does not belong to this session' },
        { status: 403 },
      );
    }

    const isOwner = !!userId && session.userId === userId;
    const isCollab =
      !isOwner &&
      session.isPublic &&
      !!shareToken &&
      shareToken === session.shareToken;

    if (!isOwner && !isCollab) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const sandbox = await getSandbox(sandboxId);
    if (!sandbox) {
      return NextResponse.json(
        { error: 'Sandbox not found or expired' },
        { status: 404 },
      );
    }

    const absolutePath = filePath.startsWith('/') ? filePath : `/home/user/${filePath}`;
    let content: string;
    try {
      // sandbox.files.read returns a string (default encoding).
      content = await sandbox.files.read(absolutePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // The E2B SDK throws when a path doesn't exist — surface a 404 so the
      // client can decide whether to drop the row from the tree or just
      // render an empty editor.
      if (/not found|no such file/i.test(msg)) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
      throw err;
    }

    // Strip null bytes — PostgreSQL rejects them and the sandbox occasionally
    // emits binaries that the client doesn't need to render. Same hardening
    // we apply on the write path.
    const safe = content.replaceAll('\x00', '');

    return NextResponse.json({ success: true, content: safe });
  } catch (error) {
    console.error('Error reading from sandbox:', error);
    return NextResponse.json(
      {
        error: 'Failed to read from sandbox',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
