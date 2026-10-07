import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './navigation.css';
import type { MapController, MapCreateOptions, MapProvider } from './MapProvider';
import type { LatLng } from './types';

// Leaflet + OpenStreetMap-compatible raster tiles. The tile server comes from configuration (see config.ts).

const userIcon = L.divIcon({
  className: 'bc-marker',
  html: '<div class="bc-user"><span class="bc-user-pulse"></span><span class="bc-user-heading" hidden></span><span class="bc-user-dot"></span></div>',
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
/** Rough distance in metres, good enough to tell a glide from a jump. */
const distanceApprox = (a: LatLng, b: LatLng): number => Math.hypot((a.lat - b.lat) * 110574, (a.lng - b.lng) * 105000);

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
  private following = false;
  private insets = { top: 0, bottom: 0 };
  private manualCb: (() => void) | null = null;
  private programmatic = 0;
  private anim: number | null = null;
  private shown: LatLng | null = null;   // where the marker is drawn right now (differs from `user` while it glides)

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

    // A drag, or a zoom the app did not start itself, is the customer taking control: follow mode must back off.
    // (The app's own pans / zooms run inside move(), which raises `programmatic` while Leaflet fires its start events.)
    this.map.on('dragstart', () => this.manual());
    this.map.on('zoomstart', () => { if (this.programmatic === 0) this.manual(); });
  }

  private manual(): void {
    this.following = false;
    this.manualCb?.();
  }

  /** Runs a map movement started by the app, so it is not mistaken for the customer's own gesture. */
  private move(fn: () => void): void {
    this.programmatic++;
    try { fn(); } finally { this.programmatic--; }
  }

  onManualMove(cb: () => void): void { this.manualCb = cb; }

  setDestination(position: LatLng, name: string): void {
    this.dest = position;
    if (this.destMarker) { this.destMarker.setLatLng(ll(position)); return; }
    this.destMarker = L.marker(ll(position), { icon: shopIcon, title: name, alt: name, keyboard: false, zIndexOffset: 500 }).addTo(this.map);
  }

  setUserLocation(position: LatLng | null, accuracyMeters: number | null, headingDegrees: number | null = null): void {
    this.user = position;
    if (!position) {
      this.stopGlide();
      this.userMarker?.remove(); this.userMarker = null;
      this.accuracyCircle?.remove(); this.accuracyCircle = null;
      this.shown = null;
      return;
    }
    if (!this.userMarker) {
      this.userMarker = L.marker(ll(position), { icon: userIcon, title: this.o.labels.you, alt: this.o.labels.you, keyboard: false, zIndexOffset: 1000 }).addTo(this.map);
      this.shown = position;
    } else {
      this.glideTo(position);
    }

    if (accuracyMeters && accuracyMeters > 0) {
      const radius = Math.min(accuracyMeters, 2000);
      if (this.accuracyCircle) this.accuracyCircle.setRadius(radius);
      else this.accuracyCircle = L.circle(ll(this.shown ?? position), { radius, stroke: false, fillColor: '#FF91A4', fillOpacity: 0.18, interactive: false }).addTo(this.map);
    } else {
      this.accuracyCircle?.remove(); this.accuracyCircle = null;
    }

    const arrow = this.userMarker.getElement()?.querySelector<HTMLElement>('.bc-user-heading');
    if (arrow) {
      if (headingDegrees === null) arrow.hidden = true;
      else { arrow.hidden = false; arrow.style.transform = `rotate(${Math.round(headingDegrees)}deg)`; }
    }
    this.followUser(false);
  }

  /** Glides the marker to its new position instead of jumping (GPS updates arrive about once a second). */
  private glideTo(to: LatLng): void {
    const marker = this.userMarker;
    if (!marker) return;
    const from = this.shown ?? to;
    this.stopGlide();
    const jump = distanceApprox(from, to) > 400;
    if (this.o.reducedMotion || jump || typeof requestAnimationFrame === 'undefined') { this.drawUser(to); return; }
    const t0 = performance.now();
    const DURATION = 900;
    const frame = (now: number) => {
      const k = Math.min(1, (now - t0) / DURATION);
      this.drawUser({ lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k });
      this.anim = k < 1 ? requestAnimationFrame(frame) : null;
    };
    this.anim = requestAnimationFrame(frame);
  }

  private drawUser(p: LatLng): void {
    this.shown = p;
    this.userMarker?.setLatLng(ll(p));
    this.accuracyCircle?.setLatLng(ll(p));
  }

  private stopGlide(): void {
    if (this.anim !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.anim);
    this.anim = null;
  }

  setInsets(insets: { top: number; bottom: number }): void { this.insets = insets; }

  setFollowing(following: boolean, insets: { top: number; bottom: number }): void {
    this.following = following;
    this.insets = insets;
    if (following) this.followUser(true);
  }

  /** Keeps the customer inside a comfortable area of the visible map. A small drift is left alone, so the map does not
   *  twitch on every GPS tick; once the customer leaves that area the map glides back. `force` re-focuses at navigation zoom. */
  private followUser(force: boolean): void {
    if (!this.following || !this.user) return;
    const size = this.map.getSize();
    const { top, bottom } = this.insets;
    if (force) {
      const z = Math.max(this.map.getZoom(), 17);
      const centre = this.map.project(ll(this.user), z).add([0, (bottom - top) / 2]);
      this.move(() => this.map.setView(this.map.unproject(centre, z), z, { animate: !this.o.reducedMotion }));
      return;
    }
    const pt = this.map.latLngToContainerPoint(ll(this.user));
    const dx = pt.x - size.x / 2;
    const dy = pt.y - (top + (size.y - bottom)) / 2;
    if (Math.hypot(dx, dy) < Math.max(40, Math.min(size.x, size.y) * 0.12)) return;
    this.move(() => this.map.panBy([dx, dy], { animate: !this.o.reducedMotion, duration: 0.9, easeLinearity: 0.5, noMoveStart: true }));
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
    this.insets = insets;
    this.map.invalidateSize();
    if (points.length === 1) { this.move(() => this.map.setView(points[0], this.o.zoom, { animate: !this.o.reducedMotion })); return; }
    this.move(() => this.map.fitBounds(L.latLngBounds(points), {
      paddingTopLeft: [32, insets.top], paddingBottomRight: [32, insets.bottom], maxZoom: 17, animate: !this.o.reducedMotion,
    }));
  }

  destroy(): void {
    this.stopGlide();
    this.manualCb = null;
    this.resizeObserver?.disconnect();
    this.map.remove();   // removes layers, markers and every listener Leaflet attached
  }
}

export const leafletMapProvider: MapProvider = {
  id: 'leaflet',
  create: (container, options) => new LeafletController(container, options),
};
