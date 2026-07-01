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

// Poll `curl http://localhost:<port>` inside the sandbox until the dev
// server answers (any HTTP status is fine — 200 / 404 / 500 all mean
// "something is listening"). Returns:
//   'ready'   — port answered within `timeoutMs`
//   'booting' — timed out; the daemon is still installing / compiling.
//                Frontend keeps its shimmer up and retries.
async function waitForPortListening(
  sandbox: Sandbox,
  port: number,
  timeoutMs: number,
): Promise<'ready' | 'booting'> {
  // We bake the whole loop into one shell script rather than making N
  // round-trips from Next → E2B, which would waste ~100ms per attempt on
  // RPC overhead alone. The script exits as soon as curl reports a
  // response, capped by the deadline.
  const deadlineSecs = Math.ceil(timeoutMs / 1000);
  const script = `
set -u
DEADLINE=$(( $(date +%s) + ${deadlineSecs} ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  # -o /dev/null: discard body. -w '%{http_code}': print status only.
  # --max-time 1: give up on this attempt after 1s so we can retry.
  code=$(curl -sS -o /dev/null --max-time 1 -w '%{http_code}' "http://127.0.0.1:${port}" || echo 000)
  if [ "$code" != "000" ] && [ "$code" != "" ]; then
    echo "PORT_READY $code"
    exit 0
  fi
  sleep 0.5
done
echo "PORT_TIMEOUT"
exit 1
`.trim();
  try {
    const res = await runSandboxScript(sandbox, script, {
      // Give the sandbox side a little more time than our deadline so we
      // don't kill it mid-check.
      timeoutMs: timeoutMs + 5_000,
    });
    return res.stdout.includes('PORT_READY') ? 'ready' : 'booting';
  } catch (err) {
    console.warn('[github/import] waitForPortListening threw:', (err as Error).message);
    return 'booting';
  }
}

