import {FORMATS, type Format} from './formats';
import {decode, encode, firstOutOfRange, type Precision} from './polyline';
import {initialState, type State} from './store';

/**
 * The shareable state lives in the URL hash so long polylines never hit
 * request-line limits: `#f=latlng&pr=6&l=<encoded>&l=<encoded>&n=Route`.
 * `f` and `pr` are omitted at their defaults (encoded, 5); `n` is present only
 * when a line has a custom name, aligned with `l`. Empty lines are skipped.
 */
export function toHash(state: State): string {
  const params = new URLSearchParams();
  if (state.format !== 'encoded') params.set('f', state.format);
  if (state.precision !== 5) params.set('pr', String(state.precision));
  const lines = state.lines.filter((l) => l.coords.length > 0);
  for (const line of lines) params.append('l', encode(line.coords, state.precision));
  if (lines.some((l, i) => l.name !== `Line ${i + 1}`)) {
    for (const line of lines) params.append('n', line.name);
  }
  const query = params.toString();
  return query ? `#${query}` : '';
}

export function fromHash(hash: string): State {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const f = params.get('f');
  const format: Format = FORMATS.some((x) => x.value === f) ? (f as Format) : 'encoded';
  const precision: Precision = params.get('pr') === '6' ? 6 : 5;
  const names = params.getAll('n');
  const lines = params.getAll('l').flatMap((encoded, i) => {
    try {
      const coords = decode(encoded, precision);
      if (coords.length === 0 || firstOutOfRange(coords) !== -1) return [];
      return [{coords, name: names[i]?.trim() || undefined}];
    } catch {
      return [];
    }
  });
  return initialState(lines, format, precision);
}
