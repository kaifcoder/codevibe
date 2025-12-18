import { NextRequest, NextResponse } from 'next/server';
import { getSandbox } from '@/lib/sandbox-utils';
import { globalEventEmitter } from '@/lib/event-emitter';
import type { EntryInfo } from 'e2b';

type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  content?: string;
};

export async function POST(request: NextRequest) {
  try {
    const { sandboxId, sessionId } = await request.json();

    if (!sandboxId || !sessionId) {
      return NextResponse.json(
        { error: 'Missing sandboxId or sessionId' },
        { status: 400 }
      );
    }

    const sbx = await getSandbox(sandboxId);
    if (!sbx) {
      return NextResponse.json(
        { error: 'Sandbox not found or expired' },
        { status: 404 }
      );
    }

    const defaultExcludes = ['node_modules', '.git', '.next', 'dist', 'build', '.cache', 'components/ui', 'nextjs-app'];
    const excludes = new Set(defaultExcludes);
    
    // Binary file extensions to exclude
    const binaryExtensions = new Set([
      '.ico', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
      '.mp4', '.mov', '.avi', '.mp3', '.wav',
      '.zip', '.tar', '.gz', '.rar',
      '.exe', '.dll', '.so', '.dylib',
      '.pdf', '.doc', '.docx',
      '.woff', '.woff2', '.ttf', '.otf', '.eot'
    ]);
    
    const lockFiles = new Set(['.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']);
    
    function isBinaryFile(fileName: string): boolean {
      const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
      return binaryExtensions.has(ext) || lockFiles.has(fileName);
    }

    async function processFile(file: EntryInfo, fullPath: string, relativePath: string): Promise<FileNode | null> {
      const isDirectory = file.type === 'dir';
      
      if (isDirectory) {
        const children = await listRecursive(fullPath);
        if (children.length > 0) {
          return {
            name: file.name,
            path: relativePath,
            type: 'folder',
            children
          };
        }
        return null;
      }
      
      // Handle file
      // Skip binary files
      if (isBinaryFile(file.name)) {
        return null;
      }
      
      let content = '';
      try {
        if (file.size < 100000) { // Only read files < 100KB
          const rawContent = await sbx!.files.read(fullPath);
          // Remove null bytes that PostgreSQL can't handle
          content = rawContent.replaceAll('\x00', '');
        }
      } catch (err) {
        console.warn(`Could not read file ${fullPath}:`, err);
      }
      
      return {
        name: file.name,
        path: relativePath,
        type: 'file',
        content
      };
    }

    async function listRecursive(dirPath: string): Promise<FileNode[]> {
      try {
        const files = await sbx!.files.list(dirPath);
        const result: FileNode[] = [];

        for (const file of files) {
          if (excludes.has(file.name)) {
            continue;
          }

          const fullPath = dirPath === '/' ? `/${file.name}` : `${dirPath}/${file.name}`;
          const relativePath = fullPath.startsWith('/home/user/') 
            ? fullPath.substring('/home/user/'.length)
            : fullPath;
          
          // Skip if path contains any excluded directory
          if (Array.from(excludes).some(exc => relativePath.includes(exc + '/'))) {
            continue;
          }

          const processedFile = await processFile(file, fullPath, relativePath);
          if (processedFile) {
            result.push(processedFile);
          }
        }

        return result.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      } catch (error) {
        console.error(`Error listing directory ${dirPath}:`, error);
        return [];
      }
    }

    const fileTree = await listRecursive('/home/user');

    // Emit file tree sync event
    if (fileTree.length > 0) {
      globalEventEmitter.emit('agent:fileTreeSync', {
        sessionId,
        fileTree
      });
    }

    return NextResponse.json({ 
      success: true, 
      fileCount: fileTree.length,
      message: 'Filesystem synced successfully'
    });

  } catch (error) {
    console.error('Error syncing filesystem:', error);
    return NextResponse.json(
      { error: 'Failed to sync filesystem' },
      { status: 500 }
    );
  }
}
