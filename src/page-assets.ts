import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

export interface PageAsset {
  readonly path: string;
  readonly file: string;
  readonly mime: string;
}

export const PAGE_ASSETS: readonly PageAsset[] = [
  { path: '/', file: 'editor.html', mime: 'text/html; charset=utf-8' },
  { path: '/editor.html', file: 'editor.html', mime: 'text/html; charset=utf-8' },
  { path: '/editor.css', file: 'editor.css', mime: 'text/css; charset=utf-8' },
  { path: '/editor.js', file: 'editor.js', mime: 'text/javascript; charset=utf-8' },
  { path: '/fonts/Kalam-Regular.ttf', file: 'fonts/Kalam-Regular.ttf', mime: 'font/ttf' },
  { path: '/fonts/OFL.txt', file: 'fonts/OFL.txt', mime: 'text/plain; charset=utf-8' },
];

export function answerPageAsset(
  folder: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const asset = PAGE_ASSETS.find((entry) => entry.path === pathname);
  if (asset === undefined) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  response.writeHead(200, { 'content-type': asset.mime, 'cache-control': 'no-store' });
  const file = createReadStream(join(folder, asset.file));
  file.on('error', () => response.destroy());
  file.pipe(response);
}
