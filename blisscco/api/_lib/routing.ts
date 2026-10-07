// Server-side routing providers. The browser never talks to a routing service directly: it calls /api/route, which
// calls the provider chosen here. To switch provider: add a function to PROVIDERS and set ROUTING_PROVIDER.
// A provider that needs a secret key reads it from process.env here (never from VITE_ variables).
//
// Env (all optional):
//   ROUTING_PROVIDER   'osrm' (default)
//   OSRM_BASE_URL      default https://router.project-osrm.org  (public DEMO server: fine for testing, point this at your own OSRM or a paid host for production)
//   OSRM_PROFILE       default 'driving'

export interface LatLng { lat: number; lng: number }
export interface RouteStep { maneuver: string; modifier: string | null; streetName: string; distanceMeters: number; durationSeconds: number; location: LatLng }
export interface RouteResult { path: [number, number][]; distanceMeters: number; durationSeconds: number; steps: RouteStep[] }

export class RouteError extends Error {
  constructor(readonly kind: 'no_route' | 'unavailable', message?: string) { super(message ?? kind); }
}

type Provider = (from: LatLng, to: LatLng, signal: AbortSignal) => Promise<RouteResult>;

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

interface OsrmStep { distance?: number; duration?: number; name?: string; maneuver?: { type?: string; modifier?: string; location?: [number, number] } }
interface OsrmResponse {
  code?: string;
  routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs?: { steps?: OsrmStep[] }[] }[];
}

const osrm: Provider = async (from, to, signal) => {
  const base = (process.env.OSRM_BASE_URL || 'https://router.project-osrm.org').replace(/\/+$/, '');
  const profile = (process.env.OSRM_PROFILE || 'driving').replace(/[^a-z]/gi, '') || 'driving';
  const url = `${base}/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true&alternatives=false`;
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json', 'User-Agent': 'Blisscco/1.0 (route proxy)' } });
  } catch {
    throw new RouteError('unavailable', 'OSRM unreachable');
  }
  let json: OsrmResponse | null = null;
  try { json = (await res.json()) as OsrmResponse; } catch { /* handled below */ }
  if (json?.code === 'NoRoute' || json?.code === 'NoSegment') throw new RouteError('no_route');
  if (!res.ok || json?.code !== 'Ok' || !json.routes?.[0]) throw new RouteError('unavailable', `OSRM status ${res.status}`);

  const r = json.routes[0];
  const path = r.geometry.coordinates.map(([lng, lat]) => [round5(lat), round5(lng)] as [number, number]);
  const steps: RouteStep[] = (r.legs ?? []).flatMap((l) => l.steps ?? []).map((s) => ({
    maneuver: s.maneuver?.type ?? '', modifier: s.maneuver?.modifier ?? null, streetName: s.name ?? '',
    distanceMeters: Math.round(s.distance ?? 0), durationSeconds: Math.round(s.duration ?? 0),
    location: { lat: round5(s.maneuver?.location?.[1] ?? 0), lng: round5(s.maneuver?.location?.[0] ?? 0) },
  }));
  return { path, distanceMeters: Math.round(r.distance), durationSeconds: Math.round(r.duration), steps };
};

const PROVIDERS: Record<string, Provider> = { osrm };

export function providerId(): string {
  const id = (process.env.ROUTING_PROVIDER || 'osrm').trim().toLowerCase();
  return PROVIDERS[id] ? id : 'osrm';
}

export async function calculateRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);   // stay inside the serverless time limit
  try {
    return await PROVIDERS[providerId()](from, to, ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

// India only (same service area as the rest of Blisscco). Also stops the endpoint from being used as a general-purpose router.
export function validIndiaPoint(p: unknown): p is LatLng {
  const o = p as Partial<LatLng> | null;
  return !!o && typeof o.lat === 'number' && typeof o.lng === 'number'
    && Number.isFinite(o.lat) && Number.isFinite(o.lng)
    && o.lat >= 6.5 && o.lat <= 35.9 && o.lng >= 68 && o.lng <= 97.5;
}

/** Straight-line limit between start and destination (default 400 km, env ROUTE_MAX_KM). Navigation to a shop is local, so this
 *  also stops the endpoint from being used as a general-purpose long-distance router. */
export function withinServiceRange(from: LatLng, to: LatLng): boolean {
  const max = Number(process.env.ROUTE_MAX_KM) > 0 ? Number(process.env.ROUTE_MAX_KM) : 400;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(to.lat - from.lat) / 2) ** 2 + Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(rad(to.lng - from.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))) <= max;
}
