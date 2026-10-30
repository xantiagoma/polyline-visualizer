# Polyline Visualizer

Decode, encode, draw and edit polylines on a map. Every line is shown in one
format at a time and stays in sync with the map.

## [polyline-visualizer.vercel.app](https://polyline-visualizer.vercel.app/)

- Formats: encoded polyline (precision 5 or 6), LatLng array, LngLat array
  and GeoJSON. Switching format re-renders every line.
- Paste detection: pasted text in another format or precision is recognised
  and the app switches to it (e.g. an OSRM/Valhalla precision-6 string, a
  LngLat array whose longitudes exceed ±90, a GeoJSON Feature).
- Several lines, each with a name, colour, stats (points, length), copy,
  zoom-to, show/hide and delete. Several polylines pasted at once
  (whitespace-separated, nested arrays, MultiLineString, FeatureCollection)
  become separate lines.
- Draw new lines on the map, drag vertices, drag a midpoint to insert a
  vertex, right-click a vertex to delete it. Start/end markers.
- Add points to an existing line: “Add points” (on the map or a card), then
  click the map to extend it from its end or start; ⌫ undoes, Enter or Esc
  finishes. Also works to draw into an empty line.
- Clear errors (out-of-range coordinates, truncated polylines, wrong order or
  precision). Invalid text never moves the map; Esc restores the last valid
  value.
- Shareable URL: lines, names, format and precision live in the hash
  (`#f=latlng&pr=6&l=…&n=…`), so long polylines never hit request limits.
  Copy all lines in any format, or as a FeatureCollection.
- Place search (press `/`): search-as-you-type with
  [Photon](https://photon.komoot.io) over OpenStreetMap, biased to the map
  view; the map flies to the result and drops a marker.
- Light, dark and system themes; the basemap follows. Satellite view (Esri
  World Imagery with roads and places), remembered per browser.

Originally a fork of [open-polyline-decoder](https://open-polyline-decoder.60devs.com/).

## Development

```sh
bun install
bun dev          # dev server with HMR on http://localhost:3000
bun test         # encoding, formats, store and URL tests
bun run typecheck
bun run build    # static site in dist/
bun run preview  # build, then serve dist/ (PORT=4419 to change the port)
```

Built with Bun, React, [MapLibre GL](https://maplibre.org/) with
[OpenFreeMap](https://openfreemap.org/) tiles (free, no API key), Esri World
Imagery for the satellite view,
[Terra Draw](https://terradraw.io/) and shadcn/ui on Base UI. Hosted on
Vercel.

## Deploying

Static build on Vercel (`vercel.json`): Bun is detected from `bun.lock`,
`bunVersion` pins it, and `dist/` is served as static files. The dev server's
`Bun.serve()` HTML imports are not used in production. MapLibre's worker is
copied to `dist/vendor/` (versioned) and fonts to `dist/fonts/` by `build.ts`.
