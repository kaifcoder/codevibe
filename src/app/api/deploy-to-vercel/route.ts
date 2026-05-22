import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { auth } from '@clerk/nextjs/server';
import { extract as tarExtract } from 'tar-stream';
import { prisma } from "@/server/db";
import { getSandbox } from '@/lib/sandbox-utils';
import { readFromYjsRoom } from '@/lib/server-yjs-writer';


// Same exclusions as the download flow — node_modules / build output / locks
// add bulk that Vercel rebuilds anyway.
const TAR_EXCLUDES = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.cache',
  '.bun',
  '.npm',
  '.local',
  '.config',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
];

const ROOT = '/home/user';
const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MB — Vercel deployment ceiling

interface TarHeader {
  name: string;
  type: string;
  size: number;
}

interface DeploymentFile {
  file: string;
  data: string;
  encoding: 'base64';
}

function bytesToNodeStream(bytes: Uint8Array): Readable {
  return Readable.from(Buffer.from(bytes));
}

async function tarGzToVercelFiles(tarGz: Uint8Array): Promise<DeploymentFile[]> {
  const files: DeploymentFile[] = [];

  await new Promise<void>((resolve, reject) => {
    const extract = tarExtract();
    let totalBytes = 0;

    extract.on('entry', (header: TarHeader, stream: Readable, next: () => void) => {
      if (header.type !== 'file') {
        stream.resume();
        stream.on('end', next);
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
        const name = header.name.replace(/^\.\//, '');
        if (name) {
          files.push({
            file: name,
            data: Buffer.concat(chunks).toString('base64'),
            encoding: 'base64',
          });
        }
        next();
      });
      stream.on('error', reject);
    });

    extract.on('finish', resolve);
    extract.on('error', reject);

    bytesToNodeStream(tarGz).pipe(createGunzip()).pipe(extract);
  });

  return files;
}

function sanitizeProjectName(input: string): string {
  // Vercel: lowercase letters, digits, "-", "_", ".", max 100 chars, can't start with "-"
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^-+/, '')
    .slice(0, 100);
  return cleaned || 'codevibe-project';
}

// Persisted file tree shape — same as e2b-tools `scanAndEmitFileTree` and
// the `fileTree` JSON column. We only deploy text files (binaries aren't in
// the tree to begin with).
interface StoredFileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: StoredFileNode[];
  content?: string;
}

function flattenStoredFiles(nodes: StoredFileNode[]): StoredFileNode[] {
  const out: StoredFileNode[] = [];
  for (const n of nodes) {
    if (n.type === 'file') out.push(n);
    if (n.type === 'folder' && n.children) out.push(...flattenStoredFiles(n.children));
  }
  return out;
}

// Build deployment files from the sandbox via tar. Returns null if the tar
// command fatal-errored — caller falls back to Yjs+DB.
async function buildFilesFromSandbox(
  sandboxId: string,
  sessionId: string,
): Promise<DeploymentFile[] | null> {
  const sandbox = await getSandbox(sandboxId);
  if (!sandbox) return null;

  const tarPath = `/tmp/codevibe-deploy-${sessionId}.tar.gz`;
  const excludeArgs = TAR_EXCLUDES.map((p) => `--exclude='${p}'`).join(' ');
  await sandbox.commands.run(`rm -f ${tarPath}`, { timeoutMs: 5_000 }).catch(() => {});
  const tarCmd =
    `tar --warning=no-file-changed --warning=no-file-removed --ignore-failed-read `
    + `${excludeArgs} -czf ${tarPath} -C ${ROOT} . ; echo __TAR_EXIT__=$?`;
  let tarStdout = '';
  let tarStderr = '';
  try {
    const result = await sandbox.commands.run(tarCmd, { timeoutMs: 120_000 });
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
    console.error('[deploy-to-vercel] tar failed:', { tarExit, tarStderr });
    return null;
  }

  const tarBytes = (await sandbox.files.read(tarPath, { format: 'bytes' })) as Uint8Array;
  sandbox.commands.run(`rm -f ${tarPath}`, { timeoutMs: 5_000 }).catch(() => {});
  return tarGzToVercelFiles(tarBytes);
}

