import type { VercelRequest } from '@vercel/node';

// Best-effort per-IP limiter held in memory (same approach as the other API routes). It slows down abuse of the
// routing / geocoding proxies; it is not a hard guarantee across serverless instances.
const buckets = new Map<string, number[]>();

export function clientIp(req: VercelRequest): string {
  return String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
}

export function limited(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { buckets.set(key, recent); return true; }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 5000) buckets.clear();   // keep memory bounded
  return false;
}
