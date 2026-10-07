// POST /api/route  { from: {lat,lng}, to: {lat,lng} }  ->  { provider, route: { path, distanceMeters, durationSeconds, steps } }
// Server-side proxy to the configured routing provider (see api/_lib/routing.ts). No login needed (shop pages are public),
// so a small per-IP limit applies. The customer's position is read from the body only and is never logged or stored.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, limited } from './_lib/rateLimit.js';
import { calculateRoute, providerId, RouteError, validIndiaPoint } from './_lib/routing.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  if (limited(`route:${clientIp(req)}`, 30)) return res.status(429).json({ error: 'rate_limited' });

  const body = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as { from?: unknown; to?: unknown } | null;
  if (!body || !validIndiaPoint(body.from) || !validIndiaPoint(body.to)) return res.status(400).json({ error: 'invalid_request' });

  try {
    const route = await calculateRoute(body.from, body.to);
    return res.status(200).json({ provider: providerId(), route });
  } catch (e) {
    if (e instanceof RouteError && e.kind === 'no_route') return res.status(422).json({ error: 'route_not_found' });
    return res.status(502).json({ error: 'provider_unavailable' });   // never leak provider details to the browser
  }
}

function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
