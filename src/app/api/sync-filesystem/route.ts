import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { extract as tarExtract } from 'tar-stream';
import { getSandbox } from '@/lib/sandbox-utils';

type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  content?: string;
};

interface TarHeader {
  name: string;
  type: string;
  size: number;
}

// Same boundaries as e2b-tools.scanAndEmitFileTree and download-project — keep
// these three lists in sync if you change them in one place.
const TAR_EXCLUDES = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.cache',
  'components/ui',
  'nextjs-app',
  '.bun',
  '.npm',
  '.local',
  '.config',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
];

const BINARY_EXTENSIONS = new Set([
  '.ico', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
  '.mp4', '.mov', '.avi', '.mp3', '.wav',
  '.zip', '.tar', '.gz', '.rar',
  '.exe', '.dll', '.so', '.dylib',
  '.pdf', '.doc', '.docx',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

const ROOT = '/home/user';
const MAX_FILE_BYTES = 100_000;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

function bytesToNodeStream(bytes: Uint8Array): Readable {
  return Readable.from(Buffer.from(bytes));
}

function isBinaryFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(name.substring(dot).toLowerCase());
}

// Extract tar entries into a flat list of {path, content}. Binary files and
// files over MAX_FILE_BYTES are kept in the tree but with empty content (so
// the user still sees them in the file list).
async function tarGzToFiles(
  tarGz: Uint8Array,
): Promise<{ path: string; content: string }[]> {
  const out: { path: string; content: string }[] = [];

  await new Promise<void>((resolve, reject) => {
    const extract = tarExtract();
    let totalBytes = 0;

    extract.on('entry', (header: TarHeader, stream: Readable, next: () => void) => {
      if (header.type !== 'file') {
        stream.resume();
        stream.on('end', next);
        return;
      }

      // tar entries from `tar -C /home/user .` are prefixed with "./"
      const relPath = header.name.replace(/^\.\//, '');
      if (!relPath) {
        stream.resume();
        stream.on('end', next);
        return;
      }

      // Skip binary files entirely — match the old behavior of not including
      // them in the file tree at all.
      if (isBinaryFile(relPath)) {
        stream.resume();
        stream.on('end', next);
        return;
      }

      // For oversize files, drain the stream but record an empty content
      // entry — keeps them visible in the tree without exploding memory.
      if (header.size > MAX_FILE_BYTES) {
        stream.resume();
        stream.on('end', () => {
          out.push({ path: relPath, content: '' });
          next();
        });
        return;
      }

      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_TOTAL_BYTES) {
          stream.destroy();
          reject(new Error(`Project exceeds ${MAX_TOTAL_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => {
        const content = Buffer.concat(chunks).toString('utf8').replaceAll('\x00', '');
        out.push({ path: relPath, content });
        next();
      });
      stream.on('error', reject);
    });

    extract.on('finish', resolve);
    extract.on('error', reject);

    bytesToNodeStream(tarGz).pipe(createGunzip()).pipe(extract);
  });

  return out;
}

// Build the same shape as the old recursive scan: nested folders with file
// children, sorted folders-first then alphabetical. Frontend depends on this
// shape (FileTree component, fileTree DB column).
function buildTree(files: { path: string; content: string }[]): FileNode[] {
  const root: FileNode = { name: '', path: '', type: 'folder', children: [] };

  for (const { path, content } of files) {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLeaf = i === parts.length - 1;
      const partial = parts.slice(0, i + 1).join('/');

      if (isLeaf) {
        cursor.children!.push({ name, path: partial, type: 'file', content });
      } else {
        let folder = cursor.children!.find((c) => c.type === 'folder' && c.name === name);
        if (!folder) {
          folder = { name, path: partial, type: 'folder', children: [] };
          cursor.children!.push(folder);
        }
        cursor = folder;
      }
    }
  }

  function sortRecursive(node: FileNode): void {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of node.children) sortRecursive(child);
  }
  sortRecursive(root);

  return root.children ?? [];
}

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

    // Tar inside the sandbox + read once. Replaces the old
    // sbx.files.list/read recursion which did N sequential round-trips and
    // dominated sync time on projects with > ~30 files. Same exit-code dance
    // as /api/download-project — dev server writes during archiving cause
    // tar to exit 1 ("files differ"), which is non-fatal.
    //
    // Path is uniquified per-request: page mount auto-sync + manual refresh
    // can race, and a shared tarPath leads to one request's `rm -f` clobbering
    // the other's in-flight archive.
    const tarPath = `/tmp/codevibe-sync-${sessionId}-${crypto.randomUUID()}.tar.gz`;
    const excludeArgs = TAR_EXCLUDES.map((p) => `--exclude='${p}'`).join(' ');
    await sbx.commands.run(`rm -f ${tarPath}`, { timeoutMs: 5_000 }).catch(() => {});
    const tarCmd =
      `tar --warning=no-file-changed --warning=no-file-removed --ignore-failed-read `
      + `${excludeArgs} -czf ${tarPath} -C ${ROOT} . ; echo __TAR_EXIT__=$?`;
    let tarStdout = '';
    let tarStderr = '';
    try {
      const result = await sbx.commands.run(tarCmd, { timeoutMs: 120_000 });
      tarStdout = result.stdout ?? '';
      tarStderr = result.stderr ?? '';
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string };
      tarStdout = e?.stdout ?? '';
      tarStderr = e?.stderr ?? '';
    }
    const exitMatch = /__TAR_EXIT__=(\d+)/.exec(tarStdout);
    const tarExit = exitMatch ? Number(exitMatch[1]) : -1;
    if (tarExit !== 0 && tarExit !== 1) {
      console.error('[sync-filesystem] tar failed:', { tarExit, tarStderr });
      return NextResponse.json(
        { error: 'Failed to archive sandbox', details: tarStderr || `tar exit ${tarExit}` },
        { status: 500 },
      );
    }

    const tarBytes = (await sbx.files.read(tarPath, { format: 'bytes' })) as Uint8Array;
    sbx.commands.run(`rm -f ${tarPath}`, { timeoutMs: 5_000 }).catch(() => {});

    const flat = await tarGzToFiles(tarBytes);
    const fileTree = buildTree(flat);

    return NextResponse.json({
      success: true,
      fileTree,
      fileCount: flat.length,
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
