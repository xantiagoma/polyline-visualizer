import {useMemo, useRef, useState, type ActionDispatch} from 'react';
import {
  DownloadIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  EyeOffIcon,
  LocateFixedIcon,
  MapPinPlusIcon,
  PentagonIcon,
  RouteIcon,
  SplineIcon,
  TableIcon,
  Trash2Icon,
} from 'lucide-react';
import {toast} from 'sonner';
import {CopyButton} from '@/components/copy-button';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Textarea} from '@/components/ui/textarea';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {formatLabel, parse, serialize} from '@/lib/formats';
import {exportFile, FILE_TYPES, type FileKind} from '@/lib/files';
import {COSTINGS, MAX_WAYPOINTS, type Costing} from '@/lib/osm';
import {formatArea, formatCount, formatDistance, perimeter, ringArea} from '@/lib/geo';
import {interpretInput, type Action, type Line, type State} from '@/lib/store';
import {cn, downloadFile} from '@/lib/utils';

export type LinePanel = 'simplify' | 'points';

const PLACEHOLDERS = {
  encoded: 'Paste an encoded polyline, e.g. _p~iF~ps|U_ulLnnqC_mqNvxq`@',
  latlng: 'Paste [[lat, lng], …] pairs',
  lnglat: 'Paste [[lng, lat], …] pairs',
  geojson: 'Paste a LineString, Feature or FeatureCollection',
};

