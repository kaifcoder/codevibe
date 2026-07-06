/**
 * Initialize Yjs collaboration infrastructure
 *
 * Single source of truth for Y.Doc and HocuspocusProvider instances.
 * No Monaco-specific code - just CRDT and WebSocket setup.
 */

import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

// Store active providers to prevent multiple connections per room
const providers = new Map<string, HocuspocusProvider>();
const documents = new Map<string, Y.Doc>();

/** How to authenticate this Yjs connection with the server.
 *  - `clerk`: use the Clerk session JWT (call getToken()). Signed-in owners.
 *  - `share`: user isn't signed in but has a valid ?token= share link.
 *    We stuff both sessionId and shareToken into a `share:<sid>:<tok>`
 *    token, which the server matches against Postgres. */
export type CollaborationAuth =
  | { kind: 'clerk'; getToken: () => Promise<string | null> }
  | { kind: 'share'; sessionId: string; shareToken: string };

export interface CollaborationConfig {
  roomId: string;
  username?: string;
  userId?: string;
  wsUrl?: string;
  auth?: CollaborationAuth;
}

export interface CollaborationSession {
  ydoc: Y.Doc;
  yText: Y.Text;
  provider: HocuspocusProvider;
  disconnect: () => void;
}

/**
 * Get the WebSocket URL based on current hostname.
 *
 * Resolution order:
 *   1. `NEXT_PUBLIC_WS_URL` env — the correct production knob. Set this to
 *      the public Yjs endpoint (e.g. `wss://yjs.example.com` or a same-origin
 *      `wss://app.example.com/yjs` when the server is proxied behind the
 *      main domain).
 *   2. Local dev on `localhost`/`127.0.0.1` — hit `ws://localhost:1234`
 *      directly (`npm run yjs`).
 *   3. Same-origin fallback with NO port. In production, Yjs is expected to
 *      be reachable on the same host/port as the app (typically via reverse
 *      proxy on `/yjs` or `/collab`). Appending `:1234` on a production
 *      hostname always failed because that port isn't publicly exposed —
 *      that was the "WebSocket closed before connection established" bug.
 */
function getWebSocketUrl(): string {
  // SSR — never used to actually connect, but keeps typing happy.
  if (globalThis.window === undefined) {
    return process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:1234';
  }

  // 1. Explicit override always wins.
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit && explicit.trim().length > 0) {
    console.log('[Collaboration] Using NEXT_PUBLIC_WS_URL:', explicit);
    return explicit;
  }

  const { hostname, protocol } = globalThis.window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';

  // 2. Local dev: hit the standalone `npm run yjs` server on :1234.
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const url = `${wsProtocol}//${hostname}:1234`;
    console.log('[Collaboration] Local dev WS URL:', url);
    return url;
  }

  // 3. Production fallback — same origin, no port. Assumes a reverse proxy
  // routes the WebSocket handshake to the Yjs process (Hocuspocus responds
  // to any path, so `/` is fine). If your prod topology needs a different
  // host/port, set NEXT_PUBLIC_WS_URL and it'll take precedence above.
  const url = `${wsProtocol}//${globalThis.window.location.host}`;
  console.warn(
    '[Collaboration] NEXT_PUBLIC_WS_URL is unset in production. ' +
      'Falling back to same-origin:', url,
  );
  return url;
}

/**
 * Generate random color for user presence
 */
function generateUserColor(): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Initialize or retrieve existing collaboration session
 * 
 * Returns: Y.Doc, Y.Text, HocuspocusProvider with awareness
 */
