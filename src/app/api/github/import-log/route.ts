import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/server/db';
import { getSandbox, runSandboxScript } from '@/lib/sandbox-utils';

/**
 * Tails /tmp/import-boot.log inside a session's sandbox so the UI can show
 * why the preview didn't come up (dev-server crashed on install, wrong
 * port binding, framework detection wrong, etc.).
 *
 * GET /api/github/import-log?sessionId=<id>
 *   → { ok, log, exists }
 *
 * We deliberately do NOT expose the sandbox shell — this is a read-only
 * tail so a share-link visitor can't run arbitrary commands.
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, sandboxId: true },
    });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.userId !== userId) {
      return NextResponse.json({ error: 'Owner only' }, { status: 403 });
    }
    if (!session.sandboxId) {
      return NextResponse.json(
        { ok: true, log: '', exists: false, hint: 'No sandbox attached.' },
      );
    }

    const sandbox = await getSandbox(session.sandboxId);
    if (!sandbox) {
      return NextResponse.json(
        { ok: true, log: '', exists: false, hint: 'Sandbox is not alive.' },
      );
    }

    // tail -n 200 is plenty for the boot phase; anything longer is user
    // hot-reload noise. `2>/dev/null` + `|| echo` gives us an empty string
    // when the file doesn't exist yet.
    const script = `
if [ -f /tmp/import-boot.log ]; then
  echo "__EXISTS__"
  tail -n 200 /tmp/import-boot.log
else
  echo "__MISSING__"
fi
# Also check if any dev server is actually listening on the exposed port
# — helps distinguish "crashed" from "still starting up".
echo "__PORTS__"
(ss -ltnp 2>/dev/null || netstat -ltn 2>/dev/null || true) | grep -E ':(3000|5173|4200|8080|8000)\\b' || echo "no listeners"
`.trim();

    const res = await runSandboxScript(sandbox, script, { timeoutMs: 10_000 });
    const raw = res.stdout ?? '';
    const exists = raw.startsWith('__EXISTS__');
    // Strip the marker + the ports section into separate fields.
    const [logPart = '', portsPart = ''] = raw.split('__PORTS__');
    const log = logPart
      .replace(/^__EXISTS__\n?/, '')
      .replace(/^__MISSING__\n?/, '')
      .trimEnd();

    return NextResponse.json({
      ok: true,
      exists,
      log,
      listeningPorts: portsPart.trim(),
    });
  } catch (error) {
    console.error('[github/import-log] failed:', error);
    return NextResponse.json(
      { error: 'Failed to read import log', details: (error as Error).message },
      { status: 500 },
    );
  }
}
