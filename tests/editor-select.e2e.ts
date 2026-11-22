/**
 * Seam 2: what a press selects — a click, a box a drag sweeps, the drawn border
 * outside the box, the ink a glyph hangs outside its words, the halo of a lower
 * Element, and the resize handles the selection gets. The press is the browser's
 * own and the answer is the saved Scene, never the page's markup.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  CROSSED,
  CROSSED_SCENE,
  OVERFLOW,
  OVERFLOW_SCENE,
  at,
  clickScene,
  drag,
  dragBy,
  expectSvgMatchesCli,
  median,
  settle,
  openEditor,
  savedFiles,
  savedScene,
  TIMING,
} from './helpers.ts';
import type { Point, SavedScene, Ui, View } from './helpers.ts';
import { livePage } from './cdp.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';
import { SCENE_SOURCE } from './editor-shared.ts';

const CROSSED_SOURCE = JSON.stringify(CROSSED_SCENE, null, 2);

test('click selects one Element, shift-click adds another, and both move', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // Selecting `b` on top of `a` and moving: both end up in the saved Scene.
  await clickScene(ui, { x: 100, y: 80 });
  await clickScene(ui, { x: 250, y: 110 }, ['Shift']);
  await dragBy(ui, { x: 250, y: 110 }, 11, 7);

  const scene = await savedScene(ui);
  expect(scene.elements.map((element) => [element.id, element.x, element.y])).toEqual([
    ['a', 51, 47],
    ['b', 211, 67],
  ]);
});

test('dragging a box around the Elements selects both, and the page keeps no text selection', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await drag(ui, at({ x: 10, y: 10 }), at({ x: 320, y: 180 }));

  // The browser's own selection stays empty: a drag cannot catch page text.
  expect(await ui.browser.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

  // Both Elements are selected: a nudge moves both.
  await ui.browser.keyboard.press('Shift+ArrowRight');
  const scene = await savedScene(ui);
  expect(scene.elements.map((element) => element.x)).toEqual([50, 210]);
});

test('a box that only overlaps an Element does not select it', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The box crosses `a` and clips `b`, enclosing neither.
  await drag(ui, at({ x: 10, y: 10 }), at({ x: 250, y: 100 }));
  expect(await ui.browser.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

  // Nothing is selected, so a nudge writes nothing.
  await ui.browser.keyboard.press('Shift+ArrowRight');
  expect((await savedFiles(ui))['scene.json']).toBe(SCENE_SOURCE);
});

test('a thick horizontal line is picked a pixel off its centre', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'crossed.json': CROSSED_SOURCE } }, 'crossed.json');

  // The line draws at y 200 with a 4px stroke; its box has no height at all.
  await clickScene(ui, { x: 190, y: 201 }, [], CROSSED);
  await ui.browser.keyboard.press('Shift+ArrowRight');

  const scene = await savedScene(ui, 'crossed.json');
  expect(scene.elements.find((element) => element.id === 'rule')?.points).toEqual([
    { x: 70, y: 200 },
    { x: 330, y: 200 },
  ]);
});

/** A rectangle, an ellipse and a diamond, unfilled, with bare paper between them. */
const BORDERS_SCENE = {
  version: 1,
  title: 'Borders',
  defaults: { roughness: 1 },
  elements: [
    { id: 'rect', type: 'rectangle', x: 40, y: 40, width: 120, height: 80 },
    { id: 'oval', type: 'ellipse', x: 220, y: 40, width: 140, height: 110 },
    { id: 'dia', type: 'diamond', x: 420, y: 40, width: 160, height: 120 },
  ],
};
const BORDERS_SOURCE = JSON.stringify(BORDERS_SCENE, null, 2);

/** The view `BORDERS_SCENE` lands in: its 572×152 page fitted one to one. */
const BORDERS = { zoom: 1, panX: 330, panY: 300 };

/** The three boxes, in Scene units, in the order they are pressed. */
const BORDERS_BOXES = BORDERS_SCENE.elements.map(({ id, x, y, width, height }) => ({
  id,
  box: { x, y, width, height },
}));

/** How dark a pixel has to be to count as the ink a person sees. */
const DRAWN = 0.6;

