// GET /api/geocode?q=<address>  ->  { lat, lng }  (404 when nothing is found)
// Used ONLY as a fallback when a shop has no valid stored coordinates. Provider chosen by env (server-only):
//   GEOCODER_PROVIDER    'nominatim' (default)
//   GEOCODER_BASE_URL    default https://nominatim.openstreetmap.org  (public server: 1 request/second max, identify your app; use your own instance or a paid host for heavy use)
//   GEOCODER_USER_AGENT  default 'Blisscco/1.0'  (Nominatim requires an identifying User-Agent; add a contact, e.g. 'Blisscco/1.0 (you@yourdomain.com)')
// Results are cached at the edge for a day, which also keeps us inside the provider's usage policy.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, limited } from './_lib/rateLimit.js';

interface Point { lat: number; lng: number }
type Geocoder = (q: string, signal: AbortSignal) => Promise<Point | null>;

const nominatim: Geocoder = async (q, signal) => {
  const base = (process.env.GEOCODER_BASE_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
  const url = `${base}/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json', 'Accept-Language': 'en', 'User-Agent': process.env.GEOCODER_USER_AGENT || 'Blisscco/1.0' },
  });
  if (!res.ok) throw new Error(`geocoder status ${res.status}`);
  const rows = (await res.json()) as { lat?: string; lon?: string }[];
  const lat = Number(rows[0]?.lat);
  const lng = Number(rows[0]?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

const GEOCODERS: Record<string, Geocoder> = { nominatim };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method_not_allowed' }); }
  if (limited(`geocode:${clientIp(req)}`, 15)) return res.status(429).json({ error: 'rate_limited' });

  const q = String(Array.isArray(req.query.q) ? req.query.q[0] : req.query.q ?? '').replace(/\s+/g, ' ').trim();
  if (q.length < 5 || q.length > 300) return res.status(400).json({ error: 'invalid_request' });

  const id = (process.env.GEOCODER_PROVIDER || 'nominatim').trim().toLowerCase();
  const geocode = GEOCODERS[id] ?? nominatim;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const p = await geocode(q, ctrl.signal);
    if (!p) { res.setHeader('Cache-Control', 'public, s-maxage=3600'); return res.status(404).json({ error: 'not_found' }); }
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json(p);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'provider_unavailable' });
  } finally {
    clearTimeout(timer);
  }
}
