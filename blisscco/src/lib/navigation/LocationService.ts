import type { UserLocation } from './types';
import { NavigationError } from './types';

// Browser Geolocation wrapper. Nothing here runs until a function is called, so opening a shop page never asks for permission.

export type PermissionResult = 'granted' | 'denied' | 'prompt' | 'unknown';

export function isGeolocationSupported(): boolean {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return false;
  return typeof window === 'undefined' || window.isSecureContext !== false;   // geolocation only works over HTTPS
}

/** Reads the permission state WITHOUT triggering the prompt. 'unknown' where the Permissions API is missing (e.g. older Safari). */
export async function getPermissionState(): Promise<PermissionResult> {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    const s = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return s.state;
  } catch {
    return 'unknown';
  }
}

/** Calls cb once if the customer grants permission while the prompt is open. Returns a cleanup function. */
export function onPermissionGranted(cb: () => void): () => void {
  let status: PermissionStatus | null = null;
  let active = true;
  const handler = () => { if (status?.state === 'granted') cb(); };
  void navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    .then((s) => { if (!active) return; status = s; s.addEventListener('change', handler); })
    .catch(() => undefined);
  return () => { active = false; status?.removeEventListener('change', handler); };
}

function toError(err: GeolocationPositionError): NavigationError {
  if (err.code === err.PERMISSION_DENIED) return new NavigationError('location_denied');
  if (err.code === err.TIMEOUT) return new NavigationError('location_timeout');
  return new NavigationError('location_unavailable');
}

function toLocation(pos: GeolocationPosition): UserLocation {
  const { latitude, longitude, accuracy, heading } = pos.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new NavigationError('location_unavailable');
  return {
    position: { lat: latitude, lng: longitude },
    accuracyMeters: Number.isFinite(accuracy) ? accuracy : null,
    headingDegrees: typeof heading === 'number' && Number.isFinite(heading) ? heading : null,   // null when stationary / no compass: never required
    timestamp: pos.timestamp,
  };
}

interface FixOptions { highAccuracy: boolean; timeoutMs: number; maximumAgeMs: number }

function getFix(o: FixOptions): Promise<UserLocation> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => { try { resolve(toLocation(pos)); } catch (e) { reject(e); } },
      (err) => reject(toError(err)),
      { enableHighAccuracy: o.highAccuracy, timeout: o.timeoutMs, maximumAge: o.maximumAgeMs },
    );
  });
}

/** One position fix for starting navigation. High accuracy first; if the GPS is slow, one quick retry with network location. */
export async function locateForNavigation(): Promise<UserLocation> {
  if (!isGeolocationSupported()) throw new NavigationError('browser_unsupported');
  try {
    return await getFix({ highAccuracy: true, timeoutMs: 15000, maximumAgeMs: 0 });
  } catch (e) {
    if (e instanceof NavigationError && e.code === 'location_timeout') {
      return getFix({ highAccuracy: false, timeoutMs: 10000, maximumAgeMs: 60000 });
    }
    throw e;
  }
}

/** Continuous tracking for ACTIVE navigation only. Always call the returned function to stop it.
 *  A timeout or a lost signal is reported through onError but the watcher keeps running, so tracking resumes by itself. */
export function watchLocation(onUpdate: (l: UserLocation) => void, onError: (e: NavigationError) => void): () => void {
  if (!isGeolocationSupported()) { onError(new NavigationError('browser_unsupported')); return () => undefined; }
  const id = navigator.geolocation.watchPosition(
    (pos) => { try { onUpdate(toLocation(pos)); } catch (e) { onError(e as NavigationError); } },
    (err) => onError(toError(err)),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 2000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

/** Everything the navigation controller needs from the device, as one object so tests can replace it. */
export interface LocationPort {
  isSupported(): boolean;
  permissionState(): Promise<PermissionResult>;
  onPermissionGranted(cb: () => void): () => void;
  locateOnce(): Promise<UserLocation>;
  watch(onUpdate: (l: UserLocation) => void, onError: (e: NavigationError) => void): () => void;
}

export const browserLocation: LocationPort = {
  isSupported: isGeolocationSupported,
  permissionState: getPermissionState,
  onPermissionGranted,
  locateOnce: locateForNavigation,
  watch: watchLocation,
};