/**
 * The drawn border of the Element whose box's left edge is `edge`: the leftmost
 * ink on the page's own line through it, within `span` page pixels. The box is
 * not the answer — the roughness draws the border outside it, so the test reads
 * where the ink actually landed.
 */
async function borderInk(ui: Ui, edge: Point, span: number): Promise<Point> {
  const bounds = (await shot(ui)).darkBounds(
    { x: edge.x - span, y: edge.y - 0.5, width: span, height: 1 },
    DRAWN,
  );
  if (bounds === null) {
    throw new Error(`no border ink on the line through ${edge.x}, ${edge.y}`);
  }
  return { x: bounds.x + 0.5, y: edge.y };
}

/** A press and a release at a screen point, through the browser's own mouse. */
async function press(point: Point): Promise<void> {
  const mouse = livePage().mouse;
  await mouse.move(point.x, point.y);
  await mouse.down();
  await mouse.up();
}

/** The middle of a box's left edge, as the page shows it. */
function leftEdgeOf(box: { x: number; y: number; height: number }): Point {
  return at({ x: box.x, y: box.y + box.height / 2 }, BORDERS);
}

/**
 * The ink that reaches furthest left in `region`, from the page's pixels: the
 * row that gets furthest left and the pixel on it, centred where a press lands.
 * A glyph's hook or a rough outline's lobe is not on the row through the middle
 * of its box, so the row is found rather than assumed.
 */
async function leftmostInk(ui: Ui, region: Rect): Promise<Point> {
  const image = await shot(ui);
  let leftmost: Point | null = null;
  for (let y = Math.ceil(region.y); y < region.y + region.height; y += 1) {
    const row = image.darkBounds({ x: region.x, y, width: region.width, height: 1 }, DRAWN);
    if (row !== null && (leftmost === null || row.x < leftmost.x)) {
      leftmost = { x: row.x + 0.5, y: y + 0.5 };
    }
  }
  if (leftmost === null) {
    throw new Error(`no ink in ${JSON.stringify(region)}`);
  }
  return leftmost;
}

/** The x each Element saves with, so only the pressed Element can have moved. */
function savedXs(scene: SavedScene): Array<[string, number | undefined]> {
  return scene.elements.map((element) => [element.id, element.x]);
}

test('a press on the drawn border, outside the box, selects the Element', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'borders.json': BORDERS_SOURCE } }, 'borders.json');

  for (const [index, { id, box }] of BORDERS_BOXES.entries()) {
    const edge = leftEdgeOf(box);
    // The border the Renderer drew, from the page's pixels: its roughness puts
    // the ink outside the box. A press must still pick the Element there.
    const ink = await borderInk(ui, edge, 15);
    expect(ink.x, `${id}'s border is drawn outside its box`).toBeLessThan(edge.x);

    await press(ink);
    await browser.keyboard.press('Shift+ArrowRight');

    // Only the Element whose ink was pressed moved, and it moved as a nudge does.
    const scene = await savedScene(ui, 'borders.json');
    expect(savedXs(scene)).toEqual(
      BORDERS_BOXES.map((other, earlier) => [other.id, other.box.x + (earlier <= index ? 10 : 0)]),
    );
  }

  // Bare paper clear of the ink is bare canvas: the page keeps its Scene.
  const before = (await savedFiles(ui))['borders.json'];
  const last = BORDERS_BOXES[BORDERS_BOXES.length - 1]!.box;
  const edge = leftEdgeOf({ x: last.x + 10, y: last.y, height: last.height });
  await press({ x: edge.x - 40, y: edge.y });
  await browser.keyboard.press('Shift+ArrowRight');
  expect((await savedFiles(ui))['borders.json']).toBe(before);
});

