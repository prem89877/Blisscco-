import { navConfig } from './config';
import type { LatLng } from './types';

// Rendering abstraction. The screen only uses these interfaces; Leaflet is loaded lazily and lives in leafletMapProvider.ts.
// To use MapLibre GL (or anything else) later: add a provider file implementing MapProvider and a case below.

export interface MapCreateOptions {
  center: LatLng;
  zoom: number;
  tile: { url: string; attribution: string; maxZoom: number; subdomains: string };
  reducedMotion: boolean;
  labels: { destination: string; you: string };
}

export interface MapController {
  setDestination(position: LatLng, name: string): void;
  /** Shows the shop's first photo (small, round) inside the shop pin instead of the "B" letter. `null` brings the "B" back. */
  setDestinationPhoto(url: string | null): void;
  /** Moves the "you" marker smoothly. `headingDegrees` is optional (no compass needed): when given, the marker shows a small direction arrow. */
  setUserLocation(position: LatLng | null, accuracyMeters: number | null, headingDegrees?: number | null): void;
  setRoute(path: LatLng[] | null): void;
  /** Shows the whole route (or you + the shop when there is no route yet) inside the visible area above the info card. */
  fitToRoute(insets: { top: number; bottom: number }): void;
  /** Follow mode: keeps the customer in the visible area above the info card, moving the map gently (not on every GPS tick).
   *  Turning it on focuses on the customer straight away. */
  setFollowing(following: boolean, insets: { top: number; bottom: number }): void;
  /** Tells the map how much of it is covered by the top bar / bottom card (they change size between states). */
  setInsets(insets: { top: number; bottom: number }): void;
  /** Called when the customer moves or zooms the map by hand (not for moves the app makes itself). */
  onManualMove(cb: () => void): void;
  destroy(): void;
}

export interface MapProvider {
  readonly id: string;
  create(container: HTMLElement, options: MapCreateOptions): MapController;
}

export function mapCreateDefaults(): Pick<MapCreateOptions, 'tile' | 'zoom' | 'reducedMotion'> {
  return {
    tile: { url: navConfig.tileUrl, attribution: navConfig.tileAttribution, maxZoom: navConfig.tileMaxZoom, subdomains: navConfig.tileSubdomains },
    zoom: 17,   // close enough that small lanes (galiyan) are drawn from the first view
    reducedMotion: typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  };
}

/** Loads the map library only when a navigation screen actually needs it. */
export async function loadMapProvider(): Promise<MapProvider> {
  switch (navConfig.mapProvider) {
    case 'leaflet':
    default:
      return (await import('./leafletMapProvider')).leafletMapProvider;
  }
}
