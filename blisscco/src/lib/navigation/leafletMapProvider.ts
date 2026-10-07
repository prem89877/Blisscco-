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

const SHOP_PIN = '<svg viewBox="0 0 40 48" width="40" height="48" aria-hidden="true">'
  + '<path d="M20 46C20 46 4 30 4 18a16 16 0 0 1 32 0c0 12-16 28-16 28Z" fill="#FF91A4" stroke="#2D2A2E" stroke-width="2.5" stroke-linejoin="round"/>'
  + '<circle cx="20" cy="18" r="11" fill="#FDF8F5"/>'
  + '</svg>';
const SHOP_LETTER = '<span class="bc-shop-b">B</span>';

/** Shop pin. With a photo the first shop image sits in the round window of the pin; without one (or if it fails to load) the "B" is shown. */
function makeShopIcon(photoUrl: string | null): L.DivIcon {
  const root = document.createElement('div');
  root.className = 'bc-shop';
  root.innerHTML = SHOP_PIN + SHOP_LETTER;
  if (photoUrl) {
    const img = document.createElement('img');
    img.className = 'bc-shop-photo';
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('load', () => { root.classList.add('has-photo'); });
    img.addEventListener('error', () => { img.remove(); root.classList.remove('has-photo'); });
    img.src = photoUrl;
    root.appendChild(img);
  }
  return L.divIcon({ className: 'bc-marker', html: root, iconSize: [40, 48], iconAnchor: [20, 46] });
}


/** Tile coordinates of a point at zoom z (standard web-mercator tiling). */
function tileOf(p: LatLng, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((p.lng + 180) / 360) * n);
  const rad = (p.lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y };
}

/** Loads one tile and tells whether it is a real picture. Tile servers answer "Map data not yet available" with a
 *  flat grey tile (HTTP 200), so Leaflet cannot see it as an error: we look at the pixels instead.
 *  Returns null when the pixels cannot be read (no CORS / network); the caller then keeps its configured zoom. */
function realTile(url: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 4000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const g = c.getContext('2d', { willReadFrequently: true });
        if (!g) { resolve(null); return; }
        g.drawImage(img, 0, 0, 64, 64);
        const d = g.getImageData(0, 0, 64, 64).data;
        const r0 = d[0], g0 = d[1], b0 = d[2], a0 = d[3];
        if (a0 < 10) { resolve(true); return; }   // transparent overlay tile: nothing wrong with it
        const grey = Math.abs(r0 - g0) < 8 && Math.abs(g0 - b0) < 8 && r0 > 140 && r0 < 240;
        let same = 0;
        const total = 64 * 64;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] - r0) < 8 && Math.abs(d[i + 1] - g0) < 8 && Math.abs(d[i + 2] - b0) < 8) same++;
        }
        resolve(!(grey && same / total > 0.8));
      } catch { resolve(null); }
    };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}

/** Deepest zoom (<= `from`) at which this tile layer really has pictures around `at`. */
async function deepestRealZoom(template: string, subdomain: string, at: LatLng, from: number): Promise<number> {
  for (let z = from; z >= 10; z--) {
    const { x, y } = tileOf(at, z);
    const url = template.replace('{s}', subdomain).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
    const ok = await realTile(url);
    if (ok === null) return from;   // cannot tell: keep the configured value
    if (ok) return z;
  }
  return 10;
}

