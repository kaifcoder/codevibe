import "server-only";
import { prisma } from "@/server/db";

// ─── Slack alerter ──────────────────────────────────────────────────────────
//
// One env var, SLACK_ALERT_WEBHOOK_URL, gets a fire-and-forget Slack message
// with the abuse signal. If the var isn't set (e.g. dev), we just log and
// return — alerts are an additional channel, never the source of truth.
//
// We attach a 2s timeout so a slow Slack endpoint can't tie up an API route.

const SLACK_TIMEOUT_MS = 2_000;

async function postSlack(text: string, blocks?: unknown[]): Promise<void> {
  const url = process.env.SLACK_ALERT_WEBHOOK_URL;
  if (!url) {
    console.log("[alerts] (no SLACK_ALERT_WEBHOOK_URL) would send:", text);
    return;
  }
  const body = blocks ? { text, blocks } : { text };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SLACK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error("[alerts] Slack webhook returned", res.status, await res.text());
    }
  } catch (err) {
    // Don't propagate — alerting failures must never break a request.
    console.error("[alerts] Slack webhook failed:", (err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

// ─── AbuseEvent persistence + alert ────────────────────────────────────────
//
// Cooldown via the (userId, kind, windowStart) unique key on AbuseEvent:
// we bucket the current time into ALERT_COOLDOWN_SEC windows and try to
// insert. The first insert in a window succeeds and triggers a Slack alert;
// subsequent calls collide on the unique index and we silently drop them.
//
// This keeps a misbehaving user from posting hundreds of alerts per minute
// while still recording every distinct trip in the DB (different windows).

const ALERT_COOLDOWN_SEC = Number(process.env.ABUSE_ALERT_COOLDOWN_SEC ?? "300"); // 5 min

export type AbuseKind = "rate_limit" | "auth_failed" | "sandbox_spam" | "cost_spike";

interface RecordAbuseInput {
  userId: string;
  kind: AbuseKind;
  message: string;
  metadata?: Record<string, unknown>;
}

export async function recordAbuseEvent({
  userId,
  kind,
  message,
  metadata = {},
}: RecordAbuseInput): Promise<void> {
  const bucketSec = Math.floor(Date.now() / 1000 / ALERT_COOLDOWN_SEC) * ALERT_COOLDOWN_SEC;
  const windowStart = new Date(bucketSec * 1000);

  try {
    // create() throws P2002 on the unique constraint when this user has
    // already had this kind of event in the current window — the cooldown
    // signal we want.
    await prisma.abuseEvent.create({
      data: {
        userId,
        kind,
        message,
        metadata: metadata as object,
        windowStart,
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      // Already alerted for this user/kind in this window — silently drop.
      return;
    }
    // Any other DB error: log, don't throw — abuse tracking must not break
    // the request that triggered it.
    console.error("[alerts] failed to write AbuseEvent:", err);
    return;
  }

  // First event in this window → send the Slack alert.
  const emoji = abuseEmoji(kind);
  await postSlack(`${emoji} *${kind}* — \`${userId}\`: ${message}`, [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${kind}* — \`${userId}\`\n${message}`,
      },
    },
    metadata && Object.keys(metadata).length > 0
      ? {
          type: "section",
          fields: Object.entries(metadata)
            .slice(0, 8)
            .map(([k, v]) => ({
              type: "mrkdwn",
              text: `*${k}*: \`${typeof v === "string" ? v : JSON.stringify(v)}\``,
            })),
        }
      : null,
  ].filter(Boolean));
}

function abuseEmoji(kind: AbuseKind): string {
  switch (kind) {
    case "rate_limit":
      return "🚦";
    case "auth_failed":
      return "🔐";
    case "sandbox_spam":
      return "📦";
    case "cost_spike":
      return "💸";
  }
}

// ─── Cost-spike anomaly check ──────────────────────────────────────────────
//
// Called from the usage ingest route after a Usage row is inserted. Sums
// the user's spend over the last hour; if it crosses a threshold we record
// an abuse event (cooldown applies — at most one alert per 5 min per user).
//
// This is intentionally simple — the more advanced version is a moving
// window over both spend AND request count. For v1, "user spent more than
// $X in an hour" catches every realistic abuse pattern we've considered.

const COST_SPIKE_USD_PER_HOUR = Number(
  process.env.COST_SPIKE_USD_PER_HOUR ?? "5",
);

export async function checkCostSpike(userId: string): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const agg = await prisma.usage.aggregate({
    where: { userId, createdAt: { gte: since } },
    _sum: { costUsd: true },
    _count: { _all: true },
  });
  const totalUsd = agg._sum.costUsd ?? 0;
  const calls = agg._count._all;
  if (totalUsd < COST_SPIKE_USD_PER_HOUR) return;

  await recordAbuseEvent({
    userId,
    kind: "cost_spike",
    message: `User spent $${totalUsd.toFixed(2)} in the last hour across ${calls} calls (threshold $${COST_SPIKE_USD_PER_HOUR}).`,
    metadata: {
      totalUsd: Number(totalUsd.toFixed(4)),
      calls,
      sinceIso: since.toISOString(),
    },
  });
}
