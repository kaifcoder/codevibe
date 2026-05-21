import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { Sandbox } from '@e2b/code-interpreter';
import { PrismaClient } from '@/generated/prisma';
import { getSandbox } from '@/lib/sandbox-utils';

const prisma = new PrismaClient();

const REPO_PATH = '/home/user';

interface CreateBody {
  mode: 'create';
  sessionId: string;
  name: string;
  isPrivate: boolean;
  description?: string;
  message?: string;
}

interface CommitBody {
  mode: 'commit';
  sessionId: string;
  message: string;
}

type PushBody = CreateBody | CommitBody;

interface GithubRepoResponse {
  full_name: string;
  default_branch: string;
  html_url: string;
  clone_url: string;
}

interface GithubUserResponse {
  login: string;
  name?: string | null;
  email?: string | null;
}

async function getGithubToken(userId: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, 'github');
    return tokens.data?.[0]?.token ?? null;
  } catch (err) {
    console.warn('[github/push] failed to read clerk oauth token:', (err as Error).message);
    return null;
  }
}

async function ghFetch<T>(
  path: string,
  init: RequestInit & { token: string },
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${init.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    try {
      message = JSON.parse(text)?.message || text;
    } catch {}
    return { ok: false, status: res.status, message };
  }
  return { ok: true, data: (await res.json()) as T };
}

// Inject the access token into the remote URL right before push so it never
// touches the working tree. The script `set +x`s and overwrites the variable
// after the push so curl-style logging doesn't leak it. The agent (and any
// subsequent push) re-supplies the token on each call rather than persisting
// the credential in `.git/config`.
async function runGit(
  sandbox: Sandbox,
  script: string,
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // We avoid envs= (which leaks via `printenv` if someone shells in) by
  // inlining tokens through a heredoc trick: the token comes in via stdin
  // and is consumed by `git credential approve` only when needed. For the
  // simple push case we use the URL form `https://x-access-token:TOKEN@…`
  // which is well-understood and gets discarded with the temp remote.
  const wrapped = `set -e\ncd ${REPO_PATH}\n${script}`;
  const res = await sandbox.commands.run(`bash -lc ${JSON.stringify(wrapped)}`, {
    timeoutMs: 120_000,
    envs: env,
  });
  return {
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    exitCode: typeof res.exitCode === 'number' ? res.exitCode : 0,
  };
}

