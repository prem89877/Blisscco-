// Map / routing / geocoding configuration. Everything that may change per environment lives here.
//
// Browser-side variables (safe to expose, all optional):
//   VITE_MAP_PROVIDER          'leaflet' (default)
//   VITE_MAP_TILE_URL          tile template, default = public OpenStreetMap server (fine for testing, NOT for heavy production traffic)
//   VITE_MAP_TILE_ATTRIBUTION  HTML attribution text required by the tile provider
//   VITE_MAP_TILE_MAX_ZOOM     default 19
//   VITE_MAP_TILE_SUBDOMAINS   only if the tile URL contains {s}
//   VITE_ROUTING_ENDPOINT      default /api/route  (our own server function; the real routing provider is chosen there)
//   VITE_GEOCODE_ENDPOINT      default /api/geocode
// Secret keys never go here: routing and geocoding providers are called from /api/route and /api/geocode.

const env: Record<string, string | undefined> = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};   // `?? {}` only matters outside Vite (unit tests)
const text = (v: string | undefined, fallback: string): string => (v && v.trim() ? v.trim() : fallback);

export const navConfig = {
  mapProvider: text(env.VITE_MAP_PROVIDER, 'leaflet'),
  tileUrl: text(env.VITE_MAP_TILE_URL, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  tileAttribution: text(
    env.VITE_MAP_TILE_ATTRIBUTION,
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  ),
  tileMaxZoom: Number(env.VITE_MAP_TILE_MAX_ZOOM) > 0 ? Number(env.VITE_MAP_TILE_MAX_ZOOM) : 19,
  tileSubdomains: text(env.VITE_MAP_TILE_SUBDOMAINS, 'abc'),
  routingEndpoint: text(env.VITE_ROUTING_ENDPOINT, '/api/route'),
  geocodeEndpoint: text(env.VITE_GEOCODE_ENDPOINT, '/api/geocode'),
} as const;
