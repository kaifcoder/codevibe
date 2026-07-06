/**
 * Global kill-switch for sandbox provisioning + other expensive resources.
 *
 * Any endpoint that spawns an E2B sandbox, kicks off an agent run, or
 * otherwise burns money should call `assertProvisioningAllowed()` first (or
 * return `checkMaintenanceMode()`'s response directly). Set the env var to
 * degrade the site gracefully during an incident without redeploying code.
 *
 * Env knobs:
 *   - MAINTENANCE_MODE=true         → block ALL provisioning-tier endpoints
 *   - DISABLE_NEW_SANDBOXES=true    → block sandbox provisioning only
 *   - MAINTENANCE_MESSAGE=<string>  → optional message shown to callers
 *
 * Reads env each call — no module-level cache — so flipping the env var on
 * Vercel takes effect on the next request without a redeploy.
 */

import { NextResponse } from 'next/server';

const DEFAULT_MESSAGE =
  'CodeVibe is temporarily paused while we work on something. Try again in a few minutes.';

export interface MaintenanceStatus {
  blocked: boolean;
  reason: 'maintenance' | 'sandboxes-disabled' | null;
  message: string | null;
}

function readFlag(name: string): boolean {
  const v = process.env[name];
  if (!v) return false;
  const lowered = v.trim().toLowerCase();
  return lowered === 'true' || lowered === '1' || lowered === 'yes';
}

/**
 * Check whether provisioning is currently allowed.
 * Callers can inspect .blocked and short-circuit with a 503 response.
 */
export function getMaintenanceStatus(kind: 'sandbox' | 'general' = 'sandbox'): MaintenanceStatus {
  const message = process.env.MAINTENANCE_MESSAGE?.trim() || DEFAULT_MESSAGE;
  if (readFlag('MAINTENANCE_MODE')) {
    return { blocked: true, reason: 'maintenance', message };
  }
  if (kind === 'sandbox' && readFlag('DISABLE_NEW_SANDBOXES')) {
    return { blocked: true, reason: 'sandboxes-disabled', message };
  }
  return { blocked: false, reason: null, message: null };
}

/**
 * Convenience wrapper for API routes. Returns a 503 NextResponse when
 * provisioning is off, or null when it's fine to proceed.
 */
export function checkMaintenanceMode(kind: 'sandbox' | 'general' = 'sandbox'): NextResponse | null {
  const status = getMaintenanceStatus(kind);
  if (!status.blocked) return null;
  return NextResponse.json(
    {
      error: 'maintenance',
      reason: status.reason,
      message: status.message,
    },
    { status: 503, headers: { 'Retry-After': '120' } },
  );
}
