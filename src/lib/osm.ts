/**
 * Shapes from OpenStreetMap, all keyless public services:
 * - Nominatim: the outline (or line) of a searched place, one lookup per
 *   click (its policy forbids autocomplete and asks for ≤ 1 request/s).
 * - Overpass: routes (bus, metro, bike…), streets and rivers in the map view.
 * - Valhalla (FOSSGIS): snapping a line to roads.
 * Data © OpenStreetMap contributors, ODbL.
 */
import {parse, type ParsedLine} from './formats';
import {decode, type LatLng} from './polyline';

// --- Nominatim outlines -----------------------------------------------------

const NOMINATIM = 'https://nominatim.openstreetmap.org';

/**
 * Geometry for an OSM node/way/relation as lines or zones. Big areas are
 * simplified server-side (`polygon_threshold`, in degrees) relative to their
 * size, so a country does not arrive with hundreds of thousands of points.
 */
export async function fetchOutline(
  osm: {type: string; id: number},
  span: number,
  name: string,
  signal?: AbortSignal,
): Promise<ParsedLine[]> {
  const threshold = Math.min(0.01, Math.max(0.00001, span / 3000));
  const params = new URLSearchParams({
    osm_ids: `${osm.type}${osm.id}`,
    format: 'geojson',
    polygon_geojson: '1',
    polygon_threshold: String(threshold),
  });
  const response = await fetch(`${NOMINATIM}/lookup?${params}`, {signal});
  if (!response.ok) throw new Error(`Nominatim answered ${response.status}`);
  const data = (await response.json()) as {features?: {geometry: unknown}[]};
  const geometry = data.features?.[0]?.geometry;
  if (!geometry) throw new Error('No shape found for this place.');
  const result = parse(JSON.stringify(geometry), 'geojson', 5);
  if (!result.ok) throw new Error('This place is a single point, so it has no shape.');
  return result.lines.map((l, i, all) => ({
    ...l,
    name: all.length > 1 ? `${name} (${i + 1})` : name,
  }));
}

// --- Overpass ---------------------------------------------------------------

/** Tried in order: the main instance is often busy, the others mirror it. */
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export type OsmKind =
  | 'bus'
  | 'tram'
  | 'subway'
  | 'train'
  | 'bicycle'
  | 'hiking'
  | 'street'
  | 'river';

export const OSM_KINDS: {value: OsmKind; label: string}[] = [
  {value: 'bus', label: 'Bus routes'},
  {value: 'subway', label: 'Metro routes'},
  {value: 'tram', label: 'Tram routes'},
  {value: 'train', label: 'Train routes'},
  {value: 'bicycle', label: 'Bike routes'},
  {value: 'hiking', label: 'Hiking routes'},
  {value: 'street', label: 'Streets and roads'},
  {value: 'river', label: 'Rivers and canals'},
];

/** `[south, west, north, east]`, Overpass's bbox order. */
export type Bbox = [number, number, number, number];

export type OsmResult = {
  key: string;
  name: string;
  detail: string;
  /** What to fetch: one route relation, or every way sharing a name. */
  query: string;
};

