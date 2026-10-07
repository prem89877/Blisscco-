import { checkIndiaCoords } from '../india';
import { getPermissionState, isGeolocationSupported, locateForNavigation, onPermissionGranted } from './LocationService';
import { getRoutingProvider, type RoutingProvider } from './RoutingProvider';
import { INITIAL_NAVIGATION, NavigationError, type Destination, type NavigationErrorCode, type NavigationSnapshot } from './types';

// Framework-free navigation state machine:
//   idle -> requesting_location -> locating -> calculating_route -> route_ready   (any step can end in `error`)
// `navigating` and `completed` exist in the model for Part 2 (live tracking / turn-by-turn) but are not entered yet.
// Subscribe with useSyncExternalStore (see useNavigation.ts).

type Listener = () => void;

export class NavigationService {
  private snap: NavigationSnapshot = INITIAL_NAVIGATION;
  private listeners = new Set<Listener>();
  private runId = 0;
  private abort: AbortController | null = null;
  private stopPermissionWatch: (() => void) | null = null;

  constructor(private readonly routing: RoutingProvider = getRoutingProvider()) {}

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };

  getSnapshot = (): NavigationSnapshot => this.snap;

  private set(patch: Partial<NavigationSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  private fail(run: number, code: NavigationErrorCode): void {
    if (run !== this.runId) return;
    this.releaseResources();
    this.set({ navigationStatus: 'error', error: code });
  }

  private releaseResources(): void {
    this.abort?.abort();
    this.abort = null;
    this.stopPermissionWatch?.();
    this.stopPermissionWatch = null;
  }

  /** Starts navigation to `destination`. Location permission is requested HERE, never earlier.
   *  Calls while a start is already in progress are ignored, so one tap never causes two routing requests. */
  async start(destination: Destination): Promise<void> {
    const s = this.snap.navigationStatus;
    if (s === 'requesting_location' || s === 'locating' || s === 'calculating_route') return;

    this.releaseResources();
    const run = ++this.runId;
    const abort = new AbortController();
    this.abort = abort;
    this.set({ ...INITIAL_NAVIGATION, destination });

    const { lat, lng } = destination.position;
    if (!checkIndiaCoords(lat, lng).ok) return this.fail(run, 'destination_unavailable');
    if (!isGeolocationSupported()) return this.fail(run, 'browser_unsupported');

    const perm = await getPermissionState();
    if (run !== this.runId) return;
    if (perm === 'denied') return this.fail(run, 'location_denied');

    this.set({ navigationStatus: perm === 'granted' ? 'locating' : 'requesting_location' });
    if (perm !== 'granted') {
      // the browser prompt is open; once the customer taps Allow we are just waiting for the GPS fix
      this.stopPermissionWatch = onPermissionGranted(() => {
        if (run === this.runId && this.snap.navigationStatus === 'requesting_location') this.set({ navigationStatus: 'locating' });
      });
    }

    let userLocation;
    try {
      userLocation = await locateForNavigation();
    } catch (e) {
      return this.fail(run, e instanceof NavigationError ? e.code : 'location_unavailable');
    }
    if (run !== this.runId) return;
    this.stopPermissionWatch?.();
    this.stopPermissionWatch = null;

    this.set({ userLocation, navigationStatus: 'calculating_route' });
    if (navigator.onLine === false) return this.fail(run, 'network_unavailable');

    try {
      const route = await this.routing.getRoute({ from: userLocation.position, to: destination.position, signal: abort.signal });
      if (run !== this.runId) return;
      this.set({
        navigationStatus: 'route_ready', error: null, route,
        routeDistance: route.distanceMeters, estimatedDuration: route.durationSeconds,
        remainingDistance: route.distanceMeters, remainingDuration: route.durationSeconds, currentStep: 0,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      this.fail(run, e instanceof NavigationError ? e.code : 'route_failed');
    }
  }

  /** Runs the whole flow again for the same destination (after an error, or to refresh the route). */
  retry(): Promise<void> {
    const d = this.snap.destination;
    if (!d) return Promise.resolve();
    return this.start(d);
  }

  /** Cancels everything in flight and returns to idle. Safe to call on unmount, and more than once. */
  stop(): void {
    this.runId++;
    this.releaseResources();
    this.snap = INITIAL_NAVIGATION;
    this.listeners.forEach((l) => l());
  }
}
