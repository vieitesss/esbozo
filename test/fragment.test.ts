/**
 * Seam 3: the Scene fragment a copy carries, and the paste that reads it.
 *
 * A fragment is Scene JSON text, so it is checked by the same parser a Scene
 * file is: a fragment from another schema is refused, one that names an
 * Element it does not carry has that Snap dropped, and a fragment with no
 * version is the current one.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';
import type { Element, Scene } from '../src/scene.ts';

const { parseScene, parseFragment, serialiseFragment } = await loadProjectModules();

const BOX = { id: 'box', type: 'rectangle', x: 40, y: 40, width: 120, height: 80 };

/** An arrow whose near end Snaps to `box`, so the pair is a drawing and the arrow alone is not. */
const ARROW = {
  id: 'link',
  type: 'arrow',
  points: [
    { x: 160, y: 80 },
    { x: 300, y: 80, snap: 'box' },
  ],
  heads: { start: 'none', end: 'arrow' },
};

const SCENE: Scene = sceneOf({
  version: 1,
  title: 'Box and arrow',
  defaults: { roughness: 1, fill: { kind: 'solid', grey: 4 }, textAlign: 'right' },
  elements: [BOX, ARROW],
});

/** An arrow's or line's stored ends, or a failure for any other Element. */
function pointsOf(element: Element | undefined): unknown {
  return element !== undefined && 'points' in element ? element.points : null;
}

/** A Scene through the parser, so the test works with the value a file would give. */
function sceneOf(source: unknown): Scene {
  const parsed = parseScene(JSON.stringify(source));
  assert.equal(parsed.ok, true, 'the fixture Scene parses');
  if (!parsed.ok) {
    throw new Error('unreachable');
  }
  return parsed.scene;
}

test('a fragment is the version and the Elements, and nothing else', () => {
  const text = serialiseFragment(SCENE, SCENE.elements);
  assert.deepEqual(Object.keys(JSON.parse(text)), ['version', 'elements']);
  assert.equal(JSON.parse(text).version, 1);
});

test('a copy of one Snapped arrow is a fragment that parses on its own', () => {
  const arrow = SCENE.elements[1]!;
  const copied = serialiseFragment(SCENE, [arrow]);
  assert.equal(JSON.parse(copied).elements[0].points[1].snap, undefined);

  const fragment = parseFragment(copied, SCENE.defaults);
  assert.ok(fragment);
  assert.deepEqual(pointsOf(fragment[0]), [
    { x: 160, y: 80 },
    { x: 300, y: 80 },
  ]);
});

test('a copy of both keeps the Snap between them', () => {
  const fragment = parseFragment(serialiseFragment(SCENE, SCENE.elements), SCENE.defaults);
  assert.ok(fragment);
  assert.deepEqual(pointsOf(fragment[1]), ARROW.points);
});

test('a fragment from another schema is refused, and an unversioned one is the current schema', () => {
  const defaults = SCENE.defaults;
  const box = BOX;

  // Only an omitted version defaults. A version that is there is the one
  // Scene validation judges, so `null` is as wrong as 42.
  assert.equal(parseFragment(JSON.stringify({ version: 42, elements: [box] }), defaults), null);
  assert.equal(parseFragment(JSON.stringify({ version: null, elements: [box] }), defaults), null);
  const unversioned = parseFragment(JSON.stringify({ elements: [box] }), defaults);
  assert.ok(unversioned, 'a fragment with no version is the current one');
  assert.equal(unversioned[0]?.id, 'box');
});

test('a bare array and text that is not a fragment are refused', () => {
  assert.equal(parseFragment(JSON.stringify([BOX]), SCENE.defaults), null);
  assert.equal(parseFragment('just some notes, not a Scene', SCENE.defaults), null);
  assert.equal(parseFragment(JSON.stringify({ version: 1 }), SCENE.defaults), null);
});

test("a fragment without a style lands in the Scene's own", () => {
  const scene = sceneOf({
    version: 1,
    title: 'Plain',
    defaults: { roughness: 0, fill: { kind: 'none' } },
    elements: [],
  });
  const fragment = parseFragment(JSON.stringify({ elements: [BOX] }), scene.defaults);
  assert.ok(fragment);
  const element = fragment[0] as Element & { roughness: number };
  assert.equal(element.roughness, 0);
  assert.deepEqual(element.fill, { kind: 'none', grey: 2 });
});
