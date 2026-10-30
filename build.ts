import tailwind from 'bun-plugin-tailwind';
import {copyFile, mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {fonts, vendor} from './src/assets';

const outdir = path.join(process.cwd(), 'dist');
await rm(outdir, {recursive: true, force: true});

const result = await Bun.build({
  entrypoints: ['src/index.html'],
  outdir,
  plugins: [tailwind],
  minify: true,
  splitting: true,
  target: 'browser',
  sourcemap: 'linked',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

for (const [dir, files] of Object.entries({fonts, vendor})) {
  await mkdir(path.join(outdir, dir), {recursive: true});
  for (const [name, source] of Object.entries(files)) {
    await copyFile(source, path.join(outdir, dir, name));
  }
}

for (const output of result.outputs) {
  const file = Bun.file(output.path);
  if (output.path.endsWith('.map')) continue;
  const gzip = Bun.gzipSync(new Uint8Array(await file.arrayBuffer())).length;
  console.log(
    ` ${path.relative(process.cwd(), output.path)}  ${(output.size / 1024).toFixed(1)} KB (gzip ${(gzip / 1024).toFixed(1)} KB)`,
  );
}
console.log(` dist/fonts  ${Object.keys(fonts).length} files`);
console.log(` dist/vendor  ${Object.keys(vendor).join(', ')}`);
