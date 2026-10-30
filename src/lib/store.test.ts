import {describe, expect, test} from 'bun:test';
import {encode, type LatLng} from './polyline';
import {initialState, interpretInput, lineError, reducer, type State} from './store';
import {formatDistance, lineLength} from './geo';
import {fromHash, toHash} from './url-state';

const COORDS: LatLng[] = [
  [38.5, -120.2],
  [40.7, -120.95],
];

function input(state: State, id: string, text: string, detect = false) {
  return reducer(state, {
    type: 'input',
    id,
    text,
    ...interpretInput(text, state.format, state.precision, detect),
  });
}

describe('reducer', () => {
  test('starts with one empty, selected line', () => {
    const s = initialState();
    expect(s.lines).toHaveLength(1);
    expect(s.selectedId).toBe(s.lines[0]!.id);
    expect(s.lines[0]!.name).toBe('Line 1');
  });

  test('valid input updates coordinates and keeps the typed text', () => {
    let s = initialState();
    const id = s.lines[0]!.id;
    s = input(s, id, encode(COORDS));
    expect(s.lines[0]!.coords).toEqual(COORDS);
    expect(s.lines[0]!.draft).toBe(encode(COORDS));
    expect(s.fit.ids).toEqual([id]);
    s = reducer(s, {type: 'commit', id});
    expect(s.lines[0]!.draft).toBeNull();
  });

  test('invalid input keeps the last coordinates and reports an error', () => {
    let s = initialState();
    const id = s.lines[0]!.id;
    s = input(s, id, encode(COORDS));
    s = input(s, id, '[[1, 2],');
    expect(s.lines[0]!.coords).toEqual(COORDS);
    expect(lineError(s.lines[0]!, s)).toStartWith('This looks like JSON');
    s = reducer(s, {type: 'revert', id});
    expect(lineError(s.lines[0]!, s)).toBeNull();
  });

  test('pasting another format switches to it', () => {
    let s = initialState();
    const id = s.lines[0]!.id;
    const pasted = JSON.stringify(COORDS.map(([a, b]) => [b, a]));
    const result = interpretInput(pasted, s.format, s.precision, true);
    expect(result.format).toBe('lnglat');
    expect(result.notice).toBe('Detected LngLat array');
    s = input(s, id, pasted, true);
    expect(s.format).toBe('lnglat');
    expect(s.lines[0]!.coords).toEqual(COORDS);
  });

  test('pasting precision 6 switches precision', () => {
    const s = initialState();
    const pasted = encode([[60.123456, 170.654321]], 6);
    const r = interpretInput(pasted, 'encoded', 5, true);
    expect(r.precision).toBe(6);
    expect(r.lines?.[0]!.coords).toEqual([[60.123456, 170.654321]]);
    expect(interpretInput(pasted, 'encoded', 5, false).lines).toBeNull();
    expect(input(s, s.lines[0]!.id, pasted, true).precision).toBe(6);
  });

  test('pasting several lines splits them', () => {
    let s = initialState();
    const id = s.lines[0]!.id;
    s = input(s, id, `${encode(COORDS)}\n${encode(COORDS.slice(1))}`);
    expect(s.lines.map((l) => l.name)).toEqual(['Line 1', 'Line 2']);
    expect(s.lines[1]!.coords).toEqual(COORDS.slice(1));
    expect(s.lines[0]!.color).not.toBe(s.lines[1]!.color);
    expect(s.fit.ids).toHaveLength(2);
  });

  test('changing format re-derives valid drafts and keeps invalid ones', () => {
    let s = reducer(initialState(), {type: 'add'});
    const [a, b] = s.lines.map((l) => l.id) as [string, string];
    s = input(s, a, encode(COORDS));
    s = input(s, b, 'not valid ~ ~');
    s = reducer(s, {type: 'setFormat', format: 'latlng'});
    expect(s.lines[0]!.draft).toBeNull();
    expect(s.lines[1]!.draft).toBe('not valid ~ ~');
  });

  test('drawing fills the empty selected line, then adds new ones', () => {
    let s = reducer(initialState(), {type: 'setDrawing', drawing: 'line'});
    s = reducer(s, {type: 'drawn', id: 'a', coords: COORDS, closed: false});
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]!.id).toBe('a');
    expect(s.drawing).toBe(false);
    s = reducer(s, {type: 'drawn', id: 'b', coords: COORDS, closed: true});
    expect(s.lines.map((l) => l.id)).toEqual(['a', 'b']);
    expect(s.selectedId).toBe('b');
  });

  test('removing the selected line selects the last one', () => {
    let s = reducer(reducer(initialState(), {type: 'add'}), {type: 'add'});
    const ids = s.lines.map((l) => l.id);
    s = reducer(s, {type: 'remove', id: ids[2]!});
    expect(s.selectedId).toBe(ids[1]!);
    expect(reducer(s, {type: 'add'}).lines.at(-1)!.name).toBe('Line 3');
  });
});

