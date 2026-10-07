import { checkIndiaCoords } from '../india';
import { browserNetwork, browserScreenWake, type NetworkPort, type ScreenWakePort } from './DeviceServices';
import { distanceMeters, snapToRoute } from './geo';
import { buildGuidance, nextInstruction, type RouteGuidance } from './instructions';
import { browserLocation, type LocationPort } from './LocationService';
import { getRoutingProvider, type RoutingProvider } from './RoutingProvider';
import {
  INITIAL_NAVIGATION, NavigationError,
  type Destination, type NavigationErrorCode, type NavigationSnapshot, type Route, type UserLocation,
} from './types';

// Framework-free navigation controller (sits between the UI and the location / routing services):
//   idle -> requesting_location -> locating -> calculating_route -> route_ready -> navigating -> completed
// Any step before `navigating` can end in `error`. beginNavigation() starts live tracking, endNavigation() goes back to
// the route preview, stop() resets everything. Subscribe with useSyncExternalStore (see useNavigation.ts).

/** Every threshold in one place. */
export interface NavTuning {
  /** Inside this distance of the shop (or the GPS accuracy, whichever is larger, up to arrivalMaxMeters) = arrived. */
  arrivalMeters: number;
  arrivalMaxMeters: number;
  /** GPS fixes less accurate than this are not trusted for guidance. */
  poorAccuracyMeters: number;
  /** Movement smaller than this is GPS jitter and is ignored. */
  minMoveMeters: number;
  /** Distance from the route line that counts as off route (grows with a poor GPS accuracy, up to offRouteMaxMeters). */
  offRouteMeters: number;
  offRouteMaxMeters: number;
  /** Consecutive off-route fixes needed before it is believed (one stray GPS jump is not a wrong turn). */
  offRouteConfirmFixes: number;
  /** Minimum gap between two route requests while navigating. */
  rerouteMinIntervalMs: number;
  /** Waits between retries after failed route requests (the last value repeats). */
  retryBackoffMs: number[];
}

export const DEFAULT_TUNING: NavTuning = {
  arrivalMeters: 30,
  arrivalMaxMeters: 50,
  poorAccuracyMeters: 150,
  minMoveMeters: 3,
  offRouteMeters: 50,
  offRouteMaxMeters: 120,
  offRouteConfirmFixes: 3,
  rerouteMinIntervalMs: 10_000,
  retryBackoffMs: [5_000, 10_000, 20_000, 40_000, 60_000],
};

export interface NavigationDeps {
  routing?: RoutingProvider;
  location?: LocationPort;
  network?: NetworkPort;
  screenWake?: ScreenWakePort;
  tuning?: Partial<NavTuning>;
  now?: () => number;
}

type Listener = () => void;

export class NavigationService {
  private snap: NavigationSnapshot = INITIAL_NAVIGATION;
  private listeners = new Set<Listener>();
  private runId = 0;
  private abort: AbortController | null = null;
  private stopPermissionWatch: (() => void) | null = null;

  private readonly routing: RoutingProvider;
  private readonly location: LocationPort;
  private readonly network: NetworkPort;
  private readonly screenWake: ScreenWakePort;
  private readonly T: NavTuning;
  private readonly now: () => number;

  // live navigation
  private guidance: RouteGuidance | null = null;
  private stopWatch: (() => void) | null = null;
  private stopNetwork: (() => void) | null = null;
  private releaseWake: (() => void) | null = null;
  private lastFix: UserLocation | null = null;
  private segmentHint = 0;
  private offCount = 0;
  private rerouteAbort: AbortController | null = null;
  private rerouteTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRerouteAt = -Infinity;
  private failures = 0;

