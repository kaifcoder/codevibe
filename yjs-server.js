#!/usr/bin/env node

/**
 * Hocuspocus WebSocket Server for collaborative editing
 * Run this server to enable real-time collaboration with Yjs
 *
 * Usage: node yjs-server.js [port]
 * Default port: 1234
 */

import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';

const port = process.env.PORT || process.env.YJS_PORT || process.argv[2] || 1234;

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

  // Logging
  quiet: false,

  // Increase max payload size to 100MB to handle large documents
  maxPayload: 100 * 1024 * 1024,

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
    docStore.set(documentName, Y.encodeStateAsUpdate(document));
    console.log(`[Hocuspocus] Document stored: ${documentName} (${docStore.get(documentName).byteLength} bytes)`);
  },

  async onAuthenticate() {
    return {
      user: { id: 'anonymous', name: 'Anonymous User' },
    };
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
  console.log('[Hocuspocus] Server closed');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Hocuspocus] Shutting down server...');
  await server.destroy();
  console.log('[Hocuspocus] Server closed');
  process.exit(0);
});
