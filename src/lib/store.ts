import {detectFormat, formatLabel, parse, type Format, type ParsedLine} from './formats';
import type {LatLng, Precision} from './polyline';

export type Line = {
  id: string;
  name: string;
  color: string;
  coords: LatLng[];
  /** Text being edited; `null` means the text is derived from `coords`. */
  draft: string | null;
  hidden: boolean;
  /** A zone: the last point connects back to the first. */
  closed: boolean;
};

export type LineEnd = 'start' | 'end';
export type DrawKind = 'line' | 'zone';

export type State = {
  lines: Line[];
  format: Format;
  precision: Precision;
  selectedId: string | null;
  drawing: DrawKind | false;
  /** Adding points to an existing line by clicking the map. */
  extending: {id: string; end: LineEnd} | null;
  /** Bumped when the map should fit these lines (null = every line). */
  fit: {ids: string[] | null; n: number};
};

/** Distinct on both the light and the dark basemap. */
export const LINE_COLORS = [
  '#2563eb',
  '#db2777',
  '#ea580c',
  '#059669',
  '#7c3aed',
  '#0891b2',
  '#ca8a04',
  '#dc2626',
];

/**
 * UUID v4 (Terra Draw's default id check). `crypto.randomUUID` only exists in
 * secure contexts, so plain-HTTP previews (e.g. over a LAN) build one by hand.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function nextColor(lines: Line[]) {
  const used = new Set(lines.map((l) => l.color));
  return (
    LINE_COLORS.find((c) => !used.has(c)) ??
    LINE_COLORS[lines.length % LINE_COLORS.length]!
  );
}

function nextName(lines: Line[], prefix: 'Line' | 'Zone') {
  const used = new Set(lines.map((l) => l.name));
  let n = lines.length + 1;
  for (let k = 1; k <= n; k++) {
    if (!used.has(`${prefix} ${k}`)) return `${prefix} ${k}`;
  }
  return `${prefix} ${n}`;
}

export function makeLine(
  lines: Line[],
  init: Partial<Omit<Line, 'color'>> & {color?: string} = {},
): Line {
  return {
    id: init.id ?? newId(),
    name: init.name ?? nextName(lines, init.closed ? 'Zone' : 'Line'),
    color: init.color ?? nextColor(lines),
    coords: init.coords ?? [],
    draft: init.draft ?? null,
    hidden: init.hidden ?? false,
    closed: init.closed ?? false,
  };
}

const fromParsed = (p: ParsedLine) => ({coords: p.coords, name: p.name, closed: !!p.closed});

export function initialState(
  lines: ParsedLine[] = [],
  format: Format = 'encoded',
  precision: Precision = 5,
): State {
  const built: Line[] = [];
  for (const parsed of lines.length ? lines : [{coords: []}]) {
    built.push(makeLine(built, fromParsed(parsed)));
  }
  return {
    lines: built,
    format,
    precision,
    selectedId: built[0]!.id,
    drawing: false,
    extending: null,
    fit: {ids: null, n: 0},
  };
}

export type Interpreted = {
  format: Format;
  precision: Precision;
  /** Parsed lines, or null while the text is invalid. */
  lines: ParsedLine[] | null;
  /** What auto-detection changed, for a toast. */
  notice?: string;
};

/**
 * Reads text typed or pasted into a line. Pasted text that does not parse in
 * the current format or precision is retried with the detected ones.
 */
export function interpretInput(
  text: string,
  format: Format,
  precision: Precision,
  detect: boolean,
): Interpreted {
  const result = parse(text, format, precision);
  if (result.ok) {
    return {format, precision, lines: result.lines, notice: result.notes?.join(' ')};
  }
  if (!detect) return {format, precision, lines: null};

  if (result.precision) {
    const retry = parse(text, format, result.precision);
    if (retry.ok) {
      return {
        format,
        precision: result.precision,
        lines: retry.lines,
        notice: `Switched to precision ${result.precision} (1e${result.precision})`,
      };
    }
  }
  const detected = detectFormat(text);
  if (detected && detected !== format) {
    for (const p of [precision, precision === 5 ? 6 : 5] as Precision[]) {
      const retry = parse(text, detected, p);
      if (retry.ok) {
        return {
          format: detected,
          precision: p,
          lines: retry.lines,
          notice:
            `Detected ${formatLabel(detected)}` +
            (p !== precision ? `, precision ${p}` : ''),
        };
      }
    }
  }
  return {format, precision, lines: null};
}

