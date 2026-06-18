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

    const user = await verifyClerkJwt(token);
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