describe('url state', () => {
  test('round-trips lines, names, format and precision', () => {
    let s = reducer(initialState(), {type: 'add'});
    s = input(s, s.lines[0]!.id, encode(COORDS));
    s = reducer(s, {type: 'setFormat', format: 'geojson'});
    s = reducer(s, {type: 'setPrecision', precision: 6});
    s = reducer(s, {type: 'rename', id: s.lines[0]!.id, name: 'Route & more'});
    const hash = toHash(s);
    expect(hash).toStartWith('#f=geojson&pr=6&l=');
    const loaded = fromHash(hash);
    expect(loaded.format).toBe('geojson');
    expect(loaded.precision).toBe(6);
    expect(loaded.lines).toHaveLength(1);
    expect(loaded.lines[0]!.name).toBe('Route & more');
    expect(loaded.lines[0]!.coords).toEqual(COORDS);
  });

  test('defaults are omitted and garbage is ignored', () => {
    let s = initialState();
    expect(toHash(s)).toBe('');
    s = input(s, s.lines[0]!.id, encode(COORDS));
    expect(toHash(s)).toBe(`#${new URLSearchParams({l: encode(COORDS)})}`);
    const loaded = fromHash('#f=nope&l=%20bad&l=' + encodeURIComponent(encode(COORDS)));
    expect(loaded.format).toBe('encoded');
    expect(loaded.lines.map((l) => l.coords)).toEqual([COORDS]);
  });
});

describe('geo', () => {
  test('length of a known segment', () => {
    // Bogotá → Medellín, about 240 km in a straight line.
    const m = lineLength([
      [4.711, -74.0721],
      [6.2442, -75.5812],
    ]);
    expect(m).toBeGreaterThan(235_000);
    expect(m).toBeLessThan(245_000);
    expect(formatDistance(850.4)).toBe('850 m');
    expect(formatDistance(3149)).toBe('3.15 km');
    expect(formatDistance(240_123)).toBe('240 km');
  });
});

describe('extending a line', () => {
  test('adds and removes points at either end', () => {
    let s = initialState([{coords: COORDS}]);
    const id = s.lines[0]!.id;
    s = reducer(s, {type: 'toggleHidden', id});
    s = reducer(s, {type: 'extend', id, end: 'end'});
    expect(s.lines[0]!.hidden).toBe(false);
    s = reducer(s, {type: 'addPoint', coords: [41, -121]});
    expect(s.lines[0]!.coords.at(-1)).toEqual([41, -121]);
    s = reducer(s, {type: 'extend', id, end: 'start'});
    s = reducer(s, {type: 'addPoint', coords: [37, -119]});
    expect(s.lines[0]!.coords).toEqual([[37, -119], ...COORDS, [41, -121]]);
    s = reducer(s, {type: 'removePoint'});
    expect(s.lines[0]!.coords[0]).toEqual(COORDS[0]!);
    s = reducer(s, {type: 'setDrawing', drawing: 'line'});
    expect(s.extending).toBeNull();
  });

  test('works on an empty line and stops when it is removed', () => {
    let s = initialState();
    const id = s.lines[0]!.id;
    s = reducer(s, {type: 'extend', id, end: 'end'});
    s = reducer(s, {type: 'addPoint', coords: [1, 2]});
    s = reducer(s, {type: 'addPoint', coords: [3, 4]});
    expect(s.lines[0]!.coords).toEqual([[1, 2], [3, 4]]);
    expect(reducer(s, {type: 'remove', id}).extending).toBeNull();
  });
});

