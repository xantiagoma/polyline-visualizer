import {detectFormat, parse, ringOf, stringifyGeoJson, toGeoJsonFeature, type ParsedLine} from './formats';
import {firstOutOfRange, type LatLng, type Precision} from './polyline';

/**
 * GPX and KML import/export. The XML is read with small regular expressions
 * rather than DOMParser so the same code runs in tests (Bun has no DOM); both
 * formats are flat enough for that: GPX tracks and routes are lists of
 * `<trkpt lat lon>`, KML geometry is a whitespace-separated `<coordinates>`.
 */

export type ImportResult = {lines: ParsedLine[]; notes: string[]};

export type FileKind = 'geojson' | 'gpx' | 'kml';

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};

function unescapeXml(text: string) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (match, code: string) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) ? String.fromCodePoint(n) : match;
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .trim();
}

const escapeXml = (text: string) =>
  text.replace(/[<>&"']/g, (c) => `&${{'<': 'lt', '>': 'gt', '&': 'amp', '"': 'quot', "'": 'apos'}[c]};`);

/** Text of the first `<tag>` directly in `xml` (ignores nested blocks' names). */
function childText(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i'));
  return match ? unescapeXml(match[1]!) || undefined : undefined;
}

/** Every `<tag>…</tag>` block (namespace prefixes allowed). */
function blocks(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'gi'))].map(
    (m) => m[1]!,
  );
}

function attr(tagText: string, name: string) {
  const m = tagText.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? Number(m[1]) : NaN;
}

function gpxPoints(xml: string, tag: 'trkpt' | 'rtept'): LatLng[] {
  return [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))]
    .map((m) => [attr(m[1]!, 'lat'), attr(m[1]!, 'lon')] as LatLng)
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
}

export function parseGpx(xml: string): ImportResult {
  const lines: ParsedLine[] = [];
  for (const trk of blocks(xml, 'trk')) {
    const name = childText(trk.replace(/<trkseg[\s\S]*?<\/trkseg>/gi, ''), 'name');
    const segs = blocks(trk, 'trkseg');
    segs.forEach((seg, i) => {
      const coords = gpxPoints(seg, 'trkpt');
      if (coords.length) {
        lines.push({coords, name: name && segs.length > 1 ? `${name} (${i + 1})` : name});
      }
    });
  }
  for (const rte of blocks(xml, 'rte')) {
    const coords = gpxPoints(rte, 'rtept');
    const name = childText(rte.replace(/<rtept[\s\S]*?(<\/rtept>|\/>)/gi, ''), 'name');
    if (coords.length) lines.push({coords, name});
  }
  const waypoints = (xml.match(/<wpt\b/gi) ?? []).length;
  return {
    lines,
    notes: waypoints && lines.length ? [`${waypoints} waypoints were skipped.`] : [],
  };
}

function kmlCoordinates(text: string): LatLng[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tuple) => {
      const [lng, lat] = tuple.split(',').map(Number);
      return [lat!, lng!] as LatLng;
    })
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
}

export function parseKml(xml: string): ImportResult {
  const lines: ParsedLine[] = [];
  let holes = 0;
  for (const placemark of blocks(xml, 'Placemark')) {
    const name = childText(placemark.replace(/<(\w+:)?(LineString|Polygon|MultiGeometry)\b[\s\S]*/i, ''), 'name');
    const found: ParsedLine[] = [];
    for (const line of blocks(placemark, 'LineString')) {
      const coords = kmlCoordinates(childText(line, 'coordinates') ?? '');
      if (coords.length) found.push({coords, name});
    }
    for (const polygon of blocks(placemark, 'Polygon')) {
      holes += blocks(polygon, 'innerBoundaryIs').length;
      const outer = blocks(polygon, 'outerBoundaryIs')[0] ?? '';
      let coords = kmlCoordinates(childText(outer, 'coordinates') ?? '');
      const [first, last] = [coords[0], coords.at(-1)];
      if (first && last && coords.length > 1 && first[0] === last[0] && first[1] === last[1]) {
        coords = coords.slice(0, -1);
      }
      if (coords.length >= 3) found.push({coords, name, closed: true});
    }
    found.forEach((line, i) =>
      lines.push(found.length > 1 && name ? {...line, name: `${name} (${i + 1})`} : line),
    );
  }
  return {
    lines,
    notes: holes ? ['Polygon holes are not supported; only the outlines were kept.'] : [],
  };
}

