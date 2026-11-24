/**
 * CLI seam, the bundle: the built CLI needs nothing but Node and `dist/`.
 *
 * The Docker image copies `dist/` alone — no `node_modules` — so this proves
 * that is enough: `render` (esbuild inlines its imports), `png` (resvg's wasm
 * travels inside the bundle), and `serve`, whose page files have to be found
 * beside the CLI. Every run happens in a folder that holds `dist/` and nothing
 * else from the repository.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, test } from 'node:test';
import { startServe, tempFolder } from './cli.ts';
import { removeTempFolders } from './temp.ts';
import type { Serve } from './cli.ts';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SAMPLE_SCENE = {
  version: 1,
  title: 'Two boxes',
  elements: [
    { id: 'a', type: 'rectangle', x: 40, y: 40, width: 120, height: 80, label: 'one' },
    { id: 'b', type: 'rectangle', x: 200, y: 60, width: 100, height: 100 },
  ],
};

/** A folder holding a copy of `dist/` and one Scene, and nothing else. */
async function bundleFolder(): Promise<string> {
  const folder = await tempFolder();
  await cp(join(ROOT, 'dist'), join(folder, 'dist'), { recursive: true });
  await writeFile(join(folder, 'scene.json'), JSON.stringify(SAMPLE_SCENE, null, 2), 'utf8');
  return folder;
}

/** The servers these tests started, stopped whatever the assertions did. */
const running: Serve[] = [];
after(async () => {
  await Promise.all(running.map((server) => server.stop()));
  await removeTempFolders();
});

test('the bundled CLI renders and draws a PNG with no node_modules beside it', async () => {
  const folder = await bundleFolder();
  const cli = join(folder, 'dist', 'cli.js');

  const rendered = await run(process.execPath, [cli, 'render', 'scene.json'], { cwd: folder });
  assert.match(rendered.stdout, /scene\.svg\n$/, 'render prints the path it wrote');
  // check-rules: markup of a written SVG file, not the page
  assert.match(await readFile(join(folder, 'scene.svg'), 'utf8'), /^<svg[\s>]/);

  const drawn = await run(process.execPath, [cli, 'png', 'scene.json', '--theme', 'dark'], {
    cwd: folder,
  });
  assert.match(drawn.stdout, /scene\.dark\.png\n$/, 'png prints the path it wrote');
  const png = await readFile(join(folder, 'scene.dark.png'));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.ok(png.length > 1000, 'the PNG holds an image, not just a header');
});

test('the bundled CLI serves the page and the folder with no node_modules beside it', async () => {
  const folder = await bundleFolder();
  const server = await startServe(folder, [], join(folder, 'dist', 'cli.js'));
  running.push(server);

  const listing = await fetch(`${server.url}/api/scenes`);
  assert.equal(listing.status, 200);
  const body = (await listing.json()) as { scenes: string[] };
  assert.deepEqual(body.scenes, ['scene.json']);

  const page = await fetch(`${server.url}/editor.js`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.ok((await page.text()).length > 1000, 'the page script is the built one');
});