describe('geo extras', () => {
  test('area, perimeter, bearing and segments', async () => {
    const {bearing, compass, formatArea, perimeter, ringArea, segments} = await import('./geo');
    // A 0.01° square at the equator is about 1.236 km².
    const square: LatLng[] = [
      [0, 0],
      [0, 0.01],
      [0.01, 0.01],
      [0.01, 0],
    ];
    expect(ringArea(square)).toBeGreaterThan(1_230_000);
    expect(ringArea(square)).toBeLessThan(1_240_000);
    expect(formatArea(ringArea(square))).toBe('1.24 km²');
    expect(formatArea(5_000)).toBe('5,000 m²');
    expect(formatArea(50_000)).toBe('5 ha');
    expect(perimeter(square, true)).toBeCloseTo(4 * 1111.95, -1);
    expect(perimeter(square, false)).toBeCloseTo(3 * 1111.95, -1);
    expect(Math.round(bearing([0, 0], [0, 1]))).toBe(90);
    expect(compass(bearing([0, 0], [1, 0]))).toBe('N');
    const segs = segments(square);
    expect(segs[0]).toEqual({distance: 0, cumulative: 0, bearing: null});
    expect(segs[3]!.cumulative).toBeCloseTo(perimeter(square, false), 6);
  });

  test('simplify keeps ends, drops points within tolerance', async () => {
    const {simplify} = await import('./geo');
    // Points along a straight meridian, with one 50 m bump.
    const line: LatLng[] = Array.from({length: 11}, (_, i) => [i * 0.001, i === 5 ? 0.00045 : 0]);
    const loose = simplify(line, 100);
    expect(loose).toEqual([line[0]!, line[10]!]);
    const tight = simplify(line, 10);
    expect(tight).toEqual([line[0]!, line[4]!, line[5]!, line[6]!, line[10]!]);
    expect(simplify(line, 0)).toBe(line);
    const ring: LatLng[] = [
      [0, 0],
      [0, 0.000001],
      [0, 0.01],
      [0.01, 0.01],
      [0.01, 0],
    ];
    expect(simplify(ring, 5, true)).toHaveLength(4);
  });
});

describe('zones and point edits', () => {
  const RING: LatLng[] = [
    [0, 0],
    [0, 1],
    [1, 1],
  ];

  test('typing a ring marks the line closed; toggling keeps the shape', () => {
    let s = initialState();
    const id = s.lines[0]!.id;
    s = input(s, id, encode([...RING, RING[0]!]));
    expect(s.lines[0]!.closed).toBe(true);
    expect(s.lines[0]!.coords).toEqual(RING);
    s = reducer(s, {type: 'toggleClosed', id});
    expect(s.lines[0]!.closed).toBe(false);
    expect(s.lines[0]!.coords).toEqual([...RING, RING[0]!]);
    s = reducer(s, {type: 'toggleClosed', id});
    expect(s.lines[0]!.coords).toEqual(RING);
  });

  test('zones survive the URL', () => {
    let s = initialState([{coords: COORDS}, {coords: RING, closed: true}]);
    const hash = toHash(s);
    expect(hash).toContain('z=1');
    expect(fromHash(hash).lines.map((l) => l.closed)).toEqual([false, true]);
    expect(fromHash(hash).lines[1]!.coords).toEqual(RING);
  });

  test('set and delete points', () => {
    let s = initialState([{coords: RING}]);
    const id = s.lines[0]!.id;
    s = reducer(s, {type: 'setPoint', id, index: 1, coords: [5, 5]});
    expect(s.lines[0]!.coords[1]).toEqual([5, 5]);
    s = reducer(s, {type: 'deletePoint', id, index: 0});
    expect(s.lines[0]!.coords).toEqual([[5, 5], [1, 1]]);
  });

  test('import replaces the lone empty line and fits the new ones', () => {
    let s = initialState();
    s = reducer(s, {type: 'import', lines: [{coords: RING, closed: true, name: 'Park'}, {coords: COORDS}]});
    expect(s.lines.map((l) => [l.name, l.closed])).toEqual([
      ['Park', true],
      ['Line 1', false],
    ]);
    expect(s.fit.ids).toHaveLength(2);
    s = reducer(s, {type: 'import', lines: [{coords: COORDS}]});
    expect(s.lines).toHaveLength(3);
  });
});

