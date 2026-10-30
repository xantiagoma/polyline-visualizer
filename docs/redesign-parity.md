# Redesign parity (2026-10-29)

Baseline: `main` at ce6afe8 (Vite 2, vanilla JS, Leaflet 1.2 + leaflet.pm
`@latest`, `@mapbox/polyline` 0.2 from unpkg, CARTO light tiles).
New stack: Bun + React 19, MapLibre GL 6 + OpenFreeMap, Terra Draw, shadcn/ui
on Base UI.

Evidence key: **T** = `bun test` (src/lib/*.test.ts), **B** = checked by hand in
Chrome against the production build (`bun run preview`), light/dark, 320/390
px and desktop.

| Capability (baseline) | Where now | Evidence |
| --- | --- | --- |
| Encoded polyline tab (precision 5) | `encode`/`decode` (lib/polyline.ts), Encoded tab | T (Google example), B |
| LatLng array tab | `parse`/`serialize` (lib/formats.ts) | T, B |
| LngLat array tab | same | T, B |
| Paste/type → decode and draw | `LineCard` → `interpretInput` → reducer `input` | T, B |
| Map fits the line on input | `fit` request in the store, `MapView` fit effect | T, B |
| Switching tab re-renders in the new format | reducer `setFormat`, text derived from coords | T, B |
| Draw a polyline on the map | Terra Draw linestring mode, Draw buttons | B |
| Edit vertices on the map → text updates | Terra Draw select mode, `edited` action | B (drag changed length 4.96 → 4.74 km and the URL) |
| Remove the line | Delete button on each card (map-side feature delete disabled to keep sync) | B |
| Draw disabled while a line exists | Replaced: any number of lines | T |
| Empty text removes the line from the map | empty text = line with no coords | T |
| Parse error shown under the input | inline error on blur, `role="alert"` | B |
| Carto light basemap, attribution | OpenFreeMap positron / dark, attribution control | B |
| Autofocus on the input | Add line focuses the new field | B |
| Title / description meta | `index.html` | — |

## Bugs fixed from the baseline

- Clearing the text left a stale layer reference, so the next paste updated
  a layer no longer on the map (nothing appeared).
- Drawn lines used `width` instead of `weight`, so they had another thickness.
- Invalid encoded strings decoded to garbage instead of an error; JSON shapes
  and coordinate ranges were not validated.
- `leaflet.pm@latest` was unpinned; the layout was unusable on mobile.

## New behavior

| Feature | Where | Evidence |
| --- | --- | --- |
| Precision 5/6 toggle, hint and auto-switch on paste | `interpretInput`, "Use precision 6" button | T, B (OSRM-style string → toast "Switched to precision 6") |
| GeoJSON tab (LineString, MultiLineString, Feature, FeatureCollection, names) | lib/formats.ts | T, B |
| Format detection on paste | `detectFormat` | T, B (FeatureCollection pasted in LatLng → "Detected GeoJSON") |
| Several lines, split on paste | reducer `input`, `add`, `remove` | T, B |
| Names, colours, hide/show, zoom-to, copy per line | `LineCard` | B |
| Points and length per line and in total | lib/geo.ts | T |
| Start/end markers, vertex/midpoint editing | `MapView` | B |
| Extend a line from its end or start (Add points mode, ⌫ undo, Enter/Esc) | store `extend`/`addPoint`/`removePoint`, `ExtendBanner`, `MapView` | T, B (3 → 5 points, ⌫ → 4, selection kept after Done) |
| Shareable URL in the hash, copy link, copy all, FeatureCollection | lib/url-state.ts, More menu | T, B |
| `{lat, lng}` objects, elevation values, quoted encoded strings | lib/formats.ts | T |
| Zones: toggle closed, draw zone, ring/Polygon/KML detection, fill, area and perimeter, `z` in the URL | lib/formats.ts `detectRing`, store `toggleClosed`, `MapView` polygon mode | T, B (drawn zone → "Zone · 4 points · 6.08 km²", `z=0,2`) |
| Simplify with tolerance and dashed preview | lib/geo.ts `simplify`, `SimplifyPanel` | T, B (120 → 22 points at 4.9 m) |
| Points and segments table (edit, delete, hover highlight, fly to point) | lib/geo.ts `segments`, `PointsPanel` | T, B (desktop and 390 px) |
| Import GPX/KML/GeoJSON/text by drop or picker; download GeoJSON/GPX/KML | lib/files.ts, App drop zone, menus | T (lib/files.test.ts), B (dropped KML zone + GPX track) |
| Import a place's shape from search (Nominatim lookup) | lib/osm.ts `fetchOutline`, `PlaceSearch` | B (Medellín → zone, 1,330 points, 110 km²) |
| Routes, streets and rivers in view (Overpass, mirror fallback, stitched ways) | lib/osm.ts, `OsmSearch` | T (queries, grouping, stitching), B (metro lines listed; Carrera 50D, 3 ways → 1 line) |
| Snap to roads (Valhalla, 10 locations per request, undo) | lib/osm.ts `snapToRoads`, card menu | T (chunking), B (28 → 36 points on foot, undo restores) |
| CSV/TSV of points (line, point, lat, lng, segment_m, cumulative_m, bearing_deg, zone) from the points panel and download menus | lib/files.ts `toCsv`/`toTsv` | T, B (parque.csv/.tsv content checked) |
| CSV/TSV import (column detection, grouping, zones, semicolons/decimal commas, no header) | lib/files.ts `parseDelimited` | T, B (dropped rutas.csv + lote.tsv → 2 lines + 1 zone) |
| Reorder lines: drag grip, keyboard drag, Move up/down, Alt+↑/↓ | store `move`, dnd-kit in `App`/`LineCard` | T, B (mouse drag, Space/arrows/Space with announcement, Alt+↑) |
| Units: metric/imperial; fixed length unit (m, km, ft, mi) and area unit (m², ha, km², ft², ac, mi²), or auto | lib/geo.ts, lib/units.tsx `UnitsProvider`, `UnitsMenu` | T, B (imperial: 4.98 mi², 1.09 ac, 490 mi, scale bar in mi) |
| Place search (Photon, `/` shortcut, marker, biased to the map centre) | lib/places.ts, `PlaceSearch`, `MapView` | T (lib/places.test.ts), B (“parque berrio medellin” → flies to Parque Berrío, marker removable) |
| Satellite view (Esri World Imagery + roads/places), saved per browser | `MapView` `STYLES.satellite`, map toolbar toggle | B (lines kept across switches, attribution shown) |
| Light / dark / system theme, basemap follows | lib/theme.ts, `setStyle` keeping draw layers | B |
| Responsive: map on top, panel below on mobile | `App` grid | B (no horizontal scroll at 320/390) |
