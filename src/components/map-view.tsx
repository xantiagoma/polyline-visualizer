import {useEffect, useEffectEvent, useRef, useState, type RefObject} from 'react';
import * as maplibregl from 'maplibre-gl';
import type {GeoJSONSource, StyleSpecification} from 'maplibre-gl';
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPolygonMode,
  TerraDrawRenderMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
  type HexColor,
} from 'terra-draw';
import {TerraDrawMapLibreGLAdapter} from 'terra-draw-maplibre-gl-adapter';
import {bounds} from '@/lib/geo';
import type {Place} from '@/lib/places';
import type {LatLng} from '@/lib/polyline';
import type {DrawKind, Line, State} from '@/lib/store';

export type Basemap = 'light' | 'dark' | 'satellite';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const esriRaster = (service: string, maxzoom: number) => ({
  type: 'raster' as const,
  tiles: [`${ESRI}/${service}/MapServer/tile/{z}/{y}/{x}`],
  tileSize: 256,
  maxzoom,
});

/**
 * OpenFreeMap: free vector tiles, no API key, no usage limits
 * (https://openfreemap.org). Satellite: Esri World Imagery with its roads and
 * places reference layers on top (keyless raster tiles, attribution required).
 */
const STYLES: Record<Basemap, string | StyleSpecification> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
  satellite: {
    version: 8,
    sources: {
      imagery: {
        ...esriRaster('World_Imagery', 19),
        attribution:
          'Imagery © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics and the GIS User Community',
      },
      roads: esriRaster('Reference/World_Transportation', 19),
      places: esriRaster('Reference/World_Boundaries_and_Places', 19),
    },
    layers: [
      {id: 'imagery', type: 'raster', source: 'imagery'},
      {id: 'roads', type: 'raster', source: 'roads', paint: {'raster-opacity': 0.8}},
      {id: 'places', type: 'raster', source: 'places'},
    ],
  },
};

// Served from /vendor (src/assets.ts); the bundler does not follow the worker.
maplibregl.setWorkerUrl(`/vendor/maplibre-gl-worker-${maplibregl.getVersion()}.mjs`);

/** Layers and sources we own, kept across basemap (theme) swaps. */
const OWN = /^(td-|pv-)/;
const ENDPOINTS = 'pv-endpoints';
const PREVIEW = 'pv-extend-preview';
/** Simplification preview: the candidate line, dashed, with its vertices. */
const GHOST = 'pv-ghost';
/** A point hovered in the points table. */
const HIGHLIGHT = 'pv-highlight';
const EMPTY: GeoJSON.FeatureCollection = {type: 'FeatureCollection', features: []};
const FIT = {padding: {top: 72, bottom: 48, left: 48, right: 64}, maxZoom: 17};

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;
/** Terra Draw rejects coordinates with more decimals than its precision (9). */
const toPosition = ([lat, lng]: LatLng) => [round(lng, 9), round(lat, 9)];
/** Drawn coordinates: 6 decimals is ~0.1 m, more than any encoding keeps. */
const fromPosition = ([lng, lat]: number[]): LatLng => [round(lat!, 6), round(lng!, 6)];

const sameCoords = (a: number[][], b: number[][]) =>
  a.length === b.length &&
  a.every((p, i) => Math.abs(p[0]! - b[i]![0]!) < 1e-9 && Math.abs(p[1]! - b[i]![1]!) < 1e-9);

/** Lines of 2+ points and zones of 3+ are drawn; zones as polygons. */
const drawable = (l: Line) => !l.hidden && l.coords.length >= (l.closed ? 3 : 2);

function geometryOf(line: Line): GeoJSONStoreFeatures['geometry'] {
  const positions = line.coords.map(toPosition);
  return line.closed
    ? {type: 'Polygon', coordinates: [[...positions, positions[0]!]]}
    : {type: 'LineString', coordinates: positions};
}

/** A Terra Draw feature back to our coordinates (rings lose the closing point). */
function coordsOf(feature: GeoJSONStoreFeatures): LatLng[] | null {
  const {geometry} = feature;
  if (geometry.type === 'LineString') return (geometry.coordinates as number[][]).map(fromPosition);
  if (geometry.type === 'Polygon') {
    return (geometry.coordinates[0] as number[][]).slice(0, -1).map(fromPosition);
  }
  return null;
}

