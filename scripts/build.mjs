/**
 * Build what a person runs: the `ez` CLI, the editor page, and the bundle that
 * puts the editor on someone else's page.
 *
 * All three share the Scene and the Renderer, and none needs a node builtin, so
 * the browser bundles are the same source as the CLI's. The page and the bundle
 * differ in two ways only: the page links its stylesheet and font beside itself,
 * while the bundle carries the CSS and takes the font URL from its element.
 *
 * It ends with the core bundle the Go binary embeds (`scripts/build-core.mjs`)
 * and the binary itself: one build writes every copy of the core.
 */
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { build, transform } from 'esbuild';
import { buildId, buildTime } from '../src/build-id.ts';
import { PAGE_ASSETS } from '../src/page-assets.ts';

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
  // Which build the CLI is, stamped only here: `ez serve` prints it and answers
  // it at `/api/health`, so a server someone finds running can say whether it
  // is the one they started. The page and the bundle are not stamped, so what
  // they render is the same bytes either way.
  define: {
    STAMPED_BUILD: JSON.stringify(buildId(gitAnswer)),
    STAMPED_BUILT_AT: JSON.stringify(buildTime(new Date())),
  },
  logLevel: 'info',
});

await chmod(cliOutfile, 0o755);

/**
 * git's answer to one command, or `null` when git is missing or this is no
 * checkout: the build then names itself `unknown` instead of failing, because
 * a tarball of the sources still has to build.
 */
function gitAnswer(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/**
 * A stylesheet with its comments and its indentation gone, as `minify` leaves
 * the JavaScript: esbuild's CSS minifier never sees a text-loaded one
 * (`loader: { '.css': 'text' }` hands it the source as an opaque string), so
 * the embed and the served page minify theirs here. The source stays readable.
 */
async function minifiedCss(path) {
  const { code } = await transform(await readFile(path, 'utf8'), { loader: 'css', minify: true });
  return code;
}

/** The embed's stylesheet arrives as text, so it is minified on the way in. */
const minifiedStylesheet = {
  name: 'minified-stylesheet',
  setup(bundle) {
    bundle.onLoad({ filter: /\.css$/ }, async (args) => ({
      contents: await minifiedCss(args.path),
      loader: 'text',
    }));
  },
};

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
 * editor's CSS so the page needs no second request. Rough.js is in it, and its
 * MIT notice is a banner of its own: `legalComments` has nothing to keep,
 * because the dependency's files carry no bang comment.
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
  plugins: [minifiedStylesheet],
  banner: { js: '/*! Rough.js, MIT License, Copyright (c) 2019 Preet Shihn */' },
  logLevel: 'info',
});

await mkdir('dist/fonts', { recursive: true });
// The served page's stylesheet: the editor's look (scoped to the element, the
// same rules the bundle carries), and then the page's own chrome, last so it can
// make the element fill the window. No `@font-face`: the page installs the face
// it measured from the one file it fetched, so the font is fetched once.
await writeFile(
  'dist/editor.css',
  [await minifiedCss('src/editor/editor.css'), await minifiedCss('src/editor/page.css')].join('\n'),
);
await copyFile('src/editor/page.html', 'dist/editor.html');
await copyFile('fonts/Kalam-Regular.ttf', 'dist/fonts/Kalam-Regular.ttf');
await copyFile('fonts/OFL.txt', 'dist/fonts/OFL.txt');
await compressPageFiles();

/**
 * The core bundle `ez` carries, built here so one `pnpm build` writes every copy
 * of the Scene, the Layout and the Renderer.
 */
execFileSync(process.execPath, ['scripts/build-core.mjs'], { stdio: 'inherit' });

/**
 * The one static binary: the bundle above, Kalam, and what measuring it yielded,
 * linked by goja into `ez` with the Go toolchain `go.mod` names.
 *
 * `CGO_ENABLED=0` is what makes it one file that runs anywhere; `GOTOOLCHAIN` is
 * `local` so a toolchain older than `go.mod` fails here instead of downloading
 * another one behind the build's back.
 */
execFileSync('go', ['build', '-ldflags=-s -w', '-o', 'dist/ez', './cmd/ez'], {
  stdio: 'inherit',
  env: { ...process.env, GOTOOLCHAIN: 'local', CGO_ENABLED: '0' },
});

/**
 * Every text page file, compressed beside itself. `ez serve` sends these bytes
 * instead of compressing per request: a page load pays for the compression once,
 * here, and the server only picks the variant the request takes. The table is
 * the same one the server routes by, so a file is compressed exactly when it is
 * a page file — and the font, whose own format is the compression, is not.
 */
async function compressPageFiles() {
  const files = new Set(
    PAGE_ASSETS.filter((asset) => asset.mime.startsWith('text/')).map((asset) => asset.file),
  );
  for (const file of files) {
    const source = await readFile(`dist/${file}`);
    await writeFile(`dist/${file}.br`, brotliCompressSync(source));
    await writeFile(`dist/${file}.gz`, gzipSync(source));
  }
}