export type Action =
  | ({type: 'input'; id: string; text: string} & Interpreted)
  | {type: 'commit'; id: string}
  | {type: 'revert'; id: string}
  | {type: 'setFormat'; format: Format}
  | {type: 'setPrecision'; precision: Precision}
  | {type: 'add'; id?: string; line?: ParsedLine}
  | {type: 'remove'; id: string}
  | {type: 'move'; id: string; to: number}
  | {type: 'rename'; id: string; name: string}
  | {type: 'toggleHidden'; id: string}
  | {type: 'select'; id: string | null}
  | {type: 'setDrawing'; drawing: DrawKind | false}
  | {type: 'toggleClosed'; id: string}
  | {type: 'setPoint'; id: string; index: number; coords: LatLng}
  | {type: 'deletePoint'; id: string; index: number}
  | {type: 'import'; lines: ParsedLine[]}
  | {type: 'extend'; id: string; end: LineEnd}
  | {type: 'stopExtending'}
  | {type: 'addPoint'; coords: LatLng}
  | {type: 'removePoint'}
  | {type: 'drawn'; id: string; coords: LatLng[]; closed: boolean}
  | {type: 'edited'; id: string; coords: LatLng[]}
  | {type: 'fit'; ids: string[] | null}
  | {type: 'clear'}
  | {type: 'load'; state: State};

const update = (state: State, id: string, patch: (line: Line) => Line): State => ({
  ...state,
  lines: state.lines.map((l) => (l.id === id ? patch(l) : l)),
});

const fit = (state: State, ids: string[] | null): State => ({
  ...state,
  fit: {ids, n: state.fit.n + 1},
});

