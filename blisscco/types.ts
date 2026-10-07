// Shared types for the Blisscco in-website navigation system (Part 1).
// Nothing in here knows about Leaflet, OSRM or React, so providers can be swapped without touching the UI.

export interface LatLng { lat: number; lng: number }

export interface UserLocation {
  position: LatLng;
  /** Horizontal accuracy in metres, when the device reports it. */
  accuracyMeters: number | null;
  timestamp: number;
}

export interface Destination {
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
  /** Index into route.steps. Used by Part 2. */
  currentStep: number;
  remainingDistance: number | null;
  remainingDuration: number | null;
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
};
