import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { build, transform } from 'esbuild';
import { buildId, buildTime } from '../src/build-id.ts';
import { gitAnswer } from './git.mjs';
import { PAGE_ASSETS } from '../src/page-assets.ts';

const buildStamp = { id: buildId(gitAnswer), at: buildTime(new Date()) };

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

execFileSync(process.execPath, ['scripts/build-core.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/version-stamp.mjs', 'dist/version'], { stdio: 'inherit' });
await writeFile('dist/build-id', `${buildStamp.id}\n`);
await writeFile('dist/built-at', `${buildStamp.at}\n`);

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
