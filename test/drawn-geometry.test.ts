/**
 * Seam 3: the one answer the Editor reads an Element's drawn geometry from.
 *
 * `ez` cannot reach these cases: a file's Scene is parsed and canonical before
 * the CLI draws it, and no command picks an Element or drags a bend. The query
 * is the Renderer's own answer to the Editor, so this seam holds it to the
 * geometry the drawing already promises — the ends a Snap lands, the points a
 * Shaft turns by, the dots halfway along its segments and the box its Label
 * paints — and to the fine-grained answers it replaces, which stay until the
 * Editor asks for nothing else.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';
import type { ArrowOrLineElement, Element, Scene } from '../src/scene.ts';

const {
  parseScene,
  drawnGeometry,
  drawnShaft,
  shaftInk,
  shaftLabel,
  elementBounds,
  renderElement,
  createLayout,
  parseFontFile,
  KALAM,
} = await loadProjectModules();

/** The drawing is measured with the bundled font, as `ez render` measures it. */
const LAYOUT = createLayout(parseFontFile(KALAM));

/** How far a glyph hangs past Layout's advance box, as a share of the font size. */
const GLYPH_HANG = 0.25;

/** A parsed Scene, or the problems that stopped it. */
function parsed(scene: unknown): Scene {
  const result = parseScene(JSON.stringify(scene));
  if (!result.ok) {
    throw new Error(`Scene did not parse: ${result.problems.map((p) => p.message).join('; ')}`);
  }
  return result.scene;
}

/** The Element an id names, refusing a fixture that lost it. */
function elementOf(scene: Scene, id: string): Element {
  const element = scene.elements.find((candidate) => candidate.id === id);
  if (element === undefined) {
    throw new Error(`the fixture holds no "${id}"`);
  }
  return element;
}

/** A shaft of the fixture, refusing anything else. */
function shaftOf(scene: Scene, id: string): ArrowOrLineElement {
  const element = elementOf(scene, id);
  if (element.type !== 'arrow' && element.type !== 'line') {
    throw new Error(`"${id}" is no arrow or line`);
  }
  return element;
}

/** The ids a Scene holds, mapped to the Elements themselves. */
function byIdOf(scene: Scene): Map<string, Element> {
  return new Map(scene.elements.map((element) => [element.id, element]));
}

test('a Snapped end lands where the ink puts it, Anchor and all', () => {
  // A 100×100 box whose middle is the Anchor, and a free end far outside it: the
  // stored point is the box's middle, the ink's end is the foot on its top edge.
  const scene = parsed({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      { id: 'box', type: 'rectangle', x: 100, y: 100, width: 100, height: 100 },
      {
        id: 'a',
        type: 'line',
        points: [
          { x: 400, y: 400 },
          { x: 150, y: 150, snap: 'box', anchor: { x: 0.5, y: 0.5 } },
        ],
      },
    ],
  });
  const shaft = shaftOf(scene, 'a');
  const drawn = drawnGeometry(shaft, byIdOf(scene), LAYOUT);

  assert.deepEqual(drawn.ends, [
    { x: 400, y: 400 },
    { x: 150, y: 100 },
  ]);
  assert.deepEqual(drawn.ends, drawnShaft(shaft, byIdOf(scene)), 'one answer, not two');
  assert.equal(drawn.path?.start.y, 400, 'the path starts at the free end');
  assert.equal(drawn.path?.end.y, 100, 'and finishes on the outline it snaps to');
});

test('a Shaft turns by its own points, and its dots sit halfway along its segments', () => {
  // A bend cuts its corner, so a dot sits halfway along the run that is drawn and
  // not on the bend itself: between the ends of its own leg, before the cut.
  const scene = parsed({
    version: 1,
    elements: [
      {
        id: 'a',
        type: 'line',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
          { x: 200, y: 0 },
        ],
      },
    ],
  });
  const shaft = shaftOf(scene, 'a');
  const drawn = drawnGeometry(shaft, byIdOf(scene), LAYOUT);

  assert.deepEqual(drawn.bends, [
    { index: 1, at: { x: 100, y: 100 }, corner: 'sharp' },
  ]);
  assert.equal(drawn.dots.length, 2, 'one dot per segment of the ink');
  assert.deepEqual(
    drawn.dots.map((dot) => dot.index),
    [1, 2],
    'each names the leg it adds a point to',
  );

  // Leg one runs up from (0,0) to the bend, leg two down to (200,0).
  const legs = [
    [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ],
    [
      { x: 100, y: 100 },
      { x: 200, y: 0 },
    ],
  ] as const;
  drawn.dots.forEach((dot, leg) => {
    const [from, to] = legs[leg]!;
    const across = (dot.at.x - from.x) / (to.x - from.x);
    assert.ok(across > 0 && across < 1, `dot ${leg + 1} sits between the ends of its leg`);
    assert.ok(
      Math.abs(dot.at.y - (from.y + across * (to.y - from.y))) < 1e-9,
      `dot ${leg + 1} sits on its leg`,
    );
  });
});