test('a press on the drawn border selects the Element in a zoomed-in view', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };

  for (const { id, box } of BORDERS_BOXES) {
    // Each Element starts from the fitted view: a zoom about one Element's border
    // would carry the next one somewhere the test never asked for.
    await openEditor(ui, { A: { 'borders.json': BORDERS_SOURCE } }, 'borders.json');
    const edge = leftEdgeOf(box);

    // Zoom in on the border's own Scene point: the view keeps that point under
    // the pointer, so the box's left edge stays on the line the press follows.
    const mouse = livePage().mouse;
    await mouse.move(edge.x, edge.y);
    for (let notch = 0; notch < 4; notch += 1) {
      await mouse.wheel(0, -400);
    }
    await settle(ui);

    // Zoomed in, the same wobble is more pixels out, and the box is not what
    // the press aims at: the ink is.
    const ink = await borderInk(ui, edge, 60);
    expect(ink.x, `${id}'s border is drawn outside its box`).toBeLessThan(edge.x);

    await press(ink);
    await browser.keyboard.press('Shift+ArrowRight');

    const scene = await savedScene(ui, 'borders.json');
    expect(savedXs(scene)).toEqual(
      BORDERS_BOXES.map((other) => [other.id, other.box.x + (other.id === id ? 10 : 0)]),
    );
  }
});

/**
 * Two bold, plain-stroked boxes a 4px gap apart: the right one's tolerance halo
 * reaches the left one's border ink, so a press there has two candidates.
 */
const HALO_SCENE = {
  version: 1,
  title: 'Halo',
  defaults: { roughness: 0 },
  elements: [
    { id: 'left', type: 'rectangle', x: 40, y: 40, width: 100, height: 80, stroke: { width: 'bold' } },
    { id: 'right', type: 'rectangle', x: 144, y: 40, width: 96, height: 80, stroke: { width: 'bold' } },
  ],
};
const HALO_SOURCE = JSON.stringify(HALO_SCENE, null, 2);

/** The view `HALO_SCENE` lands in: its 200×80 page fitted one to one. */
const HALO = { zoom: 1, panX: 500, panY: 320 };

/** The middle of `HALO_SCENE`'s right-hand box, where its own ink is. */
const HALO_RIGHT = at({ x: 192, y: 80 }, HALO);

/**
 * The row the press follows, stopping short of the neighbour's border ink: it
 * holds the lower box's right border and nothing else.
 */
const HALO_ROW = { x: 620, y: HALO_RIGHT.y - 0.5, width: 22, height: 1 };

/** Two plain boxes whose interiors overlap: the second is drawn over the first. */
const OVERLAP_SCENE = {
  version: 1,
  title: 'Overlap',
  defaults: { roughness: 0 },
  elements: [
    { id: 'under', type: 'rectangle', x: 40, y: 40, width: 120, height: 80, fill: { kind: 'solid', grey: 2 } },
    { id: 'over', type: 'rectangle', x: 100, y: 50, width: 120, height: 80, fill: { kind: 'solid', grey: 4 } },
  ],
};
const OVERLAP_SOURCE = JSON.stringify(OVERLAP_SCENE, null, 2);

/** The view `OVERLAP_SCENE` lands in: its 180×90 page fitted one to one. */
const OVERLAP = { zoom: 1, panX: 510, panY: 315 };

test('a press on a lower Element\u2019s border ink is not taken by the halo above it', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'halo.json': HALO_SOURCE } }, 'halo.json');

  // The left box's right border, from the page's own pixels: the row through it
  // holds no other ink, and the rightmost of it is outside the box the border
  // belongs to, where the neighbour's halo reaches but its ink does not.
  const ink = (await shot(ui)).darkBounds(HALO_ROW, DRAWN);
  expect(ink, 'the left box draws its right border here').not.toBeNull();
  const onInk = { x: ink!.x + ink!.width - 0.5, y: HALO_RIGHT.y };
  const edge = at({ x: 140, y: 80 }, HALO);
  expect(onInk.x, 'the press is on ink outside the left box').toBeGreaterThan(edge.x);

  await press(onInk);
  await browser.keyboard.press('Shift+ArrowRight');

  // Only the box whose ink was pressed moved: the halo of the box above it is
  // not ink, and a press on ink is never bare canvas.
  const scene = await savedScene(ui, 'halo.json');
  expect(savedXs(scene)).toEqual([
    ['left', 50],
    ['right', 144],
  ]);
});

/**
 * One XL Kalam `j`: a hand font's hook hangs past the advance box its words are
 * measured by, so the ink a person sees and the box the words occupy differ.
 */
const HANG_SCENE = {
  version: 1,
  title: 'Hang',
  defaults: { roughness: 1 },
  elements: [{ id: 'hang', type: 'text', x: 40, y: 40, content: 'j', fontSize: 'XL', textAlign: 'left' }],
};
const HANG_SOURCE = JSON.stringify(HANG_SCENE, null, 2);

