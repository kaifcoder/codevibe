// Custom auth handler for the LangGraph Agent Server (Render).
//
// Wires every request to /runs, /threads/*, /store/* through:
//   1. Clerk JWT verification — only authenticated codevibe users get past.
//   2. A sliding-window per-user rate limit, backed by the same Redis instance
//      LangGraph already uses (REDIS_URI on Render). No extra infra.
//   3. Resource-scoped @auth.on handlers that tag every thread/store item
//      with `owner: <clerk userId>` and filter reads by that owner so users
//      can never see each other's threads — even if they guess thread_ids.
//
// langgraph.json points at this file via `auth.path`.
//
// IMPORTANT: this runs INSIDE the agent container (Render), not on Vercel.
// Env vars expected on Render:
//   - CLERK_SECRET_KEY    (already used by Next.js — set the same value)
//   - REDIS_URI           (already set; LangGraph uses it for pub/sub)
//   - AGENT_RATE_LIMIT    (optional, default "60")  — requests
//   - AGENT_RATE_WINDOW   (optional, default "60")  — seconds
//   - INTERNAL_AGENT_SECRET (optional) — bypass token for server-to-server
//     calls from Next.js (e.g. internal MCP routes). The Next.js app sends
//     it as `X-Internal-Secret`; we let those requests through.

import { Auth, HTTPException } from '@langchain/langgraph-sdk/auth';
import { verifyToken } from '@clerk/backend';
import Redis from 'ioredis';

// ─── Redis (lazy, single connection per process) ────────────────────────────

let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.REDIS_URI;
  if (!url) {
    // Local dev (`langgraph dev` without docker-compose) won't have Redis.
    // Fail open in that case — rate limiting is a production-only concern.
    return null;
  }
  redis = new Redis(url, {
    // Don't crash the agent on a Redis blip; fail open instead.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  redis.on('error', (err) => {
    console.error('[langgraph-auth] redis error:', err.message);
  });
  return redis;
}

// ─── Fire-and-forget abuse signals → Next.js ingest ────────────────────────
//
// The Next.js side owns Postgres + Slack alerting. We POST a JSON signal
// here when we spot abuse; Vercel persists an AbuseEvent row (with cooldown
// dedupe) and triggers a Slack message. Failures are swallowed — abuse
// tracking must never break a request that already passed auth checks.

const ABUSE_INGEST_TIMEOUT_MS = 1_500;

type AbuseKind = 'rate_limit' | 'auth_failed' | 'sandbox_spam' | 'cost_spike';

