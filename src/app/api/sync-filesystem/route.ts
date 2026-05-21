import { NextRequest, NextResponse } from 'next/server';
import { getSandbox } from '@/lib/sandbox-utils';
import { scanSandboxToTree } from '@/lib/sandbox-scan';

export async function POST(request: NextRequest) {
  try {
    const { sandboxId, sessionId } = await request.json();

    if (!sandboxId || !sessionId) {
      return NextResponse.json(
        { error: 'Missing sandboxId or sessionId' },
        { status: 400 },
      );
    }

    const sbx = await getSandbox(sandboxId);
    if (!sbx) {
      return NextResponse.json(
        { error: 'Sandbox not found or expired' },
        { status: 404 },
      );
    }

    const fileTree = await scanSandboxToTree(sbx, { sessionId });

    return NextResponse.json({
      success: true,
      fileTree,
      message: 'Filesystem synced successfully',
    });
  } catch (error) {
    console.error('Error syncing filesystem:', error);
    return NextResponse.json(
      {
        error: 'Failed to sync filesystem',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
