import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { Sandbox } from '@e2b/code-interpreter';
import { prisma } from "@/server/db";
import { TEMPLATE_CONFIG, resolveTemplateType } from '@/lib/sandbox-registry';
import { runSandboxScript } from '@/lib/sandbox-utils';


const REPO_PATH = '/home/user';
// Cache dirs we preserve across the wipe. The template pre-warmed `.npm` and
// `.cache` during snapshot build — nuking them forces every import to pull
// packages over the network cold. Keeping them turns most `npm install` runs
// into a cache-only restore.
const PRESERVED_DOTS = ['.npm', '.cache', '.local', '.config'];

interface ImportBody {
  sessionId: string;
  // Either a full owner/name string or a clone URL — we accept both forms
  // and normalize to owner/name internally.
  repo: string;
  branch?: string;
}

async function getGithubToken(userId: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, 'github');
    return tokens.data?.[0]?.token ?? null;
  } catch (err) {
    console.warn('[github/import] failed to read clerk oauth token:', (err as Error).message);
    return null;
  }
}

function normalizeRepo(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) return trimmed;
  const match =
    trimmed.match(/^https?:\/\/github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/i)
    ?? trimmed.match(/^git@github\.com:([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+?)(?:\.git)?$/i);
  return match?.[1] ?? null;
}

async function detectDefaultBranch(repo: string, token: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { default_branch?: string };
  return data.default_branch ?? null;
}

