import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { recordAbuseEvent } from "@/lib/alerts";

// User-facing crash sink. The chat UI's useStream onError handler POSTs here
// when the agent server returns an error that isn't one of the known
// recoverable cases (recursion limit, call limit, rate limit). This catches
// the silent SIGTERM cascade — Render killed the JS process mid-run, the
// frontend just sees a stream interruption, and we get a Slack ping with
// the thread/session/run identifiers so we can find the run in agent logs.
//
// Authed via Clerk only (NOT the internal-secret path) — this is the
// browser reporting its own crashes, not a server-to-server call. We use
// the session's userId, NOT a client-supplied one, so a malicious user
// can't spam alerts attributed to other users.

const Payload = z.object({
  threadId: z.string().min(1).max(128).optional(),
  sessionId: z.string().min(1).max(128).optional(),
  runId: z.string().min(1).max(128).optional(),
  message: z.string().min(1).max(500),
  // Free-form metadata — useStream may include http status, error name etc.
  // Capped via record() + zod's unknown-value safety; we additionally clip
  // its serialized size below before persisting.
  context: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Payload.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Clip the context blob before stuffing it into the AbuseEvent metadata
  // JSON column — runaway model traces or stack dumps can be enormous and
  // we don't want a single user's bad day to bloat the table.
  let metadata: Record<string, unknown> = {
    threadId: data.threadId ?? null,
    sessionId: data.sessionId ?? null,
    runId: data.runId ?? null,
  };
  if (data.context) {
    const serialized = JSON.stringify(data.context);
    metadata = {
      ...metadata,
      context:
        serialized.length > 4_000
          ? `${serialized.slice(0, 4_000)}…[truncated ${serialized.length - 4_000} chars]`
          : data.context,
    };
  }

  try {
    await recordAbuseEvent({
      // Cooldown bucket on (user, thread) so a crashy thread alerts once per
      // window rather than every reload — but a different thread for the
      // same user still gets its own alert.
      userId: data.threadId ? `${userId}:${data.threadId}` : userId,
      kind: "agent_crash",
      message: data.message.slice(0, 500),
      metadata,
    });
  } catch (err) {
    console.error("[ingest/agent-crash] record failed:", err);
    return NextResponse.json({ error: "Failed to record" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
