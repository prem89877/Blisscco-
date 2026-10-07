import { checkIndiaCoords } from '../india';
import { navConfig } from './config';
import type { Destination, LatLng } from './types';
import { NavigationError } from './types';

// Shops normally store coordinates. Only when those are missing or invalid is the address turned into coordinates,
// through Blisscco's own backend (/api/geocode), so the geocoding provider and any key stay on the server.

export interface GeocodingProvider {
  geocode(address: string, signal?: AbortSignal): Promise<LatLng | null>;
}

export class ServerGeocodingProvider implements GeocodingProvider {
  async geocode(address: string, signal?: AbortSignal): Promise<LatLng | null> {
    let res: Response;
    try {
      res = await fetch(`${navConfig.geocodeEndpoint}?q=${encodeURIComponent(address)}`, { signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new NavigationError(navigator.onLine === false ? 'network_unavailable' : 'provider_unavailable');
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new NavigationError('provider_unavailable');
    const j = (await res.json()) as { lat?: unknown; lng?: unknown };
    return typeof j.lat === 'number' && typeof j.lng === 'number' ? { lat: j.lat, lng: j.lng } : null;
  }
}

let geocoder: GeocodingProvider = new ServerGeocodingProvider();
export function setGeocodingProvider(p: GeocodingProvider): void { geocoder = p; }

export interface ShopLocationInput {
  name: string;
  latitude: number | null;
  longitude: number | null;
  address_line?: string | null; city?: string | null; state?: string | null; pincode?: string | null;
}

/** Builds the navigation destination from a shop's stored data. Throws NavigationError('destination_unavailable') when no valid point exists. */
export async function resolveDestination(shop: ShopLocationInput, signal?: AbortSignal): Promise<Destination> {
  const address = [shop.address_line, shop.city, shop.state, shop.pincode].filter(Boolean).join(', ') || null;
  if (checkIndiaCoords(shop.latitude, shop.longitude).ok) {
    return { name: shop.name, address, position: { lat: shop.latitude as number, lng: shop.longitude as number } };
  }
  if (!address) throw new NavigationError('destination_unavailable');
  const found = await geocoder.geocode(`${address}, India`, signal);
  if (!found || !checkIndiaCoords(found.lat, found.lng).ok) throw new NavigationError('destination_unavailable');
  return { name: shop.name, address, position: found };
}
