import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { Sandbox } from '@e2b/code-interpreter';
import { prisma } from "@/server/db";
import { TEMPLATE_CONFIG, resolveTemplateType } from '@/lib/sandbox-registry';
import { readFromYjsRoom } from '@/lib/server-yjs-writer';
import { runSandboxScript } from '@/lib/sandbox-utils';
import { checkMaintenanceMode } from '@/lib/maintenance';

// Per-session rewarm cap. Every successful rewarm burns a fresh 25-minute
// E2B sandbox and the seed/install cost — hard-cap at 3 so a signed-in user
// (or a share-link holder) can't loop this endpoint to hold N sandboxes
// alive indefinitely. Same override knob shape as MAX_SESSIONS_PER_USER.
const MAX_REWARMS_PER_SESSION = Number(process.env.MAX_REWARMS_PER_SESSION ?? '3');
// Minimum gap between rewarm attempts on the same session. Cheap thundering-
// herd guard so a double-click or a retry loop can't burn two sandbox
// provisions back-to-back.
const REWARM_COOLDOWN_MS = Number(process.env.REWARM_COOLDOWN_MS ?? '20000');


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
async function restartDevServer(sandbox: Sandbox): Promise<'ready' | 'timeout' | 'fail'> {
  const script = `
set -u
cd /home/user
pkill -f "next dev" >/dev/null 2>&1 || true
sleep 1
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
    const res = await runSandboxScript(sandbox, script, { timeoutMs: 90_000 });
    const out = (res.stdout ?? '').trim();
    if (out.endsWith('READY')) return 'ready';
    console.warn('[rewarm-sandbox] dev server not ready:', { stdout: out, stderr: res.stderr });
    return 'timeout';
  } catch (err) {
    console.warn('[rewarm-sandbox] restartDevServer threw:', (err as Error).message);
    return 'fail';
  }
}

// Run `npm install --prefer-offline` inside the sandbox. Cheap when the
// template's ~/.npm cache covers the deps (which it does for the entire
// create-next-app + shadcn baseline), and mandatory when the seeded
// package.json declares deps that aren't in the baked node_modules.
//
// We always run this on rewarm because the fresh sandbox image only has the
// baseline install — anything the agent added since the last rewarm needs
// to be reinstalled. Skipping it left the dev server 500'ing on imports of
// user-added packages until the next agent turn happened to trigger a
// restart. --prefer-offline keeps this at ~2-4s when everything's cached.
async function runNpmInstall(sandbox: Sandbox): Promise<'ok' | 'fail'> {
  const script = `
set -u
cd /home/user
npm install --prefer-offline --no-audit --no-fund --loglevel=error > /tmp/rewarm-install.log 2>&1
echo "INSTALL_EXIT=$?"
`.trim();
  try {
    const res = await runSandboxScript(sandbox, script, { timeoutMs: 120_000 });
    const match = res.stdout.match(/INSTALL_EXIT=(\d+)/);
    const exitCode = match ? parseInt(match[1], 10) : 1;
    if (exitCode === 0) return 'ok';
    console.warn('[rewarm-sandbox] npm install non-zero exit:', {
      exitCode,
      stdout: res.stdout.slice(-500),
      stderr: res.stderr.slice(-500),
    });
    // Non-zero is often peer-dep warnings — node_modules is usually still
    // usable. Return 'ok' so we don't fail the whole rewarm on npm noise.
    return 'ok';
  } catch (err) {
    console.warn('[rewarm-sandbox] runNpmInstall threw:', (err as Error).message);
    return 'fail';
  }
}

export async function POST(request: NextRequest) {
  try {
    // Kill-switch: allow ops to shut off all sandbox provisioning in a
    // hurry via env var, without a redeploy. Do this before any DB reads
    // so an incident can back-pressure at the edge.
    const maintenance = checkMaintenanceMode('sandbox');
    if (maintenance) return maintenance;

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
        rewarmCount: true,
        lastRewarmAt: true,
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

    // Per-session rewarm cap. Enforced *before* provisioning so an at-cap
    // client just gets a 429 instead of burning another sandbox. The cap
    // is deliberately session-scoped rather than user-scoped: a user with
    // three chats gets 3 × MAX_REWARMS_PER_SESSION rewarms total, which
    // composes cleanly with the per-user chat quota.
    if (session.rewarmCount >= MAX_REWARMS_PER_SESSION) {
      return NextResponse.json(
        {
          error: 'rewarm_limit_reached',
          message: `This chat has been rewarmed ${session.rewarmCount} times (max ${MAX_REWARMS_PER_SESSION}). Start a new chat to continue.`,
          rewarmCount: session.rewarmCount,
          rewarmLimit: MAX_REWARMS_PER_SESSION,
        },
        { status: 429 },
      );
    }

    // Cooldown: reject requests that arrive faster than one per
    // REWARM_COOLDOWN_MS window. Cheap way to swat double-clicks and
    // client retry loops without needing Redis-backed rate limiting on
    // the Next.js side.
    if (session.lastRewarmAt) {
      const elapsed = Date.now() - session.lastRewarmAt.getTime();
      if (elapsed < REWARM_COOLDOWN_MS) {
        const retryAfter = Math.ceil((REWARM_COOLDOWN_MS - elapsed) / 1000);
        return NextResponse.json(
          {
            error: 'rewarm_cooldown',
            message: `Rewarm cooldown active. Try again in ${retryAfter}s.`,
            retryAfterSec: retryAfter,
          },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } },
        );
      }
    }

    const templateType = resolveTemplateType(session.templateType);
    if (templateType === 'chat') {
      return NextResponse.json({ error: 'Chat mode has no sandbox to rewarm.' }, { status: 400 });
    }
    const cfg = TEMPLATE_CONFIG[templateType];

    // Atomically reserve a rewarm slot before we spend money on
    // Sandbox.create. Uses a conditional update keyed on the previously-
    // observed rewarmCount so a concurrent second call will find the row
    // has moved on and treat it as "someone else grabbed the slot" —
    // race-safer than the pre-provision read alone.
    const reservation = await prisma.session.updateMany({
      where: {
        id: sessionId,
        rewarmCount: { lt: MAX_REWARMS_PER_SESSION },
        OR: [
          { lastRewarmAt: null },
          { lastRewarmAt: { lt: new Date(Date.now() - REWARM_COOLDOWN_MS) } },
        ],
      },
      data: {
        rewarmCount: { increment: 1 },
        lastRewarmAt: new Date(),
      },
    });
    if (reservation.count === 0) {
      // Lost the race with a concurrent rewarm — one of the two guards
      // (cap or cooldown) tripped between the read above and this write.
      // Return 429 so the client backs off; the winner's response will
      // provision the sandbox they both wanted.
      return NextResponse.json(
        {
          error: 'rewarm_race',
          message: 'Another rewarm is already in flight for this chat. Try again in a moment.',
        },
        { status: 429, headers: { 'Retry-After': '5' } },
      );
    }

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
        console.log(
          '[rewarm-sandbox] seeded',
          {
            sessionId,
            sandboxId: sandbox.sandboxId,
            totalFiles,
            written,
            skipped,
            failed: result.failed.length,
            configChanged: result.configChanged,
            packageJsonChanged: result.packageJsonChanged,
          },
        );
        if (result.failed.length > 0) {
          console.warn(
            '[rewarm-sandbox] failed to seed',
            result.failed.length,
            'files; first 5:',
            failedSamples,
          );
        }

        // Always run npm install after seeding. The fresh sandbox image
        // carries only the create-next-app + shadcn baseline `node_modules`
        // — anything the agent added later needs to be reinstalled or the
        // dev server 500s on the missing import at request time. With the
        // template's warmed `~/.npm` cache, this is ~2-4s for a no-op
        // install and only pays real network cost when a new dep is
        // actually missing. Runs even when the current seed didn't touch
        // package.json, because a *previous* rewarm may have failed halfway
        // and left node_modules out of sync.
        const installResult = await runNpmInstall(sandbox);
        console.log('[rewarm-sandbox] npm install:', installResult);

        // Restart the dev server only when we wrote something turbopack
        // can't hot-reload. Source-file edits are picked up by HMR against
        // the running server, so the typical no-config-change path skips
        // the ~30-60s pkill+boot cycle.
        //
        // NOTE: on a freshly-provisioned sandbox from `Sandbox.create`, the
        // template's baked `next dev` is already running with the baseline
        // tree — after seeding user files on top, we still need to restart
        // once so it picks up the seeded config / new node_modules.
        if (result.configChanged || result.packageJsonChanged) {
          devReady = await restartDevServer(sandbox);
        } else {
          devReady = 'skipped';
        }
      } else {
        // Most common cause of "rewarm succeeded but sandbox is empty": the
        // session row in Postgres has an empty fileTree, so there's nothing
        // to seed *from*. Surface this loudly in logs — silent skip used to
        // make this look like a sandbox/E2B problem when it was a DB-state
        // problem.
        console.warn(
          '[rewarm-sandbox] no fileTree on session row — sandbox will come up empty',
          { sessionId, sandboxId: sandbox.sandboxId, fileTreeRaw: session.fileTree },
        );
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