// Fire-and-forget install + dev-server boot. We don't block the HTTP response
// on this — the frontend already shows a preview shimmer and the iframe
// polls the sandbox URL until Next answers. Blocking here just makes the
// import dialog sit spinning for ~90s of dead time.
//
// We use a two-stage daemon fork:
//   1. Write the real work to /tmp/import-boot.sh (avoids nested-quote hell).
//   2. Fork it via `setsid ... &` and immediately `exit 0`.
// The setsid detaches the child from the controlling terminal and puts it in
// its own session/process group, so E2B's `commands.run` sees the parent
// shell finish cleanly — otherwise the child inherits the parent's stdio and
// E2B waits for its FDs to close, which never happens for a long-running dev
// server, so the outer call hits `timeoutMs` and throws.
async function startDevServerInBackground(sandbox: Sandbox): Promise<void> {
  const script = `
set -u
cd ${REPO_PATH}
pkill -f "next dev" >/dev/null 2>&1 || true

# Stage 1: write the actual work script. Reusing the template-warmed
# node_modules when possible via --prefer-offline keeps this fast.
cat > /tmp/import-boot.sh <<'BOOT_EOF'
#!/usr/bin/env bash
cd ${REPO_PATH}
{
  echo "[import-boot] starting at $(date -u +%FT%TZ)"
  npm install --prefer-offline --no-audit --no-fund --loglevel=error
  echo "[import-boot] install done, launching next dev"
  exec node ./node_modules/.bin/next dev --turbopack -p 3000
} > /tmp/import-boot.log 2>&1
BOOT_EOF
chmod +x /tmp/import-boot.sh

# Stage 2: double-fork with setsid so the child has no controlling tty and
# no inherited FDs. E2B stops waiting the moment this outer shell exits.
setsid bash /tmp/import-boot.sh </dev/null >/dev/null 2>&1 &
echo STARTED
exit 0
`.trim();
  try {
    // Timeout is a safety net — the script should return within ~200ms of
    // spawning the daemon. If it takes longer than 5s something is very
    // wrong (e.g. sandbox is under load) but we don't want to hang the
    // import response on it.
    await runSandboxScript(sandbox, script, { timeoutMs: 5_000 });
  } catch (err) {
    console.warn('[github/import] startDevServerInBackground threw:', (err as Error).message);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ImportBody;
    if (!body?.sessionId || !body?.repo) {
      return NextResponse.json({ error: 'sessionId and repo required' }, { status: 400 });
    }

    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await prisma.session.findUnique({
      where: { id: body.sessionId },
      select: { userId: true, templateType: true },
    });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.userId !== userId) {
      return NextResponse.json({ error: 'Owner only' }, { status: 403 });
    }

    const repo = normalizeRepo(body.repo);
    if (!repo) {
      return NextResponse.json(
        { error: 'Invalid repo (use owner/name or full URL)' },
        { status: 400 },
      );
    }

    const token = await getGithubToken(userId);
    if (!token) {
      return NextResponse.json({ error: 'No GitHub account connected.' }, { status: 412 });
    }

    const branch = body.branch || (await detectDefaultBranch(repo, token)) || 'main';
    const cloneUrl = `https://x-access-token:${encodeURIComponent(token)}@github.com/${repo}.git`;

    const templateType = resolveTemplateType(session.templateType);
    if (templateType === 'chat') {
      return NextResponse.json({ error: 'Chat sessions have no sandbox to import into.' }, { status: 400 });
    }
    const cfg = TEMPLATE_CONFIG[templateType];

    const sandbox = await Sandbox.create(cfg.alias, { timeoutMs: 25 * 60 * 1000 });
    try {
      // Clone into a scratch dir first, then swap it into /home/user. This
      // keeps the template's warmed caches (~/.npm, ~/.cache/next) intact —
      // wiping them with `rm -rf *` in /home/user is what made cold imports
      // take a minute (every dep re-fetched from the registry).
      //
      // Shallow + single-branch keeps the git payload tiny; for most repos
      // this drops clone time from tens of seconds to ~2s. We use the
      // authed URL transiently, then rewrite origin to the unauthed URL so
      // the token doesn't linger in .git/config.
      const preserveList = PRESERVED_DOTS.map((n) => JSON.stringify(n)).join(' ');
      const cloneScript = `
set -e
pkill -f "next dev" >/dev/null 2>&1 || true

# Fresh scratch dir for the clone; guaranteed empty so git won't refuse.
SCRATCH="$(mktemp -d /tmp/repo.XXXXXX)"
git clone --depth 1 --single-branch --branch ${JSON.stringify(branch)} ${JSON.stringify(cloneUrl)} "$SCRATCH"

# Swap: wipe /home/user contents EXCEPT preserved cache dirs, then move the
# cloned tree in. We copy hidden files too so .env, .gitignore, etc. survive.
cd /home/user
shopt -s dotglob nullglob
for entry in *; do
  keep=0
  for p in ${preserveList}; do
    if [ "$entry" = "$p" ]; then keep=1; break; fi
  done
  if [ "$keep" = "0" ]; then rm -rf -- "$entry"; fi
done
shopt -u dotglob

shopt -s dotglob
mv "$SCRATCH"/* /home/user/ 2>/dev/null || true
shopt -u dotglob
rm -rf "$SCRATCH"

cd ${REPO_PATH}
git remote set-url origin ${JSON.stringify(`https://github.com/${repo}.git`)}
echo CLONE_OK
`.trim();
      const cloneRes = await runSandboxScript(sandbox, cloneScript, {
        timeoutMs: 60_000,
      });
      if (!(cloneRes.stdout ?? '').includes('CLONE_OK')) {
        throw new Error(
          `git clone failed: ${cloneRes.stderr || cloneRes.stdout || 'unknown error'}`,
        );
      }

      // Kick off install + dev server without blocking the response — the
      // frontend iframe / shimmer already handles the "server not up yet"
      // window. This is what makes the import dialog return in seconds
      // instead of a minute+.
      void startDevServerInBackground(sandbox);
      const host = sandbox.getHost(cfg.port);
      const sandboxUrl = `https://${host}`;

      await prisma.session.update({
        where: { id: body.sessionId },
        data: {
          sandboxId: sandbox.sandboxId,
          sandboxUrl,
          sandboxCreatedAt: new Date(),
          githubRepo: repo,
          githubBranch: branch,
        } as never,
      });

      return NextResponse.json({
        ok: true,
        sandboxId: sandbox.sandboxId,
        sandboxUrl,
        repo,
        branch,
        templateType,
        // Dev server boots in the background; the client polls via iframe.
        devReady: 'booting',
      });
    } catch (err) {
      try {
        await sandbox.kill();
      } catch {}
      throw err;
    }
  } catch (error) {
    console.error('Error importing from GitHub:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Failed to import repo', details: message },
      { status: 500 },
    );
  }
}