// Detect what kind of JS project we cloned so we can run the right dev
// command on the right port. The sandbox's public URL always points at the
// template's exposed port (cfg.port — 3000 for the Next template), so we
// have to *force* whatever dev server the project ships to bind there. Most
// tools honor `PORT` env var; Vite additionally honors `--port`. We also
// force `--host 0.0.0.0` where possible because E2B routes external traffic
// through the sandbox's network interface, not localhost.
//
// We prefer `./node_modules/.bin/<binary>` over `npx` when the binary is
// available — bypasses npx's registry lookup and any auto-install prompt.
// Falls back to `npx <name>` if the local bin is missing (rare — usually
// means the install silently failed). Ultimately falls back to
// `npm run dev` → `npm start` if we can't statically identify the framework.
function detectProjectKindShell(port: number): string {
  return `
# Read package.json once; jq isn't guaranteed to be installed, so we grep.
PKG=/home/user/package.json
if [ ! -f "$PKG" ]; then
  # Not a Node project — nothing to boot. The user probably imported a
  # static repo or a non-JS project; leave the tree in place so the code
  # editor still shows the files.
  echo "[import-boot] no package.json — skipping dev-server boot"
  exit 0
fi

# Helper: run <name> either from ./node_modules/.bin (fast, no network) or
# via \`npx <name>\` (slow, may hit registry). This makes the script survive
# a partial npm install failure — a warning about peer deps often leaves
# .bin populated even when npm's exit code was non-zero.
run_bin() {
  local bin="$1"; shift
  if [ -x "./node_modules/.bin/\$bin" ]; then
    exec "./node_modules/.bin/\$bin" "\$@"
  else
    echo "[import-boot] ./node_modules/.bin/\$bin missing — falling back to npx"
    exec npx --yes "\$bin" "\$@"
  fi
}

# Framework fingerprints. Order matters: check the more specific ones first
# so a project that has both (e.g. next + vite dep) picks the right one.
HAS_NEXT=$(grep -Eq '"next"[[:space:]]*:' "$PKG" && echo 1 || echo 0)
HAS_VITE=$(grep -Eq '"vite"[[:space:]]*:' "$PKG" && echo 1 || echo 0)
HAS_REACT_SCRIPTS=$(grep -Eq '"react-scripts"[[:space:]]*:' "$PKG" && echo 1 || echo 0)
HAS_ASTRO=$(grep -Eq '"astro"[[:space:]]*:' "$PKG" && echo 1 || echo 0)
HAS_NUXT=$(grep -Eq '"nuxt"[[:space:]]*:' "$PKG" && echo 1 || echo 0)
HAS_REMIX=$(grep -Eq '"@remix-run/' "$PKG" && echo 1 || echo 0)
HAS_SVELTEKIT=$(grep -Eq '"@sveltejs/kit"' "$PKG" && echo 1 || echo 0)
HAS_DEV_SCRIPT=$(grep -Eq '"dev"[[:space:]]*:' "$PKG" && echo 1 || echo 0)
HAS_START_SCRIPT=$(grep -Eq '"start"[[:space:]]*:' "$PKG" && echo 1 || echo 0)

# Every dev server we spawn gets PORT + HOST env so they bind where E2B
# forwards traffic. Not every tool respects PORT (Vite ignores it in some
# versions) so per-framework we also pass the CLI flag when possible.
export PORT=${port}
export HOST=0.0.0.0
export HOSTNAME=0.0.0.0        # some tools read HOSTNAME instead of HOST
export BROWSER=none            # CRA otherwise tries to open a browser

echo "[import-boot] fingerprint: next=$HAS_NEXT vite=$HAS_VITE cra=$HAS_REACT_SCRIPTS astro=$HAS_ASTRO nuxt=$HAS_NUXT remix=$HAS_REMIX sveltekit=$HAS_SVELTEKIT dev=$HAS_DEV_SCRIPT start=$HAS_START_SCRIPT"

if [ "$HAS_NEXT" = "1" ]; then
  echo "[import-boot] detected: Next.js — binding :$PORT"
  run_bin next dev -p "$PORT" --hostname 0.0.0.0
elif [ "$HAS_NUXT" = "1" ]; then
  echo "[import-boot] detected: Nuxt — binding :$PORT"
  run_bin nuxt dev --port "$PORT" --host 0.0.0.0
elif [ "$HAS_REMIX" = "1" ]; then
  echo "[import-boot] detected: Remix — honors PORT env"
  run_bin remix dev
elif [ "$HAS_SVELTEKIT" = "1" ]; then
  echo "[import-boot] detected: SvelteKit — binding :$PORT via vite"
  run_bin vite dev --port "$PORT" --host 0.0.0.0
elif [ "$HAS_ASTRO" = "1" ]; then
  echo "[import-boot] detected: Astro — binding :$PORT"
  run_bin astro dev --port "$PORT" --host 0.0.0.0
elif [ "$HAS_VITE" = "1" ]; then
  echo "[import-boot] detected: Vite — binding :$PORT"
  run_bin vite --port "$PORT" --host 0.0.0.0
elif [ "$HAS_REACT_SCRIPTS" = "1" ]; then
  echo "[import-boot] detected: CRA — honors PORT=$PORT"
  run_bin react-scripts start
elif [ "$HAS_DEV_SCRIPT" = "1" ]; then
  echo "[import-boot] detected: generic 'dev' script — PORT=$PORT HOST=$HOST"
  exec npm run dev
elif [ "$HAS_START_SCRIPT" = "1" ]; then
  echo "[import-boot] detected: generic 'start' script — PORT=$PORT HOST=$HOST"
  exec npm start
else
  echo "[import-boot] no dev/start script — nothing to run" >&2
  exit 1
fi
`.trim();
}

