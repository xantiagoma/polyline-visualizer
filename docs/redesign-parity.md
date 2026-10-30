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
| Light / dark / system theme, basemap follows | lib/theme.ts, `setStyle` keeping draw layers | B |
| Responsive: map on top, panel below on mobile | `App` grid | B (no horizontal scroll at 320/390) |
