/**
 * Build the three artefacts: the `ez` CLI, the editor page, and the bundle that
 * puts the editor on someone else's page.
 *
 * All three share the Scene and the Renderer, and none needs a node builtin, so
 * the browser bundles are the same source as the CLI's. The page and the bundle
 * differ in two ways only: the page links its stylesheet and font beside itself,
 * while the bundle carries the CSS and takes the font URL from its element.
 */
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const cliOutfile = 'dist/cli.js';

await build({
  entryPoints: ['src/cli.ts'],
  outfile: cliOutfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  loader: { '.wasm': 'binary', '.ttf': 'binary' },
  logLevel: 'info',
});

await chmod(cliOutfile, 0o755);

/**
 * The served page: minified, because it crosses the wire, and `ez serve`
 * compresses what it sends. The page is read once per load, not edited.
 */
await build({
  entryPoints: ['src/editor/main.ts'],
  outfile: 'dist/editor.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  logLevel: 'info',
});

/**
 * `ez bundle` copies this file out; it is not meant to be loaded from `dist`.
 * Minified because it is inlined into someone else's page, and it carries the
 * editor's CSS so the page needs no second request.
 */
await build({
  entryPoints: ['src/editor/embed.ts'],
  outfile: 'dist/embed.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  loader: { '.css': 'text' },
  logLevel: 'info',
});

await mkdir('dist/fonts', { recursive: true });
// The served page's stylesheet: the editor's look (scoped to the element, the
// same text the bundle carries), and then the page's own chrome, last so it can
// make the element fill the window. No `@font-face`: the page installs the face
// it measured from the one file it fetched, so the font is fetched once.
await writeFile(
  'dist/editor.css',
  [
    await readFile('src/editor/editor.css', 'utf8'),
    await readFile('src/editor/page.css', 'utf8'),
  ].join('\n'),
);
await copyFile('src/editor/page.html', 'dist/editor.html');
await copyFile('fonts/Kalam-Regular.ttf', 'dist/fonts/Kalam-Regular.ttf');
await copyFile('fonts/OFL.txt', 'dist/fonts/OFL.txt');
