import {describe, expect, test} from 'bun:test';
import {detectFormat, parse, serialize, serializeAll} from './formats';
import {encode, type LatLng} from './polyline';

const COORDS: LatLng[] = [
  [38.5, -120.2],
  [40.7, -120.95],
  [43.252, -126.453],
];
const ENCODED = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

const linesOf = (r: ReturnType<typeof parse>) => {
  if (!r.ok) throw new Error(r.error);
  return r.lines.map((l) => l.coords);
};

describe('parse', () => {
  test('empty text is one empty line', () => {
    expect(linesOf(parse('  \n', 'latlng', 5))).toEqual([[]]);
  });

  test('encoded, also as a JSON string with escapes', () => {
    expect(linesOf(parse(ENCODED, 'encoded', 5))).toEqual([COORDS]);
    const escaped = encode([[-33.86, 151.21], [-33.87, 151.2]]);
    expect(linesOf(parse(JSON.stringify(escaped), 'encoded', 5))).toEqual(
      linesOf(parse(escaped, 'encoded', 5)),
    );
  });

  test('several encoded polylines separated by whitespace', () => {
    const second = encode([[4.6, -74.08], [4.7, -74.05]]);
    expect(linesOf(parse(`${ENCODED}\n${second}`, 'encoded', 5))).toHaveLength(2);
  });

  test('suggests the other precision when out of range', () => {
    const r = parse(encode([[60, 170]], 6), 'encoded', 5);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.precision).toBe(6);
      expect(r.error).toContain('precision 6');
    }
  });

  test('LatLng and LngLat arrays', () => {
    expect(linesOf(parse(JSON.stringify(COORDS), 'latlng', 5))).toEqual([COORDS]);
    const lnglat = COORDS.map(([lat, lng]) => [lng, lat]);
    expect(linesOf(parse(JSON.stringify(lnglat), 'lnglat', 5))).toEqual([COORDS]);
  });

  test('extra values (elevation) and {lat, lng} objects', () => {
    expect(linesOf(parse('[[1, 2, 300], [3, 4, 310]]', 'latlng', 5))).toEqual([
      [[1, 2], [3, 4]],
    ]);
    expect(
      linesOf(parse('[{"lat": 1, "lng": 2}, {"latitude": 3, "lon": 4}]', 'lnglat', 5)),
    ).toEqual([[[1, 2], [3, 4]]]);
  });

  test('nested arrays are several lines', () => {
    const r = parse('[[[1, 2], [3, 4]], [[5, 6], [7, 8]]]', 'latlng', 5);
    expect(linesOf(r)).toEqual([
      [[1, 2], [3, 4]],
      [[5, 6], [7, 8]],
    ]);
  });

  test('array errors', () => {
    const notJson = parse('[[1, 2],', 'latlng', 5);
    expect(!notJson.ok && notJson.error).toStartWith('Invalid JSON');
    const badItem = parse('[[1, 2], [3]]', 'latlng', 5);
    expect(!badItem.ok && badItem.error).toContain('item 2 is not a [lat, lng] pair');
    const swapped = parse('[[-122.4, 37.7]]', 'latlng', 5);
    expect(!swapped.ok && swapped.error).toContain('LngLat order');
  });

  test('GeoJSON shapes, names and skipped geometries', () => {
    const coordinates = COORDS.map(([lat, lng]) => [lng, lat]);
    expect(linesOf(parse(JSON.stringify({type: 'LineString', coordinates}), 'geojson', 5))).toEqual([
      COORDS,
    ]);
    const collection = {
      type: 'FeatureCollection',
      features: [
        {type: 'Feature', properties: {name: 'Route'}, geometry: {type: 'LineString', coordinates}},
        {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [0, 0]}},
        {
          type: 'Feature',
          properties: null,
          geometry: {type: 'MultiLineString', coordinates: [coordinates, coordinates]},
        },
      ],
    };
    const r = parse(JSON.stringify(collection), 'geojson', 5);
    expect(r.ok && r.lines.map((l) => l.name)).toEqual(['Route', undefined, undefined]);
    const points = parse('{"type": "Point", "coordinates": [0, 0]}', 'geojson', 5);
    expect(!points.ok && points.error).toContain('only Point');
  });
});

