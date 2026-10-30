import {detectFormat, detectRing, parse, ringOf, stringifyGeoJson, toGeoJsonFeature, type ParsedLine} from './formats';
import {segments} from './geo';
import {firstOutOfRange, type LatLng, type Precision} from './polyline';

/**
 * GPX and KML import/export. The XML is read with small regular expressions
 * rather than DOMParser so the same code runs in tests (Bun has no DOM); both
 * formats are flat enough for that: GPX tracks and routes are lists of
 * `<trkpt lat lon>`, KML geometry is a whitespace-separated `<coordinates>`.
 */

export type ImportResult = {lines: ParsedLine[]; notes: string[]};

export type FileKind = 'geojson' | 'gpx' | 'kml' | 'csv' | 'tsv';

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

// --- CSV / TSV ---------------------------------------------------------------

/** Splits one delimited line, honouring "quoted, fields" with "" escapes. */
function splitRow(line: string, delimiter: string): string[] {
  if (delimiter === '\t') return line.split('\t');
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (c === delimiter) {
      cells.push(cell);
      cell = '';
    } else {
      cell += c;
    }
  }
  cells.push(cell);
  return cells.map((v) => v.trim());
}

/** Splits rows, keeping line breaks that are inside quotes. */
function splitLines(text: string): string[] {
  const rows: string[] = [];
  let row = '';
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    if ((c === '\n' || c === '\r') && !quoted) {
      if (row.trim()) rows.push(row);
      row = '';
    } else {
      row += c;
    }
  }
  if (row.trim()) rows.push(row);
  return rows;
}

const LAT = /^(lat|latitude|y)$/i;
const LNG = /^(lng|lon|long|longitude|x)$/i;
const GROUP = /^(line|name|track|route|shape|id|segment)$/i;
const ZONE = /^(zone|closed|polygon)$/i;

/** True for a header (or first row) that looks like coordinates in columns. */
export function looksDelimited(text: string): boolean {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = first.includes('\t') ? '\t' : first.includes(';') ? ';' : ',';
  const cells = splitRow(first, delimiter);
  return (
    cells.length >= 2 &&
    (cells.some((c) => LAT.test(c)) || cells.every((c) => c === '' || Number.isFinite(Number(c))))
  );
}

/**
 * CSV/TSV/semicolon tables with a point per row. Columns are found by name
 * (lat/latitude, lng/lon/longitude, optional line/name/track… to split into
 * several lines, and zone); without a header the first two columns are
 * lat, lng (or lng, lat when the first is beyond ±90). Our own CSV/TSV
 * exports round-trip.
 */
