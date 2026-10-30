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

export type UnitSystem = 'metric' | 'imperial';

const FOOT = 0.3048;
const MILE = 1609.344;

export type LengthUnit = 'auto' | 'm' | 'km' | 'ft' | 'mi';

export const LENGTH_UNITS: {value: LengthUnit; label: string; short: string}[] = [
  {value: 'auto', label: 'Auto', short: 'Auto'},
  {value: 'm', label: 'Metres', short: 'm'},
  {value: 'km', label: 'Kilometres', short: 'km'},
  {value: 'ft', label: 'Feet', short: 'ft'},
  {value: 'mi', label: 'Miles', short: 'mi'},
];

/**
 * A fixed unit, or `auto` by system: metric shows m below 1 km, then km;
 * imperial (US) shows ft below 0.1 mi (528 ft), then mi.
 */
export function formatDistance(
  metres: number,
  system: UnitSystem = 'metric',
  unit: LengthUnit = 'auto',
): string {
  switch (unit) {
    case 'm':
      return inUnit(metres, 'm', 0);
    case 'km':
      return inUnit(metres / 1000, 'km', 2);
    case 'ft':
      return inUnit(metres / FOOT, 'ft', 0);
    case 'mi':
      return inUnit(metres / MILE, 'mi', 2);
    case 'auto': {
      if (system === 'imperial') {
        const miles = metres / MILE;
        if (miles < 0.1) return formatDistance(metres, system, 'ft');
        return inUnit(miles, 'mi', miles < 100 ? 2 : 0);
      }
      if (metres < 1000) return formatDistance(metres, system, 'm');
      const km = metres / 1000;
      return inUnit(km, 'km', km < 100 ? 2 : 0);
    }
  }
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

export type AreaUnit = 'auto' | 'm2' | 'ha' | 'km2' | 'ft2' | 'ac' | 'mi2';

export const AREA_UNITS: {value: AreaUnit; label: string; short: string}[] = [
  {value: 'auto', label: 'Auto', short: 'Auto'},
  {value: 'm2', label: 'Square metres', short: 'm²'},
  {value: 'ha', label: 'Hectares', short: 'ha'},
  {value: 'km2', label: 'Square kilometres', short: 'km²'},
  {value: 'ft2', label: 'Square feet', short: 'ft²'},
  {value: 'ac', label: 'Acres', short: 'ac'},
  {value: 'mi2', label: 'Square miles', short: 'mi²'},
];

const SQ_FOOT = FOOT * FOOT;
const ACRE = 4046.8564224;
const SQ_MILE = MILE * MILE;

/** Below 1, three significant digits (0.0123 km²) so small areas stay visible. */
function inUnit(value: number, suffix: string, decimals: number) {
  const options =
    value !== 0 && value < 1
      ? {maximumSignificantDigits: 3}
      : {maximumFractionDigits: decimals};
  return `${value.toLocaleString('en', options)} ${suffix}`;
}

/**
 * `auto` follows the unit system: m² below 1 ha, ha below 1 km², then km²;
 * or ft² below 1 acre, acres below 1 mi², then mi².
 */
export function formatArea(m2: number, unit: AreaUnit = 'auto', system: UnitSystem = 'metric'): string {
  switch (unit) {
    case 'm2':
      return inUnit(m2, 'm²', 0);
    case 'ha':
      return inUnit(m2 / 10_000, 'ha', 2);
    case 'km2':
      return inUnit(m2 / 1_000_000, 'km²', 2);
    case 'ft2':
      return inUnit(m2 / SQ_FOOT, 'ft²', 0);
    case 'ac':
      return inUnit(m2 / ACRE, 'ac', 2);
    case 'mi2':
      return inUnit(m2 / SQ_MILE, 'mi²', 2);
    case 'auto': {
      if (system === 'imperial') {
        if (m2 < ACRE) return formatArea(m2, 'ft2');
        if (m2 < SQ_MILE) return formatArea(m2, 'ac');
        const mi2 = m2 / SQ_MILE;
        return inUnit(mi2, 'mi²', mi2 < 100 ? 2 : 0);
      }
      if (m2 < 10_000) return formatArea(m2, 'm2');
      if (m2 < 1_000_000) return formatArea(m2, 'ha');
      const km2 = m2 / 1_000_000;
      return inUnit(km2, 'km²', km2 < 100 ? 2 : 0);
    }
  }
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
