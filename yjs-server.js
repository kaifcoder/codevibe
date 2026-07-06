#!/usr/bin/env node

/**
 * Hocuspocus WebSocket Server for collaborative editing
 * Run this server to enable real-time collaboration with Yjs
 *
 * Usage: node yjs-server.js [port]
 * Default port: 1234
 *
 * Auth model (see onAuthenticate below):
 *   - `internal:<INTERNAL_AGENT_SECRET>` — trusted server-to-server writer
 *     (used by src/lib/server-yjs-writer.ts on the agent side).
 *   - `share:<sessionId>:<shareToken>` — unauthenticated collaborator on a
 *     public session. Grants access only if the sessionId in the token
 *     matches the room's sessionId AND the session is `isPublic` in DB.
 *   - Anything else — treated as a Clerk session JWT. Verified with
 *     @clerk/backend, then checked against the room's session owner.
 *
 * Env vars:
 *   PORT / YJS_PORT       (default 1234)
 *   DATABASE_URL          (required — session ownership lookups)
 *   CLERK_SECRET_KEY      (required — JWT verification)
 *   INTERNAL_AGENT_SECRET (required — trusted writer bypass)
 *   YJS_MAX_PAYLOAD_MB    (optional, default 4 — down from 100)
 *   YJS_MAX_DOC_BYTES     (optional, default 5_000_000 — cap per doc)
 */

import { Server } from '@hocuspocus/server';
import { verifyToken } from '@clerk/backend';
import * as Y from 'yjs';
import pg from 'pg';

const port = process.env.PORT || process.env.YJS_PORT || process.argv[2] || 1234;

// Cap payload size hard. The previous 100MB ceiling let a single client OOM
// the WS server; typical Monaco updates are <10KB, so 4MB is generous.
const MAX_PAYLOAD_BYTES = Number(process.env.YJS_MAX_PAYLOAD_MB ?? '4') * 1024 * 1024;
// Per-doc byte cap — reject onChange results that would push us past this.
// Y.encodeStateAsUpdate is bytes-in-the-CRDT, so a runaway paste-in-a-loop
// tops out here rather than growing without bound.
const MAX_DOC_BYTES = Number(process.env.YJS_MAX_DOC_BYTES ?? '5000000');

// Minimal Postgres pool — Prisma isn't reachable from an ESM script without
// generating the client, and Hocuspocus wants a plain node process. One
// SELECT per authenticate() call keyed on the covered @@index([id]).
const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 })
  : null;

if (!pool) {
  console.warn(
    '[Hocuspocus] DATABASE_URL missing — session-ownership checks will fail-closed. ' +
      'Set DATABASE_URL to the same connection string Next.js uses.',
  );
}

async function loadSession(sessionId) {
  if (!pool) return null;
  try {
    const res = await pool.query(
      'SELECT "userId", "isPublic", "shareToken" FROM "Session" WHERE "id" = $1',
      [sessionId],
    );
    return res.rows[0] ?? null;
  } catch (err) {
    console.error('[Hocuspocus] session lookup failed:', err.message);
    return null;
  }
}

// Parse a Yjs room name into (sessionId, subKey). Rooms are
// "${sessionId}-${filePath}" or "${sessionId}-__session". sessionId is a
// UUID (cuid or crypto.randomUUID). We split on the FIRST hyphen after a
// plausible sessionId — greedy split fails on file paths that contain
// hyphens.
function parseRoom(name) {
  // Accept anything up to the first '-' that follows a 20+ char prefix
  // (UUIDs are 36 chars; cuids are 25+). Below that we bail out.
  const idx = name.indexOf('-');
  if (idx < 20) return { sessionId: null, subKey: null };
  return { sessionId: name.slice(0, idx), subKey: name.slice(idx + 1) };
}

async function verifyClerkJwt(token) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY missing');
  const claims = await verifyToken(token, { secretKey });
  if (!claims.sub) throw new Error('Token has no subject');
  return claims.sub;
}

// In-memory persistence. Hocuspocus unloads docs after a short debounce when
// no clients are connected — without an onLoadDocument that returns prior
// state, content is lost between the agent's write (writeToYjsRoom connects,
// transacts, disconnects) and the moment the user opens that file in their
// editor. We hold the encoded Y state per room so unloaded docs come back
// with their content. Process restart still wipes — swap for SQLite or
// Postgres extension when durability is needed.
const docStore = new Map();

