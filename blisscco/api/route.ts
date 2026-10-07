// POST /api/route  { from: {lat,lng}, to: {lat,lng}, shopId?: uuid }  ->  { provider, route: { path, distanceMeters, durationSeconds, steps } }
// Server-side proxy to the configured routing provider (see api/_lib/routing.ts). No login needed (shop pages are public),
// so a small per-IP limit applies. The customer's position is read from the body only and is never logged or stored.
// When `shopId` is sent, the destination is the shop's SAVED location read from the database here; the browser's `to` is then ignored.
// (Only shops without saved coordinates, whose address the browser geocoded, fall back to the validated `to`.)
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, limited } from './_lib/rateLimit.js';
import { calculateRoute, providerId, RouteError, validIndiaPoint, withinServiceRange } from './_lib/routing.js';
import { isShopId, lookupShopLocation } from './_lib/shopLocation.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  if (limited(`route:${clientIp(req)}`, 30)) return res.status(429).json({ error: 'rate_limited' });

  const body = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as { from?: unknown; to?: unknown; shopId?: unknown } | null;
  if (!body || !validIndiaPoint(body.from) || !validIndiaPoint(body.to)) return res.status(400).json({ error: 'invalid_request' });
  if (body.shopId !== undefined && !isShopId(body.shopId)) return res.status(400).json({ error: 'invalid_request' });

  let to = body.to;
  if (body.shopId !== undefined) {
    const shop = await lookupShopLocation(body.shopId);
    if (shop.kind === 'not_found') return res.status(400).json({ error: 'invalid_request' });
    if (shop.kind === 'found') to = shop.position;   // the database wins over the browser
  }
  if (!withinServiceRange(body.from, to)) return res.status(400).json({ error: 'outside_service_area' });

  try {
    const route = await calculateRoute(body.from, to);
    return res.status(200).json({ provider: providerId(), route });
  } catch (e) {
    if (e instanceof RouteError && e.kind === 'no_route') return res.status(422).json({ error: 'route_not_found' });
    return res.status(502).json({ error: 'provider_unavailable' });   // never leak provider details to the browser
  }
}

function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