// Fallback: read each file's content from the persisted fileTree, prefer the
// live Yjs version (catches user edits made in Monaco that haven't been
// scanned back into fileTree yet).
async function buildFilesFromYjsAndDb(
  sessionId: string,
  fileTree: StoredFileNode[],
): Promise<DeploymentFile[]> {
  const flat = flattenStoredFiles(fileTree).filter((f) => {
    const top = f.path.split('/')[0];
    return !TAR_EXCLUDES.includes(top);
  });

  const CONCURRENCY = 6;
  const out: DeploymentFile[] = [];
  let totalBytes = 0;

  for (let i = 0; i < flat.length; i += CONCURRENCY) {
    const slice = flat.slice(i, i + CONCURRENCY);
    const resolved = await Promise.all(
      slice.map(async (f) => {
        const room = `${sessionId}-${f.path}`;
        const yjsContent = await readFromYjsRoom(room).catch(() => null);
        const content = yjsContent ?? f.content ?? '';
        return { path: f.path, content };
      }),
    );
    for (const { path: p, content } of resolved) {
      const bytes = Buffer.byteLength(content, 'utf8');
      totalBytes += bytes;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(`Project exceeds ${MAX_TOTAL_BYTES} bytes`);
      }
      out.push({
        file: p,
        data: Buffer.from(content, 'utf8').toString('base64'),
        encoding: 'base64',
      });
    }
  }
  return out;
}

// shadcn primitives (and lib/utils.ts) are excluded from the agent's
// fileTree scan, so they aren't in the DB or Yjs. The sandbox image
// pre-installs them via `npx shadcn add --all`. We ship the same files
// from this repo's src/components/ui as the snapshot — they're the
// deterministic output of `shadcn init -b neutral` (matching e2b.Dockerfile).
//
// Files that the user already has (renamed, edited shadcn files) win — we
// only inject paths that are missing from the deployment.
async function loadShadcnSnapshot(): Promise<{ path: string; content: string }[]> {
  const repoRoot = process.cwd();
  const out: { path: string; content: string }[] = [];

  const uiDir = path.join(repoRoot, 'src/components/ui');
  try {
    const entries = await readdir(uiDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.tsx')) continue;
      const content = await readFile(path.join(uiDir, e.name), 'utf8');
      out.push({ path: `components/ui/${e.name}`, content });
    }
  } catch (err) {
    console.warn('[deploy-to-vercel] shadcn snapshot dir missing:', (err as Error).message);
  }

  try {
    const utilsContent = await readFile(path.join(repoRoot, 'src/lib/utils.ts'), 'utf8');
    out.push({ path: 'lib/utils.ts', content: utilsContent });
  } catch (err) {
    console.warn('[deploy-to-vercel] lib/utils.ts snapshot missing:', (err as Error).message);
  }

  return out;
}

async function injectShadcnIfMissing(files: DeploymentFile[]): Promise<DeploymentFile[]> {
  const have = new Set(files.map((f) => f.file));
  const snap = await loadShadcnSnapshot();
  for (const s of snap) {
    if (have.has(s.path)) continue;
    files.push({
      file: s.path,
      data: Buffer.from(s.content, 'utf8').toString('base64'),
      encoding: 'base64',
    });
  }
  return files;
}

// Versions Vercel installs for the deployed project. The sandbox image bakes
// whatever `create-next-app` / `shadcn add --all` resolved at template-build
// time, but Vercel runs `npm install` from scratch — so we rewrite
// package.json on the way out and pin to versions known to build.
//   - next: 15.3.3 baked in is flagged as vulnerable; bump to 16.2.6
//   - react-day-picker: 10.x renamed `table` → `month_grid` and shadcn
//     2.6.3's calendar.tsx still uses `table`; pin to ^9 so the ClassNames
//     type still has the field.
const DEPLOY_DEP_OVERRIDES: Record<string, string> = {
  next: '16.2.6',
  'react-day-picker': '^9.7.0',
};

// Deps that lib/utils.ts (and shadcn UI in general) require but which the
// sandbox-built package.json may not list — agent-side `npm install` doesn't
// always persist, and an older sandbox image won't have them at all. Inject
// them unconditionally so Vercel's clean install can resolve the imports.
const DEPLOY_REQUIRED_DEPS: Record<string, string> = {
  clsx: '^2.1.1',
  'tailwind-merge': '^3.3.1',
  'tw-animate-css': '^1.3.4',
};

