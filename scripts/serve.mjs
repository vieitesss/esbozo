/**
 * A static file server for the built editor page, so the e2e suite can open
 * `dist/editor.html` over http: ES modules do not load from `file://`.
 *
 * Test-only: `pnpm e2e` starts it on the port e2e picked, and `ez serve` is what
 * a person runs — it answers the save API as well as the page. Both serve the
 * same table, `src/page-assets.ts`, so neither can disagree about the page.
 *
 * Usage: node scripts/serve.mjs [folder] [port]
 */
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { PAGE_ASSETS } from '../src/page-assets.ts';

const folder = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4319);

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const asset = PAGE_ASSETS.find((entry) => entry.path === pathname);
  if (asset === undefined) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': asset.mime,
    'cache-control': 'no-store',
  });
  createReadStream(join(folder, asset.file)).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const bound = typeof address === 'object' && address !== null ? address.port : port;
  process.stdout.write(`serving ${folder} on http://127.0.0.1:${bound}/\n`);
});