  constructor(deps: NavigationDeps = {}) {
    this.routing = deps.routing ?? getRoutingProvider();
    this.location = deps.location ?? browserLocation;
    this.network = deps.network ?? browserNetwork;
    this.screenWake = deps.screenWake ?? browserScreenWake;
    this.T = { ...DEFAULT_TUNING, ...deps.tuning };
    this.now = deps.now ?? Date.now;
  }

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
    this.set({ navigationStatus: 'error', error: code, offRoute: false, rerouting: false, connectionLost: false, locationIssue: null });
  }

  /** Stops everything that runs during live navigation: GPS watcher, network listener, screen wake lock, timers, requests. Safe to call twice. */
  private stopLive(): void {
    this.stopWatch?.(); this.stopWatch = null;
    this.stopNetwork?.(); this.stopNetwork = null;
    this.releaseWake?.(); this.releaseWake = null;
    if (this.rerouteTimer) { clearTimeout(this.rerouteTimer); this.rerouteTimer = null; }
    this.rerouteAbort?.abort(); this.rerouteAbort = null;
  }

  private releaseResources(): void {
    this.abort?.abort();
    this.abort = null;
    this.stopPermissionWatch?.();
    this.stopPermissionWatch = null;
    this.stopLive();
  }

  // ---------------------------------------------------------------- route preview

  /** Starts navigation to `destination`: permission, one GPS fix, the route. Location permission is requested HERE, never earlier.
   *  Calls while a start is already in progress (or live navigation is running) are ignored, so one tap never causes two routing requests. */
  async start(destination: Destination): Promise<void> {
    const s = this.snap.navigationStatus;
    if (s === 'requesting_location' || s === 'locating' || s === 'calculating_route' || s === 'navigating') return;

    this.releaseResources();
    const run = ++this.runId;
    const abort = new AbortController();
    this.abort = abort;
    this.guidance = null;
    this.set({ ...INITIAL_NAVIGATION, destination });

    const { lat, lng } = destination.position;
    if (!checkIndiaCoords(lat, lng).ok) return this.fail(run, 'destination_unavailable');
    if (!this.location.isSupported()) return this.fail(run, 'browser_unsupported');

    const perm = await this.location.permissionState();
    if (run !== this.runId) return;
    if (perm === 'denied') return this.fail(run, 'location_denied');

    this.set({ navigationStatus: perm === 'granted' ? 'locating' : 'requesting_location' });
    if (perm !== 'granted') {
      // the browser prompt is open; once the customer taps Allow we are just waiting for the GPS fix
      this.stopPermissionWatch = this.location.onPermissionGranted(() => {
        if (run === this.runId && this.snap.navigationStatus === 'requesting_location') this.set({ navigationStatus: 'locating' });
      });
    }

    let userLocation: UserLocation;
    try {
      userLocation = await this.location.locateOnce();
    } catch (e) {
      return this.fail(run, e instanceof NavigationError ? e.code : 'location_unavailable');
    }
    if (run !== this.runId) return;
    this.stopPermissionWatch?.();
    this.stopPermissionWatch = null;

    this.set({ userLocation, navigationStatus: 'calculating_route' });
    if (!this.network.isOnline()) return this.fail(run, 'network_unavailable');

    try {
      const route = await this.routing.getRoute({ from: userLocation.position, to: destination.position, shopId: destination.shopId, signal: abort.signal });
      if (run !== this.runId) return;
      this.guidance = buildGuidance(route);
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

  // ---------------------------------------------------------------- live navigation

  /** Route preview -> live navigation. Starts the GPS watcher; no routing request is made here. */
  beginNavigation(): void {
    const { navigationStatus: st, route, destination, userLocation } = this.snap;
    if (st !== 'route_ready' || !route || !destination || !userLocation) return;

    this.stopLive();
    const run = ++this.runId;
    this.guidance = this.guidance ?? buildGuidance(route);
    this.segmentHint = 0;
    this.offCount = 0;
    this.failures = 0;
    this.lastFix = userLocation;

    this.set({
      navigationStatus: 'navigating', error: null,
      offRoute: false, rerouting: false, connectionLost: !this.network.isOnline(), locationIssue: null,
      ...this.progressFor(userLocation, route, this.guidance),
    });

    this.stopNetwork = this.network.subscribe((online) => this.onNetworkChange(run, online));
    this.releaseWake = this.screenWake.hold();
    this.stopWatch = this.location.watch((l) => this.onFix(run, l), (e) => this.onLocationError(run, e));
  }

  /** Customer ends navigation: tracking stops and the screen goes back to the route preview. */
  endNavigation(): void {
    const s = this.snap.navigationStatus;
    if (s !== 'navigating' && s !== 'completed') return;
    this.runId++;
    this.stopLive();
    this.set({
      navigationStatus: this.snap.route ? 'route_ready' : 'idle',
      remainingDistance: this.snap.routeDistance, remainingDuration: this.snap.estimatedDuration,
      progressPercent: 0, currentSegment: 0, currentStep: 0, instruction: null,
      offRoute: false, rerouting: false, connectionLost: false, locationIssue: null,
    });
  }

  private progressFor(loc: UserLocation, route: Route, g: RouteGuidance) {
    const snap = snapToRoute(g.track, loc.position, this.segmentHint);
    this.segmentHint = snap.segment;
    const total = g.track.totalMeters;
    const fraction = total > 0 ? Math.min(1, Math.max(0, snap.alongMeters / total)) : 0;
    const next = nextInstruction(g, snap.alongMeters);
    return {
      offsetMeters: snap.offsetMeters,
      userLocation: loc,
      remainingDistance: Math.round(route.distanceMeters * (1 - fraction)),
      remainingDuration: Math.round(route.durationSeconds * (1 - fraction)),
      progressPercent: Math.round(fraction * 100),
      currentSegment: snap.segment,
      currentStep: next ? next.stepIndex : -1,
      instruction: next ? next.instruction : null,
    };
  }

  private onFix(run: number, loc: UserLocation): void {
    if (run !== this.runId || this.snap.navigationStatus !== 'navigating') return;
    const { route, destination } = this.snap;
    const g = this.guidance;
    if (!route || !destination || !g) return;

    const acc = loc.accuracyMeters;
    if (acc !== null && acc > this.T.poorAccuracyMeters) {   // too vague to steer by: keep the last good position
      if (this.snap.locationIssue === null) this.set({ locationIssue: 'location_unavailable' });
      return;
    }
    const prev = this.lastFix;
    if (prev && this.snap.locationIssue === null && distanceMeters(prev.position, loc.position) < this.T.minMoveMeters) return;   // jitter
    this.lastFix = loc;

    const { offsetMeters, ...progress } = this.progressFor(loc, route, g);

    // arrival: close to the shop itself, not merely close to the end of the line
    const arrivalRadius = Math.min(this.T.arrivalMaxMeters, Math.max(this.T.arrivalMeters, acc ?? 0));
    if (distanceMeters(loc.position, destination.position) <= arrivalRadius) { this.arrive(loc); return; }

    // off route: far from the line for several fixes in a row
    const limit = Math.min(this.T.offRouteMaxMeters, Math.max(this.T.offRouteMeters, (acc ?? 0) * 1.5));
    if (offsetMeters > limit) this.offCount++; else this.offCount = 0;
    const confirmedOff = this.offCount >= this.T.offRouteConfirmFixes;

    if (this.offCount === 0 && (this.snap.offRoute || this.rerouteTimer || this.rerouteAbort)) {
      // back on the route by themselves: no new route needed
      if (this.rerouteTimer) { clearTimeout(this.rerouteTimer); this.rerouteTimer = null; }
      this.rerouteAbort?.abort(); this.rerouteAbort = null;
      this.failures = 0;
      this.set({ ...progress, locationIssue: null, offRoute: false, rerouting: false, connectionLost: !this.network.isOnline() });
      return;
    }

    this.set({ ...progress, locationIssue: null, offRoute: confirmedOff || this.snap.offRoute });
    if (confirmedOff) this.requestReroute(run);
  }

  private arrive(loc: UserLocation): void {
    this.runId++;
    this.stopLive();
    this.set({
      navigationStatus: 'completed', userLocation: loc,
      remainingDistance: 0, remainingDuration: 0, progressPercent: 100,
      instruction: { kind: 'arrive', distanceMeters: 0, streetName: '' },
      offRoute: false, rerouting: false, connectionLost: false, locationIssue: null,
    });
  }

  private onLocationError(run: number, e: NavigationError): void {
    if (run !== this.runId || this.snap.navigationStatus !== 'navigating') return;
    if (e.code === 'location_denied' || e.code === 'browser_unsupported') {
      // permission taken away mid-way: tracking cannot continue
      this.runId++;
      this.stopLive();
      this.set({ navigationStatus: 'error', error: e.code, offRoute: false, rerouting: false, connectionLost: false, locationIssue: null });
      return;
    }
    this.set({ locationIssue: e.code });   // weak signal / timeout: the watcher keeps running and clears this on the next good fix
  }

  private onNetworkChange(run: number, online: boolean): void {
    if (run !== this.runId || this.snap.navigationStatus !== 'navigating') return;
    if (!online) { this.set({ connectionLost: true }); return; }
    this.set({ connectionLost: false });
    if (this.snap.offRoute && !this.rerouteAbort) {
      // back online while waiting for a new route: try again now (still no faster than the minimum gap)
      if (this.rerouteTimer) { clearTimeout(this.rerouteTimer); this.rerouteTimer = null; }
      this.failures = 0;
      this.requestReroute(run);
    }
  }

  // ---------------------------------------------------------------- off-route recalculation

  /** Asks for a new route, but never more often than the minimum gap, never twice at once, with growing waits after failures. */
  private requestReroute(run: number): void {
    if (this.rerouteAbort || this.rerouteTimer) return;   // one request (or one scheduled retry) at a time
    const gap = this.failures > 0
      ? this.T.retryBackoffMs[Math.min(this.failures - 1, this.T.retryBackoffMs.length - 1)]
      : this.T.rerouteMinIntervalMs;
    const delay = Math.max(0, this.lastRerouteAt + gap - this.now());
    if (delay === 0) { void this.reroute(run); return; }
    this.rerouteTimer = setTimeout(() => {
      this.rerouteTimer = null;
      if (this.snap.offRoute) void this.reroute(run);
    }, delay);
  }

  private async reroute(run: number): Promise<void> {
    const from = this.lastFix?.position;
    const destination = this.snap.destination;
    if (run !== this.runId || this.snap.navigationStatus !== 'navigating' || !from || !destination) return;

    this.lastRerouteAt = this.now();
    if (!this.network.isOnline()) { this.rerouteFailed(run, 'network_unavailable'); return; }

    const abort = new AbortController();
    this.rerouteAbort = abort;
    this.set({ rerouting: true });
    try {
      const route = await this.routing.getRoute({ from, to: destination.position, shopId: destination.shopId, signal: abort.signal });
      if (run !== this.runId || abort.signal.aborted) return;
      this.rerouteAbort = null;
      this.failures = 0;
      this.offCount = 0;
      this.segmentHint = 0;
      this.guidance = buildGuidance(route);
      const here = this.lastFix ?? this.snap.userLocation;
      const { offsetMeters: _offset, ...progress } = here
        ? this.progressFor(here, route, this.guidance)
        : { offsetMeters: 0, userLocation: null, remainingDistance: route.distanceMeters, remainingDuration: route.durationSeconds, progressPercent: 0, currentSegment: 0, currentStep: -1, instruction: null };
      this.set({
        ...progress, userLocation: here ?? this.snap.userLocation,
        route, routeDistance: route.distanceMeters, estimatedDuration: route.durationSeconds,
        offRoute: false, rerouting: false, connectionLost: false,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError' || abort.signal.aborted) return;
      this.rerouteAbort = null;
      this.rerouteFailed(run, e instanceof NavigationError ? e.code : 'route_failed');
    }
  }

  /** The last valid route stays on the map and in the state; the next try is scheduled with a growing wait. */
  private rerouteFailed(run: number, code: NavigationErrorCode): void {
    if (run !== this.runId || this.snap.navigationStatus !== 'navigating') return;
    this.failures++;
    const connection = code === 'network_unavailable' || code === 'provider_unavailable';
    this.set({ rerouting: false, connectionLost: connection ? true : this.snap.connectionLost });
    this.requestReroute(run);
  }

  // ---------------------------------------------------------------- teardown

  /** Cancels everything in flight and returns to idle. Safe to call on unmount, and more than once. */
  stop(): void {
    this.runId++;
    this.releaseResources();
    this.guidance = null;
    this.lastFix = null;
    this.snap = INITIAL_NAVIGATION;
    this.listeners.forEach((l) => l());
  }
}