/** The view `HANG_SCENE` lands in: its 41×84 page fitted one to one. */
const HANG = { zoom: 1, panX: 595.5, panY: 334 };

/** Room around the drawn `j` on the page, clear of the rail and the status line. */
const HANG_REGION: Rect = { x: HANG.panX + 10, y: HANG.panY + 30, width: 60, height: 60 };

test('a press on the ink a glyph hangs outside its words selects the Text', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'hang.json': HANG_SOURCE } }, 'hang.json');

  // The hook of the `j`, from the page's pixels: it is outside the box Layout
  // measures the words in, and it is ink a person can see and press.
  const ink = await leftmostInk(ui, HANG_REGION);
  const advance = at({ x: 40, y: 0 }, HANG);
  expect(ink.x, 'the hook hangs left of the advance box').toBeLessThan(advance.x - 4);

  await press(ink);
  await browser.keyboard.press('Shift+ArrowRight');

  const scene = await savedScene(ui, 'hang.json');
  expect(scene.elements[0]?.x).toBe(50);
});

/**
 * One very wide, very flat ellipse: its 800 units of width must not add to the
 * reach its ink is picked by above and below it.
 */
const FLAT_SCENE = {
  version: 1,
  title: 'Flat',
  defaults: { roughness: 2 },
  elements: [
    {
      id: 'flat',
      type: 'ellipse',
      x: 40,
      y: 40,
      width: 800,
      height: 20,
      roughness: 2,
      seed: 37,
    },
  ],
};
const FLAT_SOURCE = JSON.stringify(FLAT_SCENE, null, 2);

/** The view `FLAT_SCENE` lands in: its 832×52 page fitted one to one. */
const FLAT = { zoom: 1, panX: 200, panY: 350 };

/** Page pixels around the drawn ellipse, clear of the rail and the status line. */
const FLAT_REGION: Rect = { x: FLAT.panX + 40, y: FLAT.panY + 10, width: 760, height: 60 };

/** How far above the ink the press lands: a press a person would not call near it. */
const CLEAR_OF_INK = 28;

test('a press clearly above a flat ellipse misses it, its width adding no reach', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'flat.json': FLAT_SOURCE } }, 'flat.json');

  // The topmost ink, from the page's own pixels: the press is measured off what
  // is drawn, not off the box the ellipse is stored as.
  const ink = (await shot(ui)).darkBounds(FLAT_REGION, DRAWN);
  expect(ink, 'the flat ellipse draws its ring').not.toBeNull();
  const above = { x: ink!.x + ink!.width / 2, y: ink!.y - CLEAR_OF_INK };
  expect(above.y, 'the press clears the ink').toBeLessThan(ink!.y);

  await press(above);
  await browser.keyboard.press('Shift+ArrowRight');
  await settle(ui);

  // Bare canvas: the press selected nothing, so the nudge moved no ink.
  expect((await shot(ui)).darkBounds(FLAT_REGION, DRAWN)).toEqual(ink);
});

/**
 * One tiny box with round corners, the roughest a Scene allows and the widest
 * stroke: at 800% its drawn line reaches well past the box it is stored as.
 */
const ROUND_SCENE = {
  version: 1,
  title: 'Round',
  defaults: { roughness: 2 },
  elements: [
    {
      id: 'dot',
      type: 'rectangle',
      x: 40,
      y: 40,
      width: 10,
      height: 10,
      corners: 'round',
      roughness: 2,
      seed: 326,
      stroke: { width: 'extra', style: 'solid' },
    },
  ],
};
const ROUND_SOURCE = JSON.stringify(ROUND_SCENE, null, 2);

/** The view `ROUND_SCENE` lands in: its 42×42 page fitted one to one. */
const ROUND = { zoom: 1, panX: 595, panY: 355 };

/** The middle of the box's left edge, as the fitted view shows it. */
const ROUND_EDGE = at({ x: 40, y: 45 }, ROUND);

