import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { prisma } from '@/server/db';
import { decrypt, encrypt } from './encryption';

// In-memory map of authorization URLs awaiting callback. Keyed by serverId.
// The MCP SDK's `auth()` calls `redirectToAuthorization(url)` on the provider
// during the REDIRECT phase; our /auth route reads the URL out and 302s the
// browser there. Since the provider instance is short-lived (created per
// request), we stash the URL on this module-level map so the route handler
// can fetch it after `auth()` returns.
const pendingAuthorizationUrls = new Map<string, URL>();

export function consumePendingAuthorizationUrl(serverId: string): URL | undefined {
  const url = pendingAuthorizationUrls.get(serverId);
  pendingAuthorizationUrls.delete(serverId);
  return url;
}

interface FactoryOptions {
  serverId: string;
  redirectUrl: string;
  clientName?: string;
  scope?: string;
}

export function createDbOAuthProvider(opts: FactoryOptions): OAuthClientProvider {
  const { serverId, redirectUrl, clientName = 'CodeVibe Agent', scope = 'mcp openid' } = opts;

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
      const row = await prisma.mcpOAuthCredential.findUnique({ where: { serverId } });
      if (!row?.encryptedClientInfo) return undefined;
      try {
        return JSON.parse(decrypt(row.encryptedClientInfo)) as OAuthClientInformationFull;
      } catch (err) {
        console.error(`[mcp-oauth] failed to decrypt clientInfo for ${serverId}:`, err);
        return undefined;
      }
    },

    async saveClientInformation(info: OAuthClientInformationFull) {
      const enc = encrypt(JSON.stringify(info));
      await prisma.mcpOAuthCredential.upsert({
        where: { serverId },
        create: { serverId, encryptedClientInfo: enc },
        update: { encryptedClientInfo: enc },
      });
    },

    async tokens() {
      const row = await prisma.mcpOAuthCredential.findUnique({ where: { serverId } });
      if (!row?.encryptedTokens) return undefined;
      try {
        return JSON.parse(decrypt(row.encryptedTokens)) as OAuthTokens;
      } catch (err) {
        console.error(`[mcp-oauth] failed to decrypt tokens for ${serverId}:`, err);
        return undefined;
      }
    },

    async saveTokens(tokens: OAuthTokens) {
      const enc = encrypt(JSON.stringify(tokens));
      await prisma.mcpOAuthCredential.upsert({
        where: { serverId },
        create: { serverId, encryptedTokens: enc },
        update: { encryptedTokens: enc },
      });
    },

    async saveCodeVerifier(verifier: string) {
      // Verifier is short-lived (auth_code → token exchange) but must round-trip
      // across two HTTP requests (auth route → callback route), so we stash it
      // in the row alongside the eventual tokens.
      await prisma.mcpOAuthCredential.upsert({
        where: { serverId },
        create: { serverId, codeVerifier: verifier },
        update: { codeVerifier: verifier },
      });
    },

    async codeVerifier() {
      const row = await prisma.mcpOAuthCredential.findUnique({ where: { serverId } });
      if (!row?.codeVerifier) {
        throw new Error('No PKCE code verifier stored — start the auth flow first.');
      }
      return row.codeVerifier;
    },

    redirectToAuthorization(url: URL) {
      pendingAuthorizationUrls.set(serverId, url);
    },

    async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
      const update: { encryptedTokens?: null; encryptedClientInfo?: null; codeVerifier?: null } = {};
      if (scope === 'all' || scope === 'tokens') update.encryptedTokens = null;
      if (scope === 'all' || scope === 'client') update.encryptedClientInfo = null;
      if (scope === 'all' || scope === 'verifier') update.codeVerifier = null;
      // 'discovery' has no persisted state for us to clear.
      if (Object.keys(update).length === 0) return;
      await prisma.mcpOAuthCredential
        .update({ where: { serverId }, data: update })
        .catch(() => {});
    },
  };
}

export async function isServerAuthorized(serverId: string): Promise<boolean> {
  const row = await prisma.mcpOAuthCredential.findUnique({
    where: { serverId },
    select: { encryptedTokens: true },
  });
  if (!row?.encryptedTokens) return false;
  try {
    const tokens = JSON.parse(decrypt(row.encryptedTokens)) as OAuthTokens;
    return Boolean(tokens.access_token);
  } catch {
    return false;
  }
}

export async function deleteOAuthCredential(serverId: string) {
  await prisma.mcpOAuthCredential.delete({ where: { serverId } }).catch(() => {});
}