/**
 * Reads a dropped or picked file's text. GPX and KML by content; anything
 * else goes through the same detection as pasted text (GeoJSON, arrays or
 * encoded polylines, one per line).
 */
export function importText(text: string, fileName = '', precision: Precision = 5): ImportResult | {error: string} {
  const head = text.slice(0, 2000);
  let result: ImportResult;
  if (/\.gpx$/i.test(fileName) || /<gpx\b/i.test(head)) {
    result = parseGpx(text);
  } else if (/\.kml$/i.test(fileName) || /<kml\b/i.test(head)) {
    result = parseKml(text);
  } else {
    const format = detectFormat(text) ?? 'latlng';
    const parsed = parse(text, format, precision);
    if (!parsed.ok) return {error: parsed.error};
    result = {lines: parsed.lines, notes: parsed.notes ?? []};
  }
  result.lines = result.lines.filter((l) => l.coords.length > 0);
  if (result.lines.length === 0) return {error: 'No lines or polygons found in this file.'};
  const bad = result.lines.findIndex((l) => firstOutOfRange(l.coords) !== -1);
  if (bad !== -1) return {error: `Line ${bad + 1} has coordinates out of range.`};
  return result;
}

type ExportLine = {coords: LatLng[]; name: string; closed?: boolean; color?: string};

const fixed = (n: number) => String(Math.round(n * 1e7) / 1e7);

export function toGpx(lines: ExportLine[]) {
  const tracks = lines
    .filter((l) => l.coords.length)
    .map((l) => {
      const points = ringOf(l.coords, l.closed)
        .map(([lat, lng]) => `      <trkpt lat="${fixed(lat)}" lon="${fixed(lng)}"/>`)
        .join('\n');
      return `  <trk>\n    <name>${escapeXml(l.name)}</name>\n    <trkseg>\n${points}\n    </trkseg>\n  </trk>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Polyline Visualizer" xmlns="http://www.topografix.com/GPX/1/1">
${tracks}
</gpx>
`;
}

/** KML colours are aabbggrr. */
const kmlColor = (hex = '#2563eb', alpha = 'ff') => {
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)];
  return `${alpha}${b}${g}${r}`.toLowerCase();
};

export function toKml(lines: ExportLine[], documentName = 'Polyline Visualizer') {
  const placemarks = lines
    .filter((l) => l.coords.length)
    .map((l) => {
      const coordinates = ringOf(l.coords, l.closed)
        .map(([lat, lng]) => `${fixed(lng)},${fixed(lat)}`)
        .join(' ');
      const style = `<Style><LineStyle><color>${kmlColor(l.color)}</color><width>4</width></LineStyle>${
        l.closed ? `<PolyStyle><color>${kmlColor(l.color, '40')}</color></PolyStyle>` : ''
      }</Style>`;
      const geometry = l.closed
        ? `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordinates}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
        : `<LineString><tessellate>1</tessellate><coordinates>${coordinates}</coordinates></LineString>`;
      return `    <Placemark>\n      <name>${escapeXml(l.name)}</name>\n      ${style}\n      ${geometry}\n    </Placemark>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(documentName)}</name>
${placemarks}
  </Document>
</kml>
`;
}

export function toGeoJsonFile(lines: ExportLine[]) {
  const features = lines
    .filter((l) => l.coords.length)
    .map((l) => toGeoJsonFeature(l.coords, l.name, l.closed));
  return `${stringifyGeoJson({type: 'FeatureCollection', features})}\n`;
}

export const FILE_TYPES: Record<FileKind, {label: string; ext: string; mime: string}> = {
  geojson: {label: 'GeoJSON', ext: 'geojson', mime: 'application/geo+json'},
  gpx: {label: 'GPX', ext: 'gpx', mime: 'application/gpx+xml'},
  kml: {label: 'KML', ext: 'kml', mime: 'application/vnd.google-earth.kml+xml'},
};

export function exportFile(lines: ExportLine[], kind: FileKind, name: string) {
  const content =
    kind === 'gpx' ? toGpx(lines) : kind === 'kml' ? toKml(lines, name) : toGeoJsonFile(lines);
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'polylines';
  return {content, fileName: `${slug}.${FILE_TYPES[kind].ext}`, mime: FILE_TYPES[kind].mime};
}
