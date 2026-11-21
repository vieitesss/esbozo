/**
 * The page a served editor is made of: the files `pnpm build` puts beside the
 * bundled CLI, and the path each one answers on.
 *
 * One table for routing and for the startup check, so `ez serve` cannot answer
 * for a file it never checked, and cannot publish anything else that happens to
 * sit in the build folder. The static harness `scripts/serve.mjs` reads the same
 * table, so the two servers cannot disagree about what the page is.
 */

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
