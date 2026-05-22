#!/usr/bin/env tsx
/**
 * n8n reverse proxy (multi-tenant).
 *
 * Sits between codevibe's iframe and per-session e2b n8n sandbox URLs.
 * Solves the third-party cookie block: the iframe loads from this proxy's
 * origin, so n8n's Set-Cookie lands as first-party. Also auto-logs in
 * server-side so users never see n8n's signin screen.
 *
 * Routing model:
 *   1. codevibe POSTs { sessionId, sandboxUrl } to /__register
 *   2. iframe loads /__claim/<sessionId>[/path] — proxy sets a `cv_session`
 *      cookie scoped to this origin and 302s to the path tail (or "/")
 *   3. all subsequent requests from that iframe carry the cookie → proxy
 *      routes to the right sandbox + injects that session's n8n-auth cookie
 */
import http from 'http';
import httpProxy from 'http-proxy';

const PORT = Number(process.env.N8N_PROXY_PORT ?? 1235);
const N8N_USER = process.env.N8N_OWNER_EMAIL ?? 'admin@codevibe.com';
const N8N_PASS = process.env.N8N_OWNER_PASSWORD ?? 'CodeVibe@2025';
const COOKIE_NAME = 'cv_session';
// Drop tenants idle past this so the Map can't grow unbounded across restarts.
const TENANT_TTL_MS = 30 * 60 * 1000;

type Tenant = {
  sandboxUrl: string;
  authCookie: string | null;
  touchedAt: number;
};

const tenants = new Map<string, Tenant>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tenants) {
    if (now - v.touchedAt > TENANT_TTL_MS) tenants.delete(k);
  }
}, 5 * 60 * 1000).unref();

function readSessionCookie(req: http.IncomingMessage): string | null {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(/;\s*/)) {
    if (part.startsWith(`${COOKIE_NAME}=`)) {
      return decodeURIComponent(part.slice(COOKIE_NAME.length + 1));
    }
  }
  return null;
}

function stripRoutingCookie(req: http.IncomingMessage): void {
  if (!req.headers.cookie) return;
  const filtered = req.headers.cookie
    .split(/;\s*/)
    .filter((c) => c && !c.startsWith(`${COOKIE_NAME}=`))
    .join('; ');
  req.headers.cookie = filtered || undefined;
}

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  ws: true,
  secure: false,
  xfwd: false,
});

// Strip Domain (so cookies land on the proxy origin) and rewrite Secure to
// match the proxy's scheme. We keep Secure when the proxy is served over
// HTTPS — required for SameSite=None and best practice anyway.
proxy.on('proxyRes', (proxyRes) => {
  const sc = proxyRes.headers['set-cookie'];
  if (sc?.length) {
    proxyRes.headers['set-cookie'] = sc.map((c) =>
      c.replace(/;\s*Domain=[^;]+/i, '').replace(/;\s*Secure/i, ''),
    );
  }
});

proxy.on('error', (err, _req, res) => {
  console.error('[n8n-proxy] proxy error:', err.message);
  if (res && 'writeHead' in res && !res.headersSent) {
    res.writeHead(502);
    res.end(`Proxy error: ${err.message}`);
  }
});

