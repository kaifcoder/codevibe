import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkInternalAuth } from "@/lib/internal-auth";
import { verifyIngestRequest } from "@/lib/ingest-signing";
import { recordAbuseEvent, type AbuseKind } from "@/lib/alerts";

// Internal-only abuse-signal sink. The agent's auth handler posts here
// when it spots a rate-limit trip, sandbox spam, or auth-failure burst
// it can't handle alone (no DB access on the agent side). Vercel persists
// the AbuseEvent and sends the Slack alert (with cooldown).
//
// Auth: HMAC-signed envelope + shared secret (see src/lib/ingest-signing.ts).
// See /api/ingest/usage for the rationale — verified header userId wins
// over body userId, blocking impersonation on secret leak.
//
// One exception: auth-failure signals from the agent use a synthetic
// "anon:<token-prefix>" userId because there's no authenticated caller
// yet. That's still an authenticated fact about a failed login attempt,
// so we accept it — the signed header just says "this signal came from
// the agent server, and it thinks the id is X".

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
  const legacyAuth = checkInternalAuth(req);
  if (!legacyAuth.ok) {
    return NextResponse.json({ error: legacyAuth.error }, { status: legacyAuth.status });
  }

  const secret = process.env.INTERNAL_AGENT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Ingest signing not configured" }, { status: 500 });
  }

  const rawBody = await req.text();

  const url = new URL(req.url);
  const verify = verifyIngestRequest({
    secret,
    method: req.method,
    path: url.pathname,
    headers: req.headers,
    rawBody,
  });
  if (!verify.ok) {
    return NextResponse.json({ error: verify.error }, { status: verify.status });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
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

  if (data.userId !== verify.userId) {
    return NextResponse.json(
      { error: "Signed userId does not match body userId" },
      { status: 401 },
    );
  }

  try {
    await recordAbuseEvent({
      userId: verify.userId,
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
