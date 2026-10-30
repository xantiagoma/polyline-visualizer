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
    let s = reducer(initialState(), {type: 'setDrawing', drawing: true});
    s = reducer(s, {type: 'drawn', id: 'a', coords: COORDS});
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]!.id).toBe('a');
    expect(s.drawing).toBe(false);
    s = reducer(s, {type: 'drawn', id: 'b', coords: COORDS});
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
    s = reducer(s, {type: 'setDrawing', drawing: true});
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