/** Escapes text for an Overpass regex inside a double-quoted string. */
export const overpassRegex = (text: string) =>
  text.replace(/[\\"]/g, '\\$&').replace(/[.*+?^${}()|[\]]/g, '\\$&');

const bboxText = ([s, w, n, e]: Bbox) => [s, w, n, e].map((v) => v.toFixed(5)).join(',');

/** Overpass QL that lists candidates (tags only, no geometry yet). */
export function searchQuery(kind: OsmKind, name: string, bbox: Bbox): string {
  const b = bboxText(bbox);
  const filter = name.trim() ? overpassRegex(name.trim()) : '';
  if (kind === 'street' || kind === 'river') {
    const tag =
      kind === 'street'
        ? '["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|service|cycleway|footway|path|track)$"]'
        : '["waterway"~"^(river|stream|canal)$"]';
    const named = filter ? `["name"~"${filter}",i]` : '["name"]';
    return `[out:json][timeout:25];way${tag}${named}(${b});out tags 300;`;
  }
  const route = `["type"="route"]["route"="${kind === 'subway' ? 'subway' : kind}"]`;
  if (!filter) return `[out:json][timeout:25];relation${route}(${b});out tags 60;`;
  return `[out:json][timeout:25];(relation${route}["name"~"${filter}",i](${b});relation${route}["ref"~"^${filter}$",i](${b}););out tags 60;`;
}

type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: {lat: number; lon: number}[];
  members?: {type: string; role: string; geometry?: {lat: number; lon: number}[]}[];
};

/** The instance that answered last is tried first next time. */
let preferred = 0;

async function overpass(query: string, signal?: AbortSignal): Promise<OverpassElement[]> {
  let lastError: unknown;
  const order = [preferred, ...OVERPASS.keys()].filter((i, n, all) => all.indexOf(i) === n);
  for (const index of order) {
    const endpoint = OVERPASS[index]!;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    // Each instance gets 30 s; a busy one answers 429/504 or never.
    const timeout = AbortSignal.timeout(30_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: new URLSearchParams({data: query}),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) throw new Error(`${new URL(endpoint).host} answered ${response.status}`);
      const data = (await response.json()) as {elements?: OverpassElement[]; remark?: string};
      if (data.remark?.includes('runtime error')) throw new Error(data.remark);
      preferred = index;
      return data.elements ?? [];
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }
  throw new Error(
    `Overpass is busy right now (${lastError instanceof Error ? lastError.message : 'no answer'}). Try again in a minute, or zoom in.`,
  );
}

/** Turns tag-only results into a list; streets and rivers are grouped by name. */
export function toResults(kind: OsmKind, elements: OverpassElement[]): OsmResult[] {
  if (kind === 'street' || kind === 'river') {
    const byName = new Map<string, {ids: number[]; types: Set<string>}>();
    for (const el of elements) {
      const name = el.tags?.name;
      if (!name) continue;
      const entry = byName.get(name) ?? {ids: [], types: new Set()};
      entry.ids.push(el.id);
      entry.types.add(el.tags?.highway ?? el.tags?.waterway ?? '');
      byName.set(name, entry);
    }
    return [...byName.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, {ids, types}]) => ({
        key: `${kind}:${name}`,
        name,
        detail: `${[...types].filter(Boolean).join(', ').replace(/_/g, ' ')} · ${ids.length} ${ids.length === 1 ? 'segment' : 'segments'}`,
        query: `[out:json][timeout:25];way(id:${ids.join(',')});out geom;`,
      }));
  }
  return elements
    .filter((el) => el.type === 'relation')
    .map((el) => {
      const t = el.tags ?? {};
      const route = [t.from, t.to].filter(Boolean).join(' → ');
      const name = t.name ?? ([t.ref, route].filter(Boolean).join(' ') || `Route ${el.id}`);
      return {
        key: `r${el.id}`,
        name,
        detail: [t.ref && t.name ? `Ref ${t.ref}` : '', t.network ?? t.operator ?? ''].filter(Boolean).join(' · '),
        query: `[out:json][timeout:25];relation(${el.id});out geom;`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
}

export async function searchOsm(
  kind: OsmKind,
  name: string,
  bbox: Bbox,
  signal?: AbortSignal,
): Promise<OsmResult[]> {
  return toResults(kind, await overpass(searchQuery(kind, name, bbox), signal));
}

const key = ([lat, lng]: LatLng) => `${lat},${lng}`;

/**
 * Joins way geometries that share endpoints into as few lines as possible
 * (OSM splits a road or a route into many ways, in any direction).
 */
export function stitch(parts: LatLng[][]): LatLng[][] {
  const pending = parts.filter((p) => p.length >= 2).map((p) => [...p]);
  const lines: LatLng[][] = [];
  while (pending.length) {
    let line = pending.shift()!;
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < pending.length; i++) {
        const part = pending[i]!;
        const [start, end] = [key(line[0]!), key(line.at(-1)!)];
        const [pStart, pEnd] = [key(part[0]!), key(part.at(-1)!)];
        let joined: LatLng[] | null = null;
        if (end === pStart) joined = [...line, ...part.slice(1)];
        else if (end === pEnd) joined = [...line, ...part.slice(0, -1).reverse()];
        else if (start === pEnd) joined = [...part, ...line.slice(1)];
        else if (start === pStart) joined = [...part.slice(1).reverse(), ...line];
        if (joined) {
          line = joined;
          pending.splice(i, 1);
          grew = true;
          break;
        }
      }
    }
    lines.push(line);
  }
  return lines.sort((a, b) => b.length - a.length);
}

