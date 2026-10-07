// Shared types for the Blisscco in-website navigation system (Part 1 + Part 2: live tracking, turn-by-turn).
// Nothing in here knows about Leaflet, OSRM or React, so providers can be swapped without touching the UI.

export interface LatLng { lat: number; lng: number }

export interface UserLocation {
  position: LatLng;
  /** Horizontal accuracy in metres, when the device reports it. */
  accuracyMeters: number | null;
  /** Direction of travel in degrees (0 = north) when the device reports it. Never required. */
  headingDegrees: number | null;
  timestamp: number;
}

export interface Destination {
  /** Shop id. The routing backend uses it to look up the shop's saved location itself instead of trusting the browser. */
  shopId?: string;
  name: string;
  /** Human-readable address, shown to the customer instead of raw coordinates. */
  address: string | null;
  position: LatLng;
}

/** One manoeuvre of a route. Collected now so Part 2 (turn-by-turn) does not need a new routing call. */
export interface RouteStep {
  maneuver: string;
  modifier: string | null;
  streetName: string;
  distanceMeters: number;
  durationSeconds: number;
  location: LatLng;
}

export interface Route {
  path: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
}

export type NavigationStatus =
  | 'idle'
  | 'requesting_location'
  | 'locating'
  | 'calculating_route'
  | 'route_ready'
  | 'navigating'
  | 'completed'
  | 'error';

export type NavigationErrorCode =
  | 'browser_unsupported'
  | 'location_denied'
  | 'location_unavailable'
  | 'location_timeout'
  | 'destination_unavailable'
  | 'route_failed'
  | 'network_unavailable'
  | 'provider_unavailable'
  | 'map_unavailable';

export class NavigationError extends Error {
  readonly code: NavigationErrorCode;
  constructor(code: NavigationErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'NavigationError';
    this.code = code;
  }
}

/** Plain-language manoeuvre kinds. These are Blisscco's own words; routing-provider terms never reach the UI. */
export type InstructionKind =
  | 'straight' | 'left' | 'right' | 'slight_left' | 'slight_right' | 'sharp_left' | 'sharp_right'
  | 'uturn' | 'keep_left' | 'keep_right' | 'roundabout' | 'arrive';

export interface NavInstruction {
  kind: InstructionKind;
  /** Distance from the customer to that manoeuvre, in metres. */
  distanceMeters: number;
  /** Street the manoeuvre leads onto. Empty when the provider has no name. */
  streetName: string;
}

/** The internal navigation state. Only what the UI needs is shown to the customer; coordinates are never rendered. */
export interface NavigationSnapshot {
  navigationStatus: NavigationStatus;
  error: NavigationErrorCode | null;
  userLocation: UserLocation | null;
  destination: Destination | null;
  route: Route | null;
  /** Total route length (metres) and travel time (seconds) when the route was calculated. */
  routeDistance: number | null;
  estimatedDuration: number | null;
  /** Index into route.steps of the next manoeuvre (-1 when the route has no usable steps). */
  currentStep: number;
  remainingDistance: number | null;
  remainingDuration: number | null;
  /** Live navigation (Part 2). All of these are only meaningful while navigationStatus is `navigating`. */
  /** 0-100, how much of the route is behind the customer. */
  progressPercent: number;
  /** Index of the route line segment the customer is on. */
  currentSegment: number;
  /** Next manoeuvre in plain language; null when the provider gave no usable steps (the UI then shows progress only). */
  instruction: NavInstruction | null;
  /** The customer has left the route and a new route is being requested / waited for. */
  offRoute: boolean;
  /** A new route request is in flight. */
  rerouting: boolean;
  /** The last route request failed because of the network or the routing service. The last valid route stays on screen. */
  connectionLost: boolean;
  /** A temporary GPS problem (weak signal / timeout). Tracking continues and clears this by itself. */
  locationIssue: NavigationErrorCode | null;
}

export const INITIAL_NAVIGATION: NavigationSnapshot = {
  navigationStatus: 'idle',
  error: null,
  userLocation: null,
  destination: null,
  route: null,
  routeDistance: null,
  estimatedDuration: null,
  currentStep: 0,
  remainingDistance: null,
  remainingDuration: null,
  progressPercent: 0,
  currentSegment: 0,
  instruction: null,
  offRoute: false,
  rerouting: false,
  connectionLost: false,
  locationIssue: null,
};
