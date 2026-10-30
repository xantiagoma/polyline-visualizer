/**
 * Encoded polyline algorithm (Google), with a configurable precision: 5 is
 * Google's default, 6 is what OSRM and Valhalla use.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */

/** A coordinate as `[lat, lng]`, the order the encoded format uses. */
export type LatLng = [lat: number, lng: number];

export type Precision = 5 | 6;
export const PRECISIONS: Precision[] = [5, 6];

export class PolylineError extends Error {
  override name = 'PolylineError';
}

/** Splits one signed value into 5-bit chunks (ASCII 63–126). */
function encodeValue(value: number, out: string[]) {
  let v = value < 0 ? ~(value << 1) : value << 1;
  while (v >= 0x20) {
    out.push(String.fromCharCode((0x20 | (v & 0x1f)) + 63));
    v >>= 5;
  }
  out.push(String.fromCharCode(v + 63));
}

export function encode(coords: LatLng[], precision: Precision = 5): string {
  const factor = 10 ** precision;
  const out: string[] = [];
  let prevLat = 0;
  let prevLng = 0;
  for (const [lat, lng] of coords) {
    const iLat = Math.round(lat * factor);
    const iLng = Math.round(lng * factor);
    encodeValue(iLat - prevLat, out);
    encodeValue(iLng - prevLng, out);
    prevLat = iLat;
    prevLng = iLng;
  }
  return out.join('');
}

/**
 * Decodes one polyline. Throws on characters outside the alphabet, a
 * truncated value or an odd number of values; it does not check ranges (see
 * `validateLatLngs`), so a precision mismatch can be reported separately.
 */
export function decode(text: string, precision: Precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const coords: LatLng[] = [];
  const values: number[] = [];
  let shift = 0;
  let result = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) - 63;
    if (code < 0 || code > 63) {
      throw new PolylineError(
        `Unexpected character “${text[i]}” at position ${i + 1}. Encoded polylines only use ASCII 63–126 (? to ~).`,
      );
    }
    // Multiplication instead of << keeps values beyond 32 bits exact.
    result += (code & 0x1f) * 2 ** shift;
    shift += 5;
    if (code < 0x20) {
      values.push(result % 2 === 1 ? -(result + 1) / 2 : result / 2);
      shift = 0;
      result = 0;
    }
  }
  if (shift !== 0) {
    throw new PolylineError(
      'The polyline ends in the middle of a value. It may be truncated or missing escaped characters (\\\\ in JSON).',
    );
  }
  if (values.length % 2 !== 0) {
    throw new PolylineError(
      'The polyline has an odd number of values (a latitude without longitude).',
    );
  }
  let lat = 0;
  let lng = 0;
  for (let i = 0; i < values.length; i += 2) {
    lat += values[i]!;
    lng += values[i + 1]!;
    // Division (not * 1e-5) keeps the shortest decimal representation.
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

/** Index of the first coordinate outside lat ±90 / lng ±180, or -1. */
export function firstOutOfRange(coords: LatLng[]): number {
  return coords.findIndex(
    ([lat, lng]) =>
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180,
  );
}