describe('serialize', () => {
  test('round-trips every format', () => {
    for (const format of ['encoded', 'latlng', 'lnglat', 'geojson'] as const) {
      const text = serialize(COORDS, format, 5, 'Route');
      const r = parse(text, format, 5);
      expect(linesOf(r)).toEqual([COORDS]);
    }
  });

  test('one pair per row, empty for no coordinates', () => {
    expect(serialize(COORDS.slice(0, 2), 'lnglat', 5)).toBe(
      '[\n  [-120.2, 38.5],\n  [-120.95, 40.7]\n]',
    );
    expect(serialize([], 'geojson', 5)).toBe('');
    expect(serialize(COORDS, 'geojson', 5)).toContain('[-120.2, 38.5]');
  });

  test('serializeAll round-trips several lines', () => {
    const lines = [
      {coords: COORDS, name: 'A'},
      {coords: [], name: 'empty'},
      {coords: COORDS.slice(1), name: 'B'},
    ];
    for (const format of ['encoded', 'latlng', 'lnglat', 'geojson'] as const) {
      const r = parse(serializeAll(lines, format, 5), format, 5);
      expect(linesOf(r)).toEqual([COORDS, COORDS.slice(1)]);
    }
  });
});

describe('detectFormat', () => {
  test('by shape and by ranges', () => {
    expect(detectFormat(ENCODED)).toBe('encoded');
    expect(detectFormat('{"type": "LineString"}')).toBe('geojson');
    expect(detectFormat('[[-122.4, 37.7]]')).toBe('lnglat');
    expect(detectFormat('[[37.7, -122.4]]')).toBe('latlng');
    expect(detectFormat('[{"lat": 1, "lng": 2}]')).toBe('latlng');
    expect(detectFormat('[[4.6, -74.1]]')).toBeNull();
    expect(detectFormat('[[[1, 2]], [[-122.4, 37.7]]]')).toBe('lnglat');
  });
});

describe('closed lines (zones)', () => {
  const RING: LatLng[] = [
    [0, 0],
    [0, 1],
    [1, 1],
  ];

  test('a repeated first point marks a ring in encoded and array text', () => {
    const r = parse(encode([...RING, RING[0]!]), 'encoded', 5);
    expect(r.ok && r.lines[0]).toEqual({coords: RING, closed: true});
    const open = parse('[[0, 0], [0, 1], [0, 0]]', 'latlng', 5);
    expect(open.ok && open.lines[0]!.closed).toBeUndefined();
  });

  test('GeoJSON Polygon and MultiPolygon, holes noted', () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [1, 0], [1, 1], [0, 0]],
        [[0.2, 0.2], [0.3, 0.2], [0.3, 0.3], [0.2, 0.2]],
      ],
    };
    const r = parse(JSON.stringify(polygon), 'geojson', 5);
    expect(r.ok && r.lines).toEqual([{coords: RING, closed: true, name: undefined}]);
    expect(r.ok && r.notes?.[0]).toContain('holes');
    const multi = parse(
      JSON.stringify({type: 'MultiPolygon', coordinates: [[polygon.coordinates[0]], [polygon.coordinates[0]]]}),
      'geojson',
      5,
    );
    expect(multi.ok && multi.lines).toHaveLength(2);
  });

  test('serialize writes the ring back in every format', () => {
    for (const format of ['encoded', 'latlng', 'lnglat', 'geojson'] as const) {
      const r = parse(serialize(RING, format, 5, 'Zone', true), format, 5);
      expect(r.ok && r.lines[0]!.coords).toEqual(RING);
      expect(r.ok && r.lines[0]!.closed).toBe(true);
    }
    expect(serialize(RING, 'geojson', 5, 'Zone', true)).toContain('"type": "Polygon"');
  });
});
