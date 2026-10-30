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

/** Length including the segment back to the start for a closed line. */
export const perimeter = (coords: LatLng[], closed?: boolean) =>
  lineLength(closed && coords.length > 2 ? [...coords, coords[0]!] : coords);

/**
 * Area of a ring in square metres, on a sphere (the same approximation as
 * turf's `area`: Chamberlain & Duquette, "Some algorithms for polygons on a
 * sphere", 2007).
 */
export function ringArea(coords: LatLng[]) {
  if (coords.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < coords.length; i++) {
    const [, lng1] = coords[i]!;
    const [lat2, lng2] = coords[(i + 1) % coords.length]!;
    const [, lng3] = coords[(i + 2) % coords.length]!;
    total += (rad(lng3) - rad(lng1)) * Math.sin(rad(lat2));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

export function formatArea(m2: number) {
  if (m2 < 10_000) return `${Math.round(m2).toLocaleString('en')} m²`;
  if (m2 < 1_000_000) {
    return `${(m2 / 10_000).toLocaleString('en', {maximumFractionDigits: 2})} ha`;
  }
  const km2 = m2 / 1_000_000;
  return `${km2.toLocaleString('en', {maximumFractionDigits: km2 < 100 ? 2 : 0})} km²`;
}

/** Initial bearing from a to b, in degrees clockwise from north (0–360). */
export function bearing([lat1, lng1]: LatLng, [lat2, lng2]: LatLng) {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8]!;

export type Segment = {distance: number; cumulative: number; bearing: number | null};

/** Per point: distance from the previous point, running total and bearing. */
export function segments(coords: LatLng[]): Segment[] {
  let cumulative = 0;
  return coords.map((point, i) => {
    if (i === 0) return {distance: 0, cumulative: 0, bearing: null};
    const prev = coords[i - 1]!;
    const d = distance(prev, point);
    cumulative += d;
    return {distance: d, cumulative, bearing: d > 0 ? bearing(prev, point) : null};
  });
}

/**
 * Douglas–Peucker with a tolerance in metres. Points are projected to a local
 * equirectangular plane around the line's mean latitude, which is accurate
 * enough for the scales a tolerance applies to. Closed lines keep at least 3
 * points; open lines always keep both ends.
 */
export function simplify(coords: LatLng[], toleranceM: number, closed?: boolean): LatLng[] {
  if (coords.length <= 2 || toleranceM <= 0) return coords;
  const meanLat = coords.reduce((s, [lat]) => s + lat, 0) / coords.length;
  const kx = rad(1) * EARTH_RADIUS_M * Math.cos(rad(meanLat));
  const ky = rad(1) * EARTH_RADIUS_M;
  const xy = coords.map(([lat, lng]) => [lng * kx, lat * ky] as const);

  const keep = new Uint8Array(coords.length);
  const run = (first: number, last: number) => {
    // Iterative to survive lines with hundreds of thousands of points.
    const stack: [number, number][] = [[first, last]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      const [ax, ay] = xy[a]!;
      const [bx, by] = xy[b]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let maxD = -1;
      let index = -1;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = xy[i]!;
        let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        if (d > maxD) {
          maxD = d;
          index = i;
        }
      }
      if (index !== -1 && maxD > toleranceM) {
        keep[index] = 1;
        stack.push([a, index], [index, b]);
      }
    }
  };

  keep[0] = 1;
  keep[coords.length - 1] = 1;
  if (closed) {
    // Split the ring at the point farthest from the start, so both halves
    // are simplified as open chains.
    let far = 1;
    for (let i = 1; i < coords.length; i++) {
      if (distance(coords[0]!, coords[i]!) > distance(coords[0]!, coords[far]!)) far = i;
    }
    keep[far] = 1;
    run(0, far);
    run(far, coords.length - 1);
  } else {
    run(0, coords.length - 1);
  }
  const result = coords.filter((_, i) => keep[i]);
  return closed && result.length < 3 ? coords : result;
}
