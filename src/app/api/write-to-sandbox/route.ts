import { NextRequest, NextResponse } from 'next/server';
import { getSandbox } from '@/lib/sandbox-utils';

export async function POST(request: NextRequest) {
  try {
    const { sandboxId, filePath, content } = await request.json();

    if (!sandboxId || !filePath || content === undefined) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
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

    // Write the file to e2b
    // Convert relative path to absolute path for e2b
    const absolutePath = filePath.startsWith('/') ? filePath : `/home/user/${filePath}`;
    await sandbox.files.write(absolutePath, content);

    return NextResponse.json({ 
      success: true,
      message: `File written to ${filePath}`
    });

  } catch (error) {
    console.error('Error writing to sandbox:', error);
    return NextResponse.json(
      { error: 'Failed to write to sandbox', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
