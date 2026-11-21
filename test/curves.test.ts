/**
 * Seam 1: multi-point and curved `arrow` and `line` Elements.
 *
 * The schema half runs the built `ez` CLI on Scene files in temporary folders
 * and asserts on exit codes and plain-text problems; the saving half drives the
 * public Scene module the editor loads, because a canonical file is what the
 * editor saves and no `ez` command writes one. Nothing here imports a private
 * helper.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ez, sceneFolder } from './cli.ts';
import { loadProjectModules } from './modules.ts';

const { parseScene, serialiseScene } = await loadProjectModules();

const BOX = { id: 'box', type: 'rectangle', x: 0, y: 0, width: 80, height: 80 };

/** A Scene holding one shaft, with the box a Snap can land on in front of it. */
function sceneWith(points: unknown[], extra: Record<string, unknown> = {}): unknown {
  return {
    version: 1,
    elements: [BOX, { id: 'a', type: 'arrow', points, ...extra }],
  };
}

/** What `ez check` says about one shaft: its exit code and its stderr. */
async function check(scene: unknown): Promise<{ code: number; stderr: string }> {
  const folder = await sceneFolder(scene);
  const run = await ez(['check', 'scene.json'], folder);
  return { code: run.code, stderr: run.stderr };
}

/** The Scene one shaft saves as, read back from canonical JSON. */
function saved(scene: unknown): Record<string, unknown> {
  const parsed = parseScene(JSON.stringify(scene));
  assert.ok(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.problems));
  return JSON.parse(serialiseScene(parsed.scene)) as Record<string, unknown>;
}

/** The points of the one shaft a saved Scene holds. */
function savedPoints(scene: unknown): Record<string, unknown>[] {
  const elements = saved(scene).elements as Record<string, unknown>[];
  return elements[1]!.points as Record<string, unknown>[];
}

test('a shaft bends through the points between its two ends', async () => {
  const bent = await check(sceneWith([{ x: 100, y: 0 }, { x: 140, y: 80 }, { x: 180, y: 0 }]));
  assert.equal(bent.code, 0, bent.stderr);

  const straight = await check(sceneWith([{ x: 100, y: 0 }, { x: 180, y: 0 }]));
  assert.equal(straight.code, 0, straight.stderr);
});

test('a Snap belongs to an end, so a middle point cannot hold one', async () => {
  const result = await check(
    sceneWith([{ x: 100, y: 0 }, { x: 120, y: 40, snap: 'box' }, { x: 180, y: 0 }]),
  );

  assert.equal(result.code, 3);
  assert.match(result.stderr, /^a: points\[1\]\.snap applies only to the first or last point$/m);
});

test('a corner belongs to a bend point, so an end cannot hold one', async () => {
  for (const index of [0, 2]) {
    const points = [
      { x: 100, y: 0, corner: 'round' },
      { x: 140, y: 80 },
      { x: 180, y: 0, corner: 'sharp' },
    ];
    const result = await check(sceneWith(points));
    assert.equal(result.code, 3, `points[${index}] is an end`);
    assert.match(
      result.stderr,
      new RegExp(`^a: points\\[${index}\\]\\.corner applies only to a middle point$`, 'm'),
    );
  }
});

test('a corner is sharp or round, and nothing else', async () => {
  const result = await check(
    sceneWith([{ x: 100, y: 0 }, { x: 140, y: 80, corner: 'curved' }, { x: 180, y: 0 }]),
  );

  assert.equal(result.code, 3);
  assert.match(
    result.stderr,
    /^a: points\[1\]\.corner must be one of sharp, round, got "curved"$/m,
  );
});

test('both ends Snap to one Element once a bend point lies between them', async () => {
  const loop = await check(
    sceneWith([
      { x: 100, y: 0, snap: 'box' },
      { x: 160, y: -60 },
      { x: 100, y: 0, snap: 'box' },
    ]),
  );
  assert.equal(loop.code, 0, loop.stderr);

  const straight = await check(
    sceneWith([
      { x: 100, y: 0, snap: 'box' },
      { x: 100, y: 80, snap: 'box' },
    ]),
  );
  assert.equal(straight.code, 3);
  assert.match(straight.stderr, /^a: both ends Snap to box$/m);
});

test('a two-point shaft saves as it always has, and a bend point saves its corner', () => {
  const straight = savedPoints(sceneWith([{ x: 10.4, y: 20.6 }, { x: 90.2, y: 60.4 }]));
  assert.deepEqual(straight, [
    { x: 10, y: 21 },
    { x: 90, y: 60 },
  ]);

  const bent = savedPoints(
    sceneWith([
      { x: 10.4, y: 20.6 },
      { x: 50.6, y: 60.4, corner: 'round' },
      { x: 90.2, y: 20.4 },
    ]),
  );
  assert.deepEqual(bent, [
    { x: 10, y: 21 },
    { x: 51, y: 60, corner: 'round' },
    { x: 90, y: 20 },
  ]);
  assert.deepEqual(Object.keys(bent[1]!), ['x', 'y', 'corner'], 'the corner is written after y');
  assert.deepEqual(Object.keys(bent[0]!), ['x', 'y'], 'an unwritten corner is never written');
});

test('a Scene of bent shafts reopens as the Scene it saved', () => {
  const savedScene = saved(
    sceneWith(
      [
        { x: 100, y: 0 },
        { x: 140, y: 80, corner: 'sharp' },
        { x: 180, y: 0 },
      ],
      { corners: 'round' },
    ),
  );

  const parsed = parseScene(JSON.stringify(savedScene));
  assert.ok(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.problems));
  assert.equal(serialiseScene(parsed.scene), JSON.stringify(savedScene, null, 2) + '\n');
});
