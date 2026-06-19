import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkInternalAuth } from "@/lib/internal-auth";
import { recordAbuseEvent, type AbuseKind } from "@/lib/alerts";

// Internal-only abuse-signal sink. The agent's auth handler posts here
// when it spots a rate-limit trip, sandbox spam, or auth-failure burst
// it can't handle alone (no DB access on the agent side). Vercel persists
// the AbuseEvent and sends the Slack alert (with cooldown).

const ABUSE_KINDS = [
  "rate_limit",
  "auth_failed",
  "sandbox_spam",
  "cost_spike",
  "token_spike",
  "agent_crash",
] as const satisfies readonly AbuseKind[];

const AbusePayload = z.object({
  userId: z.string().min(1).max(128),
  kind: z.enum(ABUSE_KINDS),
  message: z.string().min(1).max(500),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const auth = checkInternalAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = AbusePayload.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  try {
    await recordAbuseEvent({
      userId: data.userId,
      kind: data.kind,
      message: data.message,
      metadata: data.metadata,
    });
  } catch (err) {
    console.error("[ingest/abuse] record failed:", err);
    return NextResponse.json({ error: "Failed to record" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
