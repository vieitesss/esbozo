/**
 * Script seam, packaging: what `npm pack` would publish.
 *
 * The CLI embeds Kalam, so the font's OFL licence has to travel with the
 * tarball, not just sit in the repository. Packing runs `prepack`, which
 * rewrites `dist` — the folder every other suite in this run is spawning
 * `dist/cli.js` from — so this listing skips the scripts; `embed-bundle.test.ts`
 * runs the real pack and the real install, on a copy of the sources.
 */
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface PackManifest {
  files: { path: string }[];
}

/**
 * Every `dist/` file the package publishes, named here one at a time: the bundle,
 * the page and its stylesheet, each with the two compressions `ez serve` sends,
 * and the font copies whose licences travel beside them. A build output that is
 * not on this list is a file `npm pack` would ship without anyone deciding to —
 * `dist/resvg.wasm` did, until `package.json` named it out.
 */
const PUBLISHED_DIST = [
  'dist/cli.js',
  'dist/editor.css',
  'dist/editor.css.br',
  'dist/editor.css.gz',
  'dist/editor.html',
  'dist/editor.html.br',
  'dist/editor.html.gz',
  'dist/editor.js',
  'dist/editor.js.br',
  'dist/editor.js.gz',
  'dist/embed.js',
  'dist/fonts/Kalam-Regular.ttf',
  'dist/fonts/OFL.txt',
  'dist/fonts/OFL.txt.br',
  'dist/fonts/OFL.txt.gz',
];

test('the published package carries Kalam and its OFL licence', async () => {
  const { stdout } = await run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT });
  const [manifest] = JSON.parse(stdout) as PackManifest[];
  assert.ok(manifest !== undefined, 'npm pack printed no manifest');

  const paths = manifest.files.map((file) => file.path);

  assert.ok(paths.includes('dist/cli.js'), 'the bundled CLI is published');
  // The page travels compressed: `ez serve` sends the variants the build wrote,
  // never a compression of its own, so they are part of what it publishes.
  assert.ok(paths.includes('dist/editor.js.br'), 'the Brotli page is published');
  assert.ok(paths.includes('dist/editor.js.gz'), 'the gzip page is published');
  assert.ok(paths.includes('fonts/Kalam-Regular.ttf'), 'the bundled font is published');
  assert.ok(paths.includes('fonts/OFL.txt'), 'Kalam’s OFL licence is published');
});

test('the packed dist/ is exactly the files the build publishes', async () => {
  const { stdout } = await run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT });
  const [manifest] = JSON.parse(stdout) as PackManifest[];
  assert.ok(manifest !== undefined, 'npm pack printed no manifest');

  const packed = manifest.files
    .map((file) => file.path)
    .filter((path) => path.startsWith('dist/'))
    .sort();

  assert.deepEqual(packed, PUBLISHED_DIST);
});
