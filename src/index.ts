import {serve} from 'bun';
import index from './index.html';
import {fonts, vendor} from './assets';

const serveFrom = (files: Record<string, string>) => (req: {params: {file: string}}) => {
  const file = files[req.params.file];
  if (!file) return new Response('Not found', {status: 404});
  // Bun.file has no MIME type for .mjs, and module workers require one.
  const type = file.endsWith('.mjs') ? 'text/javascript' : undefined;
  return new Response(Bun.file(file, {type}));
};

const server = serve({
  routes: {
    '/*': index,
    '/fonts/:file': serveFrom(fonts),
    '/vendor/:file': serveFrom(vendor),
  },
  development: process.env.NODE_ENV !== 'production' && {
    hmr: true,
    console: true,
  },
});

console.log(`Polyline Visualizer running at ${server.url}`);
