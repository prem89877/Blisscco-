import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './navigation.css';
import type { MapController, MapCreateOptions, MapProvider } from './MapProvider';
import type { LatLng } from './types';

// Leaflet + OpenStreetMap-compatible raster tiles. The tile server comes from configuration (see config.ts).

const userIcon = L.divIcon({
  className: 'bc-marker',
  html: '<div class="bc-user"><span class="bc-user-pulse"></span><span class="bc-user-dot"></span></div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const shopIcon = L.divIcon({
  className: 'bc-marker',
  html: '<div class="bc-shop"><svg viewBox="0 0 40 48" width="40" height="48" aria-hidden="true">'
    + '<path d="M20 46C20 46 4 30 4 18a16 16 0 0 1 32 0c0 12-16 28-16 28Z" fill="#FF91A4" stroke="#2D2A2E" stroke-width="2.5" stroke-linejoin="round"/>'
    + '<circle cx="20" cy="18" r="9" fill="#FDF8F5"/>'
    + '<text x="20" y="23" text-anchor="middle" font-size="14" font-weight="700" fill="#2D2A2E" font-family="\'Playfair Display\', serif">B</text>'
    + '</svg></div>',
  iconSize: [40, 48],
  iconAnchor: [20, 46],
});

const ll = (p: LatLng): L.LatLngTuple => [p.lat, p.lng];

class LeafletController implements MapController {
  private readonly map: L.Map;
  private readonly resizeObserver: ResizeObserver | null;
  private destMarker: L.Marker | null = null;
  private userMarker: L.Marker | null = null;
  private accuracyCircle: L.Circle | null = null;
  private routeCasing: L.Polyline | null = null;
  private routeLine: L.Polyline | null = null;
  private routePath: LatLng[] | null = null;
  private user: LatLng | null = null;
  private dest: LatLng;

  constructor(container: HTMLElement, private readonly o: MapCreateOptions) {
    this.dest = o.center;
    this.map = L.map(container, {
      center: ll(o.center), zoom: o.zoom, zoomControl: false, attributionControl: false,
      zoomAnimation: !o.reducedMotion, fadeAnimation: !o.reducedMotion, markerZoomAnimation: !o.reducedMotion,
    });
    L.tileLayer(o.tile.url, { attribution: o.tile.attribution, maxZoom: o.tile.maxZoom, subdomains: o.tile.subdomains }).addTo(this.map);
    if (!L.Browser.mobile) L.control.zoom({ position: 'topright' }).addTo(this.map);
    L.control.attribution({ position: 'topright', prefix: false }).addTo(this.map);

    // the screen is full height and can change size (browser bars, rotation): keep the map in sync
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.map.invalidateSize()) : null;
    this.resizeObserver?.observe(container);
  }

  setDestination(position: LatLng, name: string): void {
    this.dest = position;
    if (this.destMarker) { this.destMarker.setLatLng(ll(position)); return; }
    this.destMarker = L.marker(ll(position), { icon: shopIcon, title: name, alt: name, keyboard: false, zIndexOffset: 500 }).addTo(this.map);
  }

  setUserLocation(position: LatLng | null, accuracyMeters: number | null): void {
    this.user = position;
    if (!position) {
      this.userMarker?.remove(); this.userMarker = null;
      this.accuracyCircle?.remove(); this.accuracyCircle = null;
      return;
    }
    if (this.userMarker) this.userMarker.setLatLng(ll(position));
    else this.userMarker = L.marker(ll(position), { icon: userIcon, title: this.o.labels.you, alt: this.o.labels.you, keyboard: false, zIndexOffset: 1000 }).addTo(this.map);

    if (accuracyMeters && accuracyMeters > 0) {
      const radius = Math.min(accuracyMeters, 2000);
      if (this.accuracyCircle) { this.accuracyCircle.setLatLng(ll(position)); this.accuracyCircle.setRadius(radius); }
      else this.accuracyCircle = L.circle(ll(position), { radius, stroke: false, fillColor: '#FF91A4', fillOpacity: 0.18, interactive: false }).addTo(this.map);
    } else {
      this.accuracyCircle?.remove(); this.accuracyCircle = null;
    }
  }

  setRoute(path: LatLng[] | null): void {
    this.routePath = path;
    this.routeCasing?.remove(); this.routeCasing = null;
    this.routeLine?.remove(); this.routeLine = null;
    if (!path || path.length < 2) return;
    const pts = path.map(ll);
    this.routeCasing = L.polyline(pts, { color: '#FF91A4', weight: 10, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(this.map);
    this.routeLine = L.polyline(pts, { color: '#2D2A2E', weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(this.map);
  }

  fitToRoute(insets: { top: number; bottom: number }): void {
    const points: L.LatLngTuple[] = this.routePath && this.routePath.length > 1
      ? this.routePath.map(ll)
      : [ll(this.dest), ...(this.user ? [ll(this.user)] : [])];
    this.map.invalidateSize();
    if (points.length === 1) { this.map.setView(points[0], this.o.zoom, { animate: !this.o.reducedMotion }); return; }
    this.map.fitBounds(L.latLngBounds(points), {
      paddingTopLeft: [32, insets.top], paddingBottomRight: [32, insets.bottom], maxZoom: 17, animate: !this.o.reducedMotion,
    });
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.map.remove();   // removes layers, markers and every listener Leaflet attached
  }
}

export const leafletMapProvider: MapProvider = {
  id: 'leaflet',
  create: (container, options) => new LeafletController(container, options),
};
