import {CheckIcon, SplineIcon, XIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {perimeter, type UnitSystem} from '@/lib/geo';
import {useUnits} from '@/lib/units';
import type {LatLng} from '@/lib/polyline';
import type {Line} from '@/lib/store';

/** Slider position (0–100) ↔ tolerance on a log scale, 0.5 m to 1 km. */
export const toleranceAt = (position: number) => 0.5 * 2000 ** (position / 100);

function formatTolerance(m: number, system: UnitSystem) {
  if (system === 'imperial') {
    const ft = m / 0.3048;
    return ft < 10 ? `${ft.toFixed(1)} ft` : ft < 5280 ? `${Math.round(ft)} ft` : `${(ft / 5280).toFixed(2)} mi`;
  }
  return m < 10 ? `${m.toFixed(1)} m` : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

/**
 * Floats over the map so the dashed preview stays visible while the slider
 * moves. Nothing changes until Apply.
 */
export function SimplifyPanel({
  line,
  position,
  simplified,
  onPositionChange,
  onApply,
  onCancel,
}: {
  line: Line;
  position: number;
  simplified: LatLng[];
  onPositionChange: (position: number) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const {system, distance: formatDistance} = useUnits();
  const before = line.coords.length;
  const after = simplified.length;
  const saved = before ? Math.round((1 - after / before) * 100) : 0;
  const lengthBefore = perimeter(line.coords, line.closed);
  const lengthAfter = perimeter(simplified, line.closed);
  return (
    <section
      aria-label={`Simplify ${line.name}`}
      className="absolute inset-x-3 bottom-8 z-10 mx-auto max-w-md rounded-lg border bg-card/95 p-3 text-sm shadow-lg backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <SplineIcon className="size-4 shrink-0" style={{color: line.color}} />
        <h2 className="min-w-0 flex-1 truncate font-semibold">Simplify {line.name}</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Cancel" onClick={onCancel}>
          <XIcon />
        </Button>
      </div>
      <label className="mt-2 flex items-center gap-3">
        <span className="shrink-0 text-xs text-muted-foreground">Tolerance</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={position}
          onChange={(e) => onPositionChange(Number(e.target.value))}
          className="min-w-0 flex-1 accent-primary"
          aria-valuetext={formatTolerance(toleranceAt(position), system)}
        />
        <span className="w-16 shrink-0 text-right font-mono text-xs tabular">
          {formatTolerance(toleranceAt(position), system)}
        </span>
      </label>
      <p className="mt-2 text-xs text-muted-foreground tabular" aria-live="polite">
        {before.toLocaleString('en')} → <strong className="text-foreground">{after.toLocaleString('en')}</strong>{' '}
        points ({saved}% fewer) · length {formatDistance(lengthBefore)} → {formatDistance(lengthAfter)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Points closer than the tolerance to the simplified line are dropped (Douglas–Peucker).
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={after === before} onClick={onApply}>
          <CheckIcon data-icon="inline-start" />
          Apply
        </Button>
      </div>
    </section>
  );
}