export function parseDelimited(text: string): ImportResult {
  const rows = splitLines(text.replace(/^\uFEFF/, ''));
  if (rows.length === 0) return {lines: [], notes: []};
  const delimiter = rows[0]!.includes('\t') ? '\t' : rows[0]!.includes(';') ? ';' : ',';
  // Semicolon files usually come from locales with decimal commas.
  const number = (v: string | undefined) =>
    v === undefined || v.trim() === '' ? NaN : Number(delimiter === ';' ? v.replace(',', '.') : v);
  const table = rows.map((r) => splitRow(r, delimiter));
  const header = table[0]!;
  const latCol = header.findIndex((c) => LAT.test(c));
  const lngCol = header.findIndex((c) => LNG.test(c));
  let body = table;
  let cols = {lat: 0, lng: 1, group: -1, zone: -1};
  if (latCol !== -1 && lngCol !== -1) {
    body = table.slice(1);
    cols = {
      lat: latCol,
      lng: lngCol,
      group: header.findIndex((c) => GROUP.test(c)),
      zone: header.findIndex((c) => ZONE.test(c)),
    };
  } else if (body.some((r) => Math.abs(number(r[0])) > 90)) {
    cols = {lat: 1, lng: 0, group: -1, zone: -1};
  }

  const groups = new Map<string, {coords: LatLng[]; closed: boolean}>();
  let skipped = 0;
  for (const row of body) {
    const lat = number(row[cols.lat]);
    const lng = number(row[cols.lng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      skipped++;
      continue;
    }
    const key = cols.group === -1 ? '' : (row[cols.group] ?? '');
    const group = groups.get(key) ?? {coords: [], closed: false};
    group.coords.push([lat, lng]);
    if (cols.zone !== -1 && /^(yes|true|1|y)$/i.test(row[cols.zone] ?? '')) group.closed = true;
    groups.set(key, group);
  }
  const lines: ParsedLine[] = [...groups.entries()].map(([name, g]) => {
    // A ring written with its first point repeated is a zone too.
    const ring = detectRing(g.coords);
    return {
      coords: ring.coords,
      ...(name && {name}),
      ...((g.closed || ring.closed) && g.coords.length >= 3 && {closed: true}),
    };
  });
  return {
    lines,
    notes: skipped
      ? [`${skipped} ${skipped === 1 ? 'row' : 'rows'} without valid coordinates ${skipped === 1 ? 'was' : 'were'} skipped.`]
      : [],
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
  } else if (/\.(csv|tsv|tab)$/i.test(fileName) || (/\.txt$|^$/i.test(fileName) && looksDelimited(text))) {
    result = parseDelimited(text);
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

/**
 * One row per point, in metres and degrees whatever units the page shows, so
 * spreadsheets get plain numbers. Zones list their points once (no repeated
 * closing point) and are marked in the `zone` column.
 */
export const TABLE_COLUMNS = [
  'line',
  'point',
  'lat',
  'lng',
  'segment_m',
  'cumulative_m',
  'bearing_deg',
  'zone',
] as const;

function tableRows(lines: ExportLine[]): (string | number)[][] {
  const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
  return lines.flatMap((l) =>
    segments(l.coords).map((s, i) => [
      l.name,
      i + 1,
      l.coords[i]![0],
      l.coords[i]![1],
      i === 0 ? '' : round(s.distance, 2),
      round(s.cumulative, 2),
      s.bearing === null ? '' : round(s.bearing, 1),
      l.closed ? 'yes' : 'no',
    ]),
  );
}

const csvCell = (v: string | number) => {
  const text = String(v);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(lines: ExportLine[]) {
  return [TABLE_COLUMNS, ...tableRows(lines)].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Tabs and line breaks inside names become spaces (TSV has no quoting). */
export function toTsv(lines: ExportLine[]) {
  return (
    [TABLE_COLUMNS, ...tableRows(lines)]
      .map((r) => r.map((v) => String(v).replace(/[\t\r\n]+/g, ' ')).join('\t'))
      .join('\n') + '\n'
  );
}

export const FILE_TYPES: Record<FileKind, {label: string; ext: string; mime: string}> = {
  geojson: {label: 'GeoJSON', ext: 'geojson', mime: 'application/geo+json'},
  gpx: {label: 'GPX', ext: 'gpx', mime: 'application/gpx+xml'},
  kml: {label: 'KML', ext: 'kml', mime: 'application/vnd.google-earth.kml+xml'},
  csv: {label: 'CSV (points)', ext: 'csv', mime: 'text/csv'},
  tsv: {label: 'TSV (points)', ext: 'tsv', mime: 'text/tab-separated-values'},
};

export function exportFile(lines: ExportLine[], kind: FileKind, name: string) {
  const nonEmpty = lines.filter((l) => l.coords.length);
  const content = {
    gpx: () => toGpx(nonEmpty),
    kml: () => toKml(nonEmpty, name),
    geojson: () => toGeoJsonFile(nonEmpty),
    csv: () => toCsv(nonEmpty),
    tsv: () => toTsv(nonEmpty),
  }[kind]();
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'polylines';
  return {content, fileName: `${slug}.${FILE_TYPES[kind].ext}`, mime: FILE_TYPES[kind].mime};
}