test('a press on the outer ink of a tiny round box selects it at 800%', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'round.json': ROUND_SOURCE } }, 'round.json');

  // Zoom in on the box's own left edge: the Scene point under the pointer stays
  // under it, so the edge is where the fitted view put it.
  const mouse = livePage().mouse;
  await mouse.move(ROUND_EDGE.x, ROUND_EDGE.y);
  for (let notch = 0; notch < 4; notch += 1) {
    await mouse.wheel(0, -400);
  }
  await settle(ui);

  // The rough line of a round corner is drawn away from the box, so the ink a
  // person sees here is outside it and is still the Element's.
  const ink = await leftmostInk(ui, {
    x: ROUND_EDGE.x - 80,
    y: ROUND_EDGE.y - 60,
    width: 80,
    height: 120,
  });
  expect(ink.x, 'the drawn corner hangs outside the box').toBeLessThan(ROUND_EDGE.x - 8);

  await press(ink);
  await browser.keyboard.press('Shift+ArrowRight');

  const scene = await savedScene(ui, 'round.json');
  expect(scene.elements[0]?.x).toBe(50);
});

/**
 * Two boxes whose strokes are nothing like the default: the widest stroke at the
 * roughest line, beside the thinnest stroke at a line with no wobble at all.
 */
const STROKES_SCENE = {
  version: 1,
  title: 'Strokes',
  defaults: { roughness: 1 },
  elements: [
    { id: 'heavy', type: 'rectangle', x: 40, y: 40, width: 120, height: 80, roughness: 2, stroke: { width: 'extra' } },
    { id: 'hair', type: 'rectangle', x: 220, y: 40, width: 120, height: 80, roughness: 0, stroke: { width: 'thin' } },
  ],
};
const STROKES_SOURCE = JSON.stringify(STROKES_SCENE, null, 2);

/** The view `STROKES_SCENE` lands in: its 332×112 page fitted one to one. */
const STROKES = { zoom: 1, panX: 450, panY: 320 };

test('a press on the border picks an Element at every stroke width and roughness', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'strokes.json': STROKES_SOURCE } }, 'strokes.json');

  for (const [index, element] of STROKES_SCENE.elements.entries()) {
    const edge = at({ x: element.x, y: element.y + element.height / 2 }, STROKES);
    // The ink the page paints, not the box the Scene stores: the widest stroke
    // and the roughest line put it outside the edge, the thinnest inside it.
    const ink = await borderInk(ui, edge, 15);
    expect(ink.x, `${element.id}'s border is drawn at its edge`).toBeLessThanOrEqual(edge.x);

    await press(ink);
    await browser.keyboard.press('Shift+ArrowRight');

    // Only the Element whose border ink was pressed moved.
    const scene = await savedScene(ui, 'strokes.json');
    expect(savedXs(scene)).toEqual(
      STROKES_SCENE.elements.map((other, earlier) => [other.id, other.x + (earlier <= index ? 10 : 0)]),
    );
  }
});

test('a press inside two overlapping boxes picks the topmost Element', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'overlap.json': OVERLAP_SOURCE } }, 'overlap.json');

  // The press is inside both boxes and outside neither border: the Element
  // drawn last is the one that moves.
  await press(at({ x: 130, y: 85 }, OVERLAP));
  await browser.keyboard.press('Shift+ArrowRight');

  const scene = await savedScene(ui, 'overlap.json');
  expect(savedXs(scene)).toEqual([
    ['under', 40],
    ['over', 110],
  ]);
});

test("a click on a rectangle inside an arrow's box selects the rectangle", async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'crossed.json': CROSSED_SOURCE } }, 'crossed.json');

  // The point is inside the diagonal arrow's box but 15px off its ink.
  await clickScene(ui, { x: 120, y: 70 }, [], CROSSED);
  await ui.browser.keyboard.press('Shift+ArrowRight');

  const scene = await savedScene(ui, 'crossed.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(saved.get('sheet')?.x).toBe(50);
  expect(saved.get('slant')?.points).toEqual([
    { x: 40, y: 40 },
    { x: 240, y: 160 },
  ]);
});

