import { navConfig } from './config';
import type { LatLng, Route, RouteStep } from './types';
import { NavigationError } from './types';

// The UI only ever talks to this interface. To use another routing service, add a new provider here (or change the
// server side in api/_lib/routing.ts, which is where the real provider is chosen). No UI code has to change.

export interface RouteRequest { from: LatLng; to: LatLng; signal?: AbortSignal }

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

  async getRoute({ from, to, signal }: RouteRequest): Promise<Route> {
    let res: Response;
    try {
      res = await fetch(navConfig.routingEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),   // POST so the customer's position never appears in a URL or access log
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

let current: RoutingProvider | null = null;
export function getRoutingProvider(): RoutingProvider {
  if (!current) current = new ServerRoutingProvider();
  return current;
}
/** Swap the provider (tests, or a future client-side provider). */
export function setRoutingProvider(p: RoutingProvider | null): void { current = p; }