test('an outline answers no ends, bends or dots', () => {
  const scene = parsed({
    version: 1,
    elements: [{ id: 'a', type: 'ellipse', x: 10, y: 20, width: 100, height: 60 }],
  });
  const drawn = drawnGeometry(elementOf(scene, 'a'), byIdOf(scene), LAYOUT);

  assert.equal(drawn.ends, null);
  assert.equal(drawn.path, null);
  assert.deepEqual(drawn.heads, []);
  assert.deepEqual(drawn.bends, []);
  assert.deepEqual(drawn.dots, []);
  assert.deepEqual(drawn.box, { x: 10, y: 20, width: 100, height: 60 });
});

test('a Label’s box is the box its ink paints, glyph overhang included', () => {
  const scene = parsed({
    version: 1,
    elements: [
      {
        id: 'a',
        type: 'line',
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
        ],
        label: 'words',
      },
    ],
  });
  const drawn = drawnGeometry(shaftOf(scene, 'a'), byIdOf(scene), LAYOUT);
  const words = drawn.words;
  assert.ok(words !== null, 'the Label is measured');

  const hang = words.size * GLYPH_HANG;
  assert.deepEqual(drawn.label, {
    x: words.x - hang,
    y: words.y,
    width: words.width + hang * 2,
    height: words.height,
  });
});

test('the query answers the ink and geometry the fine-grained answers promised', () => {
  // One Scene of every kind the Renderer draws, each with the words and the
  // shape that makes its box, its ink and its ends differ from the others.
  const scene = parsed({
    version: 1,
    elements: [
      { id: 'box', type: 'rectangle', x: 40, y: 40, width: 160, height: 80, label: 'Orders' },
      { id: 'round', type: 'diamond', x: 260, y: 40, width: 120, height: 80, corners: 'round' },
      { id: 'words', type: 'text', x: 40, y: 200, content: 'Billed once per order' },
      {
        id: 'free',
        type: 'arrow',
        points: [
          { x: 0, y: 0 },
          { x: 120, y: 90 },
        ],
        label: 'free',
      },
      {
        id: 'snapped',
        type: 'line',
        points: [
          { x: 500, y: 400, snap: 'box' },
          { x: 560, y: 460 },
          { x: 600, y: 500, snap: 'round' },
        ],
        heads: { start: 'dot', end: 'bar' },
      },
    ],
  });
  const byId = byIdOf(scene);

  for (const element of scene.elements) {
    const drawn = drawnGeometry(element, byId, LAYOUT);
    const painted = renderElement(element, byId, LAYOUT);

    assert.deepEqual(drawn.bounds, elementBounds(element, byId, LAYOUT), `${element.id}: bounds`);
    assert.deepEqual(drawn.ink, painted.ink, `${element.id}: ink`);
    assert.deepEqual(drawn.words, painted.words, `${element.id}: words`);

    if (element.type === 'arrow' || element.type === 'line') {
      assert.deepEqual(drawn.path, shaftInk(element, byId).path, `${element.id}: path`);
      assert.deepEqual(drawn.heads, shaftInk(element, byId).heads, `${element.id}: heads`);
      assert.deepEqual(drawn.ends, drawnShaft(element, byId), `${element.id}: ends`);
      assert.deepEqual(drawn.words, shaftLabel(element, byId, LAYOUT), `${element.id}: label`);
    }
  }
});

test('a query without a Layout answers the ink and refuses to measure words', () => {
  const scene = parsed({
    version: 1,
    elements: [
      {
        id: 'plain',
        type: 'line',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      },
      {
        id: 'labelled',
        type: 'line',
        points: [
          { x: 0, y: 40 },
          { x: 100, y: 40 },
        ],
        label: 'words',
      },
    ],
  });
  const byId = byIdOf(scene);

  // What a Snap reads: where the ends land. No words, no measurement.
  const plain = drawnGeometry(shaftOf(scene, 'plain'), byId);
  assert.deepEqual(plain.ends, [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]);
  assert.deepEqual(plain.bounds, plain.box, 'with no words the bounds are the box');
  assert.deepEqual(plain.dots, [{ index: 1, at: { x: 50, y: 0 } }], 'one dot, halfway');

  // A Label is the Layout's to place: asking for it without one says so.
  const labelled = drawnGeometry(shaftOf(scene, 'labelled'), byId);
  assert.equal(labelled.path?.length, 100, 'the ink is still there to read');
  assert.throws(() => {
    void labelled.bounds;
  }, /measuring words needs the Layout/);
});

test('a query without the Scene’s Elements answers the bends and nothing Snapped', () => {
  const scene = parsed({
    version: 1,
    elements: [
      {
        id: 'a',
        type: 'line',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
          { x: 200, y: 0 },
        ],
      },
    ],
  });
  const shaft = shaftOf(scene, 'a');
  const drawn = drawnGeometry(shaft);

  assert.deepEqual(
    drawn.bends.map((bend) => bend.index),
    [1],
    'the point it turns by needs no Scene',
  );
  assert.throws(() => {
    void drawn.path;
  }, /resolving a Snap needs the Scene's own Elements/);
});