test("a box drag starts inside an arrow's empty box", async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'crossed.json': CROSSED_SOURCE } }, 'crossed.json');

  // The drag starts in the arrow's box and sweeps up its own box left edge:
  // the rectangle is the only Element fully enclosed, and it is the only one
  // that moves.
  await drag(ui, at({ x: 40, y: 160 }, CROSSED), at({ x: 200, y: 20 }, CROSSED));
  await ui.browser.keyboard.press('Shift+ArrowRight');

  const scene = await savedScene(ui, 'crossed.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(saved.get('sheet')?.x).toBe(50);
  expect(saved.get('slant')?.points).toEqual([
    { x: 40, y: 40 },
    { x: 240, y: 160 },
  ]);
});

test('a resize handle changes the saved geometry', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await clickScene(ui, { x: 100, y: 80 });

  // The bottom right handle of `a` sits on its corner.
  await dragBy(ui, { x: 160, y: 120 }, 30, 10);

  const scene = await savedScene(ui);
  const resized = scene.elements.find((element) => element.id === 'a');
  expect({
    x: resized?.x,
    y: resized?.y,
    width: resized?.width,
    height: resized?.height,
  }).toEqual({ x: 40, y: 40, width: 150, height: 90 });
  await expectSvgMatchesCli(ui);
});

test('a resize follows the outline, not a Label that overflows it', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  const source = JSON.stringify(OVERFLOW_SCENE, null, 2);
  await openEditor(ui, { A: { 'overflow.json': source } }, 'overflow.json');
  await clickScene(ui, { x: 90, y: 60 }, [], OVERFLOW);

  // Its words overflow above and below the box, so the ink is taller than the
  // outline: the east handle is still the outline's right edge, mid height.
  await dragBy(ui, { x: 140, y: 60 }, 10, 0, OVERFLOW);

  const scene = await savedScene(ui, 'overflow.json');
  const resized = scene.elements.find((element) => element.id === 'box');
  expect({
    x: resized?.x,
    y: resized?.y,
    width: resized?.width,
    height: resized?.height,
  }).toEqual({ x: 40, y: 40, width: 110, height: 40 });
});

// ---------------------------------------------- the frame a press reads

/**
 * A Scene of a sheet and a hundred and ninety-six boxes, laid out so one press
 * has to ask every box before the one it lands on is reached: the sheet is drawn
 * first, the boxes above it, and the box drawn last sits away from the sheet, so
 * a second press is answered by the first Element the pick asks.
 *
 * A frame the page already painted answers a press with the box it drew, so
 * asking a hundred and ninety-six of them costs no more than asking one. A press
 * that measures the Scene instead draws each Element it walks past — words and
 * all — and a Scene of labelled boxes is what makes that difference a wall
 * clock's.
 */
const DENSE_BOXES = 196;
const DENSE_COLUMNS = 14;
/** One box, the step to the next one, and where the grid of them starts. */
const DENSE_BOX = { width: 50, height: 34 };
const DENSE_STEP = { x: 60, y: 42 };
const DENSE_ORIGIN = { x: 176, y: 16 };
/** The sheet the deep press lands on: behind every box, and drawn first. */
const DENSE_SHEET = { x: 16, y: 16, width: 140, height: 100 };

/** One box of the grid, at `cell` counted across the columns then down the rows. */
function denseBox(cell: number) {
  return {
    id: `box-${cell + 1}`,
    type: 'rectangle',
    x: DENSE_ORIGIN.x + (cell % DENSE_COLUMNS) * DENSE_STEP.x,
    y: DENSE_ORIGIN.y + Math.floor(cell / DENSE_COLUMNS) * DENSE_STEP.y,
    width: DENSE_BOX.width,
    height: DENSE_BOX.height,
    label: `box ${cell + 1}`,
  };
}

const DENSE_SCENE = {
  version: 1,
  title: 'Dense',
  defaults: { roughness: 1 },
  // The sheet first and the first box last: the press on the sheet is answered
  // only after every box above it has been asked, and the press on the last box
  // is answered at once. Both carry words, so the note either press shows is the
  // same shape as the other's.
  elements: [
    { id: 'sheet', type: 'rectangle', ...DENSE_SHEET, label: 'sheet' },
    ...Array.from({ length: DENSE_BOXES - 1 }, (_, index) => denseBox(index + 1)),
    denseBox(0),
  ],
};
const DENSE_SOURCE = JSON.stringify(DENSE_SCENE, null, 2);
/** The view `DENSE_SCENE` lands in: its 1022×612 page fitted 1:1 and centred. */
const DENSE: View = { zoom: 1, panX: 129, panY: 94 };
/** The middle of the sheet, under every box of the grid. */
const DEEP_POINT: Point = {
  x: DENSE_SHEET.x + DENSE_SHEET.width / 2,
  y: DENSE_SHEET.y + DENSE_SHEET.height / 2,
};
/** The middle of the box drawn last, which no other Element's ink covers. */
const SHALLOW_POINT: Point = {
  x: DENSE_ORIGIN.x + DENSE_BOX.width / 2,
  y: DENSE_ORIGIN.y + DENSE_BOX.height / 2,
};

