/**
 * The page a served editor is made of: the files `pnpm build` puts beside the
 * bundled CLI, the path each one answers on, and the answer each one gets.
 *
 * One table for routing and for the startup check, so `ez serve` cannot answer
 * for a file it never checked, and cannot publish anything else that happens to
 * sit in the build folder. The static harnesses `scripts/serve.mjs` and
 * `scripts/probe-editor.mjs` read the same table through the same handler, so no
 * two servers can disagree about what the page is or what an answer carries.
 */
import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

export interface PageAsset {
  /** The request path the file is served at. */
  readonly path: string;
  /** The file, relative to the folder the built CLI lives in. */
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

/** Answers `request` from the table, reading the file out of `folder`. */
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
  // A build that lost a file mid-answer ends that answer, not the server
  // answering it: the next request still has a listener to reach.
  file.on('error', () => response.destroy());
  file.pipe(response);
}