// Fire-and-forget install + dev-server boot. We don't block the HTTP response
// on this — the frontend already shows a preview shimmer and the iframe
// polls the sandbox URL until Next answers. Blocking here just makes the
// import dialog sit spinning for ~90s of dead time.
//
// Daemonization is via `nohup setsid --fork`:
//   - `nohup` ignores SIGHUP so a login-shell exit doesn't kill the child.
//   - `setsid --fork` forces a fork into a new session even when the caller
//     is a session leader (which E2B's `bash -l` shell often is — bare
//     `setsid` errors out with "cannot set process group" in that case).
//   - All FDs are redirected to files so envd doesn't wait on inherited
//     pipes, which is what caused the earlier `deadline_exceeded`.
async function startDevServerInBackground(sandbox: Sandbox, port: number): Promise<void> {
  const detectAndRun = detectProjectKindShell(port);
  const script = `
set -u
cd ${REPO_PATH}
# Kill any dev server left over from the template (next dev is baked in) or
# from an earlier failed import attempt — matching on likely command names
# so we don't have to know which framework was previously running.
pkill -f "next dev" >/dev/null 2>&1 || true
pkill -f "vite" >/dev/null 2>&1 || true
pkill -f "react-scripts" >/dev/null 2>&1 || true
pkill -f "astro dev" >/dev/null 2>&1 || true

# Write the actual work script — dodges nested-quote hell and gives us a
# clean file to \`tail -f\` for debugging.
cat > /tmp/import-boot.sh <<'BOOT_EOF'
#!/usr/bin/env bash
cd ${REPO_PATH}
{
  echo "[import-boot] starting at $(date -u +%FT%TZ)"
  if [ -f package.json ]; then
    npm install --prefer-offline --no-audit --no-fund --loglevel=error
    echo "[import-boot] install exit=$? at $(date -u +%FT%TZ), detecting framework"
  else
    echo "[import-boot] no package.json, skipping install"
  fi
${detectAndRun}
} > /tmp/import-boot.log 2>&1
BOOT_EOF
chmod +x /tmp/import-boot.sh

# Detach: nohup + setsid --fork, with every FD redirected to a real file so
# envd stops waiting on the child. The trailing \`exit 0\` guarantees this
# outer shell finishes even if the fork returns a status the runner might
# interpret as failure.
nohup setsid --fork bash /tmp/import-boot.sh </dev/null >>/tmp/import-boot.log 2>&1
echo STARTED
exit 0
`.trim();
  try {
    // Timeout is a safety net — the script should return within ~200ms of
    // spawning the daemon. If it takes longer than 10s something is very
    // wrong (e.g. sandbox is under load) but we don't want to hang the
    // import response on it.
    const res = await runSandboxScript(sandbox, script, { timeoutMs: 10_000 });
    if (!res.stdout.includes('STARTED')) {
      console.warn('[github/import] daemon spawn returned without STARTED:', {
        stdout: res.stdout,
        stderr: res.stderr,
        exitCode: res.exitCode,
      });
    }
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
set -eo pipefail
# Never prompt for credentials — a wrong token / private repo without access
# would otherwise hang forever waiting on tty input.
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/true
export GIT_LFS_SKIP_SMUDGE=1

pkill -f "next dev" >/dev/null 2>&1 || true

# Fresh scratch dir for the clone; guaranteed empty so git won't refuse.
SCRATCH="$(mktemp -d /tmp/repo.XXXXXX)"
git clone --depth 1 --single-branch --branch ${JSON.stringify(branch)} ${JSON.stringify(cloneUrl)} "$SCRATCH" 2>&1

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
      if (cloneRes.exitCode !== 0 || !(cloneRes.stdout ?? '').includes('CLONE_OK')) {
        console.error('[github/import] clone script failed:', {
          exitCode: cloneRes.exitCode,
          stdout: cloneRes.stdout,
          stderr: cloneRes.stderr,
          repo,
          branch,
        });
        // Surface a friendly error but include enough server-side detail
        // that we can diagnose from the Vercel logs.
        const stderr = (cloneRes.stderr || '').toLowerCase();
        let hint = 'Clone failed.';
        if (stderr.includes('repository not found') || stderr.includes('not found')) {
          hint = `Repository ${repo} not found. Confirm the name and that your GitHub connection has access.`;
        } else if (stderr.includes('couldn\'t find remote ref') || stderr.includes('remote branch')) {
          hint = `Branch "${branch}" does not exist on ${repo}.`;
        } else if (stderr.includes('authentication failed') || stderr.includes('403')) {
          hint = 'GitHub authentication failed. Reconnect GitHub with the "repo" scope.';
        }
        throw new Error(
          `${hint} (${cloneRes.stderr || cloneRes.stdout || `exit ${cloneRes.exitCode}`})`,
        );
      }

      // Kick off install + dev server without blocking the response — the
      // frontend iframe / shimmer already handles the "server not up yet"
      // window. This is what makes the import dialog return in seconds
      // instead of a minute+. We pass `cfg.port` so whatever dev server
      // the imported project ships (Next, Vite, CRA, …) is forced to bind
      // where E2B's public URL forwards traffic.
      void startDevServerInBackground(sandbox, cfg.port);
      const host = sandbox.getHost(cfg.port);
      const sandboxUrl = `https://${host}`;

      // Give the dev server a short window to actually bind the port
      // *before* we hand the URL to the frontend. Without this, the iframe
      // races the install and the user sees E2B's "Connection refused"
      // interstitial for the first refresh. If it doesn't come up in this
      // window (large repos, cold npm cache), we still return — the
      // client-side poller will keep watching and swap in the iframe when
      // the port answers.
      const devReady = await waitForPortListening(sandbox, cfg.port, 25_000);
      console.info('[github/import] dev-server readiness after clone:', devReady);

      await prisma.session.update({
        where: { id: body.sessionId },
        data: {
          sandboxId: sandbox.sandboxId,
          sandboxUrl,
          sandboxCreatedAt: new Date(),
          githubRepo: repo,
          githubBranch: branch,
          // Skip the agent's template-picker HITL. Importing a repo IS the
          // template decision — the sandbox is already provisioned for
          // `templateType` above, and asking the user "nextjs / n8n / chat?"
          // on their first prompt is confusing and destructive (a different
          // choice would blow the just-cloned tree away).
          templateType,
          templateDecided: true,
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