function endpoints(lines: Line[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: lines.flatMap((line) => {
      // Zones have no direction worth marking.
      if (line.hidden || line.coords.length === 0 || line.closed) return [];
      const point = (coords: LatLng, kind: 'start' | 'end') => ({
        type: 'Feature' as const,
        properties: {kind, color: line.color},
        geometry: {type: 'Point' as const, coordinates: toPosition(coords)},
      });
      return line.coords.length === 1
        ? [point(line.coords[0]!, 'start')]
        : [point(line.coords[0]!, 'start'), point(line.coords.at(-1)!, 'end')];
    }),
  };
}

function addOwnLayers(map: maplibregl.Map) {
  if (map.getSource(ENDPOINTS)) return;
  // Dashed segment from the line's end to the cursor while adding points.
  map.addSource(PREVIEW, {type: 'geojson', data: EMPTY});
  map.addLayer({
    id: PREVIEW,
    type: 'line',
    source: PREVIEW,
    layout: {'line-cap': 'round'},
    paint: {'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [1.5, 1.5]},
  });
  map.addSource(GHOST, {type: 'geojson', data: EMPTY});
  map.addLayer({
    id: GHOST,
    type: 'line',
    source: GHOST,
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [2, 1.5]},
  });
  map.addLayer({
    id: `${GHOST}-points`,
    type: 'circle',
    source: GHOST,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 3.5,
      'circle-color': '#ffffff',
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 2,
    },
  });
  map.addSource(HIGHLIGHT, {type: 'geojson', data: EMPTY});
  map.addLayer({
    id: HIGHLIGHT,
    type: 'circle',
    source: HIGHLIGHT,
    paint: {
      'circle-radius': 10,
      'circle-color': 'rgba(255,255,255,0.35)',
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 3,
    },
  });
  map.addSource(ENDPOINTS, {type: 'geojson', data: EMPTY});
  map.addLayer({
    id: ENDPOINTS,
    type: 'circle',
    source: ENDPOINTS,
    paint: {
      'circle-radius': 6,
      'circle-color': ['case', ['==', ['get', 'kind'], 'start'], '#ffffff', ['get', 'color']],
      'circle-stroke-color': ['case', ['==', ['get', 'kind'], 'start'], ['get', 'color'], '#ffffff'],
      'circle-stroke-width': 3,
    },
  });
}

/** Swaps the basemap but carries over Terra Draw's and our own layers. */
function keepOwnLayers(previous: StyleSpecification | undefined, next: StyleSpecification) {
  if (!previous) return next;
  const sources = Object.fromEntries(
    Object.entries(previous.sources).filter(([id]) => OWN.test(id)),
  );
  return {
    ...next,
    sources: {...next.sources, ...sources},
    layers: [...next.layers, ...previous.layers.filter((l) => OWN.test(l.id))],
  };
}

type Props = {
  lines: Line[];
  selectedId: string | null;
  drawing: DrawKind | false;
  extending: State['extending'];
  drawColor: string;
  basemap: Basemap;
  fit: State['fit'];
  /** A searched place to fly to and mark; `n` changes on every pick. */
  place: {place: Place; n: number} | null;
  /** Simplification preview for a line (dashed, with its points). */
  ghost: {coords: LatLng[]; closed: boolean; color: string} | null;
  /** A point to ring, e.g. the row hovered in the points table. */
  highlight: {coords: LatLng; color: string} | null;
  /** Fly to a point (e.g. from the points table); `n` changes per request. */
  focus: {coords: LatLng; n: number} | null;
  /** Written with the map centre, for search bias. */
  centerRef: RefObject<[number, number] | null>;
  onDrawn: (id: string, coords: LatLng[], closed: boolean) => void;
  onEdited: (id: string, coords: LatLng[]) => void;
  onSelect: (id: string | null) => void;
  onExtendPoint: (coords: LatLng) => void;
};

type Instance = {map: maplibregl.Map; draw: TerraDraw};

