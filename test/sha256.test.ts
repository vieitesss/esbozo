/**
 * Seam 2: the portable hash behind the Scene hash and the per-Element seed.
 *
 * The Renderer has to run in a browser as well as in the CLI, so the shared
 * modules cannot import `node:crypto`. Node's OpenSSL sha256 is the independent
 * oracle here: the shared implementation must agree with it byte for byte.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
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

test('the shared Scene, Renderer and hash modules import nothing from Node', async () => {
  for (const module of ['scene.ts', 'renderer.ts', 'sha256.ts']) {
    const source = await readFile(new URL(`../src/${module}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bfrom\s+['"]node:/, module);
    assert.doesNotMatch(source, /\brequire\(/, module);
  }
});

function openssl(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
