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
  setUserLocation(position: LatLng | null, accuracyMeters: number | null): void;
  setRoute(path: LatLng[] | null): void;
  /** Shows the whole route (or you + the shop when there is no route yet) inside the visible area above the info card. */
  fitToRoute(insets: { top: number; bottom: number }): void;
  destroy(): void;
}

export interface MapProvider {
  readonly id: string;
  create(container: HTMLElement, options: MapCreateOptions): MapController;
}

export function mapCreateDefaults(): Pick<MapCreateOptions, 'tile' | 'zoom' | 'reducedMotion'> {
  return {
    tile: { url: navConfig.tileUrl, attribution: navConfig.tileAttribution, maxZoom: navConfig.tileMaxZoom, subdomains: navConfig.tileSubdomains },
    zoom: 15,
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