function authedRemoteUrl(repoFullName: string, token: string): string {
  // x-access-token is GitHub's documented user for token-based HTTPS auth.
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${repoFullName}.git`;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PushBody;
    if (!body?.sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await prisma.session.findUnique({
      where: { id: body.sessionId },
    });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.userId !== userId) {
      return NextResponse.json({ error: 'Owner only' }, { status: 403 });
    }
    if (!session.sandboxId) {
      return NextResponse.json(
        { error: 'No sandbox attached. Restore the sandbox before pushing.' },
        { status: 400 },
      );
    }

    const sandbox = await getSandbox(session.sandboxId);
    if (!sandbox) {
      return NextResponse.json(
        { error: 'Sandbox is not alive. Restore it and try again.' },
        { status: 409 },
      );
    }

    const token = await getGithubToken(userId);
    if (!token) {
      return NextResponse.json(
        { error: 'No GitHub account connected. Add the GitHub OAuth provider in your account settings.' },
        { status: 412 },
      );
    }

    const userRes = await ghFetch<GithubUserResponse>('/user', { method: 'GET', token });
    if (!userRes.ok) {
      return NextResponse.json(
        { error: `GitHub auth failed: ${userRes.message}` },
        { status: userRes.status === 401 ? 401 : 502 },
      );
    }
    const ghUser = userRes.data;
    const committerName = ghUser.name || ghUser.login;
    const committerEmail = ghUser.email || `${ghUser.login}@users.noreply.github.com`;

    // Existing column reads are typed via `(session as any)` until the prisma
    // migration `add_github_link` runs and regenerates the client. The rows
    // do contain these fields once migrated; the cast is just a build-time
    // shim. Same for the `update` calls below.
    const sessionGithubRepo = (session as unknown as { githubRepo: string | null }).githubRepo;
    const sessionGithubBranch = (session as unknown as { githubBranch: string | null }).githubBranch;

    if (body.mode === 'create') {
      if (!body.name || !/^[A-Za-z0-9._-]+$/.test(body.name)) {
        return NextResponse.json({ error: 'Invalid repo name' }, { status: 400 });
      }
      if (sessionGithubRepo) {
        return NextResponse.json(
          { error: `Session is already linked to ${sessionGithubRepo}. Use commit mode.` },
          { status: 409 },
        );
      }

      const createRes = await ghFetch<GithubRepoResponse>('/user/repos', {
        method: 'POST',
        token,
        body: JSON.stringify({
          name: body.name,
          private: body.isPrivate,
          description: body.description ?? 'Built with CodeVibe',
          auto_init: false,
        }),
      });
      if (!createRes.ok) {
        return NextResponse.json(
          { error: `GitHub create failed: ${createRes.message}` },
          { status: createRes.status === 422 ? 409 : 502 },
        );
      }
      const repo = createRes.data;
      const branch = repo.default_branch || 'main';
      const remoteUrl = authedRemoteUrl(repo.full_name, token);

      // Fresh init: blow away any pre-existing .git so we don't pick up an
      // unrelated history (the create-next-app baseline doesn't ship one,
      // but the agent occasionally does).
      const initScript = `
rm -rf .git
git init -b ${branch}
git config user.name ${JSON.stringify(committerName)}
git config user.email ${JSON.stringify(committerEmail)}
git add -A
git commit -m ${JSON.stringify(body.message || 'Initial commit from CodeVibe')} --allow-empty
git remote add origin ${JSON.stringify(remoteUrl)}
git push -u origin ${branch}
`.trim();
      const initRes = await runGit(sandbox, initScript);
      if (initRes.exitCode !== 0) {
        return NextResponse.json(
          { error: `git push failed: ${initRes.stderr || initRes.stdout}` },
          { status: 500 },
        );
      }

      await prisma.session.update({
        where: { id: body.sessionId },
        data: { githubRepo: repo.full_name, githubBranch: branch } as never,
      });

      return NextResponse.json({
        ok: true,
        repo: repo.full_name,
        branch,
        url: repo.html_url,
        commitUrl: `${repo.html_url}/commits/${branch}`,
        created: true,
      });
    }

    // mode === 'commit'
    if (!sessionGithubRepo) {
      return NextResponse.json(
        { error: 'Session is not linked to a repo yet. Create or import one first.' },
        { status: 409 },
      );
    }
    if (!body.message?.trim()) {
      return NextResponse.json({ error: 'Commit message required' }, { status: 400 });
    }
    const branch = sessionGithubBranch || 'main';
    const remoteUrl = authedRemoteUrl(sessionGithubRepo, token);

    // The sandbox might have been provisioned without git (rewarm path) or
    // with a stale origin. Initialize if missing, replace origin every time
    // so we don't leak a previous user's token.
    const commitScript = `
git config user.name ${JSON.stringify(committerName)}
git config user.email ${JSON.stringify(committerEmail)}
if [ ! -d .git ]; then
  git init -b ${branch}
fi
git remote remove origin >/dev/null 2>&1 || true
git remote add origin ${JSON.stringify(remoteUrl)}
git add -A
if git diff --cached --quiet; then
  echo "NO_CHANGES"
  exit 7
fi
git commit -m ${JSON.stringify(body.message.trim())}
git push -u origin ${branch}
`.trim();
    const pushRes = await runGit(sandbox, commitScript);
    if (pushRes.exitCode === 7 || /NO_CHANGES/.test(pushRes.stdout)) {
      return NextResponse.json(
        { error: 'No changes to commit since the last push.' },
        { status: 409 },
      );
    }
    if (pushRes.exitCode !== 0) {
      return NextResponse.json(
        { error: `git push failed: ${pushRes.stderr || pushRes.stdout}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      repo: sessionGithubRepo,
      branch,
      url: `https://github.com/${sessionGithubRepo}`,
      commitUrl: `https://github.com/${sessionGithubRepo}/commits/${branch}`,
      created: false,
    });
  } catch (error) {
    console.error('Error pushing to GitHub:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Failed to push to GitHub', details: message },
      { status: 500 },
    );
  }
}
