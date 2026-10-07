// Looks up a shop's SAVED coordinates on the server, from the same public view the shop pages use (public_businesses, anon-readable,
// approved shops only). /api/route uses it so the destination of a route comes from the database, not from whatever the browser sends.
// Env (same fallbacks as the other API routes): SUPABASE_URL / VITE_SUPABASE_URL, SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY.
import { validIndiaPoint, type LatLng } from './routing.js';

export type ShopLookup =
  | { kind: 'found'; position: LatLng }      // shop exists and has valid saved coordinates
  | { kind: 'no_coords' }                    // shop exists but has no valid coordinates (the browser geocoded the address)
  | { kind: 'not_found' }                    // no such public shop
  | { kind: 'unavailable' };                 // lookup could not be done (not configured / database down)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isShopId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

const cache = new Map<string, { at: number; value: ShopLookup }>();
const TTL_MS = 10 * 60_000;

export async function lookupShopLocation(id: string): Promise<ShopLookup> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return { kind: 'unavailable' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/public_businesses?id=eq.${encodeURIComponent(id)}&select=latitude,longitude&limit=1`, {
      signal: ctrl.signal, headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (!res.ok) return { kind: 'unavailable' };
    const rows = (await res.json()) as { latitude?: unknown; longitude?: unknown }[];
    let value: ShopLookup;
    if (!rows[0]) value = { kind: 'not_found' };
    else {
      const p = { lat: Number(rows[0].latitude), lng: Number(rows[0].longitude) };
      value = rows[0].latitude != null && rows[0].longitude != null && validIndiaPoint(p) ? { kind: 'found', position: p } : { kind: 'no_coords' };
    }
    if (cache.size > 500) cache.clear();
    cache.set(id, { at: Date.now(), value });
    return value;
  } catch {
    return { kind: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
