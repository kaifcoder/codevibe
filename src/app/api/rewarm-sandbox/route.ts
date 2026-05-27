import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { Sandbox } from '@e2b/code-interpreter';
import { prisma } from "@/server/db";
import { TEMPLATE_CONFIG, resolveTemplateType } from '@/lib/sandbox-registry';
import { readFromYjsRoom } from '@/lib/server-yjs-writer';


interface StoredFileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: StoredFileNode[];
  content?: string;
}

// Top-level paths that are baked into the sandbox image and shouldn't be
// re-written from our scan: shadcn primitives are excluded by the agent's
// scanner anyway, and node_modules / build output / lockfiles would just be
// noise (the new image already has its own).
const SEED_EXCLUDE_PREFIXES = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.cache',
  '.bun',
  '.npm',
];

function flattenStoredFiles(nodes: StoredFileNode[]): StoredFileNode[] {
  const out: StoredFileNode[] = [];
  for (const n of nodes) {
    if (n.type === 'file') out.push(n);
    if (n.type === 'folder' && n.children) out.push(...flattenStoredFiles(n.children));
  }
  return out;
}

function shouldSeed(path: string): boolean {
  const top = path.split('/')[0];
  return !SEED_EXCLUDE_PREFIXES.includes(top);
}

// Pull the freshest content for each tracked file: Yjs reflects in-flight
// Monaco edits that may not have been flushed back into the persisted
// fileTree yet. Fall back to fileTree.content for files no one has opened.
async function collectSeedFiles(
  sessionId: string,
  fileTree: StoredFileNode[],
): Promise<Array<{ path: string; content: string }>> {
  const flat = flattenStoredFiles(fileTree).filter((f) => shouldSeed(f.path));
  const CONCURRENCY = 8;
  const out: Array<{ path: string; content: string }> = [];

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
    out.push(...resolved);
  }
  return out;
}

// Files whose contents change what next dev or its toolchain loads at boot.
// Turbopack picks up source-file edits via HMR without help, but mutating any
// of these means a hard restart (and likely a re-install) is required.
const CONFIG_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'next.config.js',
  'next.config.ts',
  'next.config.mjs',
  'tsconfig.json',
  'postcss.config.js',
  'postcss.config.mjs',
  'postcss.config.cjs',
  'tailwind.config.js',
  'tailwind.config.ts',
  '.env',
  '.env.local',
  '.env.development',
]);

interface SeedResult {
  written: number;
  skipped: number;
  failed: Array<{ path: string; error: string }>;
  packageJsonChanged: boolean;
  configChanged: boolean;
}

// Compare each seeded file against the live sandbox copy and write only the
// ones that actually differ. The new sandbox image already contains the
// `create-next-app` + `shadcn add --all` baseline, so most files in a typical
// fileTree are byte-identical and don't need to be touched.
async function seedDeltaToSandbox(
  sandbox: Sandbox,
  files: Array<{ path: string; content: string }>,
): Promise<SeedResult> {
  const CONCURRENCY = 8;
  const failed: Array<{ path: string; error: string }> = [];
  let written = 0;
  let skipped = 0;
  let packageJsonChanged = false;
  let configChanged = false;

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const slice = files.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (f) => {
        const absolutePath = f.path.startsWith('/') ? f.path : `/home/user/${f.path}`;
        let existing: string | null = null;
        try {
          existing = await sandbox.files.read(absolutePath);
        } catch {
          existing = null; // doesn't exist yet — will be a write
        }
        if (existing === f.content) {
          skipped++;
          return;
        }
        try {
          await sandbox.files.write(absolutePath, f.content);
          written++;
          if (CONFIG_FILES.has(f.path)) configChanged = true;
          if (f.path === 'package.json') packageJsonChanged = true;
        } catch (err) {
          failed.push({ path: f.path, error: (err as Error).message });
        }
      }),
    );
  }
  return { written, skipped, failed, packageJsonChanged, configChanged };
}

