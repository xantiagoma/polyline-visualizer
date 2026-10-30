import path from 'node:path';

const modules = path.join(import.meta.dir, '..', 'node_modules');

/**
 * Self-hosted font files. Bun's CSS bundler inlines every url() as base64, so
 * the @font-face rules live inline in index.html and point at /fonts/*, which
 * the dev server routes here and build.ts copies into dist/fonts.
 */
export const fonts: Record<string, string> = {};
for (const pkg of ['inter', 'jetbrains-mono']) {
  for (const subset of ['latin', 'latin-ext']) {
    const file = `${pkg}-${subset}-wght-normal.woff2`;
    fonts[file] = path.join(modules, '@fontsource-variable', pkg, 'files', file);
  }
}

/**
 * MapLibre's worker is a separate module that the bundler does not follow;
 * map-view.tsx points `setWorkerUrl` at /vendor/<name>, versioned so
 * a new release is never served a cached worker.
 */
const {version} = await Bun.file(path.join(modules, 'maplibre-gl', 'package.json')).json();
export const vendor: Record<string, string> = {
  [`maplibre-gl-worker-${version}.mjs`]: path.join(
    modules,
    'maplibre-gl',
    'dist',
    'maplibre-gl-worker.mjs',
  ),
};
