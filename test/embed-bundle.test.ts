/**
 * CLI seam, the bundle: `ez bundle` on a temp folder, and the file it writes.
 *
 * The bundle is what a page of someone else's loads instead of the editor's own
 * page, so this is where the file it points at is proved to exist, to parse, and
 * to stay inside its size budget.
 */
import assert from 'node:assert/strict';
import { readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { after, test } from 'node:test';
import { transform } from 'esbuild';
import { ez, tempFolder } from './cli.ts';
import { removeTempFolders } from './temp.ts';

after(removeTempFolders);

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** What the bundle may weigh, gzipped, with Rough.js in it. */
const BUDGET = 64 * 1024;

const PACKAGE = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
  version: string;
};

const BUNDLE = `esbozo-${PACKAGE.version}.js`;

test('ez bundle writes one versioned module, and a second run replaces it', async () => {
  const folder = await tempFolder('esbozo-bundle-');
  const path = join(folder, BUNDLE);
  // A page that pinned the bundle before this run: the old file must not survive.
  await writeFile(path, 'the bundle from yesterday', 'utf8');

  const first = await ez(['bundle', folder], ROOT);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stdout.trim(), path, 'the command prints the file it wrote');
  assert.deepEqual(await readdir(folder), [BUNDLE], 'one file, and nothing beside it');

  const bytes = await readFile(path, 'utf8');
  assert.notEqual(bytes, 'the bundle from yesterday');
  // It is one JavaScript module, parsed by the same tool that wrote it: a file
  // cut short or half written fails here, not on the page it is dropped into.
  // What it *does* is the browser suite's job (`tests/embed.e2e.ts`), which
  // loads it into a plain page and drives the element it defines.
  const parsed = await transform(bytes, { loader: 'js', format: 'esm' });
  assert.ok(parsed.code.length > 0);
  assert.ok(bytes.length > 1000, 'the bundle is the editor, not a stub');
  assert.ok(
    bytes.includes('data-source-hash='),
    'the bundle stamps data-source-hash on the SVG it sends in PUT { scene, svg }',
  );

  const second = await ez(['bundle', folder], ROOT);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(await readFile(path, 'utf8'), bytes, 'a second run writes the same bytes');
});

test('the bundle stays inside its size budget, Rough.js and all', async () => {
  const folder = await tempFolder('esbozo-bundle-');
  assert.equal((await ez(['bundle', folder], ROOT)).code, 0);

  const bytes = await readFile(join(folder, BUNDLE));
  const gzipped = gzipSync(bytes).length;
  // Reported, so the number in a review is measured and not estimated.
  console.log(`bundle: ${bytes.length} bytes raw, ${gzipped} bytes gzipped`);
  assert.ok(
    gzipped <= BUDGET,
    `the bundle is ${gzipped} bytes gzipped, over the ${BUDGET} byte budget`,
  );
});

test('a bundle that cannot be written is the write-failure exit code', async () => {
  const missing = join(await tempFolder('esbozo-bundle-'), 'not-there');
  assert.equal((await ez(['bundle'], ROOT)).code, 2, 'no folder is wrong arguments');
  assert.equal((await ez(['bundle', 'a', 'b'], ROOT)).code, 2, 'two folders are wrong arguments');
  assert.equal((await ez(['bundle', '--port', '1'], ROOT)).code, 2, 'a flag is not a folder');
  assert.equal((await ez(['bundle', missing], ROOT)).code, 4);
});

test('a folder that is a file is not a folder to write into', async () => {
  // The path is resolved before it is opened, so a file where the folder should be
  // is the write failing — `ENOTDIR`, not a missing file — and the exit code says so.
  const file = join(await tempFolder('esbozo-bundle-'), 'a-file');
  await writeFile(file, 'not a folder', 'utf8');
  const path = join(file, BUNDLE);

  const run = await ez(['bundle', file], ROOT);
  assert.equal(run.code, 4, run.stderr);
  assert.equal(run.stdout, '');
  assert.equal(run.stderr, `cannot write ${path}: ENOTDIR: not a directory, open '${path}'\n`);
});

test('a folder reached through a symlink loop is the error the CLI words', async () => {
  // Go's own text for a loop is `open ...: too many levels of symbolic links`, and
  // every `ez` message about a file is built around Node's wording instead.
  const folder = await tempFolder('esbozo-bundle-');
  await symlink(join(folder, 'b'), join(folder, 'a'));
  await symlink(join(folder, 'a'), join(folder, 'b'));
  const path = join(folder, 'a', BUNDLE);

  const run = await ez(['bundle', join(folder, 'a')], ROOT);
  assert.equal(run.code, 4, run.stderr);
  assert.equal(run.stdout, '');
  assert.equal(
    run.stderr,
    `cannot write ${path}: ELOOP: too many symbolic links encountered, open '${path}'\n`,
  );
});
