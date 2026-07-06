/**
 * HMAC-signed request envelope for /api/ingest/* routes.
 *
 * Threat model: the agent server (LangGraph on Render) posts usage/abuse
 * signals to Vercel using a shared INTERNAL_AGENT_SECRET. Previously the
 * secret alone authenticated the caller — a leak turned it into an
 * impersonation token because the receiver trusted a caller-supplied
 * `userId` in the body.
 *
 * The signed envelope closes that gap:
 *
 *   1. The sender canonicalizes (userId, path, body-hash, timestamp).
 *   2. HMAC-SHA256(secret) over the canonical string → signature header.
 *   3. Receiver rebuilds the canonical string using its own view of the
 *      request path + body-hash and the header's userId/timestamp, then
 *      verifies the signature and rejects requests older than
 *      MAX_SKEW_SECONDS. A stolen secret still lets an attacker forge
 *      signals, but the *envelope* userId is now bound to the signature
 *      — the receiver can trust it rather than the body's userId. That
 *      lets us reject signals where header-userId ≠ body-userId (spoof
 *      attempt) and lets the receiver's business logic prefer the
 *      verified header value.
 *
 * Headers:
 *   Authorization:   Bearer <INTERNAL_AGENT_SECRET>   (legacy, still checked)
 *   X-Cv-Signature:  <hex(hmac-sha256)>
 *   X-Cv-Timestamp:  <unix seconds>
 *   X-Cv-User:       <userId or "system">
 *
 * Timestamp is required (rejects replays past MAX_SKEW_SECONDS). Body-hash
 * is over the *raw* request bytes so serializer whitespace doesn't matter.
 */

import { createHmac, timingSafeEqual, createHash } from 'node:crypto';

const MAX_SKEW_SECONDS = 300; // 5 min — accommodates modest clock drift.

export const SIGNATURE_HEADER = 'x-cv-signature';
export const TIMESTAMP_HEADER = 'x-cv-timestamp';
export const USER_HEADER = 'x-cv-user';

function hashBody(bodyBytes: Uint8Array | Buffer | string): string {
  return createHash('sha256').update(bodyBytes).digest('hex');
}

function canonicalString(params: {
  method: string;
  path: string;
  timestamp: string;
  userId: string;
  bodyHash: string;
}): string {
  // Explicit order + \n delimiter. Same on both sides.
  return [
    params.method.toUpperCase(),
    params.path,
    params.timestamp,
    params.userId,
    params.bodyHash,
  ].join('\n');
}

/**
 * Compute headers to attach to an outbound ingest POST. Returns the
 * signed headers plus the exact body bytes to send (so the sender can't
 * accidentally serialize twice with different whitespace).
 */
export function signIngestRequest(input: {
  secret: string;
  method: string;
  path: string; // e.g. "/api/ingest/usage" — no query string
  userId: string;
  body: unknown;
  now?: number; // epoch seconds; test seam
}): { headers: Record<string, string>; body: string } {
  const timestamp = String(input.now ?? Math.floor(Date.now() / 1000));
  const bodyString = JSON.stringify(input.body);
  const bodyHash = hashBody(bodyString);
  const canonical = canonicalString({
    method: input.method,
    path: input.path,
    timestamp,
    userId: input.userId,
    bodyHash,
  });
  const signature = createHmac('sha256', input.secret).update(canonical).digest('hex');
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.secret}`,
      [SIGNATURE_HEADER]: signature,
      [TIMESTAMP_HEADER]: timestamp,
      [USER_HEADER]: input.userId,
    },
    body: bodyString,
  };
}

export type VerifyResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

/**
 * Verify a signed inbound ingest request. `rawBody` MUST be the exact
 * bytes the sender signed — read the body once as text, hash it, then
 * JSON.parse the same string separately for schema validation.
 */
export function verifyIngestRequest(input: {
  secret: string;
  method: string;
  path: string;
  headers: {
    get(name: string): string | null;
  };
  rawBody: string;
  now?: number;
}): VerifyResult {
  const sig = input.headers.get(SIGNATURE_HEADER);
  const ts = input.headers.get(TIMESTAMP_HEADER);
  const userId = input.headers.get(USER_HEADER);
  if (!sig || !ts || !userId) {
    return { ok: false, status: 401, error: 'Missing signature headers' };
  }
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, status: 401, error: 'Invalid timestamp' };
  }
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > MAX_SKEW_SECONDS) {
    return { ok: false, status: 401, error: 'Timestamp outside allowed skew' };
  }
  const bodyHash = hashBody(input.rawBody);
  const canonical = canonicalString({
    method: input.method,
    path: input.path,
    timestamp: ts,
    userId,
    bodyHash,
  });
  const expected = createHmac('sha256', input.secret).update(canonical).digest('hex');

  // Constant-time compare on same-length buffers to avoid a timing oracle.
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) {
    return { ok: false, status: 401, error: 'Bad signature' };
  }
  if (!timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, status: 401, error: 'Bad signature' };
  }
  return { ok: true, userId };
}
