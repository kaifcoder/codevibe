import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { verifyIngestRequest } from "@/lib/ingest-signing";
import { checkInternalAuth } from "@/lib/internal-auth";
import { checkCostSpike, checkTokenSpike } from "@/lib/alerts";

// Internal-only ingest endpoint. The Render-deployed agent posts one row
// per LLM call here so we can track per-user spend, build quotas, and
// detect cost anomalies.
//
// Auth: HMAC-signed envelope + shared secret (see src/lib/ingest-signing.ts).
// The signed X-Cv-User header is bound to the request signature — we trust
// THAT over any userId in the body. The `userId` in the payload schema is
// kept for backwards compatibility, but we assert it matches the signed
// header before writing, so a caller with a leaked secret can no longer
// attribute another user's spend by lying in the body.

const UsagePayload = z.object({
  userId: z.string().min(1).max(128),
  threadId: z.string().min(1).max(128),
  sessionId: z.string().max(128).optional().nullable(),
  modelId: z.string().max(128).optional().nullable(),
  inputTokens: z.number().int().min(0).max(10_000_000),
  outputTokens: z.number().int().min(0).max(10_000_000),
  cacheReadTokens: z.number().int().min(0).max(10_000_000).optional(),
  cacheCreateTokens: z.number().int().min(0).max(10_000_000).optional(),
  costUsd: z.number().min(0).max(1_000),
});

export async function POST(req: NextRequest) {
  // Bearer-token gate stays as a first line of defense — same header as
  // before. Legacy callers without the signature headers would fail below.
  const legacyAuth = checkInternalAuth(req);
  if (!legacyAuth.ok) {
    return NextResponse.json({ error: legacyAuth.error }, { status: legacyAuth.status });
  }

  const secret = process.env.INTERNAL_AGENT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Ingest signing not configured" }, { status: 500 });
  }

  // Read raw body ONCE — the signature was computed over these exact bytes.
  // Re-serializing after JSON.parse would produce different bytes and break
  // verification. Parse the same string separately for schema validation.
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

  const parsed = UsagePayload.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Cross-check: reject payloads whose body userId disagrees with the
  // signed header userId. A well-behaved sender always sends the two
  // matching; a spoofer with a leaked secret would have to break HMAC
  // to reach this branch.
  if (data.userId !== verify.userId) {
    return NextResponse.json(
      { error: "Signed userId does not match body userId" },
      { status: 401 },
    );
  }

  try {
    await prisma.usage.create({
      data: {
        // Use the *verified* userId in case the check above is ever
        // loosened — keeps the invariant "Usage rows are authenticated"
        // local to this write, not spread across the request lifecycle.
        userId: verify.userId,
        threadId: data.threadId,
        sessionId: data.sessionId ?? null,
        modelId: data.modelId ?? null,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        cacheReadTokens: data.cacheReadTokens ?? 0,
        cacheCreateTokens: data.cacheCreateTokens ?? 0,
        costUsd: data.costUsd,
      },
    });
  } catch (err) {
    console.error("[ingest/usage] write failed:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // Fire-and-forget anomaly checks — never block the agent on these. Each
  // check writes its own AbuseEvent + Slack alert (with cooldown) when it
  // trips its threshold; failures are swallowed and logged.
  void checkCostSpike(verify.userId).catch((e) =>
    console.error("[ingest/usage] cost spike check failed:", e),
  );
  void checkTokenSpike(verify.userId, data.threadId).catch((e) =>
    console.error("[ingest/usage] token spike check failed:", e),
  );

  return NextResponse.json({ ok: true });
}
