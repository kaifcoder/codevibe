import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { Sandbox } from '@e2b/code-interpreter';
import { prisma } from "@/server/db";
import { TEMPLATE_CONFIG, resolveTemplateType } from '@/lib/sandbox-registry';


const REPO_PATH = '/home/user';

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

// Boot dev server after a fresh clone — the cloned tree won't have
// node_modules so an install is mandatory before next dev can come up.
async function bootDevServer(sandbox: Sandbox): Promise<'ready' | 'timeout' | 'fail'> {
  const script = `
set -u
cd ${REPO_PATH}
pkill -f "next dev" >/dev/null 2>&1 || true
sleep 1
npm install --prefer-offline --no-audit --no-fund > /tmp/import-install.log 2>&1 || true
nohup npx next dev --turbopack > /tmp/next.log 2>&1 &
disown || true
for i in $(seq 1 90); do
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
      timeoutMs: 120_000,
    });
    const out = (res.stdout ?? '').trim();
    if (out.endsWith('READY')) return 'ready';
    console.warn('[github/import] dev server not ready:', { stdout: out, stderr: res.stderr });
    return 'timeout';
  } catch (err) {
    console.warn('[github/import] bootDevServer threw:', (err as Error).message);
    return 'fail';
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
      // Clear /home/user (git refuses to clone into a non-empty dir) then
      // clone the repo. We use the authed URL transiently — git stores it
      // in .git/config, so right after we rewrite origin to the unauthed
      // URL to avoid leaving a long-lived token on disk.
      const cloneScript = `
set -e
pkill -f "next dev" >/dev/null 2>&1 || true
cd /home/user
shopt -s dotglob nullglob
rm -rf -- *
shopt -u dotglob
git clone --branch ${JSON.stringify(branch)} ${JSON.stringify(cloneUrl)} ${REPO_PATH}
cd ${REPO_PATH}
git remote set-url origin ${JSON.stringify(`https://github.com/${repo}.git`)}
echo CLONE_OK
`.trim();
      const cloneRes = await sandbox.commands.run(`bash -lc ${JSON.stringify(cloneScript)}`, {
        timeoutMs: 90_000,
      });
      if (!(cloneRes.stdout ?? '').includes('CLONE_OK')) {
        throw new Error(
          `git clone failed: ${cloneRes.stderr || cloneRes.stdout || 'unknown error'}`,
        );
      }

      const devReady = await bootDevServer(sandbox);
      const host = sandbox.getHost(cfg.port);
      const sandboxUrl = `https://${host}`;

      await prisma.session.update({
        where: { id: body.sessionId },
        data: {
          sandboxId: sandbox.sandboxId,
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
        devReady,
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
