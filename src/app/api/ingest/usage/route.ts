import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { checkInternalAuth } from "@/lib/internal-auth";
import { checkCostSpike, checkTokenSpike } from "@/lib/alerts";

// Internal-only ingest endpoint. The Render-deployed agent posts one row
// per LLM call here so we can track per-user spend, build quotas, and
// detect cost anomalies. Authenticated via shared INTERNAL_AGENT_SECRET —
// see src/lib/internal-auth.ts.

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

  const parsed = UsagePayload.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  try {
    await prisma.usage.create({
      data: {
        userId: data.userId,
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
  void checkCostSpike(data.userId).catch((e) =>
    console.error("[ingest/usage] cost spike check failed:", e),
  );
  void checkTokenSpike(data.userId, data.threadId).catch((e) =>
    console.error("[ingest/usage] token spike check failed:", e),
  );

  return NextResponse.json({ ok: true });
}
