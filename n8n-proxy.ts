#!/usr/bin/env tsx
/**
 * n8n reverse proxy.
 *
 * Sits between codevibe's iframe and the e2b n8n sandbox URL. Solves the
 * third-party cookie block: the iframe loads from this proxy's origin
 * (localhost:1235), so n8n's Set-Cookie lands as first-party. Also auto-logs
 * in server-side so users never see n8n's signin screen.
 *
 * Single-target for now — codevibe POSTs the active sandbox URL to
 * /__register before pointing the iframe here. Multi-tenant routing comes
 * later via path/subdomain prefix.
 */
import http from 'http';
import httpProxy from 'http-proxy';

const PORT = Number(process.env.N8N_PROXY_PORT ?? 1235);
const N8N_USER = process.env.N8N_OWNER_EMAIL ?? 'admin@codevibe.com';
const N8N_PASS = process.env.N8N_OWNER_PASSWORD ?? 'CodeVibe@2025';

let target: string | null = null;
let cachedAuthCookie: string | null = null;

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  ws: true,
  secure: false,
  xfwd: false,
});

// Strip Domain (so cookies land on localhost) and Secure (we serve over http
// in dev) from any Set-Cookie n8n returns.
proxy.on('proxyRes', (proxyRes) => {
  const sc = proxyRes.headers['set-cookie'];
  if (sc?.length) {
    proxyRes.headers['set-cookie'] = sc.map((c) =>
      c
        .replace(/;\s*Domain=[^;]+/i, '')
        .replace(/;\s*Secure/i, '')
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

async function loginToN8n(): Promise<string> {
  if (!target) throw new Error('no target registered');
  const res = await fetch(`${target}/rest/login`, {
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

async function ensureAuth(): Promise<string> {
  if (cachedAuthCookie) return cachedAuthCookie;
  cachedAuthCookie = await loginToN8n();
  console.log('[n8n-proxy] auto-logged in, cached n8n-auth cookie');
  return cachedAuthCookie;
}

const server = http.createServer(async (req, res) => {
  // Registration endpoint: codevibe tells the proxy which sandbox to forward to.
  if (req.url === '/__register' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { sandboxUrl } = JSON.parse(body);
        if (typeof sandboxUrl !== 'string' || !sandboxUrl.startsWith('http')) {
          throw new Error('sandboxUrl must be http(s) URL');
        }
        const changed = target !== sandboxUrl;
        target = sandboxUrl.replace(/\/$/, '');
        if (changed) cachedAuthCookie = null;
        console.log(`[n8n-proxy] target ${changed ? 'set' : 'unchanged'}: ${target}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, target }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
    return;
  }

  if (req.url === '/__health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, target, hasAuth: Boolean(cachedAuthCookie) }));
    return;
  }

  if (!target) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('No sandbox registered. POST { sandboxUrl } to /__register first.');
    return;
  }

  // Auto-login: if the iframe doesn't have an n8n-auth cookie yet, get one
  // server-side and inject it on the way to n8n.
  try {
    const cookieHeader = req.headers.cookie ?? '';
    if (!cookieHeader.includes('n8n-auth=')) {
      const auth = await ensureAuth();
      req.headers.cookie = cookieHeader ? `${cookieHeader}; ${auth}` : auth;
    }
  } catch (err) {
    console.error('[n8n-proxy] auto-login failed:', (err as Error).message);
  }

  proxy.web(req, res, { target });
});

server.on('upgrade', (req, socket, head) => {
  if (!target) {
    socket.destroy();
    return;
  }
  // Inject auth on WS upgrade too (best-effort; cached cookie may be stale).
  if (cachedAuthCookie && !req.headers.cookie?.includes('n8n-auth=')) {
    const existing = req.headers.cookie ?? '';
    req.headers.cookie = existing ? `${existing}; ${cachedAuthCookie}` : cachedAuthCookie;
  }
  proxy.ws(req, socket, head, { target });
});

server.listen(PORT, () => {
  console.log(`[n8n-proxy] listening on http://localhost:${PORT}`);
  console.log(`[n8n-proxy] register a target: POST http://localhost:${PORT}/__register {"sandboxUrl":"https://5678-...e2b.app"}`);
});
