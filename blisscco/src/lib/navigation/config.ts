// Map / routing / geocoding configuration. Everything that may change per environment lives here.
//
// Browser-side variables (safe to expose, all optional):
//   VITE_MAP_PROVIDER          'leaflet' (default)
//   VITE_MAP_TILE_URL          tile template, default = Esri World Imagery (satellite). Use https://tile.openstreetmap.org/{z}/{x}/{y}.png for the plain street map.
//   VITE_MAP_LABELS_URL        optional overlay drawn on top of the satellite tiles (streets / lanes / place names). Default = Esri transportation + places.
//                              Set it to 'none' to hide the overlay (e.g. when using a street map).
//   VITE_MAP_TILE_ATTRIBUTION  HTML attribution text required by the tile provider
//   VITE_MAP_TILE_MAX_ZOOM     default 19
//   VITE_MAP_TILE_NATIVE_ZOOM  deepest zoom the tile server really has pictures for (default 18); deeper zoom stretches the last picture instead of going blank
//   VITE_MAP_TILE_SUBDOMAINS   only if the tile URL contains {s}
//   VITE_ROUTING_ENDPOINT      default /api/route  (our own server function; the real routing provider is chosen there)
//   VITE_GEOCODE_ENDPOINT      default /api/geocode
// Secret keys never go here: routing and geocoding providers are called from /api/route and /api/geocode.

const env: Record<string, string | undefined> = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};   // `?? {}` only matters outside Vite (unit tests)
const text = (v: string | undefined, fallback: string): string => (v && v.trim() ? v.trim() : fallback);

export const navConfig = {
  mapProvider: text(env.VITE_MAP_PROVIDER, 'leaflet'),
  tileUrl: text(env.VITE_MAP_TILE_URL, 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'),
  /** Roads, lanes and place names drawn over the satellite picture. Empty = no overlay. */
  overlayUrls: (() => {
    const v = text(env.VITE_MAP_LABELS_URL, '');
    if (v.toLowerCase() === 'none') return [] as string[];
    if (v) return [v];
    return [
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    ];
  })(),
  tileAttribution: text(
    env.VITE_MAP_TILE_ATTRIBUTION,
    'Imagery &copy; <a href="https://www.esri.com" target="_blank" rel="noopener noreferrer">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
  ),
  tileMaxZoom: Number(env.VITE_MAP_TILE_MAX_ZOOM) > 0 ? Number(env.VITE_MAP_TILE_MAX_ZOOM) : 19,
  tileNativeZoom: Number(env.VITE_MAP_TILE_NATIVE_ZOOM) > 0 ? Number(env.VITE_MAP_TILE_NATIVE_ZOOM) : 18,
  tileSubdomains: text(env.VITE_MAP_TILE_SUBDOMAINS, 'abc'),
  routingEndpoint: text(env.VITE_ROUTING_ENDPOINT, '/api/route'),
  geocodeEndpoint: text(env.VITE_GEOCODE_ENDPOINT, '/api/geocode'),
} as const;
