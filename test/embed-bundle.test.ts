/**
 * Seam 1, the bundle and the package: `ez bundle` on a temp folder, and the
 * packed tarball run on its own.
 *
 * Nothing here publishes anything. `npm pack` writes a tarball, `npm install`
 * installs it into a folder of its own, and the two `bin` names it makes are run
 * through — so a file the package forgot to publish, or a step `prepack` forgot
 * to build, fails here rather than on someone's machine.
 *
 * Packing runs the build (`prepack`), which writes `dist` — the folder every
 * other suite in this run is spawning `dist/cli.js` from. So the pack runs on a
 * copy of the sources instead: the same `prepack`, the same build, in a folder
 * whose `dist` nobody else is reading.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { after, test } from 'node:test';
import { transform } from 'esbuild';
import { ez, tempFolder } from './cli.ts';
import { removeTempFolders } from './temp.ts';

after(removeTempFolders);

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** What the bundle may weigh, gzipped, with Rough.js in it. */
const BUDGET = 60 * 1024;

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

test('the packed tarball installs, and both of its bins run the editor it bundles', async () => {
  // Packing runs `prepack`, which rebuilds `dist` where it runs. So it runs on a
  // copy of the sources, with this repository's `node_modules` linked in: the
  // build is the real one, and the `dist` every other suite is spawning from is
  // never rewritten underneath it.
  const source = await sourceCopy();
  const packed = await pack(source);

  // Everything the two commands that read beside the CLI need: the page `serve`
  // publishes, the bundle `bundle` copies, and Kalam's licence.
  for (const needed of [
    'dist/cli.js',
    'dist/embed.js',
    'dist/editor.js',
    'dist/editor.css',
    'dist/editor.html',
    'fonts/Kalam-Regular.ttf',
    'fonts/OFL.txt',
    // npm publishes the readme and the licence whether or not `files` names them.
    'README.md',
    'LICENSE',
    'skills/esbozo/SKILL.md',
  ]) {
    assert.ok(packed.files.includes(needed), `${needed} is published`);
  }

  // A real `npm install` of the tarball, in a folder of its own.
  const consumer = await tempFolder('esbozo-consumer-');
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, type: 'module' }, null, 2),
    'utf8',
  );
  await run(
    'npm',
    ['install', '--no-audit', '--no-fund', '--prefer-offline', join(source, packed.filename)],
    { cwd: consumer },
  );

  // Both `bin` names npm links, out of the installed package alone.
  const bin = (name: string): string => join(consumer, 'node_modules', '.bin', name);
  const alias = await run(bin('ez'), ['--help'], { cwd: consumer });
  assert.match(alias.stdout, /usage: ez bundle <dir>/);
  const named = await run(bin('esbozo'), ['--help'], { cwd: consumer });
  assert.equal(named.stdout, alias.stdout);

  // The bundle the installed CLI writes is the one the prepack built.
  const out = await tempFolder('esbozo-bundled-');
  const written = await run(bin('ez'), ['bundle', out], { cwd: consumer });
  assert.equal(written.stdout.trim(), join(out, BUNDLE));
  assert.deepEqual(
    await readFile(join(out, BUNDLE), 'utf8'),
    await readFile(join(source, 'dist', 'embed.js'), 'utf8'),
  );
});

interface Packed {
  readonly filename: string;
  readonly files: string[];
}

/** A copy of what npm publishes, with this repository's dependencies linked in. */
async function sourceCopy(): Promise<string> {
  const folder = await tempFolder('esbozo-source-');
  for (const path of [
    'package.json',
    'README.md',
    'LICENSE',
    'scripts',
    'src',
    'fonts',
    'skills',
    'tsconfig.json',
    'tsconfig.base.json',
    'tsconfig.browser.json',
  ]) {
    await cp(join(ROOT, path), join(folder, path), { recursive: true });
  }
  await symlink(join(ROOT, 'node_modules'), join(folder, 'node_modules'), 'dir');
  return folder;
}

/** `npm pack`, with the real `prepack`, writing the tarball into the folder it packs. */
async function pack(folder: string): Promise<Packed> {
  const { stdout } = await run('npm', ['pack', '--json', '--pack-destination', folder], {
    cwd: folder,
  });
  const [first] = JSON.parse(stdout) as Array<{ filename: string; files: Array<{ path: string }> }>;
  assert.ok(first !== undefined, 'npm pack printed no manifest');
  return { filename: first.filename, files: first.files.map((file) => file.path) };
}
