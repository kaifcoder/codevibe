import { NextRequest } from 'next/server';

// Shared secret between the Next.js app and the langgraph-api container.
// Used to authenticate internal-only routes that read/write per-user MCP
// credentials. Without this the agent has no way to access tokens that live
// in the app DB.

export function checkInternalAuth(req: NextRequest): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.INTERNAL_AGENT_SECRET;
  if (!secret) {
    return { ok: false, status: 500, error: 'INTERNAL_AGENT_SECRET is not configured' };
  }
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || match[1] !== secret) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}
