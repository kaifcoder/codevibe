import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { extract as tarExtract } from 'tar-stream';
import type { Sandbox } from '@e2b/code-interpreter';

export type FileNode = {
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

// Boundaries shared with /api/download-project. Keep aligned if any list moves.
export const TAR_EXCLUDES = [
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
      const relPath = header.name.replace(/^\.\//, '');
      if (!relPath) {
        stream.resume();
        stream.on('end', next);
        return;
      }
      if (isBinaryFile(relPath)) {
        stream.resume();
        stream.on('end', next);
        return;
      }
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

export function buildTree(files: { path: string; content: string }[]): FileNode[] {
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

// Fast filesystem scan: tar+gzip the project inside the sandbox and stream-read
// once. Replaces N sequential files.list/files.read round-trips that took
// ~10–20s on fresh nextjs projects (long enough that the agent run ends before
// the result is delivered, so the frontend never sees the boilerplate tree).
export async function scanSandboxToTree(
  sbx: Sandbox,
  opts: { sessionId?: string } = {},
): Promise<FileNode[]> {
  const tag = opts.sessionId ?? crypto.randomUUID();
  const tarPath = `/tmp/codevibe-scan-${tag}-${crypto.randomUUID()}.tar.gz`;
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
  // tar exits 1 when files change during archiving (dev server writes) — that's
  // expected and the partial archive is still usable.
  if (tarExit !== 0 && tarExit !== 1) {
    throw new Error(`tar failed (exit ${tarExit}): ${tarStderr}`);
  }

  const tarBytes = (await sbx.files.read(tarPath, { format: 'bytes' })) as Uint8Array;
  sbx.commands.run(`rm -f ${tarPath}`, { timeoutMs: 5_000 }).catch(() => {});

  const flat = await tarGzToFiles(tarBytes);
  return buildTree(flat);
}