export function initCollaboration(config: CollaborationConfig): CollaborationSession {
  const { roomId, username = 'Anonymous', wsUrl, auth } = config;
  const finalWsUrl = wsUrl || getWebSocketUrl();
  
  console.log('[Collaboration] Initializing room:', roomId);
  
  // Reuse existing provider if available
  if (providers.has(roomId)) {
    const provider = providers.get(roomId)!;
    const ydoc = documents.get(roomId)!;
    const yText = ydoc.getText('monaco');

    console.log('[Collaboration] Reusing existing session for room:', roomId);

    // Update awareness state — but only if the user info actually changed.
    // Blindly re-setting on every join clobbers y-monaco's `cursor` /
    // `selection` state on the same awareness map, which the binding uses
    // internally to render remote carets. Overwriting them makes remote
    // cursors visually freeze until the next selection event.
    const existingUser = provider.awareness?.getLocalState()?.user as
      | { name?: string; color?: string }
      | undefined;
    if (!existingUser || existingUser.name !== username) {
      const color = existingUser?.color ?? generateUserColor();
      provider.awareness?.setLocalStateField('user', {
        name: username,
        color,
      });
    }

    return {
      ydoc,
      yText,
      provider,
      disconnect: () => disconnectRoom(roomId),
    };
  }

  // Create new Y.Doc
  const ydoc = new Y.Doc();
  documents.set(roomId, ydoc);

  // Get Y.Text instance for Monaco binding
  const yText = ydoc.getText('monaco');

  // Pick a color once — stable across reconnects. Reused inside onConnect
  // when awareness state was lost so we don't visually flicker to a
  // different color on every disconnect.
  const initialColor = generateUserColor();

  // Create Hocuspocus provider
  const provider = new HocuspocusProvider({
    url: finalWsUrl,
    name: roomId,
    document: ydoc,

    // The Yjs server verifies this token in onAuthenticate. It's either
    // a Clerk JWT (owner path), a `share:<sid>:<tok>` string (public
    // session collaborator), or nothing (rejected). We evaluate it lazily
    // per (re)connect so a Clerk token refresh mid-session is picked up
    // without tearing down the provider.
    token: auth
      ? async () => {
          if (auth.kind === 'clerk') {
            try {
              const t = await auth.getToken();
              return t ?? '';
            } catch (err) {
              console.warn('[Collaboration] getToken() failed:', err);
              return '';
            }
          }
          return `share:${auth.sessionId}:${auth.shareToken}`;
        }
      : undefined,

    onConnect: () => {
      console.log(`[Collaboration] ✅ Connected to room: ${roomId}`);
      // Reapply awareness state on connect ONLY if it's missing — otherwise
      // we clobber the y-monaco selection state that lives on the same
      // awareness map and remote cursors visually freeze.
      const state = provider.awareness?.getLocalState()?.user;
      if (!state) {
        provider.awareness?.setLocalStateField('user', {
          name: username,
          color: initialColor,
        });
      }
    },

    onDisconnect: (data) => {
      console.log(`[Collaboration] ⚠️ Disconnected from room: ${roomId}`, data);
    },

    onSynced: () => {
      console.log(`[Collaboration] 🔄 Room ${roomId} synced`);
    },

    onStatus: (event) => {
      if (event.status === 'connected' || event.status === 'disconnected') {
        console.log(`[Collaboration] 📡 Status: ${event.status}`);
      }
      // Do NOT re-set awareness here — status flips fire often and each
      // rewrite of `user` in the awareness map cancels out the local
      // `cursor` / `selection` updates y-monaco is trying to publish. Set
      // once at construction (below) and again only if we detect state
      // loss in onConnect.
    },
    
    onAuthenticationFailed: (error) => {
      console.error(`[Collaboration] 🔒 Authentication failed:`, error);
    },
  });

  // Set initial awareness state once. Both onConnect (if state was lost)
  // and the reuse-existing-session path reference `initialColor` above so
  // the color is stable across reconnects — no more color flicker for
  // other peers' presence chips.
  provider.awareness?.setLocalStateField('user', {
    name: username,
    color: initialColor,
  });

  console.log('[Collaboration] Set awareness for user:', username, 'with color:', initialColor);

  // Store provider
  providers.set(roomId, provider);

  return {
    ydoc,
    yText,
    provider,
    disconnect: () => disconnectRoom(roomId),
  };
}

/**
 * Disconnect and cleanup a collaboration room
 */
function disconnectRoom(roomId: string): void {
  const provider = providers.get(roomId);
  if (provider) {
    provider.disconnect();
    provider.destroy();
    providers.delete(roomId);
  }

  const doc = documents.get(roomId);
  if (doc) {
    doc.destroy();
    documents.delete(roomId);
  }

  console.log(`[Collaboration] Cleaned up room: ${roomId}`);
}
