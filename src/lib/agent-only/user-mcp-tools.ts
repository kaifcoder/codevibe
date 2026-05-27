import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { createHttpOAuthProvider, fetchBearerToken } from './http-oauth-provider';

// Serialized server config the frontend sends to the agent via
// config.configurable.userMcpServers. No secrets — agent fetches them from
// Next.js via the internal credentials route (and caches in-memory per run).
export interface UserMcpServerConfig {
  id: string;
  name: string;
  url: string;
  authType: 'bearer' | 'none' | 'oauth';
}

interface BuildOptions {
  userId: string;
  appUrl: string;
  internalSecret: string;
}

interface CachedClient {
  client: MultiServerMCPClient;
  signature: string;
  expiresAt: number;
}

const cache = new Map<string, CachedClient>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function configsSignature(configs: UserMcpServerConfig[]): string {
  return configs
    .map((c) => `${c.id}:${c.authType}:${c.url}`)
    .sort()
    .join('|');
}

export async function buildUserMcpToolsFromConfigs(
  configs: UserMcpServerConfig[],
  opts: BuildOptions,
) {
  if (configs.length === 0) return [];

  const signature = `${opts.userId}|${configsSignature(configs)}`;
  const now = Date.now();
  const cached = cache.get(signature);
  if (cached && cached.expiresAt > now) {
    try {
      return await cached.client.getTools();
    } catch (err) {
      console.error('[buildUserMcpTools] cached client failed, rebuilding:', err);
      cache.delete(signature);
    }
  }
  if (cached) {
    cached.client.close().catch(() => {});
    cache.delete(signature);
  }

  const mcpServers: Record<string, {
    transport: 'http';
    url: string;
    headers?: Record<string, string>;
    authProvider?: ReturnType<typeof createHttpOAuthProvider>;
    automaticSSEFallback: boolean;
  }> = {};

  for (const cfg of configs) {
    const headers: Record<string, string> = {};
    if (cfg.authType === 'bearer') {
      const token = await fetchBearerToken({
        serverId: cfg.id,
        userId: opts.userId,
        appUrl: opts.appUrl,
        internalSecret: opts.internalSecret,
      });
      if (!token) {
        console.warn(`[buildUserMcpTools] no bearer token for ${cfg.id} (${cfg.name}) — skipping`);
        continue;
      }
      headers.Authorization = `Bearer ${token}`;
    }

    mcpServers[cfg.id] = {
      transport: 'http',
      url: cfg.url,
      headers: Object.keys(headers).length ? headers : undefined,
      authProvider:
        cfg.authType === 'oauth'
          ? createHttpOAuthProvider({
              serverId: cfg.id,
              userId: opts.userId,
              appUrl: opts.appUrl,
              internalSecret: opts.internalSecret,
              redirectUrl: `${opts.appUrl}/api/mcp/servers/${cfg.id}/callback`,
            })
          : undefined,
      automaticSSEFallback: false,
    };
  }

  const client = new MultiServerMCPClient({
    throwOnLoadError: false,
    prefixToolNameWithServerName: false,
    additionalToolNamePrefix: '',
    useStandardContentBlocks: true,
    mcpServers,
  });

  const tools = await client.getTools().catch((err) => {
    console.error('[buildUserMcpTools] getTools failed:', err);
    return [];
  });

  const idToName = new Map(configs.map((c) => [c.id, c.name.replace(/[^a-zA-Z0-9]+/g, '_')]));
  const prefixed = tools.map((t) => {
    const meta = (t as unknown as { metadata?: { serverName?: string } }).metadata;
    const serverName = meta?.serverName;
    const friendly = serverName ? idToName.get(serverName) : undefined;
    if (friendly && !t.name.startsWith(`${friendly}__`)) {
      return Object.assign(Object.create(Object.getPrototypeOf(t)), t, { name: `${friendly}__${t.name}` });
    }
    return t;
  });

  // Don't cache an empty result. If the user just connected an OAuth server
  // mid-conversation, a cached "no tools" client would block them for 5min.
  // Rebuilding next turn re-fetches credentials from Next.js and picks up
  // newly-stored tokens.
  if (prefixed.length > 0) {
    cache.set(signature, { client, signature, expiresAt: now + CACHE_TTL_MS });
  } else {
    client.close().catch(() => {});
  }
  return prefixed;
}
