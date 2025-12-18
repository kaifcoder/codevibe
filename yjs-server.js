#!/usr/bin/env node

/**
 * Hocuspocus WebSocket Server for collaborative editing
 * Run this server to enable real-time collaboration with Yjs
 * 
 * Usage: node yjs-server.js [port]
 * Default port: 1234
 */

import { Server } from '@hocuspocus/server';

const port = process.env.YJS_PORT || process.argv[2] || 1234;

const server = new Server({
  port: Number(port),
  
  // Logging
  quiet: false,
  
  // Increase max payload size to 100MB to handle large documents
  maxPayload: 100 * 1024 * 1024,
  
  // Disable authentication - allow all connections
  async onAuthenticate() {
    return {
      user: {
        id: 'anonymous',
        name: 'Anonymous User',
      },
    };
  },
  
  // Enable connection tracking
  onConnect: (data) => {
    console.log(`[Hocuspocus] ✅ Client connected to document: ${data.documentName}`);
  },

  onDisconnect: (data) => {
    console.log(`[Hocuspocus] Client disconnected from: ${data.documentName}`);
  },

  onLoadDocument: (data) => {
    console.log(`[Hocuspocus] Document loaded: ${data.documentName}`);
  },

  onStoreDocument: (data) => {
    console.log(`[Hocuspocus] Document stored: ${data.documentName}`);
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
