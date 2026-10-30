import type {LatLng} from './polyline';

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine, mean Earth radius). */
export function distance([lat1, lng1]: LatLng, [lat2, lng2]: LatLng) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function lineLength(coords: LatLng[]) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += distance(coords[i - 1]!, coords[i]!);
  }
  return total;
}

export function formatDistance(metres: number) {
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return `${km.toLocaleString('en', {maximumFractionDigits: km < 100 ? 2 : 0})} km`;
}

export const formatCount = (n: number) =>
  `${n.toLocaleString('en')} ${n === 1 ? 'point' : 'points'}`;

/** `[[west, south], [east, north]]`, or null without coordinates. */
export function bounds(lines: LatLng[][]): [[number, number], [number, number]] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const coords of lines) {
    for (const [lat, lng] of coords) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  return west === Infinity ? null : [[west, south], [east, north]];
}