/** Compass bearing in degrees (0 = north, clockwise) from a to b. */
function bearingBetween(a: LatLng, b: LatLng): number {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

const ll = (p: LatLng): L.LatLngTuple => [p.lat, p.lng];
/** Rough distance in metres, good enough to tell a glide from a jump. */
const distanceApprox = (a: LatLng, b: LatLng): number => Math.hypot((a.lat - b.lat) * 110574, (a.lng - b.lng) * 105000);

class LeafletController implements MapController {
  private readonly map: L.Map;
  private readonly resizeObserver: ResizeObserver | null;
  private destroyed = false;
  private destMarker: L.Marker | null = null;
  private destName = '';
  private photoUrl: string | null = null;
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
  private heading: number | null = null;     // where the arrow points (degrees, 0 = north)
  private shownAngle = 0;                      // continuous angle drawn, so the arrow turns the short way round
  private anchor: LatLng | null = null;        // last point used to work out the direction of travel
  private lastMoveAt = 0;
  private compassOff: (() => void) | null = null;
  private shown: LatLng | null = null;   // where the marker is drawn right now (differs from `user` while it glides)

  constructor(container: HTMLElement, private readonly o: MapCreateOptions) {
    this.dest = o.center;
    this.map = L.map(container, {
      center: ll(o.center), zoom: o.zoom, zoomControl: false, attributionControl: false,
      zoomAnimation: !o.reducedMotion, fadeAnimation: !o.reducedMotion, markerZoomAnimation: !o.reducedMotion,
    });
    // Satellite pictures do not exist at every zoom everywhere (small towns often stop at 16-17): ask the tile server what it
    // really has around the shop, then request tiles only down to that zoom (deeper zoom stretches the last real picture).
    this.map.createPane('bcLabels').style.zIndex = '250';
    this.map.getPane('bcLabels')!.style.pointerEvents = 'none';
    const sub = (o.tile.subdomains || 'a')[0];
    const base = { maxZoom: o.tile.maxZoom, subdomains: o.tile.subdomains };
    const addLayers = (zooms: number[]) => {
      if (this.destroyed) return;
      L.tileLayer(o.tile.url, { ...base, maxNativeZoom: zooms[0], attribution: o.tile.attribution, className: 'bc-tiles' }).addTo(this.map);
      o.tile.overlays.forEach((url, i) => L.tileLayer(url, { ...base, maxNativeZoom: zooms[i + 1], pane: 'bcLabels', className: 'bc-labels' }).addTo(this.map));
    };
    const native = Math.min(o.tile.nativeZoom, o.tile.maxZoom);
    const fallback = [native, ...o.tile.overlays.map(() => native)];
    void Promise.race([
      Promise.all([o.tile.url, ...o.tile.overlays].map((u) => deepestRealZoom(u, sub, o.center, native))),
      new Promise<number[]>((r) => setTimeout(() => r(fallback), 3500)),
    ]).then(addLayers, () => addLayers(fallback));
    if (!L.Browser.mobile) L.control.zoom({ position: 'topright' }).addTo(this.map);
    L.control.attribution({ position: 'topright', prefix: false }).addTo(this.map);

    // the screen is full height and can change size (browser bars, rotation): keep the map in sync
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.map.invalidateSize()) : null;
    this.resizeObserver?.observe(container);
    this.startCompass();

    // A drag, or a zoom the app did not start itself, is the customer taking control: follow mode must back off.
    // (The app's own pans / zooms run inside move(), which raises `programmatic` while Leaflet fires its start events.)
    this.map.on('dragstart', () => this.manual());
    this.map.on('zoomstart', () => { if (this.programmatic === 0) this.manual(); });
  }

  /** Phone compass (Android Chrome / iOS Safari when the browser already allows it). Used only while the customer is standing still:
   *  once moving, the direction of travel is the better source. Never asks for any permission. */
  private startCompass(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    let lastAt = 0;
    const onOrientation = (e: Event) => {
      const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      const now = Date.now();
      if (now - lastAt < 120 || now - this.lastMoveAt < 4000 || !this.userMarker) return;
      let h: number | null = null;
      if (typeof ev.webkitCompassHeading === 'number') h = ev.webkitCompassHeading;                                    // iOS
      else if (ev.absolute && typeof ev.alpha === 'number') h = (360 - ev.alpha + (screen.orientation?.angle ?? 0) + 720) % 360;   // Android
      if (h === null || !Number.isFinite(h)) return;
      const cur = this.heading;
      if (cur !== null && Math.abs(((h - cur + 540) % 360) - 180) < 3) return;   // ignore tiny wobble
      lastAt = now;
      this.heading = h;
      this.applyHeading();
    };
    window.addEventListener('deviceorientationabsolute', onOrientation as EventListener);
    window.addEventListener('deviceorientation', onOrientation as EventListener);
    this.compassOff = () => {
      window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener);
      window.removeEventListener('deviceorientation', onOrientation as EventListener);
    };
  }

  /** Turns the little arrow on the "you" dot. Hidden until a direction is known. */
  private applyHeading(): void {
    const arrow = this.userMarker?.getElement()?.querySelector<HTMLElement>('.bc-user-heading');
    if (!arrow) return;
    if (this.heading === null) { arrow.hidden = true; return; }
    const delta = ((this.heading - this.shownAngle + 540) % 360) - 180;
    this.shownAngle += delta;
    arrow.hidden = false;
    arrow.style.transform = `rotate(${Math.round(this.shownAngle)}deg)`;
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
    this.destName = name;
    if (this.destMarker) { this.destMarker.setLatLng(ll(position)); return; }
    this.destMarker = L.marker(ll(position), { icon: makeShopIcon(this.photoUrl), title: name, alt: name, keyboard: false, zIndexOffset: 500 }).addTo(this.map);
  }

  setDestinationPhoto(url: string | null): void {
    if (url === this.photoUrl) return;
    this.photoUrl = url;
    this.destMarker?.setIcon(makeShopIcon(url));
  }

  setUserLocation(position: LatLng | null, accuracyMeters: number | null, headingDegrees: number | null = null): void {
    this.user = position;
    if (!position) {
      this.stopGlide();
      this.userMarker?.remove(); this.userMarker = null;
      this.accuracyCircle?.remove(); this.accuracyCircle = null;
      this.shown = null;
      this.heading = null; this.anchor = null;
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

    // direction: the device's own heading when it gives one, otherwise worked out from how the customer moved
    const now = Date.now();
    if (headingDegrees !== null && Number.isFinite(headingDegrees)) {
      this.heading = headingDegrees; this.anchor = position; this.lastMoveAt = now;
    } else if (!this.anchor) {
      this.anchor = position;
    } else if (distanceApprox(this.anchor, position) >= 5) {   // ignore GPS jitter smaller than 5 m
      this.heading = bearingBetween(this.anchor, position); this.anchor = position; this.lastMoveAt = now;
    }
    this.applyHeading();
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
      const z = Math.max(this.map.getZoom(), 18);
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
    this.routeCasing = L.polyline(pts, { color: '#FFFFFF', weight: 11, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(this.map);
    this.routeLine = L.polyline(pts, { color: '#FF91A4', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(this.map);
  }

  fitToRoute(insets: { top: number; bottom: number }): void {
    const points: L.LatLngTuple[] = this.routePath && this.routePath.length > 1
      ? this.routePath.map(ll)
      : [ll(this.dest), ...(this.user ? [ll(this.user)] : [])];
    this.insets = insets;
    this.map.invalidateSize();
    if (points.length === 1) { this.move(() => this.map.setView(points[0], this.o.zoom, { animate: !this.o.reducedMotion })); return; }
    this.move(() => this.map.fitBounds(L.latLngBounds(points), {
      paddingTopLeft: [32, insets.top], paddingBottomRight: [32, insets.bottom], maxZoom: 18, animate: !this.o.reducedMotion,
    }));
  }

  destroy(): void {
    this.destroyed = true;
    this.compassOff?.(); this.compassOff = null;
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
