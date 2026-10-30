import {
  decode,
  encode,
  firstOutOfRange,
  PolylineError,
  type LatLng,
  type Precision,
} from './polyline';

export type Format = 'encoded' | 'latlng' | 'lnglat' | 'geojson';

export const FORMATS: {value: Format; label: string; short: string}[] = [
  {value: 'encoded', label: 'Encoded polyline', short: 'Encoded'},
  {value: 'latlng', label: 'LatLng array', short: 'LatLng'},
  {value: 'lnglat', label: 'LngLat array', short: 'LngLat'},
  {value: 'geojson', label: 'GeoJSON', short: 'GeoJSON'},
];

export const formatLabel = (format: Format) =>
  FORMATS.find((f) => f.value === format)!.label;

/** One parsed line; `name` comes from a GeoJSON feature's properties. */
export type ParsedLine = {coords: LatLng[]; name?: string};

export type ParseResult =
  | {ok: true; lines: ParsedLine[]}
  | {ok: false; error: string; precision?: Precision};

const fail = (error: string, precision?: Precision): ParseResult => ({
  ok: false,
  error,
  precision,
});

/** Rounds to 9 decimals (sub-millimetre) to drop float noise in output. */
const clean = (n: number) => Math.round(n * 1e9) / 1e9;

function rangeError(coords: LatLng[], lineIndex: number, many: boolean) {
  const bad = firstOutOfRange(coords);
  if (bad === -1) return null;
  const [lat, lng] = coords[bad]!;
  const where = many ? `line ${lineIndex + 1}, point ${bad + 1}` : `point ${bad + 1}`;
  return `Out of range at ${where}: lat ${clean(lat)}, lng ${clean(lng)}. Latitude must be within ±90 and longitude within ±180.`;
}

