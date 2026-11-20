/**
 * Seam 3: the Scene module the editor calls.
 *
 * The CLI parses a Scene before it uses it, but the editor holds one in memory
 * and mutates it: it assigns `x = 40.2` when a rectangle is dragged. Saving,
 * hashing and drawing must all agree on one whole-pixel geometry, so this seam
 * drives the public Scene functions directly.
 *
 * The modules are loaded through a bundle because that is how the editor loads
 * them, and because Rough.js ships imports Node cannot resolve on its own.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { Scene } from '../src/scene.ts';

const BOX = {
  version: 1,
  title: 'One box',
  defaults: { roughness: 1 },
  elements: [{ id: 'a', type: 'rectangle', x: 40, y: 40, width: 120, height: 80 }],
};

const { hashScene, parseScene, renderScene, serialiseScene } = await loadSceneModules();

test('a Scene mutated in memory saves, hashes and draws as its whole pixels', () => {
  const whole = parsed(BOX);
  const dragged = parsed(BOX);
  const box = dragged.elements[0]!;
  box.x = 40.2;
  box.y = 39.9;
  box.width = 120.4;
  box.height = 80.4;

  const saved = serialiseScene(dragged);
  assert.equal(saved, serialiseScene(whole), 'the saved Scene is the whole-pixel Scene');
  assert.doesNotMatch(saved, /40\.2|39\.9|120\.4|80\.4/, 'no fractional geometry is saved');

  const reopened = parseScene(saved);
  assert.ok(reopened.ok, 'the saved Scene still parses');
  assert.deepEqual(reopened.scene, whole, 'reopening gives the whole-pixel Scene');
  assert.equal(serialiseScene(reopened.scene), saved, 'saving that Scene again changes nothing');

  assert.equal(hashScene(dragged), hashScene(whole), 'the hash follows the saved geometry');
  assert.equal(renderScene(dragged), renderScene(whole), 'and so does the drawing');
  assert.match(renderScene(dragged), /viewBox="24 24 152 112"/);
});

test('saving and drawing leave the Scene the caller holds alone', () => {
  const scene = parsed(BOX);
  scene.elements[0]!.x = 40.2;

  serialiseScene(scene);
  renderScene(scene);

  assert.equal(scene.elements[0]!.x, 40.2, 'the editor still owns the value it assigned');
});

function parsed(scene: unknown): Scene {
  const result = parseScene(JSON.stringify(scene));
  if (!result.ok) {
    throw new Error(`Scene did not parse: ${result.problems.map((p) => p.message).join('; ')}`);
  }
  return result.scene;
}

interface SceneModules {
  parseScene: typeof import('../src/scene.ts').parseScene;
  serialiseScene: typeof import('../src/scene.ts').serialiseScene;
  hashScene: typeof import('../src/scene.ts').hashScene;
  renderScene: typeof import('../src/renderer.ts').renderScene;
}

/** The public Scene and Renderer functions, bundled as one module. */
async function loadSceneModules(): Promise<SceneModules> {
  const source = (module: string) =>
    JSON.stringify(fileURLToPath(new URL(`../src/${module}`, import.meta.url)));
  const folder = await mkdtemp(join(tmpdir(), 'esbozo-module-'));
  const entry = join(folder, 'entry.ts');
  await writeFile(
    entry,
    [
      `export { parseScene, serialiseScene, hashScene } from ${source('scene.ts')};`,
      `export { renderScene } from ${source('renderer.ts')};`,
      '',
    ].join('\n'),
    'utf8',
  );
  const outfile = join(folder, 'entry.mjs');
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return (await import(pathToFileURL(outfile).href)) as SceneModules;
}
