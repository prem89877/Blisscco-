import type { LatLng } from './types';

// Small geometry helpers for navigation. Pure functions, no browser APIs, so they are easy to test.

const R = 6371008.8;   // mean Earth radius in metres
const rad = (d: number) => (d * Math.PI) / 180;

/** Straight-line distance in metres between two points (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A route line with its cumulative length, built once per route so every GPS update is cheap. */
export interface RouteTrack {
  path: LatLng[];
  /** cum[i] = metres from the start of the line to path[i]. */
  cum: number[];
  totalMeters: number;
}

export function buildTrack(path: LatLng[]): RouteTrack {
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + distanceMeters(path[i - 1], path[i]));
  return { path, cum, totalMeters: cum[cum.length - 1] ?? 0 };
}

export interface RouteSnap {
  /** How far the point is from the route line, in metres. */
  offsetMeters: number;
  /** Metres travelled along the route up to the closest point. */
  alongMeters: number;
  /** Index i of the segment path[i] -> path[i+1] that is closest. */
  segment: number;
}

/** Closest point of segment a-b to p, in a local flat projection (accurate for the short segments of a road route). */
function projectOnSegment(p: LatLng, a: LatLng, b: LatLng): { t: number; offset: number } {
  const k = Math.cos(rad(a.lat));
  const ax = 0, ay = 0;
  const bx = rad(b.lng - a.lng) * k * R, by = rad(b.lat - a.lat) * R;
  const px = rad(p.lng - a.lng) * k * R, py = rad(p.lat - a.lat) * R;
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
  const cx = ax + t * (bx - ax), cy = ay + t * (by - ay);
  return { t, offset: Math.hypot(px - cx, py - cy) };
}

function scan(track: RouteTrack, p: LatLng, from: number, to: number): RouteSnap {
  let best: RouteSnap = { offsetMeters: Infinity, alongMeters: 0, segment: from };
  for (let i = from; i < to; i++) {
    const { t, offset } = projectOnSegment(p, track.path[i], track.path[i + 1]);
    if (offset < best.offsetMeters) {
      best = { offsetMeters: offset, alongMeters: track.cum[i] + t * (track.cum[i + 1] - track.cum[i]), segment: i };
    }
  }
  return best;
}

/** Finds where on the route a position is. `hintSegment` (the previous result) keeps the search local, so a route that
 *  passes the same street twice cannot make the customer jump backwards; a full search is used if the local one is far off. */
export function snapToRoute(track: RouteTrack, p: LatLng, hintSegment = 0): RouteSnap {
  const last = track.path.length - 1;
  if (last < 1) return { offsetMeters: Infinity, alongMeters: 0, segment: 0 };
  const from = Math.max(0, Math.min(last - 1, hintSegment) - 5);
  const to = Math.min(last, Math.max(0, hintSegment) + 60);
  const local = scan(track, p, from, to);
  if (local.offsetMeters <= 60) return local;
  const full = scan(track, p, 0, last);
  return full.offsetMeters < local.offsetMeters ? full : local;
}
