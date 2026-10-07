import type { NetworkPort, ScreenWakePort } from '../../src/lib/navigation/DeviceServices';
import type { LocationPort, PermissionResult } from '../../src/lib/navigation/LocationService';
import type { RouteRequest, RoutingProvider } from '../../src/lib/navigation/RoutingProvider';
import { NavigationError, type LatLng, type NavigationErrorCode, type Route, type UserLocation } from '../../src/lib/navigation/types';

// A straight 1.5 km road going east in Pune. Shop at the east end.
export const START: LatLng = { lat: 18.5204, lng: 73.8567 };
const M_PER_DEG_LNG = 111320 * Math.cos((18.5204 * Math.PI) / 180);
const M_PER_DEG_LAT = 110574;

/** Point `east` metres east and `north` metres north of `p`. */
export function offset(p: LatLng, east: number, north = 0): LatLng {
  return { lat: p.lat + north / M_PER_DEG_LAT, lng: p.lng + east / M_PER_DEG_LNG };
}
export const SHOP: LatLng = offset(START, 1500);

export function makeRoute(from: LatLng = START, withSteps = true): Route {
  const path: LatLng[] = [];
  for (let m = 0; m <= 1500; m += 100) path.push(offset(from, m));
  return {
    path, distanceMeters: 1500, durationSeconds: 300,
    steps: withSteps ? [
      { maneuver: 'depart', modifier: null, streetName: 'Main Road', distanceMeters: 700, durationSeconds: 140, location: offset(from, 0) },
      { maneuver: 'turn', modifier: 'right', streetName: 'Park Street', distanceMeters: 800, durationSeconds: 160, location: offset(from, 700) },
      { maneuver: 'arrive', modifier: null, streetName: '', distanceMeters: 0, durationSeconds: 0, location: offset(from, 1500) },
    ] : [],
  };
}

export const loc = (position: LatLng, accuracyMeters: number | null = 10): UserLocation =>
  ({ position, accuracyMeters, headingDegrees: null, timestamp: 0 });

export class FakeLocation implements LocationPort {
  supported = true;
  permission: PermissionResult = 'granted';
  once: () => Promise<UserLocation> = async () => loc(START);
  locateCalls = 0;
  watchers = new Set<{ onUpdate: (l: UserLocation) => void; onError: (e: NavigationError) => void }>();
  isSupported() { return this.supported; }
  async permissionState() { return this.permission; }
  onPermissionGranted() { return () => undefined; }
  locateOnce() { this.locateCalls++; return this.once(); }
  watch(onUpdate: (l: UserLocation) => void, onError: (e: NavigationError) => void) {
    const w = { onUpdate, onError };
    this.watchers.add(w);
    return () => { this.watchers.delete(w); };
  }
  emit(l: UserLocation) { [...this.watchers].forEach((w) => w.onUpdate(l)); }
  emitError(code: NavigationErrorCode) { [...this.watchers].forEach((w) => w.onError(new NavigationError(code))); }
}

export class FakeRouting implements RoutingProvider {
  readonly id = 'fake';
  calls: RouteRequest[] = [];
  next: () => Promise<Route> = async () => makeRoute();
  getRoute(req: RouteRequest): Promise<Route> {
    this.calls.push(req);
    return new Promise<Route>((resolve, reject) => {
      req.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      this.next().then(resolve, reject);
    });
  }
}

export class FakeNetwork implements NetworkPort {
  online = true;
  private subs = new Set<(o: boolean) => void>();
  isOnline() { return this.online; }
  subscribe(cb: (o: boolean) => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  set(o: boolean) { this.online = o; [...this.subs].forEach((s) => s(o)); }
  get listeners() { return this.subs.size; }
}

export class FakeWake implements ScreenWakePort {
  held = 0;
  hold() { this.held++; return () => { this.held--; }; }
}

export const flush = () => new Promise<void>((r) => setImmediate(r));
