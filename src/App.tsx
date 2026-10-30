import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ActionDispatch,
} from 'react';
import {
  EllipsisIcon,
  FileDownIcon,
  LinkIcon,
  ListRestartIcon,
  MaximizeIcon,
  PencilLineIcon,
  PlusIcon,
  SparklesIcon,
  XIcon,
  MapPinPlusIcon,
  Undo2Icon,
  CheckIcon,
  MapIcon,
  SatelliteIcon,
  PentagonIcon,
  FileUpIcon,
  DownloadIcon,
} from 'lucide-react';
import {flushSync} from 'react-dom';
import {toast} from 'sonner';
import {downloadFile, writeClipboard} from '@/lib/utils';
import {exportFile, FILE_TYPES, importText, type FileKind} from '@/lib/files';
import type {ParsedLine} from '@/lib/formats';
import type {LatLng} from '@/lib/polyline';
import {LineCard, type LinePanel} from '@/components/line-card';
import {PointsPanel} from '@/components/points-panel';
import {SimplifyPanel, toleranceAt} from '@/components/simplify-panel';
import {OsmSearch} from '@/components/osm-search';
import {PlaceSearch} from '@/components/place-search';
import {ThemeControl} from '@/components/theme-control';
import {Button} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Kbd} from '@/components/ui/kbd';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {FORMATS, formatLabel, serializeAll, type Format} from '@/lib/formats';
import {formatDistance, perimeter, simplify} from '@/lib/geo';
import {
  fetchOsmGeometry,
  fetchOutline,
  snapToRoads,
  COSTINGS,
  type Bbox,
  type Costing,
  type OsmResult,
} from '@/lib/osm';
import type {Place} from '@/lib/places';
import {decode, type Precision} from '@/lib/polyline';
import {
  LINE_COLORS,
  newId,
  reducer,
  type Action,
  type DrawKind,
  type Line,
  type LineEnd,
  type State,
} from '@/lib/store';
import {useTheme} from '@/lib/theme';
import {fromHash, toHash} from '@/lib/url-state';

import logo from './favicon.svg';

const MapView = lazy(() => import('@/components/map-view'));

// Google's example from the encoded polyline algorithm documentation.
const EXAMPLE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const REPO = 'https://github.com/xantiagoma/polyline-visualizer';

async function copy(text: string, label: string) {
  try {
    await writeClipboard(text);
    toast.success(`Copied ${label}`);
  } catch {
    toast.error(`Could not copy ${label}`, {
      description: 'Clipboard access was blocked.',
    });
  }
}