test('new zones are named Zone N', () => {
  let s = initialState([{coords: COORDS}]);
  s = reducer(s, {type: 'drawn', id: 'z', coords: [[0, 0], [0, 1], [1, 1]], closed: true});
  expect(s.lines.at(-1)!.name).toBe('Zone 1');
});

test('area in a fixed unit', async () => {
  const {formatArea} = await import('./geo');
  expect(formatArea(5_000)).toBe('5,000 m²');
  expect(formatArea(5_000, 'ha')).toBe('0.5 ha');
  expect(formatArea(5_000, 'km2')).toBe('0.005 km²');
  expect(formatArea(123_456_789, 'm2')).toBe('123,456,789 m²');
  expect(formatArea(123_456_789, 'ha')).toBe('12,345.68 ha');
  expect(formatArea(123_456_789)).toBe('123 km²');
  expect(formatArea(1_234, 'km2')).toBe('0.00123 km²');
});

test('imperial distances and areas', async () => {
  const {formatArea, formatDistance} = await import('./geo');
  expect(formatDistance(100, 'imperial')).toBe('328 ft');
  expect(formatDistance(1609.344, 'imperial')).toBe('1 mi');
  expect(formatDistance(250_000, 'imperial')).toBe('155 mi');
  expect(formatArea(1_000, 'auto', 'imperial')).toBe('10,764 ft²');
  expect(formatArea(40_468.564224, 'auto', 'imperial')).toBe('10 ac');
  expect(formatArea(2_589_988.110336 * 3, 'auto', 'imperial')).toBe('3 mi²');
  expect(formatArea(4046.8564224, 'ac')).toBe('1 ac');
  expect(formatArea(10_000, 'mi2')).toBe('0.00386 mi²');
});

test('fixed length units', async () => {
  const {formatDistance} = await import('./geo');
  expect(formatDistance(850)).toBe('850 m');
  expect(formatDistance(850, 'metric', 'km')).toBe('0.85 km');
  expect(formatDistance(12, 'metric', 'km')).toBe('0.012 km');
  expect(formatDistance(14_250, 'imperial', 'm')).toBe('14,250 m');
  expect(formatDistance(1609.344, 'metric', 'ft')).toBe('5,280 ft');
  expect(formatDistance(266, 'metric', 'mi')).toBe('0.165 mi');
  expect(formatDistance(0.4, 'metric', 'm')).toBe('0.4 m');
});

test('move reorders lines and clamps the target', () => {
  let s = initialState([{coords: COORDS, name: 'A'}, {coords: COORDS, name: 'B'}, {coords: COORDS, name: 'C'}]);
  const [a, b, c] = s.lines.map((l) => l.id) as [string, string, string];
  s = reducer(s, {type: 'move', id: c, to: 0});
  expect(s.lines.map((l) => l.name)).toEqual(['C', 'A', 'B']);
  s = reducer(s, {type: 'move', id: c, to: 99});
  expect(s.lines.map((l) => l.name)).toEqual(['A', 'B', 'C']);
  expect(reducer(s, {type: 'move', id: a, to: -5})).toBe(s);
  s = reducer(s, {type: 'move', id: a, to: 1});
  expect(s.lines.map((l) => l.id)).toEqual([b, a, c]);
  expect(toHash(s)).toContain('n=B&n=A&n=C');
});
