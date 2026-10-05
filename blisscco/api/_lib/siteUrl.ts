import type { VercelRequest } from '@vercel/node';

/** Public site address for robots.txt / sitemap.xml. Prefer SITE_URL (set it to your real domain);
 *  otherwise the production Vercel domain, otherwise the host this request came to. */
export function siteUrl(req: VercelRequest): string {
  const fromEnv = (process.env.SITE_URL ?? '').trim().replace(/\/+$/, '');
  if (/^https?:\/\//.test(fromEnv)) return fromEnv;
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
  return host ? `https://${host}` : '';
}