async function postAbuseSignal(
  userId: string,
  kind: AbuseKind,
  message: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const appUrl =
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? null;
  const secret = process.env.INTERNAL_AGENT_SECRET;
  if (!appUrl || !secret) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ABUSE_INGEST_TIMEOUT_MS);
  try {
    await fetch(`${appUrl}/api/ingest/abuse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ userId, kind, message, metadata }),
      signal: ctrl.signal,
    });
  } catch (err) {
    console.error('[abuse-ingest] failed:', (err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Rate limiter (fixed window, atomic INCR + EXPIRE) ──────────────────────

const RATE_LIMIT = Number(process.env.AGENT_RATE_LIMIT ?? '60');
const RATE_WINDOW_SEC = Number(process.env.AGENT_RATE_WINDOW ?? '60');

async function checkRateLimit(userId: string): Promise<void> {
  const r = getRedis();
  if (!r) return; // dev mode — skip
  // Fixed-window counter keyed per (user, current minute). Cheap, atomic,
  // and forgiving: a user briefly seeing N+1 across a window boundary is
  // fine. The TTL is set on first INCR so the key self-cleans.
  const bucket = Math.floor(Date.now() / 1000 / RATE_WINDOW_SEC);
  const key = `cv:rl:agent:${userId}:${bucket}`;
  try {
    const count = await r.incr(key);
    if (count === 1) {
      await r.expire(key, RATE_WINDOW_SEC + 1);
    }
    if (count > RATE_LIMIT) {
      // Fire abuse signal exactly once per window — count === RATE_LIMIT + 1
      // is the first request that *trips* the cap; later trips in the same
      // bucket re-trigger this branch but Vercel's cooldown dedupes them
      // server-side anyway.
      if (count === RATE_LIMIT + 1) {
        void postAbuseSignal(userId, 'rate_limit', `Hit ${RATE_LIMIT} req / ${RATE_WINDOW_SEC}s`, {
          count,
          limit: RATE_LIMIT,
          windowSec: RATE_WINDOW_SEC,
        });
      }
      throw new HTTPException(429, {
        message: `Rate limit exceeded: ${RATE_LIMIT} requests per ${RATE_WINDOW_SEC}s`,
      });
    }
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    // Redis hiccup — log and fail open. Better to serve a request than to
    // 500 the whole agent because Redis is briefly unreachable.
    console.error('[langgraph-auth] rate-limit check failed (failing open):', err);
  }
}

// ─── Clerk JWT verification ─────────────────────────────────────────────────

interface AuthedUser {
  identity: string;        // Clerk userId — becomes ctx.user.identity
  is_authenticated: true;
  permissions: string[];
}

async function verifyClerkJwt(token: string): Promise<AuthedUser> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new HTTPException(500, {
      message: 'Agent server misconfigured: CLERK_SECRET_KEY missing',
    });
  }
  try {
    const claims = await verifyToken(token, { secretKey });
    if (!claims.sub) {
      throw new HTTPException(401, { message: 'Token has no subject' });
    }
    return {
      identity: claims.sub,
      is_authenticated: true,
      permissions: [],
    };
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }
}

// ─── Auth-failure burst tracking ────────────────────────────────────────────
//
// Counts JWT verification failures by token-prefix (no PII) so a brute force
// or spammed-bad-token attack surfaces one Slack alert per window instead of
// silently 401'ing in the logs.

const AUTH_FAIL_THRESHOLD = Number(process.env.AGENT_AUTH_FAIL_THRESHOLD ?? '5');
const AUTH_FAIL_WINDOW_SEC = 60;

async function recordAuthFailure(tokenPrefix: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const bucket = Math.floor(Date.now() / 1000 / AUTH_FAIL_WINDOW_SEC);
  const key = `cv:auth:fail:${tokenPrefix}:${bucket}`;
  try {
    const count = await r.incr(key);
    if (count === 1) await r.expire(key, AUTH_FAIL_WINDOW_SEC + 1);
    if (count === AUTH_FAIL_THRESHOLD) {
      // Cross the threshold exactly once per window. Vercel has its own
      // cooldown anyway, but this avoids sending N webhooks during a flood.
      void postAbuseSignal(
        `anon:${tokenPrefix}`,
        'auth_failed',
        `${AUTH_FAIL_THRESHOLD}+ JWT verification failures in ${AUTH_FAIL_WINDOW_SEC}s`,
        { tokenPrefix, count, windowSec: AUTH_FAIL_WINDOW_SEC },
      );
    }
  } catch (err) {
    console.error('[langgraph-auth] auth-fail counter failed:', err);
  }
}

// ─── Auth instance ──────────────────────────────────────────────────────────

export const auth = new Auth()
  .authenticate(async (request: Request): Promise<AuthedUser> => {
    // 1. Server-to-server bypass: Next.js's internal MCP/agent routes send a
    //    shared secret instead of a user JWT. Treat the call as a synthetic
    //    "system" identity so resource handlers don't 403 it.
    const internalSecret = process.env.INTERNAL_AGENT_SECRET;
    const sentSecret = request.headers.get('x-internal-secret');
    if (internalSecret && sentSecret && sentSecret === internalSecret) {
      return {
        identity: '__internal__',
        is_authenticated: true,
        permissions: ['internal'],
      };
    }

    // 2. Standard path: Bearer <Clerk session JWT>
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      throw new HTTPException(401, { message: 'Missing bearer token' });
    }

    let user: AuthedUser;
    try {
      user = await verifyClerkJwt(token);
    } catch (err) {
      // Track verification failures so a brute-force run shows up in Slack
      // instead of vanishing into 401 noise. Use the first 8 chars of the
      // (rejected) token as a coarse fingerprint — not PII, can't be used
      // to recover the secret.
      void recordAuthFailure(token.slice(0, 8));
      throw err;
    }
    await checkRateLimit(user.identity);
    return user;
  })

  // ─── Resource handlers: tag + filter by owner ──────────────────────────────
  // Any thread, run, or store item created by a user is tagged with
  // `owner: <userId>`; any read returns a filter that restricts results to
  // that same owner. The agent server enforces this at the DB layer.

  .on('threads:create', ({ value, user }) => {
    if (user.permissions?.includes('internal')) return; // server-to-server: no filter
    value.metadata = { ...(value.metadata ?? {}), owner: user.identity };
    return { owner: user.identity };
  })
  .on('threads:read', ({ user }) => {
    if (user.permissions?.includes('internal')) return;
    return { owner: user.identity };
  })
  .on('threads:update', ({ user }) => {
    if (user.permissions?.includes('internal')) return;
    return { owner: user.identity };
  })
  .on('threads:delete', ({ user }) => {
    if (user.permissions?.includes('internal')) return;
    return { owner: user.identity };
  })
  .on('threads:search', ({ user }) => {
    if (user.permissions?.includes('internal')) return;
    return { owner: user.identity };
  })
  .on('threads:create_run', ({ value, user }) => {
    if (user.permissions?.includes('internal')) return;
    value.metadata = { ...(value.metadata ?? {}), owner: user.identity };
    return { owner: user.identity };
  })

  // codevibe doesn't expose user-defined assistants — every request runs the
  // single `agent` graph. Lock the assistants resource down so a probe can't
  // enumerate or mutate it.
  .on('assistants:create', () => {
    throw new HTTPException(403, { message: 'Forbidden' });
  })
  .on('assistants:update', () => {
    throw new HTTPException(403, { message: 'Forbidden' });
  })
  .on('assistants:delete', () => {
    throw new HTTPException(403, { message: 'Forbidden' });
  })

  // Store items are namespaced — first segment must be the user's identity.
  // (Currently codevibe doesn't write to /store/*; this is preventative.)
  .on('store', ({ value, user }) => {
    if (user.permissions?.includes('internal')) return;
    const ns = value.namespace?.[0];
    if (ns && ns !== user.identity) {
      throw new HTTPException(403, { message: 'Cross-user store access denied' });
    }
  });
