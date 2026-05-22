import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from "@/server/db";
import { getSandbox } from '@/lib/sandbox-utils';


export async function POST(request: NextRequest) {
  try {
    const {
      sandboxId,
      filePath,
      content,
      sessionId,
      shareToken,
    }: {
      sandboxId?: string;
      filePath?: string;
      content?: string;
      sessionId?: string;
      shareToken?: string;
    } = await request.json();

    if (!sandboxId || !filePath || content === undefined) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const { userId } = await auth();

    // Authorize: owner of the session, or collaborator with a matching
    // shareToken pointed at this same sandbox. Without either, refuse — even
    // signed-in users shouldn't be able to write into someone else's sandbox.
    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId required' },
        { status: 400 }
      );
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, isPublic: true, shareToken: true, sandboxId: true },
    });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.sandboxId !== sandboxId) {
      // Don't let a caller redirect a write to an unrelated sandbox.
      return NextResponse.json({ error: 'Sandbox does not belong to this session' }, { status: 403 });
    }

    const isOwner = !!userId && session.userId === userId;
    const isCollab =
      !isOwner
      && session.isPublic
      && !!shareToken
      && shareToken === session.shareToken;

    if (!isOwner && !isCollab) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const sandbox = await getSandbox(sandboxId);
    if (!sandbox) {
      return NextResponse.json(
        { error: 'Sandbox not found or expired' },
        { status: 404 }
      );
    }

    // Create directory structure if needed
    const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
    if (dirPath && dirPath !== filePath) {
      try {
        await sandbox.files.makeDir(dirPath);
      } catch (error) {
        // Directory might already exist, that's fine
        console.log(`Directory ${dirPath} might already exist:`, error);
      }
    }

    const absolutePath = filePath.startsWith('/') ? filePath : `/home/user/${filePath}`;
    await sandbox.files.write(absolutePath, content);

    return NextResponse.json({
      success: true,
      message: `File written to ${filePath}`,
    });

  } catch (error) {
    console.error('Error writing to sandbox:', error);
    return NextResponse.json(
      { error: 'Failed to write to sandbox', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
