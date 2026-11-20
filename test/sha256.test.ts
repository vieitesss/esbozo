/**
 * Seam 2: the portable hash behind the Scene hash and the per-Element seed.
 *
 * The Renderer has to run in a browser as well as in the CLI, so the shared
 * modules cannot import `node:crypto`. Node's OpenSSL sha256 is the independent
 * oracle here: the shared implementation must agree with it byte for byte.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { sha256Hex } from '../src/sha256.ts';

const SAMPLES = [
  '',
  'a',
  'abc',
  'a'.repeat(55),
  'a'.repeat(56),
  'a'.repeat(63),
  'a'.repeat(64),
  'a'.repeat(1000),
  'esbozo ✓ 世界',
  '{"version":1}\n',
];

test('sha256Hex matches OpenSSL for the same UTF-8 bytes', () => {
  for (const sample of SAMPLES) {
    assert.equal(sha256Hex(sample), openssl(sample), JSON.stringify(sample.slice(0, 24)));
  }
});

test('sha256Hex matches the published digest of the empty string', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('the Scene, Renderer and hash modules bundle for the browser', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'esbozo-browser-'));
  const entry = join(folder, 'entry.ts');
  const source = (module: string) =>
    JSON.stringify(fileURLToPath(new URL(`../src/${module}`, import.meta.url)));
  await writeFile(
    entry,
    [
      `export { parseScene, serialiseScene, hashScene } from ${source('scene.ts')};`,
      `export { renderScene } from ${source('renderer.ts')};`,
      '',
    ].join('\n'),
    'utf8',
  );

  // A `node:` import is unresolvable for the browser platform, so a bundle that
  // builds is a bundle that runs there: that is the outcome, not the import text.
  const bundled = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });

  assert.equal(bundled.outputFiles?.length, 1, 'the browser build produced one module');
});

function openssl(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