/** The presses a median is taken over: five of each, interleaved. */
const PRESS_SAMPLES = 5;

/** The coarsest a browser clamps its stopwatch: a press under 1 ms reads as zero. */
const STOPWATCH_TICK = 1;

/**
 * The page's own stopwatch around a press. The window hears the pointer go down
 * before the editor's own listeners do and hears the same event again after
 * them, so the mark is what the press cost the page, with no round trip in it.
 */
async function watchPresses(ui: Ui): Promise<void> {
  await ui.browser.evaluate(() => {
    const page = window as unknown as { __pressCosts: number[] };
    page.__pressCosts = [];
    let started = 0;
    window.addEventListener(
      'pointerdown',
      () => {
        started = performance.now();
      },
      true,
    );
    window.addEventListener('pointerdown', () => {
      page.__pressCosts.push(performance.now() - started);
    });
    return true;
  });
}

/** Press a page point, and answer what the press itself cost the page, in ms. */
async function costOfPress(ui: Ui, point: Point): Promise<number> {
  await ui.browser.mouse.move(point.x, point.y);
  await ui.browser.mouse.down();
  await ui.browser.mouse.up();
  const [cost] = await ui.browser.evaluate(() => {
    const page = window as unknown as { __pressCosts: number[] };
    return page.__pressCosts.splice(0);
  });
  if (cost === undefined) {
    throw new Error('the page saw no press');
  }
  return cost;
}

test('a press reads the ink the page painted instead of measuring every Element', async ({
  app,
  browser,
  screen,
}) => {
  test.skip(
    !TIMING,
    'wall-clock timing: set ESBOZO_TIMING=1 to compare the presses (see tests/README.md)',
  );
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'dense.json': DENSE_SOURCE } }, 'dense.json');

  // What the two presses land on, so the costs measured below are two known
  // answers: the deep press takes the sheet behind the grid, the shallow one the
  // box drawn last.
  await clickScene(ui, DEEP_POINT, [], DENSE);
  await ui.browser.keyboard.press('Shift+ArrowRight');
  await clickScene(ui, SHALLOW_POINT, [], DENSE);
  await ui.browser.keyboard.press('Shift+ArrowRight');

  const scene = await savedScene(ui, 'dense.json');
  const placed = new Map(DENSE_SCENE.elements.map((element) => [element.id, element.x]));
  const moved = scene.elements.filter((element) => element.x !== placed.get(element.id));
  expect(moved.map((element) => element.id)).toEqual(['sheet', 'box-1']);

  // One of each before the samples, so the first frame a press reads and the
  // first note it shows are nobody's measurement.
  await settle(ui);
  await watchPresses(ui);
  await costOfPress(ui, at(DEEP_POINT, DENSE));
  await costOfPress(ui, at(SHALLOW_POINT, DENSE));

  const deep: number[] = [];
  const shallow: number[] = [];
  for (let sample = 0; sample < PRESS_SAMPLES; sample += 1) {
    deep.push(await costOfPress(ui, at(DEEP_POINT, DENSE)));
    shallow.push(await costOfPress(ui, at(SHALLOW_POINT, DENSE)));
  }

  // Walking past a hundred and ninety-six Elements answers with the boxes the
  // page painted, so the press that must pass them all costs no more than the
  // press that asks one. An editor that measures the Scene instead draws each of
  // them, and then the two presses are twenty times apart.
  // The cutoff never falls below one tick: on a clamped stopwatch a press under
  // it reads as zero, and a cutoff of zero fails a healthy editor.
  expect(median(deep)).toBeLessThan(Math.max(median(shallow), STOPWATCH_TICK) * 8);
});
