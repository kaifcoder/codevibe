import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { prisma } from '@/server/db';
import { decrypt, encrypt } from './encryption';
import {
  createDbOAuthProvider,
  deleteOAuthCredential,
  isServerAuthorized,
} from './mcp-oauth-provider';

export type AuthType = 'bearer' | 'none' | 'oauth';

export interface UserMcpServerInput {
  name: string;
  url: string;
  authType: AuthType;
  bearerToken?: string;
}

export interface UserMcpServer {
  id: string;
  userId: string;
  name: string;
  url: string;
  authType: AuthType;
  hasToken: boolean;
  oauthAuthorized?: boolean;
  createdAt: Date;
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_\- ]{0,40}$/;

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

// Servers whose IdP only accepts loopback redirect URIs (RFC 8252) because
// their host allowlist won't include our prod URL. The user adds these via
// Settings → Apps; OAuth is then completed by pasting the loopback URL back.
const LOOPBACK_PORT = 33418;
export const LOOPBACK_REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}/callback`;
const LOOPBACK_HOST_URLS = new Set<string>([
  '',
]);

export function isLoopbackServer(url: string): boolean {
  return LOOPBACK_HOST_URLS.has(url);
}

export function oauthRedirectUrl(_serverId: string, serverUrl?: string): string {
  if (serverUrl && isLoopbackServer(serverUrl)) {
    return LOOPBACK_REDIRECT_URI;
  }
  // Single shared callback path so we only need to allowlist ONE redirect URI
  // per environment in upstream OAuth servers (upstream IdP rejects unregistered
  // hosts/paths). The serverId travels in the OAuth `state` param instead.
  return `${appUrl()}/api/mcp/oauth/callback`;
}

function toPublic(row: {
  id: string;
  userId: string;
  name: string;
  url: string;
  authType: string;
  encryptedBearerToken: string | null;
  createdAt: Date;
}, oauthAuthorized?: boolean): UserMcpServer {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    url: row.url,
    authType: row.authType as AuthType,
    hasToken: Boolean(row.encryptedBearerToken),
    oauthAuthorized,
    createdAt: row.createdAt,
  };
}

export function validateInput(input: UserMcpServerInput): string | null {
  if (!input.name || !NAME_RE.test(input.name)) {
    return 'Name must be alphanumeric with spaces/dashes/underscores, max 40 chars.';
  }
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return 'URL is not valid.';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'URL must be http(s).';
  }
  if (input.authType !== 'bearer' && input.authType !== 'none' && input.authType !== 'oauth') {
    return 'Unsupported auth type.';
  }
  if (input.authType === 'bearer' && !input.bearerToken) {
    return 'Bearer token is required when auth type is "bearer".';
  }
  return null;
}

export async function listUserServers(userId: string): Promise<UserMcpServer[]> {
  const rows = await prisma.mcpServerConfig.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
  // For OAuth rows, query whether tokens currently exist (cheap, single read).
  return Promise.all(
    rows.map(async (row) => {
      const oauthAuthorized =
        row.authType === 'oauth' ? await isServerAuthorized(row.id) : undefined;
      return toPublic(row, oauthAuthorized);
    }),
  );
}

export async function getUserServer(userId: string, id: string) {
  const row = await prisma.mcpServerConfig.findFirst({ where: { id, userId } });
  if (!row) return null;
  return row;
}

export async function createUserServer(userId: string, input: UserMcpServerInput) {
  const row = await prisma.mcpServerConfig.create({
    data: {
      userId,
      name: input.name,
      url: input.url,
      authType: input.authType,
      encryptedBearerToken:
        input.authType === 'bearer' && input.bearerToken
          ? encrypt(input.bearerToken)
          : null,
    },
  });
  return toPublic(row);
}

export async function deleteUserServer(userId: string, id: string) {
  // Cascade deletes the McpOAuthCredential row by FK; leave a defensive call
  // anyway in case the FK is bypassed.
  await deleteOAuthCredential(id);
  const res = await prisma.mcpServerConfig.deleteMany({ where: { id, userId } });
  return res.count > 0;
}

export function decryptBearer(row: { authType: string; encryptedBearerToken: string | null }): string | undefined {
  if (row.authType !== 'bearer' || !row.encryptedBearerToken) return undefined;
  return decrypt(row.encryptedBearerToken);
}

// Open a one-shot connection, list tools, close. Used by the "test" endpoint
// before saving so we surface obvious failures to the user up front.
// For OAuth servers we attach the saved provider so the transport auto-loads
// the access token (if it exists).
export async function probeMcpServer(
  url: string,
  authType: AuthType,
  bearerToken?: string,
  serverId?: string,
): Promise<{ ok: true; toolCount: number; toolNames: string[] } | { ok: false; error: string }> {
  const client = new Client({ name: 'codevibe-mcp-probe', version: '1.0.0' });
  const headers: Record<string, string> = {};
  if (authType === 'bearer' && bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  const transport =
    authType === 'oauth' && serverId
      ? new StreamableHTTPClientTransport(new URL(url), {
          authProvider: createDbOAuthProvider({
            serverId,
            redirectUrl: oauthRedirectUrl(serverId, url),
          }),
        })
      : new StreamableHTTPClientTransport(new URL(url), {
          requestInit: Object.keys(headers).length ? { headers } : undefined,
        });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    const tools = result?.tools ?? [];
    await client.close().catch(() => {});
    return { ok: true, toolCount: tools.length, toolNames: tools.map((t) => t.name) };
  } catch (err) {
    await client.close().catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

interface CachedClient {
  client: MultiServerMCPClient;
  signature: string;
  expiresAt: number;
}
const clientCache = new Map<string, CachedClient>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function rowsSignature(rows: Array<{ id: string; updatedAt: Date }>): string {
  return rows
    .map((r) => `${r.id}:${r.updatedAt.getTime()}`)
    .sort()
    .join('|');
}

export async function getUserMcpTools(userId: string) {
  const rows = await prisma.mcpServerConfig.findMany({ where: { userId } });
  if (rows.length === 0) return [];

  // Filter OAuth rows that aren't yet authorized — including them would have
  // the transport throw 401 the moment the agent tries to listTools.
  const usableRows: typeof rows = [];
  for (const row of rows) {
    if (row.authType === 'oauth') {
      const ok = await isServerAuthorized(row.id);
      if (!ok) continue;
    }
    usableRows.push(row);
  }
  if (usableRows.length === 0) return [];

  const signature = rowsSignature(usableRows);
  const cached = clientCache.get(userId);
  const now = Date.now();
  if (cached && cached.signature === signature && cached.expiresAt > now) {
    try {
      return await cached.client.getTools();
    } catch (err) {
      console.error('[mcp-user-store] cached client getTools failed, rebuilding:', err);
      clientCache.delete(userId);
    }
  }

  if (cached) {
    cached.client.close().catch(() => {});
    clientCache.delete(userId);
  }

  const mcpServers: Record<string, {
    transport: 'http';
    url: string;
    headers?: Record<string, string>;
    authProvider?: ReturnType<typeof createDbOAuthProvider>;
    automaticSSEFallback: boolean;
  }> = {};

  for (const row of usableRows) {
    const headers: Record<string, string> = {};
    if (row.authType === 'bearer' && row.encryptedBearerToken) {
      try {
        headers.Authorization = `Bearer ${decrypt(row.encryptedBearerToken)}`;
      } catch (err) {
        console.error(`[mcp-user-store] failed to decrypt token for ${row.id}:`, err);
        continue;
      }
    }
    mcpServers[row.id] = {
      transport: 'http',
      url: row.url,
      headers: Object.keys(headers).length ? headers : undefined,
      authProvider:
        row.authType === 'oauth'
          ? createDbOAuthProvider({
              serverId: row.id,
              redirectUrl: oauthRedirectUrl(row.id, row.url),
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
    console.error('[mcp-user-store] getTools failed:', err);
    return [];
  });

  const idToName = new Map(usableRows.map((r) => [r.id, r.name.replace(/[^a-zA-Z0-9]+/g, '_')]));
  const prefixed = tools.map((t) => {
    const meta = (t as unknown as { metadata?: { serverName?: string } }).metadata;
    const serverName = meta?.serverName;
    const friendly = serverName ? idToName.get(serverName) : undefined;
    if (friendly && !t.name.startsWith(`${friendly}__`)) {
      return Object.assign(Object.create(Object.getPrototypeOf(t)), t, { name: `${friendly}__${t.name}` });
    }
    return t;
  });

  clientCache.set(userId, {
    client,
    signature,
    expiresAt: now + CACHE_TTL_MS,
  });

  return prefixed;
}

export function invalidateUserMcpToolsCache(userId: string) {
  const cached = clientCache.get(userId);
  if (cached) {
    cached.client.close().catch(() => {});
    clientCache.delete(userId);
  }
}
