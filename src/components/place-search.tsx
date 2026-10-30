import {useEffect, useRef, useState} from 'react';
import {LoaderCircleIcon, MapPinIcon, SearchIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {Kbd} from '@/components/ui/kbd';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {searchPlaces, type Place} from '@/lib/places';

type Status = 'idle' | 'loading' | 'done' | 'error';

/** Search-as-you-type over Photon, biased towards the map's centre. */
export function PlaceSearch({
  near,
  onSelect,
}: {
  /** Read when a search starts, so it is a getter rather than a value. */
  near: () => [number, number] | null;
  onSelect: (place: Place) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const request = useRef<AbortController>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      request.current?.abort();
    },
    [],
  );

  // "/" opens the search from anywhere outside a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function onQueryChange(value: string) {
    setQuery(value);
    clearTimeout(timer.current);
    request.current?.abort();
    if (value.trim().length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      request.current = controller;
      try {
        const places = await searchPlaces(value.trim(), {
          signal: controller.signal,
          near: near(),
        });
        setResults(places);
        setStatus('done');
      } catch (err) {
        if (controller.signal.aborted) return;
        console.warn(err);
        setStatus('error');
      }
    }, 300);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className="bg-card shadow-md"
            aria-label="Search places"
          />
        }
      >
        <SearchIcon data-icon="inline-start" />
        <span className="hidden text-muted-foreground lg:inline">Search places</span>
        <Kbd className="hidden lg:inline-flex">/</Kbd>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <Command shouldFilter={false} loop>
          <CommandInput
            value={query}
            onValueChange={onQueryChange}
            placeholder="City, address or place…"
            aria-label="Search places"
          />
          <CommandList className="max-h-80">
            {status === 'loading' && results.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" />
                Searching…
              </div>
            )}
            {status === 'error' && (
              <div className="py-6 text-center text-sm text-destructive">
                Search is unavailable right now. Try again in a moment.
              </div>
            )}
            {status === 'done' && <CommandEmpty>No places match “{query}”.</CommandEmpty>}
            {status === 'idle' && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Type at least 2 characters.
              </div>
            )}
            {results.length > 0 && (
              <CommandGroup heading={status === 'loading' ? 'Searching…' : 'Places'}>
                {results.map((place) => (
                  <CommandItem
                    key={place.id}
                    value={place.id}
                    onSelect={() => {
                      onSelect(place);
                      setOpen(false);
                    }}
                    className="items-start py-2"
                  >
                    <MapPinIcon className="mt-0.5 text-muted-foreground" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium">{place.name}</span>
                      {place.detail && (
                        <span className="truncate text-xs text-muted-foreground">
                          {place.detail}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground capitalize">
                      {place.kind}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <p className="border-t px-3 py-1.5 text-[0.7rem] text-muted-foreground">
            Search by{' '}
            <a href="https://photon.komoot.io" target="_blank" rel="noreferrer" className="underline">
              Photon
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
        </Command>
      </PopoverContent>
    </Popover>
  );
}