const toLatLngs = (geometry: {lat: number; lon: number}[] = []) =>
  geometry.map((p) => [p.lat, p.lon] as LatLng);

export async function fetchOsmGeometry(
  result: OsmResult,
  signal?: AbortSignal,
): Promise<ParsedLine[]> {
  const elements = await overpass(result.query, signal);
  const parts: LatLng[][] = [];
  for (const el of elements) {
    if (el.type === 'way') parts.push(toLatLngs(el.geometry));
    // Route relations: the way members, without stops and platforms.
    for (const m of el.members ?? []) {
      if (m.type === 'way' && !/platform|stop/.test(m.role)) parts.push(toLatLngs(m.geometry));
    }
  }
  const lines = stitch(parts);
  if (lines.length === 0) throw new Error('OpenStreetMap has no geometry for this result.');
  return lines.map((coords, i) => ({
    coords,
    name: lines.length > 1 ? `${result.name} (${i + 1})` : result.name,
  }));
}

// --- Valhalla routing -------------------------------------------------------

const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
/** The public instance accepts 10 locations per request. */
const LOCATIONS_PER_REQUEST = 10;
/** Up to 5 sequential requests (chunks share their end points). */
export const MAX_WAYPOINTS = 5 * (LOCATIONS_PER_REQUEST - 1) + 1;

export type Costing = 'auto' | 'bicycle' | 'pedestrian';
export const COSTINGS: {value: Costing; label: string}[] = [
  {value: 'auto', label: 'By car'},
  {value: 'bicycle', label: 'By bike'},
  {value: 'pedestrian', label: 'On foot'},
];

/** At most `max` points, evenly spread, always keeping both ends. */
export function sampleWaypoints(coords: LatLng[], max = MAX_WAYPOINTS): LatLng[] {
  if (coords.length <= max) return coords;
  return Array.from({length: max}, (_, i) => coords[Math.round((i * (coords.length - 1)) / (max - 1))]!);
}

/** Consecutive chunks of `size` that share their boundary point. */
export function chunkWaypoints<T>(points: T[], size = LOCATIONS_PER_REQUEST): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < points.length - 1; i += size - 1) {
    chunks.push(points.slice(i, i + size));
  }
  return chunks;
}

/**
 * Routes through the line's points (sampled to MAX_WAYPOINTS) and returns
 * the road geometry. Requests run one after another (the instance is shared);
 * Valhalla's shapes are precision-6 polylines.
 */
export async function snapToRoads(
  coords: LatLng[],
  costing: Costing,
  closed: boolean,
  signal?: AbortSignal,
): Promise<LatLng[]> {
  const ring = closed && coords.length > 2 ? [...coords, coords[0]!] : coords;
  const route: LatLng[] = [];
  for (const chunk of chunkWaypoints(sampleWaypoints(ring))) {
    const locations = chunk.map(([lat, lon]) => ({lat, lon}));
    const json = JSON.stringify({locations, costing, directions_type: 'none'});
    const response = await fetch(`${VALHALLA}?json=${encodeURIComponent(json)}`, {signal});
    const data = (await response.json()) as {trip?: {legs: {shape: string}[]}; error?: string};
    if (!response.ok || !data.trip) {
      throw new Error(data.error ?? `Routing failed (${response.status})`);
    }
    for (const leg of data.trip.legs) {
      const points = decode(leg.shape, 6);
      route.push(...(route.length ? points.slice(1) : points));
    }
  }
  // A routed zone comes back to its start; keep the ring without the repeat.
  return closed && route.length > 3 ? route.slice(0, -1) : route;
}
