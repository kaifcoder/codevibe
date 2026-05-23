/**
 * Resolves the canonical site URL for SEO/metadata, in priority order:
 *   1. NEXT_PUBLIC_APP_URL — set explicitly when a custom domain is wired up
 *   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel-assigned production domain
 *      (e.g. "codevibe.vercel.app"); auto-injected on Vercel
 *   3. VERCEL_URL — current preview deployment URL; auto-injected on Vercel
 *   4. http://localhost:3000 — local dev fallback
 *
 * Returns a string with the protocol included so it can be used directly
 * with `new URL()` for metadataBase.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd) return `https://${vercelProd}`;

  const vercelPreview = process.env.VERCEL_URL;
  if (vercelPreview) return `https://${vercelPreview}`;

  return "http://localhost:3000";
}
