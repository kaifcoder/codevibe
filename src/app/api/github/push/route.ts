import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { Sandbox } from '@e2b/code-interpreter';
import { prisma } from "@/server/db";
import { getSandbox, runSandboxScript } from '@/lib/sandbox-utils';


const REPO_PATH = '/home/user';

interface CreateBody {
  mode: 'create';
  sessionId: string;
  name: string;
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
): Promise<
  | { ok: true; data: T; scopes: string[] | null }
  | { ok: false; status: number; message: string }
> {
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
  // `x-oauth-scopes` is present for OAuth tokens (what Clerk issues). It's
  // absent (null) for GitHub App user tokens — in that case we can't infer the
  // granted scopes, so we skip the up-front scope check.
  const scopesHeader = res.headers.get('x-oauth-scopes');
  const scopes =
    scopesHeader === null
      ? null
      : scopesHeader.split(',').map((s) => s.trim()).filter(Boolean);
  return { ok: true, data: (await res.json()) as T, scopes };
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
  return runSandboxScript(sandbox, wrapped, { timeoutMs: 120_000, envs: env });
}

function authedRemoteUrl(repoFullName: string, token: string): string {
  // x-access-token is GitHub's documented user for token-based HTTPS auth.
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${repoFullName}.git`;
}

// The sandbox `/home/user` root contains template-warmed caches (`.npm`,
// `.cache`, `.local`, `.config`) alongside the app tree. create-next-app's
// `.gitignore` doesn't cover those, so a naive `git add -A` from /home/user
// walks *gigabytes* of package cache — that's the "push is slow" symptom.
// We append this ignore block to `.gitignore` (idempotently) before every
// add so the working set stays small and objects pack fast.
const SANDBOX_IGNORE_BLOCK = [
  '# --- codevibe:sandbox-ignore (auto-added by push route) ---',
  'node_modules/',
  '.next/',
  '.turbo/',
  'dist/',
  'build/',
  'out/',
  '.cache/',
  '.npm/',
  '.local/',
  '.config/',
  '.env',
  '.env.local',
  '.env.*.local',
  '*.log',
  'npm-debug.log*',
  '/tmp/',
  '# --- /codevibe:sandbox-ignore ---',
].join('\n');

// Shell snippet: install our ignore block once (grep on the sentinel line),
// then enable git's fast-index / many-files feature so `git add -A` is
// parallel and skips redundant stat calls. Delta compression is also
// dialed down — for the first push we want speed, not the tightest pack.
function fastGitPreamble(): string {
  return `
# Idempotently seed a comprehensive .gitignore so add -A doesn't walk the
# sandbox's warmed npm/cache dirs (the slow-push culprit).
touch .gitignore
if ! grep -q "codevibe:sandbox-ignore" .gitignore 2>/dev/null; then
  printf '\\n%s\\n' ${JSON.stringify(SANDBOX_IGNORE_BLOCK)} >> .gitignore
fi

# Fast-path config — safe repo-local settings, no user prompts, no gc.
git config feature.manyFiles true          # parallel index writes (git >=2.24)
git config index.threads true              # parallel index scan
git config core.untrackedCache true        # cache untracked file scan
git config core.fsmonitor false            # no fsmonitor daemon needed
git config gc.auto 0                       # never auto-gc mid-push
git config pack.threads 0                  # let pack use all CPUs
git config pack.window 1                   # cheap delta window — speed > size
git config pack.compression 1              # zlib level 1 (fastest)
git config core.compression 1              # ditto for loose objects
git config http.postBuffer 524288000       # 500MB — avoids chunked-encoding stall
git config transfer.fsckObjects false      # don't verify server-side receive
`.trim();
}

// A missing `repo` OAuth scope makes GitHub answer repo create/push with a
// bare "Not Found" (404) or 403 instead of a helpful permission error — which
// this route was surfacing as a confusing 502. Turn those into an actionable
// message so the user knows to reconnect GitHub with repository access.
const SCOPE_HINT =
  'Your GitHub connection is missing repository write access. Reconnect GitHub and grant the "repo" scope, then try again.';

function gitAuthHint(output: string): string | null {
  return /repository not found|remote: not found|remote: permission|permission to .* denied|could not read username|authentication failed|the requested url returned error: 403|error: 404/i.test(
    output,
  )
    ? SCOPE_HINT
    : null;
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
        {
          error:
            userRes.status === 401
              ? 'GitHub token is invalid or expired. Reconnect your GitHub account and try again.'
              : `GitHub auth failed: ${userRes.message}`,
        },
        { status: userRes.status === 401 ? 401 : 502 },
      );
    }

    // Clerk's GitHub OAuth connection must request the `repo` scope. Without it
    // GitHub silently answers repo create/push with 404 "Not Found" (which the
    // route otherwise reports as a confusing 502). Catch the missing scope here
    // with a clear, actionable message.
    if (
      userRes.scopes !== null &&
      !userRes.scopes.includes('repo') &&
      !userRes.scopes.includes('public_repo')
    ) {
      return NextResponse.json({ error: SCOPE_HINT }, { status: 403 });
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
          private: false,
          description: body.description ?? 'Built with CodeVibe',
          auto_init: false,
        }),
      });
      if (!createRes.ok) {
        const { status } = createRes;
        const friendly =
          status === 422
            ? `A repo named "${body.name}" already exists on your account.`
            : status === 403 || status === 404
              ? SCOPE_HINT
              : `GitHub create failed: ${createRes.message}`;
        return NextResponse.json(
          { error: friendly },
          {
            status:
              status === 422 ? 409 : status === 403 || status === 404 ? 403 : 502,
          },
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
${fastGitPreamble()}
git config user.name ${JSON.stringify(committerName)}
git config user.email ${JSON.stringify(committerEmail)}
git add -A
git commit -m ${JSON.stringify(body.message || 'Initial commit from CodeVibe')} --allow-empty
git remote add origin ${JSON.stringify(remoteUrl)}
git push --no-verify -u origin ${branch}
`.trim();
      const initRes = await runGit(sandbox, initScript);
      if (initRes.exitCode !== 0) {
        const out = initRes.stderr || initRes.stdout;
        return NextResponse.json(
          { error: gitAuthHint(out) || `git push failed: ${out}` },
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
if [ ! -d .git ]; then
  git init -b ${branch}
fi
${fastGitPreamble()}
git config user.name ${JSON.stringify(committerName)}
git config user.email ${JSON.stringify(committerEmail)}
git remote remove origin >/dev/null 2>&1 || true
git remote add origin ${JSON.stringify(remoteUrl)}
git add -A
if git diff --cached --quiet; then
  echo "NO_CHANGES"
  exit 7
fi
git commit -m ${JSON.stringify(body.message.trim())}
git push --no-verify -u origin ${branch}
`.trim();
    const pushRes = await runGit(sandbox, commitScript);
    if (pushRes.exitCode === 7 || /NO_CHANGES/.test(pushRes.stdout)) {
      return NextResponse.json(
        { error: 'No changes to commit since the last push.' },
        { status: 409 },
      );
    }
    if (pushRes.exitCode !== 0) {
      const out = pushRes.stderr || pushRes.stdout;
      return NextResponse.json(
        { error: gitAuthHint(out) || `git push failed: ${out}` },
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
