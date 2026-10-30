import {describe, expect, test} from 'bun:test';
import {chunkWaypoints, MAX_WAYPOINTS, overpassRegex, sampleWaypoints, searchQuery, stitch, toResults} from './osm';
import type {LatLng} from './polyline';

describe('stitch', () => {
  test('joins ways in any direction and keeps gaps as separate lines', () => {
    const a: LatLng[] = [[0, 0], [0, 1]];
    const b: LatLng[] = [[0, 2], [0, 1]]; // reversed
    const c: LatLng[] = [[0, 2], [0, 3]];
    const far: LatLng[] = [[5, 5], [5, 6]];
    const lines = stitch([c, far, a, b]);
    expect(lines).toHaveLength(2);
    // Direction depends on which way came first; both are one continuous line.
    const joined = lines[0]![0]![1] === 0 ? lines[0] : [...lines[0]!].reverse();
    expect(joined).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
    expect(lines[1]).toEqual(far);
  });
});

describe('Overpass queries', () => {
  test('route search matches name or exact ref, escaped', () => {
    const q = searchQuery('bus', 'Línea "A" (1)', [6.1, -75.7, 6.4, -75.4]);
    expect(q).toContain('relation["type"="route"]["route"="bus"]["name"~"Línea \\"A\\" \\(1\\)",i]');
    expect(q).toContain('["ref"~"^Línea \\"A\\" \\(1\\)$",i]');
    expect(q).toContain('(6.10000,-75.70000,6.40000,-75.40000)');
    expect(searchQuery('subway', '', [0, 0, 1, 1])).toBe(
      '[out:json][timeout:25];relation["type"="route"]["route"="subway"](0.00000,0.00000,1.00000,1.00000);out tags 60;',
    );
    expect(overpassRegex('a.b*')).toBe('a\\.b\\*');
  });

  test('streets are grouped by name into one result', () => {
    const results = toResults('street', [
      {type: 'way', id: 1, tags: {name: 'Calle 10', highway: 'secondary'}},
      {type: 'way', id: 2, tags: {name: 'Calle 10', highway: 'residential'}},
      {type: 'way', id: 3, tags: {name: 'Avenida Oriental', highway: 'primary'}},
    ]);
    expect(results.map((r) => r.name)).toEqual(['Avenida Oriental', 'Calle 10']);
    expect(results[1]!.detail).toBe('secondary, residential · 2 segments');
    expect(results[1]!.query).toContain('way(id:1,2)');
  });

  test('routes use name, or ref with from → to', () => {
    const results = toResults('bus', [
      {type: 'relation', id: 9, tags: {ref: '10', from: 'A', to: 'B', network: 'Metroplús'}},
      {type: 'relation', id: 8, tags: {name: 'Metro Línea A', ref: 'A'}},
    ]);
    expect(results.map((r) => [r.name, r.detail])).toEqual([
      ['10 A → B', 'Metroplús'],
      ['Metro Línea A', 'Ref A'],
    ]);
  });
});

test('sampleWaypoints keeps both ends and the limit', () => {
  const coords = Array.from({length: 101}, (_, i) => [i, 0] as LatLng);
  const sampled = sampleWaypoints(coords, 5);
  expect(sampled).toEqual([[0, 0], [25, 0], [50, 0], [75, 0], [100, 0]]);
  expect(sampleWaypoints(coords.slice(0, 3), 5)).toHaveLength(3);
});

test('waypoints are chunked into requests of 10 sharing their ends', () => {
  expect(MAX_WAYPOINTS).toBe(46);
  const points = Array.from({length: 46}, (_, i) => i);
  const chunks = chunkWaypoints(points);
  expect(chunks).toHaveLength(5);
  expect(chunks.every((c) => c.length <= 10)).toBe(true);
  expect(chunks.map((c) => [c[0], c.at(-1)])).toEqual([[0, 9], [9, 18], [18, 27], [27, 36], [36, 45]]);
  expect(chunkWaypoints([1, 2])).toEqual([[1, 2]]);
  expect(chunkWaypoints(Array.from({length: 11}, (_, i) => i)).map((c) => c.length)).toEqual([10, 2]);
});