function parseEncoded(text: string, precision: Precision): ParseResult {
  let source = text.trim();
  // A JSON string literal (with \\ escapes) pasted from code or a response.
  if (source.startsWith('"') && source.endsWith('"') && source.length > 1) {
    try {
      source = JSON.parse(source);
    } catch {
      return fail('This looks like a quoted string, but it is not valid JSON.');
    }
  }
  if (/^[[{]/.test(source)) {
    return fail(
      'This looks like JSON, not an encoded polyline. Pick the LatLng, LngLat or GeoJSON tab, or paste it to detect the format.',
    );
  }
  // Encoded polylines never contain whitespace, so each token is one line.
  const tokens = source.split(/\s+/).filter(Boolean);
  const lines: ParsedLine[] = [];
  for (const [i, token] of tokens.entries()) {
    let coords: LatLng[];
    try {
      coords = decode(token, precision);
    } catch (err) {
      const message = err instanceof PolylineError ? err.message : String(err);
      return fail(tokens.length > 1 ? `Line ${i + 1}: ${message}` : message);
    }
    const error = rangeError(coords, i, tokens.length > 1);
    if (error) {
      // Precision 6 read as 5 gives values 10× too big: suggest the other one.
      const other: Precision = precision === 5 ? 6 : 5;
      const otherOk = tokens.every((t) => {
        try {
          return firstOutOfRange(decode(t, other)) === -1;
        } catch {
          return false;
        }
      });
      return otherOk
        ? fail(
            `${error} It decodes correctly with precision ${other}.`,
            other,
          )
        : fail(error);
    }
    lines.push({coords});
  }
  return {ok: true, lines: lines.length ? lines : [{coords: []}]};
}

function parseJson(text: string): {ok: true; value: unknown} | {ok: false; error: string} {
  try {
    return {ok: true, value: JSON.parse(text)};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {ok: false, error: `Invalid JSON: ${message}`};
  }
}

const isNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isPosition = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length >= 2 && isNumber(v[0]) && isNumber(v[1]);

/** `{lat, lng}`, `{lat, lon}` or `{latitude, longitude}` objects. */
function objectLatLng(v: unknown): LatLng | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const lat = o.lat ?? o.latitude;
  const lng = o.lng ?? o.lon ?? o.long ?? o.longitude;
  return isNumber(lat) && isNumber(lng) ? [lat, lng] : null;
}

function toLine(items: unknown[], order: 'latlng' | 'lnglat', line?: number) {
  const coords: LatLng[] = [];
  for (const [i, item] of items.entries()) {
    const fromObject = objectLatLng(item);
    if (fromObject) {
      coords.push(fromObject);
    } else if (isPosition(item)) {
      const [a, b] = item;
      coords.push(order === 'latlng' ? [a!, b!] : [b!, a!]);
    } else {
      const pair = order === 'latlng' ? '[lat, lng]' : '[lng, lat]';
      const where = line === undefined ? '' : `Line ${line + 1}, `;
      return `${where}item ${i + 1} is not a ${pair} pair: ${JSON.stringify(item)?.slice(0, 60)}`;
    }
  }
  return coords;
}

function parseArray(text: string, order: 'latlng' | 'lnglat'): ParseResult {
  const json = parseJson(text);
  if (!json.ok) return fail(json.error);
  const value = json.value;
  if (!Array.isArray(value)) {
    return fail(
      `Expected an array of ${order === 'latlng' ? '[lat, lng]' : '[lng, lat]'} pairs.`,
    );
  }
  // An array of lines: [[[a, b], …], [[a, b], …]].
  const nested =
    value.length > 0 && value.every((v) => Array.isArray(v) && v.length > 0 && v.every((p) => isPosition(p) || objectLatLng(p)));
  const groups = nested ? (value as unknown[][]) : [value];
  const lines: ParsedLine[] = [];
  for (const [i, group] of groups.entries()) {
    const coords = toLine(group, order, nested ? i : undefined);
    if (typeof coords === 'string') return fail(coords);
    const error = rangeError(coords, i, nested);
    if (error) {
      const other = order === 'latlng' ? 'LngLat' : 'LatLng';
      return fail(`${error} Maybe the pairs are in ${other} order?`);
    }
    lines.push({coords});
  }
  return {ok: true, lines};
}

type GeoJsonLike = {type?: unknown; [key: string]: unknown};

function collectGeoJson(
  node: GeoJsonLike,
  lines: ParsedLine[],
  skipped: Set<string>,
  name?: string,
): string | null {
  const positions = (coords: unknown, label: string) => {
    if (!Array.isArray(coords) || !coords.every(isPosition)) {
      return `${label} coordinates must be an array of [lng, lat] positions.`;
    }
    lines.push({
      coords: coords.map(([lng, lat]) => [lat!, lng!] as LatLng),
      name,
    });
    return null;
  };
  switch (node.type) {
    case 'LineString':
      return positions(node.coordinates, 'LineString');
    case 'MultiLineString': {
      if (!Array.isArray(node.coordinates)) {
        return 'MultiLineString coordinates must be an array of lines.';
      }
      for (const coords of node.coordinates) {
        const error = positions(coords, 'MultiLineString');
        if (error) return error;
      }
      return null;
    }
    case 'Feature': {
      const props = node.properties as Record<string, unknown> | null;
      const featureName =
        typeof props?.name === 'string' && props.name.trim()
          ? props.name.trim()
          : undefined;
      if (!node.geometry) return null;
      return collectGeoJson(node.geometry as GeoJsonLike, lines, skipped, featureName);
    }
    case 'FeatureCollection':
      if (!Array.isArray(node.features)) return 'FeatureCollection needs a features array.';
      for (const feature of node.features) {
        const error = collectGeoJson(feature as GeoJsonLike, lines, skipped);
        if (error) return error;
      }
      return null;
    case 'GeometryCollection':
      if (!Array.isArray(node.geometries)) return 'GeometryCollection needs a geometries array.';
      for (const geometry of node.geometries) {
        const error = collectGeoJson(geometry as GeoJsonLike, lines, skipped, name);
        if (error) return error;
      }
      return null;
    case 'Point':
    case 'MultiPoint':
    case 'Polygon':
    case 'MultiPolygon':
      skipped.add(node.type);
      return null;
    default:
      return `Unknown GeoJSON type ${JSON.stringify(node.type)}.`;
  }
}

function parseGeoJson(text: string): ParseResult {
  const json = parseJson(text);
  if (!json.ok) return fail(json.error);
  const value = json.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('Expected a GeoJSON object (LineString, Feature or FeatureCollection).');
  }
  const lines: ParsedLine[] = [];
  const skipped = new Set<string>();
  const error = collectGeoJson(value as GeoJsonLike, lines, skipped);
  if (error) return fail(error);
  if (lines.length === 0) {
    return fail(
      skipped.size
        ? `No lines found (only ${[...skipped].join(', ')}). Polylines need a LineString or MultiLineString.`
        : 'No lines found. Polylines need a LineString or MultiLineString.',
    );
  }
  for (const [i, line] of lines.entries()) {
    const error = rangeError(line.coords, i, lines.length > 1);
    if (error) return fail(error);
  }
  return {ok: true, lines};
}