// Hard-restart the dev server. Only call when something turbopack can't
// hot-reload (package.json bump, next/postcss/tailwind config, env vars) was
// actually written — otherwise the running dev server keeps serving and HMR
// picks up source edits for free.
async function restartDevServer(
  sandbox: Sandbox,
  runInstall: boolean,
): Promise<'ready' | 'timeout' | 'fail'> {
  const installStep = runInstall
    ? `npm install --prefer-offline --no-audit --no-fund > /tmp/rewarm-install.log 2>&1 || true`
    : `:`;
  const script = `
set -u
cd /home/user
pkill -f "next dev" >/dev/null 2>&1 || true
sleep 1
${installStep}
nohup npx next dev --turbopack > /tmp/next.log 2>&1 &
disown || true
for i in $(seq 1 60); do
  if curl -sf -o /dev/null http://localhost:3000; then
    echo READY
    exit 0
  fi
  sleep 1
done
echo TIMEOUT
exit 1
`.trim();
  try {
    const res = await sandbox.commands.run(`bash -lc ${JSON.stringify(script)}`, {
      timeoutMs: 90_000,
    });
    const out = (res.stdout ?? '').trim();
    if (out.endsWith('READY')) return 'ready';
    console.warn('[rewarm-sandbox] dev server not ready:', { stdout: out, stderr: res.stderr });
    return 'timeout';
  } catch (err) {
    console.warn('[rewarm-sandbox] restartDevServer threw:', (err as Error).message);
    return 'fail';
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, shareToken }: { sessionId?: string; shareToken?: string } =
      await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        userId: true,
        isPublic: true,
        shareToken: true,
        templateType: true,
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

    const templateType = resolveTemplateType(session.templateType);
    if (templateType === 'chat') {
      return NextResponse.json({ error: 'Chat mode has no sandbox to rewarm.' }, { status: 400 });
    }
    const cfg = TEMPLATE_CONFIG[templateType];

    // Provision a fresh sandbox of the same template the session was using.
    // 25-minute TTL matches the agent's auto-create path.
    const sandbox = await Sandbox.create(cfg.alias, { timeoutMs: 25 * 60 * 1000 });
    const host = sandbox.getHost(cfg.port);
    const sandboxUrl = `https://${host}`;

    let written = 0;
    let skipped = 0;
    let totalFiles = 0;
    let failedSamples: Array<{ path: string; error: string }> = [];
    let devReady: 'ready' | 'timeout' | 'fail' | 'skipped' = 'skipped';

    // Only nextjs templates have a project tree to seed; n8n's state lives in
    // SQLite and is rebuilt by the agent re-running its imports.
    if (templateType === 'nextjs') {
      const tree = (session.fileTree as unknown as StoredFileNode[]) || [];
      if (Array.isArray(tree) && tree.length > 0) {
        const files = await collectSeedFiles(sessionId, tree);
        totalFiles = files.length;
        const result = await seedDeltaToSandbox(sandbox, files);
        written = result.written;
        skipped = result.skipped;
        failedSamples = result.failed.slice(0, 5);
        if (result.failed.length > 0) {
          console.warn(
            '[rewarm-sandbox] failed to seed',
            result.failed.length,
            'files; first 5:',
            failedSamples,
          );
        }
        // Restart only when we wrote something turbopack can't hot-reload.
        // Source-file edits are picked up by HMR against the running server,
        // so the typical no-config-change path skips ~30–60s of pkill+install.
        if (result.configChanged) {
          devReady = await restartDevServer(sandbox, result.packageJsonChanged);
        } else {
          devReady = 'skipped';
        }
      }
    }

    // Persist the new id so reloads / share-link visitors connect to the
    // current sandbox; agent's resolveSandbox also picks it up via the
    // sandboxId we forward through config.configurable on the next run.
    await prisma.session.update({
      where: { id: sessionId },
      data: { sandboxId: sandbox.sandboxId },
    });

    return NextResponse.json({
      ok: true,
      sandboxId: sandbox.sandboxId,
      sandboxUrl,
      templateType,
      seeded: { totalFiles, written, skipped, failed: failedSamples },
      devReady,
    });
  } catch (error) {
    console.error('Error rewarming sandbox:', error);
    return NextResponse.json(
      {
        error: 'Failed to rewarm sandbox',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