export default function MapView({
  lines,
  selectedId,
  drawing,
  extending,
  drawColor,
  basemap,
  fit,
  place,
  ghost,
  highlight,
  focus,
  centerRef,
  onDrawn,
  onEdited,
  onSelect,
  onExtendPoint,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<Instance | null>(null);
  // Read by Terra Draw's styling functions, outside React's render.
  const colors = useRef(new Map<string, string>());
  const nextColor = useRef(drawColor);
  const known = useRef(new Set<string>());
  const selected = useRef(selectedId);
  // Leaving select mode deselects in Terra Draw; that is not a user deselect.
  const switchingMode = useRef(false);

  const handleFinish = useEffectEvent((draw: TerraDraw, id: string, mode: string) => {
    if (mode !== 'linestring' && mode !== 'polygon') return;
    const feature = draw.getSnapshotFeature(id);
    const coords = feature && coordsOf(feature);
    if (coords) onDrawn(id, coords, mode === 'polygon');
  });
  const handleChange = useEffectEvent((draw: TerraDraw, ids: (string | number)[]) => {
    for (const id of ids) {
      if (typeof id !== 'string' || !known.current.has(id)) continue;
      const feature = draw.getSnapshotFeature(id);
      const coords = feature && coordsOf(feature);
      if (coords) onEdited(id, coords);
    }
  });
  const handleSelect = useEffectEvent((id: string | null) => onSelect(id));
  const handleExtendPoint = useEffectEvent((coords: LatLng) => onExtendPoint(coords));
  /** The point new clicks connect to, and the line's colour. */
  const extendAnchor = useEffectEvent(() => {
    const line = lines.find((l) => l.id === extending?.id);
    if (!line || !extending) return null;
    const coords = extending.end === 'end' ? line.coords.at(-1) : line.coords[0];
    return {coords, color: line.color};
  });
  const initialView = useEffectEvent(() =>
    bounds(lines.filter((l) => !l.hidden).map((l) => l.coords)),
  );
  const initialStyle = useEffectEvent(() => STYLES[basemap]);

  // Create the map and Terra Draw once.
  useEffect(() => {
    const view = initialView();
    const map = new maplibregl.Map({
      container: container.current!,
      style: initialStyle(),
      ...(view ? {bounds: view, fitBoundsOptions: FIT} : {center: [20, 15], zoom: 1.3}),
      attributionControl: {compact: true},
    });
    map.addControl(new maplibregl.NavigationControl({visualizePitch: false}), 'top-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

    // Guidance points (vertices, midpoints) take the colour of their line;
    // midpoints carry no parent id, but only the selected line has them.
    const colorOf = ({id, properties: p}: GeoJSONStoreFeatures) => {
      const parent = p.selectionPointFeatureId ?? p.coordinatePointFeatureId ?? id;
      const own = colors.current.get(String(parent));
      if (own) return own as HexColor;
      if (p.midPoint) return (colors.current.get(selected.current ?? '') ?? nextColor.current) as HexColor;
      return nextColor.current as HexColor;
    };
    let draw: TerraDraw | null = null;
    map.once('load', () => {
      addOwnLayers(map);
      draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({map, coordinatePrecision: 9}),
        modes: [
          new TerraDrawLineStringMode({
            styles: {
              lineStringColor: colorOf,
              lineStringWidth: 4,
              closingPointColor: colorOf,
              closingPointOutlineColor: '#ffffff',
              closingPointWidth: 5,
              coordinatePointColor: colorOf,
              coordinatePointOutlineColor: '#ffffff',
              coordinatePointWidth: 4,
            },
          }),
          new TerraDrawPolygonMode({
            styles: {
              fillColor: colorOf,
              fillOpacity: 0.2,
              outlineColor: colorOf,
              outlineWidth: 3,
              closingPointColor: colorOf,
              closingPointOutlineColor: '#ffffff',
              closingPointWidth: 5,
              coordinatePointColor: colorOf,
              coordinatePointOutlineColor: '#ffffff',
              coordinatePointWidth: 4,
            },
          }),
          // Inert mode while points are added by clicking (see below).
          new TerraDrawRenderMode({modeName: 'idle', styles: {}}),
          new TerraDrawSelectMode({
            flags: {
              linestring: {
                feature: {
                  draggable: true,
                  coordinates: {midpoints: true, draggable: true, deletable: true},
                },
              },
              polygon: {
                feature: {
                  draggable: true,
                  coordinates: {midpoints: true, draggable: true, deletable: true},
                },
              },
            },
            // Lines are deleted from their card, so the map stays in sync.
            keyEvents: {deselect: 'Escape', delete: null, rotate: null, scale: null},
            styles: {
              selectedLineStringColor: colorOf,
              selectedLineStringWidth: 6,
              selectedPolygonColor: colorOf,
              selectedPolygonFillOpacity: 0.3,
              selectedPolygonOutlineColor: colorOf,
              selectedPolygonOutlineWidth: 4,
              selectionPointColor: colorOf,
              selectionPointOutlineColor: '#ffffff',
              selectionPointWidth: 5,
              selectionPointOutlineWidth: 2,
              midPointColor: '#ffffff',
              midPointOutlineColor: colorOf,
              midPointWidth: 5,
              midPointOutlineWidth: 2,
            },
          }),
        ],
      });
      draw.start();
      draw.setMode('select');
      const d = draw;
      d.on('finish', (id, context) => handleFinish(d, String(id), context.mode));
      d.on('change', (ids, type, context) => {
        // Our own API calls also emit changes; only user edits flow back.
        if (type !== 'update' || (context && 'origin' in context)) return;
        handleChange(d, ids);
      });
      d.on('select', (id) => handleSelect(String(id)));
      const trackCenter = () => {
        const c = map.getCenter();
        centerRef.current = [c.lng, c.lat];
      };
      trackCenter();
      map.on('moveend', trackCenter);
      d.on('deselect', () => {
        if (!switchingMode.current) handleSelect(null);
      });
      setInstance({map, draw: d});
    });

    return () => {
      setInstance(null);
      draw?.stop();
      map.remove();
    };
  }, []);

  // Basemap follows the theme, or the satellite choice.
  const currentBasemap = useRef(basemap);
  useEffect(() => {
    if (!instance || currentBasemap.current === basemap) return;
    currentBasemap.current = basemap;
    instance.map.setStyle(STYLES[basemap], {transformStyle: keepOwnLayers});
  }, [instance, basemap]);

  // Lines → Terra Draw features and endpoint markers.
  useEffect(() => {
    if (!instance) return;
    const {map, draw} = instance;
    nextColor.current = drawColor;
    colors.current = new Map(lines.map((l) => [l.id, l.color]));
    known.current = new Set(lines.map((l) => l.id));

    const visible = new Map(lines.filter(drawable).map((l) => [l.id, l]));
    const modeOf = (l: Line) => (l.closed ? 'polygon' : 'linestring');
    const stale = draw
      .getSnapshot()
      .filter((f) => {
        if (f.properties.mode !== 'linestring' && f.properties.mode !== 'polygon') return false;
        if (f.properties.currentlyDrawing) return false;
        const line = visible.get(String(f.id));
        // A line toggled to a zone (or back) is re-added in the other mode.
        return !line || modeOf(line) !== f.properties.mode;
      })
      .map((f) => f.id!);
    if (stale.length) draw.removeFeatures(stale);

    for (const line of visible.values()) {
      const geometry = geometryOf(line);
      const existing = draw.getSnapshotFeature(line.id);
      if (!existing) {
        const [result] = draw.addFeatures([
          {id: line.id, type: 'Feature', geometry, properties: {mode: modeOf(line)}},
        ]);
        if (result && !result.valid) console.warn('Line not drawn:', result.reason);
      } else {
        const ring = (g: GeoJSONStoreFeatures['geometry']) =>
          (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates) as number[][];
        if (!sameCoords(ring(existing.geometry), ring(geometry))) {
          draw.updateFeatureGeometry(line.id, geometry);
        }
      }
    }
    (map.getSource(ENDPOINTS) as GeoJSONSource | undefined)?.setData(endpoints(lines));
  }, [instance, lines, drawColor]);

  // Drawing mode, and selection while not drawing.
  useEffect(() => {
    if (!instance) return;
    const {draw} = instance;
    const mode =
      drawing === 'zone' ? 'polygon' : drawing ? 'linestring' : extending ? 'idle' : 'select';
    if (draw.getMode() !== mode) {
      switchingMode.current = true;
      draw.setMode(mode);
      switchingMode.current = false;
    }
    selected.current = selectedId;
    if (mode !== 'select') return;
    for (const f of draw.getSnapshot()) {
      if (f.properties.selected && f.id !== selectedId) draw.deselectFeature(f.id!);
    }
    const target = selectedId ? draw.getSnapshotFeature(selectedId) : undefined;
    if (target && !target.properties.selected) draw.selectFeature(selectedId!);
  }, [instance, drawing, extending, selectedId, lines]);

  // Adding points: each map click appends to (or prepends before) the line.
  const extendingId = extending?.id;
  const extendingEnd = extending?.end;
  useEffect(() => {
    if (!instance || !extendingId) return;
    const {map} = instance;
    const preview = () => map.getSource(PREVIEW) as GeoJSONSource | undefined;
    const showPreview = (lngLat: maplibregl.LngLat) => {
      const anchor = extendAnchor();
      if (!anchor?.coords) return preview()?.setData(EMPTY);
      preview()?.setData({
        type: 'Feature',
        properties: {color: anchor.color},
        geometry: {
          type: 'LineString',
          coordinates: [toPosition(anchor.coords), [lngLat.lng, lngLat.lat]],
        },
      });
    };
    const onClick = (e: maplibregl.MapMouseEvent) => {
      handleExtendPoint(fromPosition([e.lngLat.lng, e.lngLat.lat]));
    };
    const onMove = (e: maplibregl.MapMouseEvent) => showPreview(e.lngLat);
    const onOut = () => preview()?.setData(EMPTY);
    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor = 'crosshair';
    map.on('click', onClick);
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMove);
      map.off('mouseout', onOut);
      map.doubleClickZoom.enable();
      map.getCanvas().style.cursor = '';
      preview()?.setData(EMPTY);
    };
  }, [instance, extendingId, extendingEnd]);

  // Fit requests from the panel.
  const lastFit = useRef(fit.n);
  useEffect(() => {
    if (!instance || fit.n === lastFit.current) return;
    lastFit.current = fit.n;
    const targets = lines.filter(
      (l) => !l.hidden && (fit.ids === null || fit.ids.includes(l.id)),
    );
    const box = bounds(targets.map((l) => l.coords));
    if (box) instance.map.fitBounds(box, {...FIT, duration: 500});
  }, [instance, fit, lines]);

  // Searched place: fly there and drop a marker until the next pick or clear.
  const placeN = place?.n;
  const placeValue = place?.place;
  useEffect(() => {
    if (!instance || !placeValue) return;
    const {map} = instance;
    if (placeValue.bbox) {
      map.fitBounds(placeValue.bbox, {...FIT, maxZoom: 17, duration: 900});
    } else {
      map.flyTo({center: placeValue.lngLat, zoom: placeValue.zoom, duration: 900});
    }
    const marker = new maplibregl.Marker({color: '#1d5fd6'})
      .setLngLat(placeValue.lngLat)
      .addTo(map);
    marker.getElement().setAttribute('aria-label', placeValue.name);
    marker.getElement().title = placeValue.name;
    return () => {
      marker.remove();
    };
  }, [instance, placeN, placeValue]);

  const focusN = focus?.n;
  const focusCoords = focus?.coords;
  useEffect(() => {
    if (!instance || !focusCoords) return;
    const {map} = instance;
    map.flyTo({center: toPosition(focusCoords) as [number, number], zoom: Math.max(map.getZoom(), 16)});
  }, [instance, focusN, focusCoords]);

  // Simplification preview and the hovered table row.
  useEffect(() => {
    const source = instance?.map.getSource(GHOST) as GeoJSONSource | undefined;
    if (!source) return;
    if (!ghost || ghost.coords.length === 0) {
      source.setData(EMPTY);
      return;
    }
    const ring = ghost.closed ? [...ghost.coords, ghost.coords[0]!] : ghost.coords;
    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {color: ghost.color},
          geometry: {type: 'LineString', coordinates: ring.map(toPosition)},
        },
        ...ghost.coords.map((c) => ({
          type: 'Feature' as const,
          properties: {color: ghost.color},
          geometry: {type: 'Point' as const, coordinates: toPosition(c)},
        })),
      ],
    });
  }, [instance, ghost]);
  useEffect(() => {
    const source = instance?.map.getSource(HIGHLIGHT) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(
      highlight
        ? {
            type: 'Feature',
            properties: {color: highlight.color},
            geometry: {type: 'Point', coordinates: toPosition(highlight.coords)},
          }
        : EMPTY,
    );
  }, [instance, highlight]);

  // MapLibre's stylesheet sets .maplibregl-map to position: relative (and it
  // is not in a cascade layer), so the map fills a positioned wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="size-full" />
    </div>
  );
}
