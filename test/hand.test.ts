import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadProjectModules } from './modules.ts';
import type { ArrowOrLineElement, RectangleElement, Scene } from '../src/scene.ts';

const { Hand, parseScene, serialiseScene } = await loadProjectModules();

function mustParse(source: string): Scene {
  const parsed = parseScene(source);
  assert.equal(parsed.ok, true);
  return parsed.scene;
}

const BOX_SCENE = JSON.stringify({
  version: 1,
  title: 'hand-test',
  elements: [
    { id: 'box', type: 'rectangle', x: 100, y: 100, width: 120, height: 80 },
  ],
});

const SNAPPED_SCENE = JSON.stringify({
  version: 1,
  title: 'snap-settle',
  elements: [
    { id: 'box', type: 'rectangle', x: 100, y: 100, width: 120, height: 80 },
    {
      id: 'arr',
      type: 'arrow',
      points: [
        { x: 220, y: 140, snap: 'box', anchor: { x: 1, y: 0.5 } },
        { x: 340, y: 140 },
      ],
    },
  ],
});

const BENT_SCENE = JSON.stringify({
  version: 1,
  title: 'bent-shaft',
  elements: [
    { id: 'box', type: 'rectangle', x: 100, y: 100, width: 120, height: 80 },
    {
      id: 'arr',
      type: 'arrow',
      points: [
        { x: 220, y: 140 },
        { x: 280, y: 100 },
        { x: 340, y: 140 },
      ],
    },
    {
      id: 'loop',
      type: 'arrow',
      points: [
        { x: 220, y: 120, snap: 'box', anchor: { x: 1, y: 0.25 } },
        { x: 260, y: 140 },
        { x: 220, y: 160, snap: 'box', anchor: { x: 1, y: 0.75 } },
      ],
    },
  ],
});

