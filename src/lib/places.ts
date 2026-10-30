/**
 * Place search with Photon (https://photon.komoot.io): OpenStreetMap data,
 * free, no key, CORS enabled and meant for search-as-you-type (Nominatim's
 * policy forbids autocomplete). Names come back in their local language.
 */
const PHOTON = 'https://photon.komoot.io/api/';

export type Place = {
  id: string;
  name: string;
  /** City, region and country, without repeating the name. */
  detail: string;
  /** OSM value such as "city", "museum" or "residential". */
  kind: string;
  lngLat: [number, number];
  /** `[[west, south], [east, north]]` when Photon has an extent. */
  bbox?: [[number, number], [number, number]];
  /** Zoom to use when there is no extent. */
  zoom: number;
};

type PhotonFeature = {
  geometry: {coordinates: [number, number]};
  properties: Record<string, unknown>;
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function toPlace(feature: PhotonFeature): Place {
  const p = feature.properties;
  const street = [str(p.street), str(p.housenumber)].filter(Boolean).join(' ');
  const name = str(p.name) ?? (street || str(p.city) || 'Unnamed place');
  const parts = [
    street !== name ? street : undefined,
    str(p.district),
    str(p.city),
    str(p.state),
    str(p.country),
  ].filter((part): part is string => !!part && part !== name);
  const detail = [...new Set(parts)].join(', ');
  const type = str(p.type);
  const extent = Array.isArray(p.extent) && p.extent.length === 4 ? (p.extent as number[]) : null;
  return {
    id: `${p.osm_type}${p.osm_id}`,
    name,
    detail,
    kind: (str(p.osm_value) ?? type ?? 'place').replace(/_/g, ' '),
    lngLat: feature.geometry.coordinates,
    // Photon's extent is [minLon, maxLat, maxLon, minLat].
    bbox: extent ? [[extent[0]!, extent[3]!], [extent[2]!, extent[1]!]] : undefined,
    zoom: type === 'house' ? 17 : type === 'street' ? 16 : type === 'country' ? 5 : 12,
  };
}

export async function searchPlaces(
  query: string,
  {signal, near}: {signal?: AbortSignal; near?: [number, number] | null} = {},
): Promise<Place[]> {
  const params = new URLSearchParams({q: query, limit: '8'});
  // Bias results towards what the map is showing.
  if (near) {
    params.set('lon', near[0].toFixed(4));
    params.set('lat', near[1].toFixed(4));
  }
  const response = await fetch(`${PHOTON}?${params}`, {signal});
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  const data = (await response.json()) as {features?: PhotonFeature[]};
  const places = (data.features ?? []).map(toPlace);
  // The same OSM object can come back twice (e.g. node and relation).
  return places.filter((p, i) => places.findIndex((q) => q.id === p.id) === i);
}