function IconAction({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={className}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function LineCard({
  line,
  index,
  selected,
  format,
  precision,
  dispatch,
  onOpenPanel,
  onSnap,
}: {
  onOpenPanel: (panel: LinePanel) => void;
  /** Re-routes the line along roads through its points. */
  onSnap: (costing: Costing) => void;
  line: Line;
  index: number;
  selected: boolean;
  format: State['format'];
  precision: State['precision'];
  dispatch: ActionDispatch<[Action]>;
}) {
  // Errors appear once the field loses focus, not on every keystroke.
  const [showError, setShowError] = useState(false);
  const pasted = useRef(false);

  const derived = useMemo(
    () => serialize(line.coords, format, precision, line.name, line.closed),
    [line.coords, format, precision, line.name, line.closed],
  );
  const text = line.draft ?? derived;
  const result = useMemo(
    () => (line.draft === null ? null : parse(line.draft, format, precision)),
    [line.draft, format, precision],
  );
  const error = result && !result.ok ? result : null;
  const stats = useMemo(
    () => ({
      count: line.coords.length,
      length: perimeter(line.coords, line.closed),
      area: line.closed ? ringArea(line.coords) : 0,
    }),
    [line.coords, line.closed],
  );
  const minPoints = line.closed ? 3 : 2;

  function download(kind: FileKind) {
    const file = exportFile([line], kind, line.name);
    downloadFile(file.content, file.fileName, file.mime);
  }
  const id = `line-${line.id}`;

  function onChange(value: string) {
    const detect = pasted.current;
    pasted.current = false;
    setShowError(false);
    const interpreted = interpretInput(value, format, precision, detect);
    dispatch({type: 'input', id: line.id, text: value, ...interpreted});
    if (interpreted.notice) toast.info(interpreted.notice);
    if (interpreted.lines && interpreted.lines.length > 1) {
      toast.success(`Split into ${interpreted.lines.length} lines`);
    }
  }

  return (
    <section
      aria-labelledby={`${id}-name`}
      className={cn(
        'group/line relative rounded-xl border bg-card p-3 pl-4 shadow-xs transition-colors',
        selected ? 'border-primary/60 ring-2 ring-primary/15' : 'hover:border-input',
        line.hidden && 'opacity-60',
      )}
      onFocusCapture={() => dispatch({type: 'select', id: line.id})}
      onPointerDown={() => dispatch({type: 'select', id: line.id})}
    >
      <span
        aria-hidden
        className="absolute inset-y-3 left-0 w-1 rounded-r-full"
        style={{background: line.color}}
      />
      <div className="flex items-center gap-1">
        <input
          id={`${id}-name`}
          value={line.name}
          aria-label={`Name of line ${index + 1}`}
          onChange={(e) => dispatch({type: 'rename', id: line.id, name: e.target.value})}
          onBlur={(e) => {
            if (!e.target.value.trim()) {
              dispatch({type: 'rename', id: line.id, name: `Line ${index + 1}`});
            }
          }}
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1 py-0.5 text-sm font-semibold outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <IconAction
          label="Zoom to line"
          disabled={stats.count === 0 || line.hidden}
          onClick={() => dispatch({type: 'fit', ids: [line.id]})}
        >
          <LocateFixedIcon />
        </IconAction>
        <IconAction
          label="Add points on the map"
          onClick={() => dispatch({type: 'extend', id: line.id, end: 'end'})}
        >
          <MapPinPlusIcon />
        </IconAction>
        <CopyButton
          value={text}
          label={`${line.name} as ${formatLabel(format)}`}
          size="icon-sm"
          variant="ghost"
        />
        <IconAction
          label={line.hidden ? 'Show on map' : 'Hide on map'}
          onClick={() => dispatch({type: 'toggleHidden', id: line.id})}
        >
          {line.hidden ? <EyeOffIcon /> : <EyeIcon />}
        </IconAction>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`More actions for ${line.name}`}
              />
            }
          >
            <EllipsisVerticalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuCheckboxItem
                checked={line.closed}
                onCheckedChange={() => dispatch({type: 'toggleClosed', id: line.id})}
              >
                <PentagonIcon />
                Closed (zone)
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem
                disabled={stats.count <= minPoints}
                onClick={() => onOpenPanel('simplify')}
              >
                <SplineIcon />
                Simplify…
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={stats.count < 2}>
                  <RouteIcon />
                  Snap to roads
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-60">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="font-normal text-muted-foreground">
                      Routes through {stats.count > MAX_WAYPOINTS ? `${MAX_WAYPOINTS} of its` : 'its'}{' '}
                      points (Valhalla)
                    </DropdownMenuLabel>
                    {COSTINGS.map((c) => (
                      <DropdownMenuItem key={c.value} onClick={() => onSnap(c.value)}>
                        {c.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem disabled={stats.count === 0} onClick={() => onOpenPanel('points')}>
                <TableIcon />
                Points and segments
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Download</DropdownMenuLabel>
              {(Object.keys(FILE_TYPES) as FileKind[]).map((kind) => (
                <DropdownMenuItem
                  key={kind}
                  disabled={stats.count === 0}
                  onClick={() => download(kind)}
                >
                  <DownloadIcon />
                  {FILE_TYPES[kind].label} (.{FILE_TYPES[kind].ext})
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => dispatch({type: 'remove', id: line.id})}
            >
              <Trash2Icon />
              Delete {line.closed ? 'zone' : 'line'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="mt-0.5 px-1 text-xs text-muted-foreground tabular">
        {line.closed && (
          <Badge variant="secondary" className="mr-1.5 h-4 px-1.5 text-[0.65rem]">
            Zone
          </Badge>
        )}
        {formatCount(stats.count)}
        {line.closed && stats.count >= 3 && ` · ${formatArea(stats.area)}`}
        {stats.count > 1 && ` · ${formatDistance(stats.length)}${line.closed ? ' perimeter' : ''}`}
        {stats.count > 0 && stats.count < minPoints && ` · needs ${minPoints} to draw`}
      </p>
      <Textarea
        id={id}
        value={text}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        placeholder={PLACEHOLDERS[format]}
        aria-label={`${line.name}, ${formatLabel(format)}`}
        aria-invalid={showError && error ? true : undefined}
        aria-describedby={showError && error ? `${id}-error` : undefined}
        onPaste={() => {
          pasted.current = true;
        }}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setShowError(true);
          dispatch({type: 'commit', id: line.id});
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && line.draft !== null) {
            e.preventDefault();
            setShowError(false);
            dispatch({type: 'revert', id: line.id});
          }
        }}
        className={cn(
          'mt-2 field-sizing-fixed resize-y bg-field font-mono text-xs leading-relaxed break-all',
          selected ? 'h-36' : 'h-20',
        )}
      />
      {showError && error && (
        <div id={`${id}-error`} role="alert" className="mt-2 text-xs text-destructive">
          <p>{error.error}</p>
          {error.precision && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="mt-1.5"
              onClick={() => {
                const precision = error.precision!;
                dispatch({
                  type: 'input',
                  id: line.id,
                  text,
                  ...interpretInput(text, format, precision, false),
                });
              }}
            >
              Use precision {error.precision}
            </Button>
          )}
          <p className="mt-1 text-muted-foreground">
            The map keeps the last valid value. Press Esc to restore it.
          </p>
        </div>
      )}
    </section>
  );
}