async function loginToN8n(sandboxUrl: string): Promise<string> {
  const res = await fetch(`${sandboxUrl}/rest/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emailOrLdapLoginId: N8N_USER,
      password: N8N_PASS,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`login HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const auth = setCookie.find((c) => c.startsWith('n8n-auth='));
  if (!auth) throw new Error('no n8n-auth cookie in login response');
  return auth.split(';')[0];
}

async function ensureAuth(sessionId: string, tenant: Tenant): Promise<string> {
  if (tenant.authCookie) return tenant.authCookie;
  tenant.authCookie = await loginToN8n(tenant.sandboxUrl);
  console.log(`[n8n-proxy] auto-logged in for session ${sessionId}`);
  return tenant.authCookie;
}

const server = http.createServer(async (req, res) => {
  // POST /__register — codevibe registers a sessionId → sandboxUrl mapping
  if (req.url === '/__register' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { sessionId, sandboxUrl } = JSON.parse(body);
        if (!sessionId || typeof sessionId !== 'string') {
          throw new Error('sessionId required (string)');
        }
        if (typeof sandboxUrl !== 'string' || !sandboxUrl.startsWith('http')) {
          throw new Error('sandboxUrl must be http(s) URL');
        }
        const cleanUrl = sandboxUrl.replace(/\/$/, '');
        const existing = tenants.get(sessionId);
        const changed = existing?.sandboxUrl !== cleanUrl;
        tenants.set(sessionId, {
          sandboxUrl: cleanUrl,
          authCookie: changed ? null : (existing?.authCookie ?? null),
          touchedAt: Date.now(),
        });
        console.log(
          `[n8n-proxy] register session=${sessionId} target=${cleanUrl} (${changed ? 'new/changed' : 'same'})`,
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            sessionId,
            claimPath: `/__claim/${encodeURIComponent(sessionId)}`,
          }),
        );
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
    return;
  }

  // GET /__claim/<sessionId>[/...path] — sets routing cookie + redirects.
  // The iframe should be pointed here once per session (or whenever the
  // user navigates to a different workflow under the same session).
  const claimMatch = req.url?.match(/^\/__claim\/([^/?#]+)(.*)$/);
  if (claimMatch) {
    const sessionId = decodeURIComponent(claimMatch[1]);
    const tail = claimMatch[2] || '/';
    const tenant = tenants.get(sessionId);
    if (!tenant) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Unknown session: ${sessionId}. Register it first.`);
      return;
    }
    tenant.touchedAt = Date.now();
    // SameSite=None + Secure required so the cookie is sent when the iframe
    // is embedded cross-site (codevibe's chat origin ≠ this proxy's origin).
    // For local http dev, fall back to Lax — Secure cookies require HTTPS.
    const isHttps =
      (req.headers['x-forwarded-proto'] as string | undefined) === 'https';
    const cookieAttrs = isHttps
      ? `Path=/; SameSite=None; Secure; HttpOnly`
      : `Path=/; SameSite=Lax; HttpOnly`;
    res.writeHead(302, {
      'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; ${cookieAttrs}`,
      Location: tail,
    });
    res.end();
    return;
  }

  if (req.url === '/__health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        tenantCount: tenants.size,
        tenants: [...tenants.entries()].map(([k, v]) => ({
          sessionId: k,
          sandboxUrl: v.sandboxUrl,
          hasAuth: Boolean(v.authCookie),
          touchedAt: v.touchedAt,
        })),
      }),
    );
    return;
  }

  const sessionId = readSessionCookie(req);
  if (!sessionId) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(
      'No session cookie. The iframe must hit /__claim/<sessionId> first.',
    );
    return;
  }
  const tenant = tenants.get(sessionId);
  if (!tenant) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Session not registered: ${sessionId}`);
    return;
  }
  tenant.touchedAt = Date.now();

  stripRoutingCookie(req);

  // Inject n8n-auth on the way in so the user never sees n8n's signin page.
  try {
    if (!req.headers.cookie?.includes('n8n-auth=')) {
      const auth = await ensureAuth(sessionId, tenant);
      req.headers.cookie = req.headers.cookie
        ? `${req.headers.cookie}; ${auth}`
        : auth;
    }
  } catch (err) {
    console.error(
      `[n8n-proxy] auto-login failed for session ${sessionId}:`,
      (err as Error).message,
    );
  }

  proxy.web(req, res, { target: tenant.sandboxUrl });
});

server.on('upgrade', (req, socket, head) => {
  const sessionId = readSessionCookie(req);
  const tenant = sessionId ? tenants.get(sessionId) : null;
  if (!tenant) {
    socket.destroy();
    return;
  }
  tenant.touchedAt = Date.now();
  stripRoutingCookie(req);
  if (
    tenant.authCookie &&
    !req.headers.cookie?.includes('n8n-auth=')
  ) {
    req.headers.cookie = req.headers.cookie
      ? `${req.headers.cookie}; ${tenant.authCookie}`
      : tenant.authCookie;
  }
  proxy.ws(req, socket, head, { target: tenant.sandboxUrl });
});

server.listen(PORT, () => {
  console.log(`[n8n-proxy] listening on http://localhost:${PORT}`);
  console.log(
    `[n8n-proxy] register: POST http://localhost:${PORT}/__register {"sessionId":"...","sandboxUrl":"https://5678-...e2b.app"}`,
  );
});