describe('Hand (Scene in hand)', () => {
  it('refuses edits and undo/redo when read-only without changing state, saving, or consuming a step', () => {
    let writable = true;
    const saved: Scene[] = [];
    const hand = new Hand({
      writable: () => writable,
      save: (scene) => saved.push(scene),
    });
    hand.load(mustParse(BOX_SCENE));
    hand.select(['box']);

    // Land one valid edit while writable so undo has a step to protect.
    hand.nudge(10, 0);
    assert.equal(saved.length, 1);
    assert.equal(hand.canUndo, true);
    const afterNudge = serialiseScene(hand.scene);

    // Switch to read-only: edits and undo must be refused.
    writable = false;
    hand.nudge(10, 0);
    assert.equal(serialiseScene(hand.scene), afterNudge);
    assert.equal(saved.length, 1);

    hand.undo();
    assert.equal(serialiseScene(hand.scene), afterNudge);
    assert.equal(saved.length, 1);
    assert.equal(hand.canUndo, true);
    assert.equal(hand.canRedo, false);

    // Restoring writability proves the undo step was not consumed while read-only.
    writable = true;
    hand.undo();
    assert.equal((hand.scene.elements[0] as RectangleElement).x, 100);
    assert.equal(saved.length, 2);
  });

  it('records no undo step and saves nothing when an edit changes no bytes', () => {
    const saved: Scene[] = [];
    const hand = new Hand({
      writable: () => true,
      save: (scene) => saved.push(scene),
    });
    hand.load(mustParse(BOX_SCENE));
    hand.select(['box']);

    hand.land({ scene: hand.scene, selection: null });

    assert.equal(hand.canUndo, false);
    assert.equal(saved.length, 0);
  });

  it('folds nudges within the burst window into one undo step and separates nudges outside it', () => {
    let clock = 1000;
    const saved: Scene[] = [];
    const hand = new Hand({
      writable: () => true,
      save: (scene) => saved.push(scene),
      now: () => clock,
    });
    hand.load(mustParse(BOX_SCENE));
    hand.select(['box']);

    // Two nudges within 800ms -> one undo step.
    hand.nudge(10, 0);
    clock += 200;
    hand.nudge(10, 0);
    assert.equal((hand.scene.elements[0] as RectangleElement).x, 120);

    // Third nudge outside 800ms -> a second undo step.
    clock += 1000;
    hand.nudge(10, 0);
    assert.equal((hand.scene.elements[0] as RectangleElement).x, 130);

    // First undo takes back only the third nudge.
    hand.undo();
    assert.equal((hand.scene.elements[0] as RectangleElement).x, 120);

    // Second undo takes back both folded nudges together.
    hand.undo();
    assert.equal((hand.scene.elements[0] as RectangleElement).x, 100);
    assert.equal(hand.canUndo, false);
  });

  it('filters out removed Element ids from the selection on undo', () => {
    const saved: Scene[] = [];
    const hand = new Hand({
      writable: () => true,
      save: (scene) => saved.push(scene),
    });
    hand.load(mustParse(BOX_SCENE));

    // Add a second Element and select both.
    const added: RectangleElement = {
      ...(hand.scene.elements[0] as RectangleElement),
      id: 'extra',
      x: 300,
    };
    hand.land({
      scene: { ...hand.scene, elements: [...hand.scene.elements, added] },
      selection: ['box', 'extra'],
    });
    assert.deepEqual(hand.selected, ['box', 'extra']);

    // Undo removes 'extra'; selection must keep only 'box'.
    hand.undo();
    assert.deepEqual(hand.selected, ['box']);
  });

  it('settles Anchored ends when their target moves', () => {
    const saved: Scene[] = [];
    const hand = new Hand({
      writable: () => true,
      save: (scene) => saved.push(scene),
    });
    hand.load(mustParse(SNAPPED_SCENE));
    hand.select(['box']);

    // Move the box right by 50 and down by 30; the Anchored arrow start must follow.
    hand.nudge(50, 30);

    const arrow = hand.scene.elements.find((e) => e.id === 'arr') as ArrowOrLineElement;
    assert.equal(arrow.points[0].x, 270);
    assert.equal(arrow.points[0].y, 170);
    assert.equal(arrow.points[1].x, 340);
    assert.equal(arrow.points[1].y, 140);
  });

  it('switches a Bend point corner while keeping the picked Bend point, and returns false for missing shafts', () => {
    const saved: Scene[] = [];
    const hand = new Hand({
      writable: () => true,
      save: (scene) => saved.push(scene),
    });
    hand.load(mustParse(BENT_SCENE));
    hand.select(['arr']);
    hand.pickBend({ id: 'arr', index: 1 });

    assert.equal(hand.switchCorner({ id: 'missing', index: 1 }, 'round'), false);
    assert.equal(saved.length, 0);

    assert.equal(hand.switchCorner({ id: 'arr', index: 1 }, 'round'), true);
    assert.equal(saved.length, 1);
    assert.deepEqual(hand.bend, { id: 'arr', index: 1 });
    const arrow = hand.shaft('arr');
    assert.ok(arrow !== null);
    assert.equal(arrow.points[1].corner, 'round');
  });

  it('removes a Bend point and releases it, but refuses to leave a two-point self-loop', () => {
    const saved: Scene[] = [];
    const hand = new Hand({
      writable: () => true,
      save: (scene) => saved.push(scene),
    });
    hand.load(mustParse(BENT_SCENE));
    hand.select(['loop']);
    hand.pickBend({ id: 'loop', index: 1 });

    // Self-loop with one bend cannot lose its last bend point.
    assert.equal(hand.removeBend({ id: 'loop', index: 1 }), false);
    assert.deepEqual(hand.bend, { id: 'loop', index: 1 });
    assert.equal(saved.length, 0);

    // Regular shaft removes its bend point and releases the picked bend.
    hand.select(['arr']);
    hand.pickBend({ id: 'arr', index: 1 });
    assert.equal(hand.removeBend({ id: 'arr', index: 1 }), true);
    assert.equal(hand.bend, null);
    assert.equal(saved.length, 1);
    assert.equal(hand.shaft('arr')?.points.length, 2);
  });

  it('leaves selection and picked Bend point unchanged when landing an edit with null selection', () => {
    const saved: Scene[] = [];
    const hand = new Hand({
      writable: () => true,
      save: (scene) => saved.push(scene),
    });
    hand.load(mustParse(BENT_SCENE));
    hand.select(['arr']);
    hand.pickBend({ id: 'arr', index: 1 });

    const movedBox: RectangleElement = {
      ...(hand.scene.elements[0] as RectangleElement),
      x: 150,
    };
    hand.land({
      scene: {
        ...hand.scene,
        elements: [movedBox, ...hand.scene.elements.slice(1)],
      },
      selection: null,
    });

    assert.equal(saved.length, 1);
    assert.deepEqual(hand.selected, ['arr']);
    assert.deepEqual(hand.bend, { id: 'arr', index: 1 });
  });
});
