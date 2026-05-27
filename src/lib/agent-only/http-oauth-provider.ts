import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

// Agent-side OAuthClientProvider that backs onto Next.js HTTP routes instead
// of Prisma. Used inside the langgraph-api container, which doesn't have
// access to the app DB. All persistence is round-tripped to
// /api/mcp/internal/servers/:id/credentials, authenticated by
// INTERNAL_AGENT_SECRET.
//
// In-memory caches avoid hitting Next.js on every transport call. The MCP SDK
// calls tokens() and clientInformation() before every request; the cache is
// scoped to a single agent run (the provider object is recreated each run).

interface FactoryOptions {
  serverId: string;
  userId: string;
  appUrl: string;
  internalSecret: string;
  redirectUrl: string;
  clientName?: string;
  scope?: string;
}

export function createHttpOAuthProvider(opts: FactoryOptions): OAuthClientProvider {
  const {
    serverId,
    userId,
    appUrl,
    internalSecret,
    redirectUrl,
    clientName = 'CodeVibe Agent',
    scope = 'mcp openid',
  } = opts;

  const credentialsUrl = `${appUrl}/api/mcp/internal/servers/${serverId}/credentials`;
  const headers = { Authorization: `Bearer ${internalSecret}` };

  let cachedClientInfo: OAuthClientInformationFull | undefined;
  let cachedTokens: OAuthTokens | undefined;
  let cacheLoaded = false;

  async function loadCache() {
    if (cacheLoaded) return;
    try {
      const res = await fetch(`${credentialsUrl}?userId=${encodeURIComponent(userId)}`, {
        headers,
        cache: 'no-store',
      });
      if (!res.ok) {
        // Pull the body so we know WHY (auth misconfig, prisma error, etc).
        const body = await res.text().catch(() => '<no body>');
        console.error(
          `[http-oauth ${serverId}] read failed: ${res.status} body=${body.slice(0, 300)}`,
        );
        return;
      }
      const data = await res.json();
      cachedClientInfo = data?.oauth?.clientInfo ?? undefined;
      cachedTokens = data?.oauth?.tokens ?? undefined;
      // Only mark the cache populated if we actually got tokens. Otherwise
      // a connect that happens later (e.g. via the loopback flow) wouldn't
      // be picked up until the agent's MultiServerMCPClient cache (5min)
      // expires. Re-fetching is cheap (~10ms loopback to Next.js).
      if (cachedTokens) cacheLoaded = true;
    } catch (err) {
      console.error(`[http-oauth ${serverId}] read error:`, err);
    }
  }

  async function persist(kind: 'tokens' | 'clientInfo', value: unknown) {
    try {
      const res = await fetch(credentialsUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, kind, value }),
      });
      if (!res.ok) {
        console.error(`[http-oauth ${serverId}] persist ${kind} failed: ${res.status}`);
      }
    } catch (err) {
      console.error(`[http-oauth ${serverId}] persist ${kind} error:`, err);
    }
  }

  return {
    get redirectUrl() {
      return redirectUrl;
    },

    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: clientName,
        redirect_uris: [redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope,
      };
    },

    async clientInformation() {
      await loadCache();
      return cachedClientInfo;
    },

    async saveClientInformation(info: OAuthClientInformationFull) {
      cachedClientInfo = info;
      await persist('clientInfo', info);
    },

    async tokens() {
      await loadCache();
      return cachedTokens;
    },

    async saveTokens(tokens: OAuthTokens) {
      cachedTokens = tokens;
      await persist('tokens', tokens);
    },

    saveCodeVerifier() {
      throw new Error('Agent-side provider cannot start a new auth flow.');
    },

    codeVerifier(): string {
      throw new Error('Agent-side provider has no code verifier; auth flow runs in Next.js.');
    },

    redirectToAuthorization() {
      throw new Error('Agent-side provider cannot redirect; user must visit the auth URL via the UI.');
    },

    state() {
      return serverId;
    },
  };
}

// Synchronous bearer-token fetch via the same internal route. Cached by the
// caller for the life of an agent run.
export async function fetchBearerToken(opts: {
  serverId: string;
  userId: string;
  appUrl: string;
  internalSecret: string;
}): Promise<string | null> {
  const { serverId, userId, appUrl, internalSecret } = opts;
  try {
    const res = await fetch(
      `${appUrl}/api/mcp/internal/servers/${serverId}/credentials?userId=${encodeURIComponent(userId)}`,
      {
        headers: { Authorization: `Bearer ${internalSecret}` },
        cache: 'no-store',
      },
    );
    if (!res.ok) {
      console.error(`[http-oauth ${serverId}] bearer read failed: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return typeof data?.bearerToken === 'string' ? data.bearerToken : null;
  } catch (err) {
    console.error(`[http-oauth ${serverId}] bearer read error:`, err);
    return null;
  }
}