function MoreMenu({
  state,
  dispatch,
  onImport,
}: {
  state: State;
  dispatch: ActionDispatch<[Action]>;
  onImport: () => void;
}) {
  const hasCoords = state.lines.some((l) => l.coords.length > 0);
  function downloadAll(kind: FileKind) {
    const file = exportFile(state.lines, kind, 'polylines');
    downloadFile(file.content, file.fileName, file.mime);
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon" aria-label="More actions" />}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={!hasCoords}
            onClick={() => copy(window.location.href, 'share link')}
          >
            <LinkIcon />
            Copy share link
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasCoords}
            onClick={() =>
              copy(
                serializeAll(state.lines, state.format, state.precision),
                `all lines as ${formatLabel(state.format)}`,
              )
            }
          >
            <FileDownIcon />
            Copy all as {formatLabel(state.format)}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasCoords}
            onClick={() =>
              copy(serializeAll(state.lines, 'geojson', state.precision), 'FeatureCollection')
            }
          >
            <FileDownIcon />
            Copy all as FeatureCollection
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onImport}>
            <FileUpIcon />
            Import file (GPX, KML, GeoJSON)…
          </DropdownMenuItem>
          {(Object.keys(FILE_TYPES) as FileKind[]).map((kind) => (
            <DropdownMenuItem key={kind} disabled={!hasCoords} onClick={() => downloadAll(kind)}>
              <DownloadIcon />
              Download all as {FILE_TYPES[kind].label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() =>
              dispatch({type: 'add', line: {coords: decode(EXAMPLE, 5), name: 'Example'}})
            }
          >
            <SparklesIcon />
            Add example line
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => dispatch({type: 'clear'})}>
            <ListRestartIcon />
            Remove all lines
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const PRESSED =
  'aria-pressed:border-primary/50 aria-pressed:bg-accent aria-pressed:text-primary';

function Settings({state, dispatch}: {state: State; dispatch: ActionDispatch<[Action]>}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs
        value={state.format}
        onValueChange={(format) => dispatch({type: 'setFormat', format: format as Format})}
        className="min-w-[18rem] flex-1"
      >
        <TabsList className="w-full" aria-label="Format">
          {FORMATS.map((f) => (
            <TabsTrigger key={f.value} value={f.value} title={f.label}>
              {f.short}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Tooltip>
        <TooltipTrigger
          render={
            <ToggleGroup
              variant="outline"
              size="sm"
              value={[String(state.precision)]}
              onValueChange={(value: string[]) => {
                if (value[0]) {
                  dispatch({type: 'setPrecision', precision: Number(value[0]) as Precision});
                }
              }}
              aria-label="Encoding precision"
            />
          }
        >
          <ToggleGroupItem value="5" aria-label="Precision 5" className={PRESSED}>
            1e5
          </ToggleGroupItem>
          <ToggleGroupItem value="6" aria-label="Precision 6" className={PRESSED}>
            1e6
          </ToggleGroupItem>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          Encoded polyline precision: 5 decimals (Google) or 6 (OSRM, Valhalla). Also
          used for the share link.
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function MapFallback() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-muted text-sm text-muted-foreground">
      Loading map…
    </div>
  );
}

function DrawingBanner({kind, onCancel}: {kind: DrawKind; onCancel: () => void}) {
  const Icon = kind === 'zone' ? PentagonIcon : PencilLineIcon;
  return (
    <div className="absolute inset-x-3 top-3 z-10 mx-auto flex max-w-md items-center gap-2 rounded-lg border bg-card/95 px-3 py-2 text-xs shadow-md backdrop-blur sm:text-sm">
      <Icon className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1">
        {kind === 'zone' ? (
          <>
            Click to add corners. Click the first point or press <Kbd>Enter</Kbd> to close the
            zone.
          </>
        ) : (
          <>
            Click to add points. Click the last point or press <Kbd>Enter</Kbd> to finish.
          </>
        )}
      </p>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        <XIcon data-icon="inline-start" />
        Cancel
      </Button>
    </div>
  );
}

function ExtendBanner({
  line,
  end,
  dispatch,
}: {
  line: Line;
  end: LineEnd;
  dispatch: ActionDispatch<[Action]>;
}) {
  return (
    <div className="absolute inset-x-3 top-3 z-10 mx-auto flex max-w-lg flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border bg-card/95 px-3 py-2 text-xs shadow-md backdrop-blur sm:text-sm">
      <MapPinPlusIcon className="size-4 shrink-0" style={{color: line.color}} />
      <p className="min-w-0 flex-1 basis-48">
        Click the map to add points to <strong className="font-semibold">{line.name}</strong>.{' '}
        <Kbd>⌫</Kbd> removes the last one.
      </p>
      <ToggleGroup
        variant="outline"
        size="sm"
        value={[end]}
        onValueChange={(value: string[]) => {
          if (value[0]) dispatch({type: 'extend', id: line.id, end: value[0] as LineEnd});
        }}
        aria-label="Add points at"
      >
        <ToggleGroupItem value="start" className={PRESSED}>
          Start
        </ToggleGroupItem>
        <ToggleGroupItem value="end" className={PRESSED}>
          End
        </ToggleGroupItem>
      </ToggleGroup>
      <Button
        variant="ghost"
        size="sm"
        disabled={line.coords.length === 0}
        onClick={() => dispatch({type: 'removePoint'})}
      >
        <Undo2Icon data-icon="inline-start" />
        Undo
      </Button>
      <Button size="sm" onClick={() => dispatch({type: 'stopExtending'})}>
        <CheckIcon data-icon="inline-start" />
        Done
      </Button>
    </div>
  );
}

const BASEMAP_KEY = 'pv-satellite';

function readSatellite() {
  try {
    return localStorage.getItem(BASEMAP_KEY) === '1';
  } catch {
    return false;
  }
}

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => fromHash(location.hash));
  const {resolved: theme} = useTheme();
  const [satellite, setSatellite] = useState(readSatellite);
  const [place, setPlace] = useState<{place: Place; n: number} | null>(null);
  const mapCenter = useRef<[number, number] | null>(null);
  const mapBounds = useRef<Bbox | null>(null);
  const [osmImporting, setOsmImporting] = useState<string | null>(null);
  function toggleSatellite() {
    const next = !satellite;
    setSatellite(next);
    try {
      if (next) localStorage.setItem(BASEMAP_KEY, '1');
      else localStorage.removeItem(BASEMAP_KEY);
    } catch {}
  }

  // The URL hash mirrors the lines, so the address bar is always shareable.
  const hash = toHash(state);
  useEffect(() => {
    if (hash !== location.hash) {
      history.replaceState(null, '', hash || location.pathname + location.search);
    }
  }, [hash]);
  useEffect(() => {
    const onHashChange = () => {
      dispatch({type: 'load', state: fromHash(location.hash)});
      dispatch({type: 'fit', ids: null});
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const totals = useMemo(() => {
    const drawn = state.lines.filter((l) => l.coords.length > 0);
    return {
      lines: drawn.length,
      points: drawn.reduce((n, l) => n + l.coords.length, 0),
      length: drawn.reduce((m, l) => m + perimeter(l.coords, l.closed), 0),
    };
  }, [state.lines]);
  // While adding points: Enter/Esc finish, Backspace undoes (outside fields).
  const isExtending = state.extending !== null;
  useEffect(() => {
    if (!isExtending) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        dispatch({type: 'stopExtending'});
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        dispatch({type: 'removePoint'});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isExtending]);
  const extendingLine = state.lines.find((l) => l.id === state.extending?.id);
  const selectedLine = state.lines.find((l) => l.id === state.selectedId);

  const drawColor = useMemo(() => {
    const used = new Set(state.lines.map((l) => l.color));
    return LINE_COLORS.find((c) => !used.has(c)) ?? LINE_COLORS[0]!;
  }, [state.lines]);

  // One line tool at a time: Simplify floats over the map, Points replaces
  // the line list. Both close if their line is deleted.
  const [panel, setPanel] = useState<{kind: LinePanel; id: string} | null>(null);
  const panelLine = state.lines.find((l) => l.id === panel?.id);
  const [simplifyAt, setSimplifyAt] = useState(30);
  const simplified = useMemo(
    () =>
      panel?.kind === 'simplify' && panelLine
        ? simplify(panelLine.coords, toleranceAt(simplifyAt), panelLine.closed)
        : null,
    [panel?.kind, panelLine, simplifyAt],
  );
  const [hovered, setHovered] = useState<LatLng | null>(null);
  const [focus, setFocus] = useState<{coords: LatLng; n: number} | null>(null);
  function openPanel(kind: LinePanel, id: string) {
    setPanel({kind, id});
    setHovered(null);
    // While simplifying, the line is deselected so its vertex handles do not
    // hide the dashed preview.
    dispatch({type: 'select', id: kind === 'simplify' ? null : id});
    if (kind === 'simplify') dispatch({type: 'fit', ids: [id]});
  }
  function closePanel() {
    setPanel(null);
    setHovered(null);
  }

  // Import: file picker or files dropped anywhere on the page.
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  async function importFiles(files: FileList | File[]) {
    const lines: ParsedLine[] = [];
    const notes: string[] = [];
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) {
        toast.error(`${file.name} is larger than 50 MB`);
        continue;
      }
      const result = importText(await file.text(), file.name, state.precision);
      if ('error' in result) {
        toast.error(`Could not import ${file.name}`, {description: result.error});
        continue;
      }
      const base = file.name.replace(/\.[^.]+$/, '');
      lines.push(
        ...result.lines.map((l, i) => ({
          ...l,
          name: l.name ?? (result.lines.length > 1 ? `${base} ${i + 1}` : base),
        })),
      );
      notes.push(...result.notes);
    }
    if (lines.length === 0) return;
    closePanel();
    dispatch({type: 'import', lines});
    toast.success(`Imported ${lines.length} ${lines.length === 1 ? 'shape' : 'shapes'}`, {
      description: notes.join(' ') || undefined,
    });
  }

  // Remote shapes: errors become toasts, results are imported like files.
  async function importRemote(label: string, load: () => Promise<ParsedLine[]>) {
    const id = toast.loading(`Fetching ${label}…`);
    try {
      const lines = await load();
      closePanel();
      dispatch({type: 'import', lines});
      toast.success(`Imported ${label}`, {
        id,
        description: `${lines.length} ${lines.length === 1 ? 'shape' : 'shapes'} · ${lines
          .reduce((n, l) => n + l.coords.length, 0)
          .toLocaleString('en')} points`,
      });
    } catch (err) {
      toast.error(`Could not import ${label}`, {
        id,
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }
  function importShape(picked: Place) {
    void importRemote(picked.name, () => fetchOutline(picked.osm, picked.span, picked.name));
  }
  async function importOsm(result: OsmResult) {
    setOsmImporting(result.key);
    await importRemote(result.name, () => fetchOsmGeometry(result));
    setOsmImporting(null);
  }
  async function snap(line: Line, costing: Costing) {
    const before = line.coords;
    const how = COSTINGS.find((c) => c.value === costing)!.label.toLowerCase();
    const id = toast.loading(`Routing ${line.name} ${how}…`);
    try {
      const coords = await snapToRoads(line.coords, costing, line.closed);
      dispatch({type: 'edited', id: line.id, coords});
      toast.success(`Snapped ${line.name} to roads`, {
        id,
        description: `${before.length.toLocaleString('en')} → ${coords.length.toLocaleString('en')} points, ${how}`,
        duration: 10_000,
        action: {label: 'Undo', onClick: () => dispatch({type: 'edited', id: line.id, coords: before})},
      });
    } catch (err) {
      toast.error(`Could not route ${line.name}`, {
        id,
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div
      className="grid h-dvh grid-cols-1 grid-rows-[auto_minmax(14rem,42dvh)_1fr] [grid-template-areas:'header'_'map'_'panel'] md:grid-cols-[minmax(22rem,26rem)_1fr] md:grid-rows-[auto_1fr] md:[grid-template-areas:'header_map'_'panel_map']"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void importFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".gpx,.kml,.geojson,.json,.txt,application/gpx+xml,application/vnd.google-earth.kml+xml,application/geo+json,application/json,text/plain"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-50 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-background/80 backdrop-blur-sm">
          <div className="text-center">
            <FileUpIcon className="mx-auto size-8 text-primary" />
            <p className="mt-2 font-semibold">Drop to import</p>
            <p className="text-sm text-muted-foreground">GPX, KML, GeoJSON or text with polylines</p>
          </div>
        </div>
      )}
      <header className="flex items-center gap-2 border-b px-4 py-2.5 [grid-area:header] md:border-r">
        <img src={logo} alt="" className="size-6" />
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
          Polyline Visualizer
        </h1>
        <Button
          variant="ghost"
          size="sm"
          render={<a href={REPO} target="_blank" rel="noreferrer" />}
          nativeButton={false}
        >
          GitHub
        </Button>
        <ThemeControl />
      </header>

      <main className="relative min-h-0 [grid-area:map]">
        <h2 className="sr-only">Map</h2>
        <Suspense fallback={<MapFallback />}>
          <MapView
            lines={state.lines}
            selectedId={state.selectedId}
            drawing={state.drawing}
            extending={state.extending}
            drawColor={drawColor}
            basemap={satellite ? 'satellite' : theme}
            fit={state.fit}
            place={place}
            ghost={
              simplified && panelLine
                ? {coords: simplified, closed: panelLine.closed, color: panelLine.color}
                : null
            }
            highlight={hovered && panelLine ? {coords: hovered, color: panelLine.color} : null}
            focus={focus}
            centerRef={mapCenter}
            boundsRef={mapBounds}
            onDrawn={(id, coords, closed) => dispatch({type: 'drawn', id, coords, closed})}
            onEdited={(id, coords) => dispatch({type: 'edited', id, coords})}
            onSelect={(id) => dispatch({type: 'select', id})}
            onExtendPoint={(coords) => dispatch({type: 'addPoint', coords})}
          />
        </Suspense>
        {panel?.kind === 'simplify' && panelLine && simplified && (
          <SimplifyPanel
            line={panelLine}
            position={simplifyAt}
            simplified={simplified}
            onPositionChange={setSimplifyAt}
            onCancel={closePanel}
            onApply={() => {
              const before = panelLine.coords.length;
              dispatch({type: 'edited', id: panelLine.id, coords: simplified});
              toast.success(`Simplified ${panelLine.name}`, {
                description: `${before.toLocaleString('en')} → ${simplified.length.toLocaleString('en')} points`,
              });
              closePanel();
            }}
          />
        )}
        {state.drawing ? (
          <DrawingBanner
            kind={state.drawing}
            onCancel={() => dispatch({type: 'setDrawing', drawing: false})}
          />
        ) : extendingLine && state.extending ? (
          <ExtendBanner line={extendingLine} end={state.extending.end} dispatch={dispatch} />
        ) : (
          <div className="absolute top-3 right-14 left-3 z-10 flex flex-wrap gap-2">
            <PlaceSearch
              near={() => mapCenter.current}
              onSelect={(picked) => setPlace((prev) => ({place: picked, n: (prev?.n ?? 0) + 1}))}
              onImportShape={importShape}
            />
            <OsmSearch
              bounds={() => mapBounds.current}
              importing={osmImporting}
              onImport={(result) => void importOsm(result)}
            />
            {place && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      className="bg-card shadow-md"
                      aria-label={`Remove marker for ${place.place.name}`}
                      onClick={() => setPlace(null)}
                    />
                  }
                >
                  <XIcon />
                </TooltipTrigger>
                <TooltipContent>Remove marker: {place.place.name}</TooltipContent>
              </Tooltip>
            )}
            <Button
              className="shadow-md"
              aria-label="Draw line"
              onClick={() => dispatch({type: 'setDrawing', drawing: 'line'})}
            >
              <PencilLineIcon data-icon="inline-start" />
              <span className="hidden sm:inline">Draw</span>
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="bg-card shadow-md"
                    aria-label="Draw zone"
                    onClick={() => dispatch({type: 'setDrawing', drawing: 'zone'})}
                  />
                }
              >
                <PentagonIcon />
              </TooltipTrigger>
              <TooltipContent>Draw zone (closed shape)</TooltipContent>
            </Tooltip>
            {selectedLine && (
              <Button
                variant="outline"
                className="bg-card shadow-md"
                aria-label="Add points"
                onClick={() => dispatch({type: 'extend', id: selectedLine.id, end: 'end'})}
              >
                <MapPinPlusIcon data-icon="inline-start" style={{color: selectedLine.color}} />
                <span className="hidden sm:inline">Add points</span>
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="bg-card shadow-md"
                    aria-label="Zoom to all lines"
                    disabled={totals.points === 0}
                    onClick={() => dispatch({type: 'fit', ids: null})}
                  />
                }
              >
                <MaximizeIcon />
              </TooltipTrigger>
              <TooltipContent>Zoom to all lines</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="bg-card shadow-md"
                    aria-label={satellite ? 'Show map view' : 'Show satellite view'}
                    onClick={toggleSatellite}
                  />
                }
              >
                {satellite ? <MapIcon /> : <SatelliteIcon />}
              </TooltipTrigger>
              <TooltipContent>{satellite ? 'Map view' : 'Satellite view'}</TooltipContent>
            </Tooltip>
          </div>
        )}
      </main>

      <aside
        aria-label="Lines"
        className="flex min-h-0 flex-col border-t [grid-area:panel] md:border-t-0 md:border-r"
      >
        {panel?.kind === 'points' && panelLine ? (
          <PointsPanel
            line={panelLine}
            dispatch={dispatch}
            onClose={closePanel}
            onHover={setHovered}
            onLocate={(coords) => setFocus((prev) => ({coords, n: (prev?.n ?? 0) + 1}))}
          />
        ) : (
          <>
            <div className="flex flex-col gap-2 border-b px-4 py-3">
              <Settings state={state} dispatch={dispatch} />
              <p className="text-xs text-muted-foreground tabular" aria-live="polite">
                {totals.lines === 0
                  ? 'Paste a polyline, drop a file or draw on the map.'
                  : `${totals.lines} ${totals.lines === 1 ? 'shape' : 'shapes'} · ${totals.points.toLocaleString('en')} points · ${formatDistance(totals.length)}`}
              </p>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              {state.lines.map((line, index) => (
                <LineCard
                  key={line.id}
                  line={line}
                  index={index}
                  selected={line.id === state.selectedId}
                  format={state.format}
                  precision={state.precision}
                  dispatch={dispatch}
                  onOpenPanel={(kind) => openPanel(kind, line.id)}
                  onSnap={(costing) => void snap(line, costing)}
                />
              ))}
              {state.lines.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No lines. Add one, draw on the map or drop a file.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  const id = newId();
                  flushSync(() => dispatch({type: 'add', id}));
                  document.getElementById(`line-${id}`)?.focus();
                }}
              >
                <PlusIcon data-icon="inline-start" />
                Add line
              </Button>
              <Button
                variant={state.drawing ? 'secondary' : 'outline'}
                className="flex-1"
                onClick={() =>
                  dispatch({type: 'setDrawing', drawing: state.drawing ? false : 'line'})
                }
              >
                <PencilLineIcon data-icon="inline-start" />
                {state.drawing ? 'Stop drawing' : 'Draw on map'}
              </Button>
              <MoreMenu
                state={state}
                dispatch={dispatch}
                onImport={() => fileInput.current?.click()}
              />
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
