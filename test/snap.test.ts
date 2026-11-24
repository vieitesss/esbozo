/**
 * The Snap exception to rule 4 (`src/editor/snap.ts`): the four Snap rules over
 * Scene JSON in and out.
 *
 * 1. Target choice (`snapTarget`): Snap switch, `Alt`, the other end, and
 *    staying on the current target.
 * 2. Settling an end (`withEnd`, `withSnapSwitch`): outline Anchor and stored
 *    whole-pixel point, or free while keeping `"snap": false`.
 * 3. Freeing Snapped ends (`freedEnds`): where ends land when freed by the Snap
 *    switch, copy/duplicate, or delete.
 * 4. Anchored ends (`anchoredEnds`): updating stored `x, y` when a target moves
 *    or resizes, while leaving untouched targets alone.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';
import type { ArrowOrLineElement, Element, Scene } from '../src/scene.ts';

const {
  parseScene,
  elementsById,
  snapTarget,
  withEnd,
  withSnapSwitch,
  freedEnds,
  anchoredEnds,
} = await loadProjectModules();

function sceneOf(raw: object): Scene {
  const parsed = parseScene(JSON.stringify(raw));
  assert.ok(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.problems));
  return parsed.scene;
}

function shaftOf(scene: Scene, id: string): ArrowOrLineElement {
  const found = scene.elements.find((element) => element.id === id);
  assert.ok(found !== undefined && (found.type === 'arrow' || found.type === 'line'));
  return found;
}

const TWO_BOXES = {
  version: 1,
  elements: [
    { id: 'box-a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 },
    { id: 'box-b', type: 'rectangle', x: 200, y: 0, width: 100, height: 100 },
    {
      id: 'arr',
      type: 'arrow',
      points: [
        { x: 100, y: 50, snap: 'box-a', anchor: { x: 1, y: 0.5 } },
        { x: 180, y: 50 },
      ],
    },
  ],
};

test('snapTarget respects Alt, Snap switch, other end, and keepCurrentTarget', () => {
  const scene = sceneOf(TWO_BOXES);
  const arrow = shaftOf(scene, 'arr');

  // Over box-b with switch on -> attaches to box-b.
  assert.equal(snapTarget(scene.elements, { x: 220, y: 50 }, { shaft: arrow, end: 'end' }), 'box-b');

  // Alt held (`skipAttach: true`) -> attaches to nothing.
  assert.equal(
    snapTarget(scene.elements, { x: 220, y: 50 }, { shaft: arrow, end: 'end', skipAttach: true }),
    null,
  );

  // Two-point shaft cannot attach both ends to box-a.
  assert.equal(snapTarget(scene.elements, { x: 50, y: 50 }, { shaft: arrow, end: 'end' }), null);

  // A shaft with a bend between its ends can loop back to box-a.
  const loopScene = sceneOf({
    ...TWO_BOXES,
    elements: [
      ...TWO_BOXES.elements.slice(0, 2),
      {
        id: 'loop',
        type: 'arrow',
        points: [
          { x: 100, y: 50, snap: 'box-a', anchor: { x: 1, y: 0.5 } },
          { x: 150, y: 120 },
          { x: 180, y: 50 },
        ],
      },
    ],
  });
  assert.equal(
    snapTarget(loopScene.elements, { x: 50, y: 50 }, { shaft: shaftOf(loopScene, 'loop'), end: 'end' }),
    'box-a',
  );

  // An end with Snap switch off attaches to nothing unless `ignoreSnapSwitch` is set.
  const offArrow = withSnapSwitch(scene.elements, arrow, 'end', false);
  assert.equal(snapTarget(scene.elements, { x: 220, y: 50 }, { shaft: offArrow, end: 'end' }), null);
  assert.equal(
    snapTarget(scene.elements, { x: 220, y: 50 }, { shaft: offArrow, end: 'end', ignoreSnapSwitch: true }),
    'box-b',
  );

  // Already-Snapped end with `keepCurrentTarget: true` stays on box-a even over paper or with Alt.
  assert.equal(
    snapTarget(scene.elements, { x: 400, y: 400 }, {
      shaft: arrow,
      end: 'start',
      skipAttach: true,
      keepCurrentTarget: true,
    }),
    'box-a',
  );
});

test('withEnd settles onto the nearest outline point with an Anchor, or free keeping snap: false', () => {
  const scene = sceneOf(TWO_BOXES);
  const byId = elementsById(scene.elements);
  const arrow = shaftOf(scene, 'arr');

  // Drop near the left edge of box-b (x=200, y=0..100).
  const attached = withEnd(arrow, 'end', { x: 210, y: 50 }, 'box-b', byId);
  assert.deepEqual(attached.points[1], {
    x: 200,
    y: 50,
    snap: 'box-b',
    anchor: { x: 0, y: 0.5 },
  });

  // Turning Snap off then settling free preserves `snap: false` and rounds to whole pixels.
  const off = withSnapSwitch(scene.elements, arrow, 'end', false);
  const movedOff = withEnd(off, 'end', { x: 210.4, y: 50.6 }, null, byId);
  assert.deepEqual(movedOff.points[1], { x: 210, y: 51, snap: false });
});

test('freedEnds frees matching Snapped ends where they draw and drops Snap and Anchor', () => {
  const scene = sceneOf({
    version: 1,
    elements: [
      { id: 'box-a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 },
      {
        id: 'loop',
        type: 'arrow',
        points: [
          { x: 0, y: 0, snap: 'box-a', anchor: { x: 1, y: 0.25 } },
          { x: 150, y: 50 },
          { x: 0, y: 0, snap: 'box-a', anchor: { x: 1, y: 0.75 } },
        ],
      },
    ],
  });
  const byId = elementsById(scene.elements);
  const loop = shaftOf(scene, 'loop');

  // Freeing both ends at once (as delete/copy-without-target does) places each where its Anchor draws.
  const freed = freedEnds(loop, (_end, target) => target === 'box-a', byId);
  assert.deepEqual(freed.points, [
    { x: 100, y: 25 },
    { x: 150, y: 50 },
    { x: 100, y: 75 },
  ]);
});

test('anchoredEnds moves stored x, y when a target moves and leaves untouched targets alone', () => {
  const before = sceneOf({
    version: 1,
    elements: [
      { id: 'box-a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 },
      { id: 'box-b', type: 'rectangle', x: 200, y: 0, width: 100, height: 100 },
      {
        id: 'arr',
        type: 'arrow',
        points: [
          { x: 100, y: 50, snap: 'box-a', anchor: { x: 1, y: 0.5 } },
          // Deliberately stale stored x, y on an untouched target: must not be rewritten.
          { x: 195, y: 45, snap: 'box-b', anchor: { x: 0, y: 0.5 } },
        ],
      },
    ],
  });

  const movedElements: Element[] = before.elements.map((element) =>
    element.id === 'box-a' && element.type === 'rectangle'
      ? { ...element, x: 40, y: 20 }
      : element,
  );
  const settled = anchoredEnds(movedElements, before.elements);
  const arrow = settled.find((element) => element.id === 'arr');
  assert.ok(arrow !== undefined && arrow.type === 'arrow');
  assert.deepEqual(arrow.points[0], { x: 140, y: 70, snap: 'box-a', anchor: { x: 1, y: 0.5 } });
  assert.deepEqual(arrow.points[1], { x: 195, y: 45, snap: 'box-b', anchor: { x: 0, y: 0.5 } });
});