const server = new Server({
  port: Number(port),
  quiet: false,
  maxPayload: MAX_PAYLOAD_BYTES,

  async onLoadDocument({ documentName, document }) {
    const stored = docStore.get(documentName);
    if (stored) {
      Y.applyUpdate(document, stored);
      console.log(`[Hocuspocus] Restored ${stored.byteLength} bytes for ${documentName}`);
    } else {
      console.log(`[Hocuspocus] Document loaded (empty): ${documentName}`);
    }
    return document;
  },

  async onStoreDocument({ documentName, document }) {
    const bytes = Y.encodeStateAsUpdate(document);
    if (bytes.byteLength > MAX_DOC_BYTES) {
      // Refuse to persist a doc that would push us past the cap. The delta
      // that got us here is still in the running Y.Doc, but we won't save
      // it — the next unload cycle drops the ballooning content. Log
      // loudly so this shows up in monitoring.
      console.warn(
        `[Hocuspocus] Doc ${documentName} exceeds ${MAX_DOC_BYTES} bytes (${bytes.byteLength}) — refusing to persist.`,
      );
      return;
    }
    docStore.set(documentName, bytes);
    console.log(`[Hocuspocus] Document stored: ${documentName} (${bytes.byteLength} bytes)`);
  },

  async onAuthenticate({ documentName, token }) {
    if (!token) {
      throw new Error('missing_token');
    }

    // 1. Server-to-server: the agent's Yjs writer uses this scheme so it
    //    can push codePatch results into rooms without owning a Clerk JWT.
    const internalSecret = process.env.INTERNAL_AGENT_SECRET;
    if (internalSecret && token === `internal:${internalSecret}`) {
      return { user: { id: '__internal__', name: 'Internal Writer' } };
    }

    const { sessionId } = parseRoom(documentName);
    if (!sessionId) {
      throw new Error('bad_room_name');
    }

    // 2. Share-token collaborators (may be signed out entirely). Format:
    //    `share:<sessionId>:<shareToken>`. Sanity-checks the shareToken
    //    against Postgres AND requires isPublic.
    if (token.startsWith('share:')) {
      const [, tokSessionId, tokShareToken] = token.split(':');
      if (tokSessionId !== sessionId) throw new Error('room_session_mismatch');
      const session = await loadSession(sessionId);
      if (!session) throw new Error('session_not_found');
      if (!session.isPublic) throw new Error('session_private');
      if (session.shareToken !== tokShareToken) throw new Error('bad_share_token');
      return { user: { id: `share:${tokShareToken.slice(0, 8)}`, name: 'Collaborator' } };
    }

    // 3. Clerk JWT — signed-in owner (or, when we later add ACLs, an
    //    explicit collaborator). Verify the token, load the session,
    //    require ownership.
    let userId;
    try {
      userId = await verifyClerkJwt(token);
    } catch (err) {
      throw new Error(`bad_jwt: ${err.message}`);
    }
    const session = await loadSession(sessionId);
    if (!session) throw new Error('session_not_found');
    if (session.userId !== userId) {
      // Not the owner — fall back to public + share-token would have been
      // caught above. Deny.
      throw new Error('not_session_owner');
    }
    return { user: { id: userId, name: 'Owner' } };
  },

  // Plain HTTP /health endpoint for Render health checks + the homepage
  // warmup ping. Hocuspocus' onRequest contract: throw a FALSY value to
  // short-circuit the default "Welcome to Hocuspocus!" response. Throwing
  // a truthy value (Error or non-empty string) rethrows and crashes the
  // process under Node 20's strict unhandled-rejection mode.
  // See: node_modules/@hocuspocus/server/src/Server.ts:118-135
  async onRequest({ request, response }) {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, docs: docStore.size }));
      throw '';
    }
  },

  onConnect: (data) => {
    console.log(`[Hocuspocus] ✅ Client connected to document: ${data.documentName}`);
  },

  onDisconnect: (data) => {
    console.log(`[Hocuspocus] Client disconnected from: ${data.documentName}`);
  },

  onChange: (data) => {
    console.log(`[Hocuspocus] Document changed: ${data.documentName}`);
  },

  onStateless: (data) => {
    console.log(`[Hocuspocus] Received stateless message for: ${data.documentName}`);
  },
});

await server.listen();

console.log(`🚀 Hocuspocus server running on ws://localhost:${port}`);
console.log('   Ready for collaborative editing!');
console.log('   Press Ctrl+C to stop');

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Hocuspocus] Shutting down server...');
  await server.destroy();
  if (pool) await pool.end();
  console.log('[Hocuspocus] Server closed');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Hocuspocus] Shutting down server...');
  await server.destroy();
  if (pool) await pool.end();
  console.log('[Hocuspocus] Server closed');
  process.exit(0);
});
