import { navConfig } from './config';
import type { LatLng, Route, RouteStep } from './types';
import { NavigationError } from './types';

// The UI only ever talks to this interface. To use another routing service, add a new provider here (or change the
// server side in api/_lib/routing.ts, which is where the real provider is chosen). No UI code has to change.

export interface RouteRequest { from: LatLng; to: LatLng; shopId?: string; signal?: AbortSignal }

export interface RoutingProvider {
  readonly id: string;
  getRoute(req: RouteRequest): Promise<Route>;
}

interface WireStep { maneuver: string; modifier: string | null; streetName: string; distanceMeters: number; durationSeconds: number; location: LatLng }
interface WireRoute { path: [number, number][]; distanceMeters: number; durationSeconds: number; steps: WireStep[] }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseRoute(json: unknown): Route {
  const r = (json as { route?: WireRoute } | null)?.route;
  if (!r || !Array.isArray(r.path) || r.path.length < 2 || !isNum(r.distanceMeters) || !isNum(r.durationSeconds)) {
    throw new NavigationError('route_failed');
  }
  const path: LatLng[] = [];
  for (const p of r.path) {
    if (Array.isArray(p) && isNum(p[0]) && isNum(p[1])) path.push({ lat: p[0], lng: p[1] });
  }
  if (path.length < 2) throw new NavigationError('route_failed');
  const steps: RouteStep[] = (Array.isArray(r.steps) ? r.steps : []).map((s) => ({
    maneuver: String(s.maneuver ?? ''), modifier: s.modifier ?? null, streetName: String(s.streetName ?? ''),
    distanceMeters: Number(s.distanceMeters) || 0, durationSeconds: Number(s.durationSeconds) || 0,
    location: { lat: Number(s.location?.lat), lng: Number(s.location?.lng) },
  }));
  return { path, distanceMeters: r.distanceMeters, durationSeconds: r.durationSeconds, steps };
}

/** Calls Blisscco's own backend (/api/route), which talks to the configured routing service (OSRM at first).
 *  Keys and the provider address stay on the server. */
export class ServerRoutingProvider implements RoutingProvider {
  readonly id = 'server';

  async getRoute({ from, to, shopId, signal }: RouteRequest): Promise<Route> {
    let res: Response;
    try {
      res = await fetch(navConfig.routingEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shopId ? { from, to, shopId } : { from, to }),   // POST so the customer's position never appears in a URL or access log
        cache: 'no-store',
        signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new NavigationError(navigator.onLine === false ? 'network_unavailable' : 'provider_unavailable');
    }
    if (!res.ok) {
      let code = '';
      try { code = String(((await res.json()) as { error?: string }).error ?? ''); } catch { /* not JSON */ }
      if (res.status === 429) throw new NavigationError('provider_unavailable');   // too many requests: treated like a temporary outage, retried later
      if (code === 'route_not_found' || code === 'invalid_request' || code === 'outside_service_area') throw new NavigationError('route_failed');
      throw new NavigationError('provider_unavailable');
    }
    try {
      return parseRoute(await res.json());
    } catch (e) {
      if (e instanceof NavigationError) throw e;
      throw new NavigationError('provider_unavailable');
    }
  }
}

/** Remembers recent routes so a retry, a double tap or a repeated recalculation from (almost) the same spot does not hit the
 *  routing service again. Only successes are cached; the key rounds the start to ~11 m. */
export function withRouteCache(inner: RoutingProvider, opts: { ttlMs?: number; max?: number; now?: () => number } = {}): RoutingProvider {
  const ttl = opts.ttlMs ?? 45_000;
  const max = opts.max ?? 12;
  const now = opts.now ?? Date.now;
  const store = new Map<string, { at: number; route: Route }>();
  const key = (r: RouteRequest) => `${r.from.lat.toFixed(4)},${r.from.lng.toFixed(4)}>${r.to.lat.toFixed(5)},${r.to.lng.toFixed(5)}`;
  return {
    id: inner.id,
    async getRoute(req) {
      const k = key(req);
      const hit = store.get(k);
      if (hit && now() - hit.at < ttl) return hit.route;
      const route = await inner.getRoute(req);
      store.delete(k);
      store.set(k, { at: now(), route });
      while (store.size > max) store.delete(store.keys().next().value as string);
      return route;
    },
  };
}

let current: RoutingProvider | null = null;
export function getRoutingProvider(): RoutingProvider {
  if (!current) current = withRouteCache(new ServerRoutingProvider());
  return current;
}
/** Swap the provider (tests, or a future client-side provider). */
export function setRoutingProvider(p: RoutingProvider | null): void { current = p; }
