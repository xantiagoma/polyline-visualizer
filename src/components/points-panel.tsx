import {useMemo, useState, type ActionDispatch} from 'react';
import {ArrowLeftIcon, DownloadIcon, Trash2Icon} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {exportFile} from '@/lib/files';
import {compass, distance, segments} from '@/lib/geo';
import {useUnits} from '@/lib/units';
import type {LatLng} from '@/lib/polyline';
import type {Action, Line} from '@/lib/store';
import {downloadFile} from '@/lib/utils';

const PAGE = 200;

/** Commits on Enter or blur; invalid or out-of-range values snap back. */
function CoordInput({
  value,
  label,
  limit,
  onCommit,
}: {
  value: number;
  label: string;
  limit: number;
  onCommit: (value: number) => void;
}) {
  return (
    <input
      // Remount when the value changes elsewhere (map edits, simplify).
      key={value}
      defaultValue={value}
      inputMode="decimal"
      aria-label={label}
      className="w-full min-w-0 rounded bg-transparent px-1 py-0.5 font-mono text-xs tabular outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.currentTarget.value = String(value);
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const next = Number(e.currentTarget.value.trim());
        if (e.currentTarget.value.trim() === '' || !Number.isFinite(next) || Math.abs(next) > limit) {
          if (e.currentTarget.value !== String(value)) {
            toast.error(`${label} must be a number within ±${limit}`);
          }
          e.currentTarget.value = String(value);
        } else if (next !== value) {
          onCommit(next);
        }
      }}
    />
  );
}

/**
 * Every point of one line with the distance from the previous point, the
 * running total and the bearing. Coordinates are editable; hovering a row
 * rings the point on the map and clicking its number flies there.
 */
export function PointsPanel({
  line,
  dispatch,
  onClose,
  onHover,
  onLocate,
}: {
  line: Line;
  dispatch: ActionDispatch<[Action]>;
  onClose: () => void;
  onHover: (point: LatLng | null) => void;
  onLocate: (point: LatLng) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const {distance: formatDistance} = useUnits();
  const rows = useMemo(() => segments(line.coords), [line.coords]);
  const closing =
    line.closed && line.coords.length > 2 ? distance(line.coords.at(-1)!, line.coords[0]!) : null;
  const total = (rows.at(-1)?.cumulative ?? 0) + (closing ?? 0);
  const minPoints = line.closed ? 3 : 2;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeftIcon data-icon="inline-start" />
          Lines
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          <span
            aria-hidden
            className="mr-1.5 inline-block size-2.5 rounded-full"
            style={{background: line.color}}
          />
          {line.name}
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground tabular">
          {formatDistance(total)}
        </span>
      </div>
      <div className="flex items-center gap-2 border-b px-4 py-1.5">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
          Download the table (metres and degrees)
        </span>
        {(['csv', 'tsv'] as const).map((kind) => (
          <Button
            key={kind}
            variant="outline"
            size="xs"
            onClick={() => {
              const file = exportFile([line], kind, line.name);
              downloadFile(file.content, file.fileName, file.mime);
            }}
          >
            <DownloadIcon data-icon="inline-start" />
            {kind.toUpperCase()}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto" onPointerLeave={() => onHover(null)}>
        <table className="w-full table-fixed text-xs">
          <thead className="sticky top-0 z-10 bg-background text-left text-muted-foreground">
            <tr className="border-b">
              <th className="w-10 px-2 py-1.5 font-medium">#</th>
              <th className="px-1 py-1.5 font-medium">Lat</th>
              <th className="px-1 py-1.5 font-medium">Lng</th>
              <th className="w-[4.5rem] px-1 py-1.5 text-right font-medium" title="Distance from the previous point">
                Segment
              </th>
              <th
                className="hidden w-[4.5rem] px-1 py-1.5 text-right font-medium sm:table-cell"
                title="Distance from the start"
              >
                Total
              </th>
              <th className="w-16 px-1 py-1.5 text-right font-medium" title="Bearing from the previous point">
                Dir.
              </th>
              <th className="w-8">
                <span className="sr-only">Delete</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {line.coords.slice(0, shown).map((point, i) => {
              const row = rows[i]!;
              return (
                <tr
                  key={i}
                  className="border-b border-border/60 hover:bg-muted/60"
                  onPointerEnter={() => onHover(point)}
                >
                  <td className="px-2 py-0.5">
                    <button
                      type="button"
                      className="font-mono text-muted-foreground tabular hover:text-foreground hover:underline"
                      aria-label={`Show point ${i + 1} on the map`}
                      onClick={() => onLocate(point)}
                    >
                      {i + 1}
                    </button>
                  </td>
                  <td className="px-0.5">
                    <CoordInput
                      value={point[0]}
                      label={`Latitude of point ${i + 1}`}
                      limit={90}
                      onCommit={(lat) =>
                        dispatch({type: 'setPoint', id: line.id, index: i, coords: [lat, point[1]]})
                      }
                    />
                  </td>
                  <td className="px-0.5">
                    <CoordInput
                      value={point[1]}
                      label={`Longitude of point ${i + 1}`}
                      limit={180}
                      onCommit={(lng) =>
                        dispatch({type: 'setPoint', id: line.id, index: i, coords: [point[0], lng]})
                      }
                    />
                  </td>
                  <td className="px-1 text-right tabular">
                    {i === 0 ? '—' : formatDistance(row.distance)}
                  </td>
                  <td className="hidden px-1 text-right text-muted-foreground tabular sm:table-cell">
                    {formatDistance(row.cumulative)}
                  </td>
                  <td
                    className="px-1 text-right whitespace-nowrap tabular"
                    title={row.bearing === null ? undefined : `${row.bearing.toFixed(1)}°`}
                  >
                    {row.bearing === null ? '—' : `${Math.round(row.bearing)}° ${compass(row.bearing)}`}
                  </td>
                  <td className="px-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete point ${i + 1}`}
                      disabled={line.coords.length <= minPoints}
                      className="hover:text-destructive"
                      onClick={() => {
                        onHover(null);
                        dispatch({type: 'deletePoint', id: line.id, index: i});
                      }}
                    >
                      <Trash2Icon />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {line.coords.length > shown && (
          <div className="p-3 text-center">
            <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, line.coords.length - shown)} more of{' '}
              {(line.coords.length - shown).toLocaleString('en')}
            </Button>
          </div>
        )}
        {closing !== null && line.coords.length <= shown && (
          <p className="px-4 py-2 text-xs text-muted-foreground tabular">
            Closing segment back to point 1: {formatDistance(closing)} · perimeter{' '}
            {formatDistance(total)}
          </p>
        )}
      </div>
    </div>
  );
}