/** Valid drafts are re-derived in the new format; invalid ones are kept. */
function dropValidDrafts(state: State): State {
  return {
    ...state,
    lines: state.lines.map((l) =>
      l.draft !== null && parse(l.draft, state.format, state.precision).ok
        ? {...l, draft: null}
        : l,
    ),
  };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'input': {
      const settings =
        action.format !== state.format || action.precision !== state.precision
          ? dropValidDrafts({...state, format: action.format, precision: action.precision})
          : state;
      const parsed = action.lines;
      if (!parsed) {
        return update(settings, action.id, (l) => ({...l, draft: action.text}));
      }
      const [first, ...rest] = parsed;
      if (rest.length === 0) {
        const next = update(settings, action.id, (l) => ({
          ...l,
          coords: first!.coords,
          name: first!.name ?? l.name,
          closed: !!first!.closed,
          draft: action.text,
        }));
        return first!.coords.length ? fit(next, [action.id]) : next;
      }
      // Several lines pasted at once: the first replaces this one, the rest
      // are inserted after it.
      const index = settings.lines.findIndex((l) => l.id === action.id);
      if (index === -1) return state;
      const lines = [...settings.lines];
      const current = lines[index]!;
      lines[index] = {
        ...current,
        coords: first!.coords,
        name: first!.name ?? current.name,
        closed: !!first!.closed,
        draft: null,
      };
      const added: Line[] = [];
      for (const p of rest) {
        added.push(makeLine([...lines, ...added], fromParsed(p)));
      }
      lines.splice(index + 1, 0, ...added);
      return fit({...settings, lines}, [current.id, ...added.map((l) => l.id)]);
    }
    case 'commit':
      return update(state, action.id, (l) =>
        l.draft !== null && parse(l.draft, state.format, state.precision).ok
          ? {...l, draft: null}
          : l,
      );
    case 'revert':
      return update(state, action.id, (l) => ({...l, draft: null}));
    case 'setFormat':
      return action.format === state.format
        ? state
        : dropValidDrafts({...dropValidDrafts(state), format: action.format});
    case 'setPrecision':
      return action.precision === state.precision
        ? state
        : dropValidDrafts({...dropValidDrafts(state), precision: action.precision});
    case 'add': {
      const line = makeLine(state.lines, {
        id: action.id,
        ...(action.line && fromParsed(action.line)),
      });
      const next = {...state, lines: [...state.lines, line], selectedId: line.id};
      return line.coords.length ? fit(next, [line.id]) : next;
    }
    case 'remove': {
      const lines = state.lines.filter((l) => l.id !== action.id);
      const selectedId =
        state.selectedId === action.id ? (lines.at(-1)?.id ?? null) : state.selectedId;
      const extending = state.extending?.id === action.id ? null : state.extending;
      return {...state, lines, selectedId, extending};
    }
    case 'move': {
      // `to` is the index the line should end up at (clamped to the list).
      const from = state.lines.findIndex((l) => l.id === action.id);
      const to = Math.max(0, Math.min(state.lines.length - 1, action.to));
      if (from === -1 || from === to) return state;
      const lines = [...state.lines];
      const [line] = lines.splice(from, 1);
      lines.splice(to, 0, line!);
      return {...state, lines};
    }
    case 'rename':
      return update(state, action.id, (l) => ({...l, name: action.name}));
    case 'toggleHidden':
      return update(state, action.id, (l) => ({...l, hidden: !l.hidden}));
    case 'select':
      return state.selectedId === action.id ? state : {...state, selectedId: action.id};
    case 'setDrawing':
      return state.drawing === action.drawing
        ? state
        : {...state, drawing: action.drawing, extending: null};
    case 'toggleClosed':
      // Keep the shape on screen: opening a zone adds the closing point back
      // as a real point; closing a loop drops its repeated end.
      return update(state, action.id, (l) => {
        const [first, last] = [l.coords[0], l.coords.at(-1)];
        const loop =
          l.coords.length >= 4 && first && last && first[0] === last[0] && first[1] === last[1];
        const coords = l.closed
          ? l.coords.length >= 2
            ? [...l.coords, l.coords[0]!]
            : l.coords
          : loop
            ? l.coords.slice(0, -1)
            : l.coords;
        return {...l, closed: !l.closed, coords, draft: null};
      });
    case 'setPoint':
      return update(state, action.id, (l) => ({
        ...l,
        coords: l.coords.map((c, i) => (i === action.index ? action.coords : c)),
        draft: null,
      }));
    case 'deletePoint':
      return update(state, action.id, (l) => ({
        ...l,
        coords: l.coords.filter((_, i) => i !== action.index),
        draft: null,
      }));
    case 'import': {
      if (action.lines.length === 0) return state;
      // A lone empty line (the starting state) is replaced, not kept.
      const base =
        state.lines.length === 1 &&
        state.lines[0]!.coords.length === 0 &&
        state.lines[0]!.draft === null
          ? []
          : state.lines;
      const added: Line[] = [];
      for (const p of action.lines) added.push(makeLine([...base, ...added], fromParsed(p)));
      return fit(
        {...state, lines: [...base, ...added], selectedId: added[0]!.id, drawing: false},
        added.map((l) => l.id),
      );
    }
    case 'extend':
      return {
        ...update(state, action.id, (l) => ({...l, hidden: false})),
        extending: {id: action.id, end: action.end},
        selectedId: action.id,
        drawing: false,
      };
    case 'stopExtending':
      return state.extending ? {...state, extending: null} : state;
    case 'addPoint': {
      const ext = state.extending;
      if (!ext) return state;
      return update(state, ext.id, (l) => ({
        ...l,
        coords: ext.end === 'end' ? [...l.coords, action.coords] : [action.coords, ...l.coords],
        draft: null,
      }));
    }
    case 'removePoint': {
      const ext = state.extending;
      if (!ext) return state;
      return update(state, ext.id, (l) => ({
        ...l,
        coords: ext.end === 'end' ? l.coords.slice(0, -1) : l.coords.slice(1),
        draft: null,
      }));
    }
    case 'drawn': {
      // Fill the selected line if it is still empty, otherwise add a new one.
      const target = state.lines.find(
        (l) => l.id === state.selectedId && l.coords.length === 0 && l.draft === null,
      );
      if (target) {
        return {
          ...update(state, target.id, (l) => ({
            ...l,
            id: action.id,
            coords: action.coords,
            closed: action.closed,
          })),
          selectedId: action.id,
          drawing: false,
        };
      }
      const line = makeLine(state.lines, {
        id: action.id,
        coords: action.coords,
        closed: action.closed,
      });
      return {...state, lines: [...state.lines, line], selectedId: line.id, drawing: false};
    }
    case 'edited':
      return update(state, action.id, (l) => ({...l, coords: action.coords, draft: null}));
    case 'fit':
      return fit(state, action.ids);
    case 'clear': {
      const line = makeLine([]);
      return {...state, lines: [line], selectedId: line.id, drawing: false, extending: null};
    }
    case 'load':
      return action.state;
  }
}

/** The parse error of a line's draft, if it has an invalid one. */
export function lineError(line: Line, state: Pick<State, 'format' | 'precision'>) {
  if (line.draft === null) return null;
  const result = parse(line.draft, state.format, state.precision);
  return result.ok ? null : result.error;
}