function bumpVulnerableDeps(files: DeploymentFile[]): DeploymentFile[] {
  const idx = files.findIndex((f) => f.file === 'package.json');
  if (idx < 0) return files;

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const original = Buffer.from(files[idx].data, 'base64').toString('utf8');
  try {
    pkg = JSON.parse(original);
  } catch {
    console.warn('[deploy-to-vercel] package.json unparseable — skipping dep override');
    return files;
  }

  let changed = false;
  pkg.dependencies = pkg.dependencies ?? {};

  for (const [name, target] of Object.entries(DEPLOY_DEP_OVERRIDES)) {
    if (pkg.dependencies[name] && pkg.dependencies[name] !== target) {
      pkg.dependencies[name] = target;
      changed = true;
    } else if (pkg.devDependencies?.[name] && pkg.devDependencies[name] !== target) {
      pkg.devDependencies[name] = target;
      changed = true;
    }
  }

  for (const [name, target] of Object.entries(DEPLOY_REQUIRED_DEPS)) {
    if (!pkg.dependencies[name] && !pkg.devDependencies?.[name]) {
      pkg.dependencies[name] = target;
      changed = true;
    }
  }

  if (!changed) return files;

  const next = JSON.stringify(pkg, null, 2) + '\n';
  files[idx] = {
    file: 'package.json',
    data: Buffer.from(next, 'utf8').toString('base64'),
    encoding: 'base64',
  };
  return files;
}

export async function POST(request: NextRequest) {
  try {
    const {
      sessionId,
      shareToken,
      vercelToken,
      projectName,
      teamId,
    }: {
      sessionId?: string;
      shareToken?: string;
      vercelToken?: string;
      projectName?: string;
      teamId?: string;
    } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }
    if (!vercelToken) {
      return NextResponse.json({ error: 'vercelToken required' }, { status: 400 });
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        userId: true,
        isPublic: true,
        shareToken: true,
        sandboxId: true,
        title: true,
        fileTree: true,
      },
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

    let files: DeploymentFile[] | null = null;
    let source: 'sandbox' | 'yjs+db' = 'sandbox';

    if (session.sandboxId) {
      try {
        files = await buildFilesFromSandbox(session.sandboxId, sessionId);
      } catch (err) {
        console.warn('[deploy-to-vercel] sandbox path failed, falling back:', err);
        files = null;
      }
    }

    if (!files || files.length === 0) {
      const tree = (session.fileTree as unknown as StoredFileNode[]) || [];
      if (!Array.isArray(tree) || tree.length === 0) {
        return NextResponse.json(
          { error: 'Sandbox is unavailable and no saved file tree exists for this session' },
          { status: 404 },
        );
      }
      files = await buildFilesFromYjsAndDb(sessionId, tree);
      // shadcn primitives are excluded from the scan — layer them in from
      // the bundled snapshot so the deployment actually builds.
      files = await injectShadcnIfMissing(files);
      source = 'yjs+db';
    }

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files to deploy' }, { status: 400 });
    }

    files = bumpVulnerableDeps(files);

    const name = sanitizeProjectName(projectName || session.title || 'codevibe-project');

    const deployUrl = teamId
      ? `https://api.vercel.com/v13/deployments?teamId=${encodeURIComponent(teamId)}`
      : 'https://api.vercel.com/v13/deployments';

    const vercelRes = await fetch(deployUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        files,
        target: 'production',
        projectSettings: {
          framework: 'nextjs',
        },
      }),
    });

    const body = await vercelRes.json().catch(() => ({}));
    if (!vercelRes.ok) {
      console.error('[deploy-to-vercel] vercel api error:', vercelRes.status, body);
      return NextResponse.json(
        {
          error: body?.error?.message || `Vercel API error (${vercelRes.status})`,
          code: body?.error?.code,
        },
        { status: vercelRes.status },
      );
    }

    const url = body.url ? `https://${body.url}` : null;
    const inspectorUrl = body.inspectorUrl ?? null;

    return NextResponse.json({
      ok: true,
      deploymentId: body.id,
      url,
      inspectorUrl,
      projectName: name,
      readyState: body.readyState ?? body.status ?? null,
      source,
    });
  } catch (error) {
    console.error('Error deploying to Vercel:', error);
    return NextResponse.json(
      {
        error: 'Failed to deploy',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