/**
 * Parses text in one format. Empty text is a valid empty line. Several lines
 * come back from whitespace-separated encoded polylines, nested arrays,
 * MultiLineStrings and FeatureCollections.
 */
export function parse(text: string, format: Format, precision: Precision): ParseResult {
  if (text.trim() === '') return {ok: true, lines: [{coords: []}]};
  switch (format) {
    case 'encoded':
      return parseEncoded(text, precision);
    case 'latlng':
    case 'lnglat':
      return parseArray(text, format);
    case 'geojson':
      return parseGeoJson(text);
  }
}

/** Guesses the format of pasted text; `null` when it cannot tell. */
export function detectFormat(text: string): Format | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('{')) return 'geojson';
  if (!t.startsWith('[')) return 'encoded';
  const json = parseJson(t);
  if (!json.ok || !Array.isArray(json.value)) return null;
  const flat: unknown[] = json.value.flatMap((v: unknown) =>
    Array.isArray(v) && v.some((p) => Array.isArray(p) || objectLatLng(p)) ? v : [v],
  );
  if (flat.some((v) => objectLatLng(v))) return 'latlng';
  if (flat.some((v) => v && typeof v === 'object' && 'type' in v)) return 'geojson';
  const pairs = flat.filter(isPosition);
  if (!pairs.length) return null;
  if (pairs.some(([a]) => Math.abs(a!) > 90)) return 'lnglat';
  if (pairs.some(([, b]) => Math.abs(b!) > 90)) return 'latlng';
  return null;
}

const pair = (a: number, b: number) => `[${clean(a)}, ${clean(b)}]`;

/** One pair per row, so long lines stay readable. */
function pairsArray(coords: LatLng[], order: 'latlng' | 'lnglat', indent = '') {
  const rows = coords.map(([lat, lng]) =>
    order === 'latlng' ? pair(lat, lng) : pair(lng, lat),
  );
  return `[\n${rows.map((r) => `${indent}  ${r}`).join(',\n')}\n${indent}]`;
}

export function toGeoJsonFeature(coords: LatLng[], name?: string) {
  return {
    type: 'Feature' as const,
    properties: name ? {name} : {},
    geometry: {
      type: 'LineString' as const,
      coordinates: coords.map(([lat, lng]) => [clean(lng), clean(lat)]),
    },
  };
}

/** JSON with each [lng, lat] position kept on one row. */
export function stringifyGeoJson(value: unknown) {
  return JSON.stringify(value, null, 2).replace(
    /\[\s+(-?[\d.eE+-]+),\s+(-?[\d.eE+-]+)\s+\]/g,
    '[$1, $2]',
  );
}

export function serialize(
  coords: LatLng[],
  format: Format,
  precision: Precision,
  name?: string,
): string {
  if (coords.length === 0) return '';
  switch (format) {
    case 'encoded':
      return encode(coords, precision);
    case 'latlng':
    case 'lnglat':
      return pairsArray(coords, format);
    case 'geojson':
      return stringifyGeoJson(toGeoJsonFeature(coords, name));
  }
}

/** Every line as one document, for "copy all". */
export function serializeAll(
  lines: {coords: LatLng[]; name: string}[],
  format: Format,
  precision: Precision,
): string {
  const nonEmpty = lines.filter((l) => l.coords.length > 0);
  if (nonEmpty.length === 0) return '';
  switch (format) {
    case 'encoded':
      return nonEmpty.map((l) => encode(l.coords, precision)).join('\n');
    case 'latlng':
    case 'lnglat':
      return nonEmpty.length === 1
        ? pairsArray(nonEmpty[0]!.coords, format)
        : `[\n${nonEmpty.map((l) => `  ${pairsArray(l.coords, format, '  ')}`).join(',\n')}\n]`;
    case 'geojson':
      return stringifyGeoJson({
        type: 'FeatureCollection',
        features: nonEmpty.map((l) => toGeoJsonFeature(l.coords, l.name)),
      });
  }
}
