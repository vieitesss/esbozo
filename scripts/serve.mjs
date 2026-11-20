/**
 * A static file server for the built editor page, so tests (and a person) can
 * open `dist/editor.html` over http: ES modules do not load from `file://`.
 *
 * Usage: node scripts/serve.mjs [folder] [port]
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const folder = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4319);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

const server = createServer(async (request, response) => {
  const requested = decodeURIComponent((request.url ?? '/').split('?')[0]);
  const path = join(folder, normalize(requested.endsWith('/') ? `${requested}index.html` : requested));
  if (!path.startsWith(folder)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, {
      'content-type': MIME[extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404).end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`serving ${folder} on http://127.0.0.1:${port}/\n`);
});
