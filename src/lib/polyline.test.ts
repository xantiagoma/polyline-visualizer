import {describe, expect, test} from 'bun:test';
import {decode, encode, firstOutOfRange, type LatLng} from './polyline';

// The example from Google's algorithm documentation.
const GOOGLE: LatLng[] = [
  [38.5, -120.2],
  [40.7, -120.95],
  [43.252, -126.453],
];
const GOOGLE_ENCODED = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

describe('encode / decode', () => {
  test('Google example at precision 5', () => {
    expect(encode(GOOGLE)).toBe(GOOGLE_ENCODED);
    expect(decode(GOOGLE_ENCODED)).toEqual(GOOGLE);
  });

  test('precision 6 round-trips with 6 decimals', () => {
    const coords: LatLng[] = [
      [6.244203, -75.581212],
      [6.251838, -75.563591],
    ];
    const encoded = encode(coords, 6);
    expect(decode(encoded, 6)).toEqual(coords);
    expect(encoded).not.toBe(encode(coords, 5));
  });

  test('empty input', () => {
    expect(encode([])).toBe('');
    expect(decode('')).toEqual([]);
  });

  test('extreme coordinates at precision 6 do not overflow', () => {
    const coords: LatLng[] = [
      [-90, -180],
      [90, 180],
      [-89.999999, 179.999999],
    ];
    expect(decode(encode(coords, 6), 6)).toEqual(coords);
  });

  test('rejects characters outside the alphabet', () => {
    expect(() => decode('_p~iF ~ps|U')).toThrow('position 6');
  });

  test('rejects a truncated value', () => {
    expect(() => decode(GOOGLE_ENCODED.slice(0, -1))).toThrow('middle of a value');
  });

  test('rejects an odd number of values', () => {
    expect(() => decode('_p~iF')).toThrow('odd number');
  });

  test('precision 6 read as 5 is out of range', () => {
    const encoded = encode([[60, 170]], 6);
    expect(firstOutOfRange(decode(encoded, 5))).toBe(0);
    expect(firstOutOfRange(decode(encoded, 6))).toBe(-1);
  });
});
