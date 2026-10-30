import {useEffect, useRef, useState} from 'react';
import {DownloadIcon, LoaderCircleIcon, RouteIcon, SearchIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {OSM_KINDS, searchOsm, type Bbox, type OsmKind, type OsmResult} from '@/lib/osm';

/** Larger views make Overpass slow or time out; ask to zoom in instead. */
const MAX_SPAN_DEG = 1.5;

type Status =
  | {kind: 'idle'}
  | {kind: 'loading'}
  | {kind: 'done'; results: OsmResult[]}
  | {kind: 'error'; message: string};

/**
 * Finds routes (bus, metro, bike…), streets and rivers inside the current map
 * view with Overpass. Explicit search (no search-as-you-type): Overpass
 * queries are heavy for the shared public servers.
 */
export function OsmSearch({
  bounds,
  importing,
  onImport,
}: {
  /** Read when a search starts: the map view as [south, west, north, east]. */
  bounds: () => Bbox | null;
  /** Key of the result being imported, if any. */
  importing: string | null;
  onImport: (result: OsmResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<OsmKind>('bus');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<Status>({kind: 'idle'});
  const request = useRef<AbortController>(undefined);
  useEffect(() => () => request.current?.abort(), []);

  async function search() {
    const bbox = bounds();
    if (!bbox) return;
    const [s, w, n, e] = bbox;
    if (n - s > MAX_SPAN_DEG || e - w > MAX_SPAN_DEG) {
      setStatus({kind: 'error', message: 'The map shows too large an area. Zoom in to a city or region and search again.'});
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setStatus({kind: 'loading'});
    try {
      const results = await searchOsm(kind, name, bbox, controller.signal);
      setStatus({kind: 'done', results});
    } catch (err) {
      if (controller.signal.aborted) return;
      setStatus({kind: 'error', message: err instanceof Error ? err.message : String(err)});
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="bg-card shadow-md"
                  aria-label="Find routes, streets and rivers"
                />
              }
            />
          }
        >
          <RouteIcon />
        </TooltipTrigger>
        <TooltipContent>Routes, streets and rivers (OpenStreetMap)</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <form
          className="flex flex-col gap-2 border-b p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <h2 className="text-sm font-semibold">Find in this map view</h2>
          <div className="flex gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as OsmKind)}
              aria-label="What to find"
              className="h-8 min-w-0 shrink-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              {OSM_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === 'street' || kind === 'river' ? 'Name' : 'Name or number (optional)'}
              aria-label="Name"
              className="min-w-0 flex-1"
            />
            <Button type="submit" size="icon" aria-label="Search" disabled={status.kind === 'loading'}>
              {status.kind === 'loading' ? <LoaderCircleIcon className="animate-spin" /> : <SearchIcon />}
            </Button>
          </div>
        </form>
        <div className="max-h-80 overflow-y-auto" aria-live="polite">
          {status.kind === 'idle' && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Pan the map to the area, pick a type and search.
            </p>
          )}
          {status.kind === 'loading' && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Asking Overpass… public servers can take a minute or more when busy.
            </p>
          )}
          {status.kind === 'error' && (
            <p className="px-3 py-6 text-center text-sm text-destructive">{status.message}</p>
          )}
          {status.kind === 'done' && status.results.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing found in this view. Try another name or zoom out a little.
            </p>
          )}
          {status.kind === 'done' && status.results.length > 0 && (
            <ul className="p-1">
              {status.results.map((result) => (
                <li
                  key={result.key}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{result.name}</span>
                    {result.detail && (
                      <span className="truncate text-xs text-muted-foreground">{result.detail}</span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={importing !== null}
                    aria-label={`Import ${result.name}`}
                    onClick={() => onImport(result)}
                  >
                    {importing === result.key ? (
                      <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
                    ) : (
                      <DownloadIcon data-icon="inline-start" />
                    )}
                    Import
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="border-t px-3 py-1.5 text-[0.7rem] text-muted-foreground">
          Via{' '}
          <a href="https://overpass-api.de" target="_blank" rel="noreferrer" className="underline">
            Overpass API
          </a>{' '}
          · data ©{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            OpenStreetMap
          </a>
        </p>
      </PopoverContent>
    </Popover>
  );
}
