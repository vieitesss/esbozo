/**
 * Seam 2: the editor in a browser, on e2e.
 *
 * Everything is driven the way a person drives it — the folder button, the file
 * name, the pointer and the keys — and asserted on the Scene the editor hands
 * to the file system and on the pixels it paints. The fixtures and the fixed
 * viewport put every Element at a known page point, so pointer input needs no
 * transform read, and a wrapper or a class name can change without a test
 * noticing.
 *
 * No test here uses the model, so `pnpm e2e` passes with no key set. The same
 * visible outcomes are also judged by a model in `tests/visual.e2e.ts`, which
 * runs on its own with `pnpm e2e:agent`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  ARRANGE,
  ARRANGE_SCENE,
  BIG_SCENE,
  BROKEN_SCENE,
  CROSSED,
  CROSSED_SCENE,
  EDGE,
  EDGE_1366,
  EDGE_SCENE,
  LONG_1366,
  LACED,
  LACED_SCENE,
  LONG_SCENE,
  PINNED,
  PINNED_SCENE,
  MIXED,
  MIXED_SCENE,
  TEXT_SCENE,
  WIDE_WALL_SCENE,
  XL_WORDS_SCENE,
  OVERFLOW,
  OVERFLOW_SCENE,
  SCENE,
  SHAFT,
  SHAFT_SCENE,
  UNEVEN,
  UNEVEN_SCENE,
  SNAPPED,
  SNAPPED_SCENE,
  SPREAD,
  SPREAD_SCENE,
  TETHER,
  TETHER_SCENE,
  THREE,
  THREE_SCENE,
  WIDE_1366,
  WIDE_SCENE,
  allowWrites,
  at,
  browseFolder,
  cliPng,
  clickScene,
  drag,
  dragBy,
  expectSvgMatchesCli,
  exported,
  settle,
  holdClipboardWrites,
  holdWrites,
  openEditor,
  releaseClipboardWrite,
  runAsWritten,
  openNewScene,
  releaseWrite,
  savedFiles,
  savedScene,
} from './helpers.ts';
import type { Point, SavedScene, Ui } from './helpers.ts';
import { livePage } from './cdp.ts';
import { decodePng, difference, shot } from './pixels.ts';
import type { Rect } from './pixels.ts';

const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
const MIXED_SOURCE = JSON.stringify(MIXED_SCENE, null, 2);
const CROSSED_SOURCE = JSON.stringify(CROSSED_SCENE, null, 2);
const SNAPPED_SOURCE = JSON.stringify(SNAPPED_SCENE, null, 2);
const BROKEN_SOURCE = JSON.stringify(BROKEN_SCENE, null, 2);
const THREE_SOURCE = JSON.stringify(THREE_SCENE, null, 2);
const EDGE_SOURCE = JSON.stringify(EDGE_SCENE, null, 2);
const SPREAD_SOURCE = JSON.stringify(SPREAD_SCENE, null, 2);
const TETHER_SOURCE = JSON.stringify(TETHER_SCENE, null, 2);
const ARRANGE_SOURCE = JSON.stringify(ARRANGE_SCENE, null, 2);
const WIDE_SOURCE = JSON.stringify(WIDE_SCENE, null, 2);
const LONG_SOURCE = JSON.stringify(LONG_SCENE, null, 2);
const PINNED_SOURCE = JSON.stringify(PINNED_SCENE, null, 2);
const UNEVEN_SOURCE = JSON.stringify(UNEVEN_SCENE, null, 2);
const LACED_SOURCE = JSON.stringify(LACED_SCENE, null, 2);
const SHAFT_SOURCE = JSON.stringify(SHAFT_SCENE, null, 2);
const TEXT_SOURCE = JSON.stringify(TEXT_SCENE, null, 2);
const BIG_SOURCE = JSON.stringify(BIG_SCENE, null, 2);
const XL_SOURCE = JSON.stringify(XL_WORDS_SCENE, null, 2);
const WIDE_WALL_SOURCE = JSON.stringify(WIDE_WALL_SCENE, null, 2);

/** One solid box, alone on its page: ink a cancelled gesture has to put back. */
const BLOCK_SCENE = {
  version: 1,
  title: 'Block',
  defaults: { roughness: 1 },
  elements: [
    {
      id: 'block',
      type: 'rectangle',
      x: 40,
      y: 40,
      width: 120,
      height: 80,
      fill: { kind: 'solid', grey: 6 },
    },
  ],
};
const BLOCK_SOURCE = JSON.stringify(BLOCK_SCENE, null, 2);

/** The view a lone 120x80 box lands in: its page is fitted one to one. */
const BLOCK = { zoom: 1, panX: 540, panY: 320 };

/** Inside the box where the Scene has it: solid ink. */
const HELD_BLOCK: Rect = { x: 600, y: 380, width: 40, height: 40 };
/** Inside the box where a drag carries it: paper once the gesture is gone. */
const MOVED_BLOCK: Rect = { x: 660, y: 500, width: 40, height: 40 };

/**
 * Press the block and carry it 60 by 120, leaving the pointer down: half a
 * gesture, painted and not yet a Scene.
 */
async function carryBlock(ui: Ui): Promise<void> {
  const from = at({ x: 100, y: 80 }, BLOCK);
  const to = at({ x: 160, y: 200 }, BLOCK);
  await ui.browser.mouse.move(from.x, from.y);
  await ui.browser.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await ui.browser.mouse.move(
      from.x + ((to.x - from.x) * step) / 6,
      from.y + ((to.y - from.y) * step) / 6,
    );
  }
  await settle(ui);
}

/** The middle of `b`, the one solid grey box in the fixture. */
const GREY_BOX: Rect = { x: 700, y: 390, width: 40, height: 40 };
/** Bare paper: no Element, no rail, no status, no note. */
const PAPER: Rect = { x: 900, y: 550, width: 40, height: 40 };
/** Bare paper wide enough for the dot Grid to show its dots. */
const GRID: Rect = { x: 850, y: 500, width: 200, height: 150 };
/** Both Elements and the space between them, clear of the rail and the status. */
const BOTH: Rect = { x: 400, y: 250, width: 700, height: 400 };
/** Empty canvas in the top right corner, where only paper and Grid show. */
const CORNER: Rect = { x: 950, y: 100, width: 100, height: 100 };

test('opening a Scene file paints it with the Renderer', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The grey box is painted, and it is painted darker than bare paper.
  const view = await shot(ui);
  const fill = view.meanLuminance(GREY_BOX);
  const paper = view.meanLuminance(PAPER);
  expect(fill).toBeLessThan(paper - 0.2);
});

test('a Scene that will not parse is reported and left alone on disk', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'broken.json': BROKEN_SOURCE } }, 'broken.json');

  await expect(ui.screen.getByRole('status')).toContainText('width must be at least 1 pixel');
  await expect(ui.screen.getByRole('status')).toContainText('box-a');
  const files = await savedFiles(ui);
  expect(files['broken.json']).toBe(BROKEN_SOURCE);
  expect(files['broken.svg']).toBeUndefined();
});

test('a Scene that is not there opens empty and is saved as Scene and SVG', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  // Asked for by name, so it is a Scene at once: empty, and on disk with its SVG.
  await openNewScene(ui, { A: {} }, 'fresh.json');

  await expect(ui.screen.getByRole('status')).toHaveText('saved');
  const files = await savedFiles(ui);
  expect(Object.keys(files).sort()).toEqual(['fresh.json', 'fresh.svg']);

  const scene = JSON.parse(files['fresh.json'] ?? '{}');
  expect(scene.elements).toEqual([]);
  expect(scene.title).toBe('fresh');
  // check-rules: markup of a written SVG file, not the page
  expect(files['fresh.svg']).toMatch(/<title[^>]*>fresh<\/title>/);

  // An empty Scene paints nothing where the grey box would have been.
  const view = await shot(ui);
  expect(view.meanLuminance(GREY_BOX)).toBeGreaterThan(0.85);
});

test('dragging an Element moves it smoothly and autosaves Scene plus SVG', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  const prompts: string[] = [];
  const stop = await ui.browser.onDialog(async (dialog) => {
    prompts.push(dialog.message);
    await dialog.dismiss();
  });
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // 37 and 23 are not on the 22px Grid, so a saved 77/63 proves no snapping.
  await dragBy(ui, { x: 100, y: 80 }, 37, 23);

  const scene = await savedScene(ui);
  const box = scene.elements.find((element) => element.id === 'a');
  expect({ x: box?.x, y: box?.y }).toEqual({ x: 77, y: 63 });
  await expectSvgMatchesCli(ui);
  expect(prompts).toEqual([]);
  await stop();
});

test('a gesture the browser takes away leaves none of its preview on the page', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'block.json': BLOCK_SOURCE } }, 'block.json');

  // Half a drag: the press selected `block`, the moves carried it down and
  // right, and the pointer is still down.
  await carryBlock(ui);
  expect((await shot(ui)).meanLuminance(MOVED_BLOCK)).toBeLessThan(0.2);

  // The browser takes the pointer away, as a touch that became a scroll does.
  await browser.evaluate(() => {
    document
      .querySelector('esbozo-editor .board')!
      .dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, isPrimary: true }));
    return true;
  });
  await settle(ui);

  // Nothing of the gesture is left: the drawing is where the Scene has it, and
  // where the pointer carried it is paper again.
  const cancelled = await shot(ui);
  expect(cancelled.meanLuminance(HELD_BLOCK)).toBeLessThan(0.2);
  expect(cancelled.meanLuminance(MOVED_BLOCK)).toBeGreaterThan(0.85);
  await browser.mouse.up();
  const scene = await savedScene(ui, 'block.json');
  expect({ x: scene.elements[0]?.x, y: scene.elements[0]?.y }).toEqual({ x: 40, y: 40 });

  // The same for the focus leaving the page mid-gesture, which sends no pointer
  // event at all: the preview leaves with the gesture it belonged to.
  await carryBlock(ui);
  expect((await shot(ui)).meanLuminance(MOVED_BLOCK)).toBeLessThan(0.2);
  await browser.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    return true;
  });
  await settle(ui);

  const blurred = await shot(ui);
  expect(blurred.meanLuminance(HELD_BLOCK)).toBeLessThan(0.2);
  expect(blurred.meanLuminance(MOVED_BLOCK)).toBeGreaterThan(0.85);
  await browser.mouse.up();
  const after = await savedScene(ui, 'block.json');
  expect({ x: after.elements[0]?.x, y: after.elements[0]?.y }).toEqual({ x: 40, y: 40 });
});

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

/** The middle of a box's left edge, as the page shows it. */
function leftEdgeOf(box: { x: number; y: number; height: number }): Point {
  return at({ x: box.x, y: box.y + box.height / 2 }, BORDERS);
}

/** A press and a release where the pointer lands, through the browser's own mouse. */
async function press(point: Point): Promise<void> {
  const mouse = livePage().mouse;
  await mouse.move(point.x, point.y);
  await mouse.down();
  await mouse.up();
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
    // the ink outside the box, which is exactly where a press used to miss.
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
    // Each Element starts from the fitted view: a zoom about one shape's border
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

/** The row the press follows, and where the lower box's border ink sits on it. */
const HALO_ROW = { x: 620, y: HALO_RIGHT.y - 0.5, width: 20, height: 1 };

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

  // The left box's right border, from the page's own pixels: it is the only ink
  // on this row, and the box the pointer is aimed near belongs to its neighbour.
  const ink = (await shot(ui)).darkBounds(HALO_ROW, DRAWN);
  expect(ink, 'the left box draws its right border here').not.toBeNull();
  const onInk = { x: ink!.x + ink!.width / 2, y: HALO_RIGHT.y };

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

test('Space pans and the wheel zooms without touching the Scene', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  const savedBefore = (await savedFiles(ui))['scene.json'];
  const start = (await shot(ui)).darkCentre(BOTH, 0.6);
  expect(start.count).toBeGreaterThan(0);

  await ui.browser.keyboard.down('Space');
  await drag(ui, { x: 640, y: 400 }, { x: 660, y: 430 });
  await ui.browser.keyboard.up('Space');

  // The grey box moved exactly as far as the pointer did.
  const panned = (await shot(ui)).darkCentre(BOTH, 0.6);
  expect(panned.x).toBeCloseTo(start.x + 20, 0);
  expect(panned.y).toBeCloseTo(start.y + 30, 0);

  // Zooming in makes the same box cover more pixels.
  const before = (await shot(ui)).darkCount(BOTH, 0.6);
  await ui.browser.mouse.move(640, 400);
  await ui.browser.mouse.wheel(0, -240);
  const wheeled = (await shot(ui)).darkCount(BOTH, 0.6);
  expect(wheeled).toBeGreaterThan(before * 1.3);

  await ui.browser.keyboard.press('Meta+=');
  expect((await shot(ui)).darkCount(BOTH, 0.6)).toBeGreaterThan(wheeled);

  // Panning and zooming are view changes, not Scene changes.
  expect((await savedFiles(ui))['scene.json']).toBe(savedBefore);
});

test('G shows and hides the dot Grid', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // A dot pattern puts a few hundred dark pixels in the region; plain paper
  // puts none, so a hundred over the bare count is the dots showing.
  const withGrid = (await shot(ui)).darkCount(GRID, 0.9);
  await ui.browser.keyboard.press('g');
  const bare = (await shot(ui)).darkCount(GRID, 0.9);
  expect(withGrid).toBeGreaterThan(bare + 100);

  await ui.browser.keyboard.press('g');
  expect((await shot(ui)).darkCount(GRID, 0.9)).toBeGreaterThan(bare + 100);
});

test('every Element type moves, and only a box-like one gets resize handles', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');

  // The ellipse: select it, resize it from its corner handle, then move it.
  await clickScene(ui, { x: 120, y: 110 }, [], MIXED);
  await dragBy(ui, { x: 180, y: 160 }, 30, 20, MIXED);
  await dragBy(ui, { x: 120, y: 110 }, 30, 20, MIXED);

  // Text carries no width and height, so its corner drags it; nothing resizes.
  // Its box is the words measured with Kalam, so the drag starts inside them.
  await clickScene(ui, { x: 270, y: 110 }, [], MIXED);
  await dragBy(ui, { x: 280, y: 120 }, 10, 10, MIXED);

  // An arrow moves by both of its ends.
  await dragBy(ui, { x: 200, y: 280 }, 0, -20, MIXED);

  const scene = await savedScene(ui);
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect({
    x: saved.get('oval')?.x,
    y: saved.get('oval')?.y,
    width: saved.get('oval')?.width,
    height: saved.get('oval')?.height,
  }).toEqual({ x: 90, y: 80, width: 150, height: 120 });
  expect({ x: saved.get('word')?.x, y: saved.get('word')?.y }).toEqual({ x: 270, y: 100 });
  expect(saved.get('shaft')?.points).toEqual([
    { x: 60, y: 210 },
    { x: 340, y: 310 },
  ]);
  await expectSvgMatchesCli(ui);

  // A box around the arrow alone selects only the arrow, ends included.
  await drag(ui, at({ x: 40, y: 190 }, MIXED), at({ x: 360, y: 340 }, MIXED));
  await ui.browser.keyboard.press('Shift+ArrowRight');
  const nudged = await savedScene(ui);
  const moved = new Map(nudged.elements.map((element) => [element.id, element]));
  expect(moved.get('shaft')?.points).toEqual([
    { x: 70, y: 210 },
    { x: 350, y: 310 },
  ]);
  expect(moved.get('oval')?.x).toBe(90);
  expect(moved.get('word')?.x).toBe(270);
});

test('dragging an arrow Snapped at both ends frees both ends and moves it', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'snapped.json': SNAPPED_SOURCE } }, 'snapped.json');

  // An arrow cannot move while it follows two Elements, so the drag frees both
  // ends where they draw and carries them by the drag.
  await dragBy(ui, { x: 230, y: 80 }, 10, 20, SNAPPED);

  const scene = await savedScene(ui, 'snapped.json');
  expect(scene.elements[2]?.points).toEqual([
    { x: 170, y: 100 },
    { x: 310, y: 100 },
  ]);

  // One gesture is one step: a single undo takes the drag back, Snaps and all.
  await ui.browser.keyboard.press('Meta+z');
  const undone = await savedScene(ui, 'snapped.json');
  expect(undone.elements[2]?.points).toEqual([
    { x: 160, y: 80, snap: 'from' },
    { x: 300, y: 80, snap: 'to' },
  ]);
});

test('nudging an arrow Snapped at both ends frees both ends and moves it', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'snapped.json': SNAPPED_SOURCE } }, 'snapped.json');

  await clickScene(ui, { x: 230, y: 80 }, [], SNAPPED);
  await ui.browser.keyboard.press('Shift+ArrowRight');

  const scene = await savedScene(ui, 'snapped.json');
  expect(scene.elements[2]?.points).toEqual([
    { x: 170, y: 80 },
    { x: 310, y: 80 },
  ]);

  // A keyboard nudge is a body move, so it follows the drag rule: the one step
  // it is undoes the move and puts both Snaps back.
  await ui.browser.keyboard.press('Meta+z');
  const undone = await savedScene(ui, 'snapped.json');
  expect(undone.elements[2]?.points).toEqual([
    { x: 160, y: 80, snap: 'from' },
    { x: 300, y: 80, snap: 'to' },
  ]);
});

test('browsing another folder never moves where the open Scene saves', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  const other = JSON.stringify({ ...SCENE, title: 'B copy' }, null, 2);
  // Two folders that both hold a `same.json`: only the opened one may change.
  await openEditor(
    ui,
    { A: { 'same.json': SCENE_SOURCE }, B: { 'same.json': other } },
    'same.json',
    ['A', 'B'],
  );

  await browseFolder(ui, 'B');
  await expect(ui.screen.getByRole('button', 'same.json')).toBeVisible();
  await ui.browser.keyboard.press('Escape');

  await clickScene(ui, { x: 100, y: 80 });
  await ui.browser.keyboard.press('Shift+ArrowRight');

  const opened = await savedScene(ui, 'same.json', 'A');
  expect(opened.elements.find((element) => element.id === 'a')?.x).toBe(50);
  await expectSvgMatchesCli(ui, 'same.json', 'A');

  const browsed = await savedScene(ui, 'same.json', 'B');
  expect(browsed.title).toBe('B copy');
  expect(browsed.elements.find((element) => element.id === 'a')?.x).toBe(40);
  expect((await savedFiles(ui, 'B'))['same.svg']).toBeUndefined();
});

test('reopening a Scene waits for the save already in flight', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The disk goes quiet with the first edit still unwritten.
  await holdWrites(ui, 'scene.json');
  await clickScene(ui, { x: 100, y: 80 });
  await ui.browser.keyboard.press('Shift+ArrowRight');
  await expect(ui.screen.getByRole('status')).toHaveText('saving…');

  // Reopening the same file from the note waits for that write to land.
  await browseFolder(ui, 'A');
  await ui.screen.getByRole('button', 'scene.json').click();
  await releaseWrite(ui);
  await allowWrites(ui);
  await expect(ui.screen.getByRole('status')).toHaveText('saved');

  // The reopened Scene carries the first nudge (x 50), so the second reaches 60.
  await clickScene(ui, { x: 100, y: 80 });
  await ui.browser.keyboard.press('Shift+ArrowRight');
  const scene = await savedScene(ui);
  expect(scene.elements.find((element) => element.id === 'a')?.x).toBe(60);
});

test('the status says saved only for the bytes that are on disk', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await holdWrites(ui, 'scene.json');

  await clickScene(ui, { x: 100, y: 80 });
  await ui.browser.keyboard.press('Shift+ArrowRight');
  await ui.browser.keyboard.press('Shift+ArrowRight');

  // The first write lands (x 50) while the edit that made it stale (x 60) is
  // still queued: the newest bytes are not on disk, so nothing is "saved".
  await releaseWrite(ui);
  await expect
    .poll(async () => {
      const files = await savedFiles(ui);
      const scene = JSON.parse(files['scene.json'] ?? '{}') as {
        elements: Array<{ id: string; x?: number }>;
      };
      return scene.elements.find((element) => element.id === 'a')?.x;
    })
    .toBe(50);
  await expect(ui.screen.getByRole('status')).toHaveText('saving…');

  await releaseWrite(ui);
  await allowWrites(ui);
  const scene = await savedScene(ui);
  expect(scene.elements.find((element) => element.id === 'a')?.x).toBe(60);
});

test('a font that will not load leaves the page with a visible error', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  // The hand font 404s, so nothing on the page can be measured with it.
  await ui.browser.route('**/fonts/Kalam-Regular.ttf', (route) =>
    route.fulfill({ status: 404, body: 'gone' }),
  );
  await ui.app.open('/editor.html');

  // The page says what it could not load, in its own status line.
  await expect(ui.screen.getByRole('status')).toContainText('cannot load fonts/Kalam-Regular.ttf');

  // And it is still the editor: the tools a person reaches for are there.
  await expect(ui.screen.getByRole('button', /Open folder/)).toBeVisible();
  await ui.browser.unrouteAll();
});

test('the page serves the hand font itself and nothing from a font CDN', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };

  // Watched from before the navigation, so a font request still in flight when
  // the page says it loaded cannot slip past.
  const requested: string[] = [];
  await ui.browser.route('**', async (route) => {
    requested.push(route.request.url);
    await route.continue();
  });
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The page fetched the hand font from its own folder. The filter runs inside
  // the poll, on the live list, so a fetch still in flight is waited for.
  await expect
    .poll(() => requested.filter((url) => new URL(url).pathname === '/fonts/Kalam-Regular.ttf').length)
    .toBeGreaterThan(0);
  await ui.browser.evaluate(() => document.fonts.ready.then(() => true));

  // The browser drew the hand font.
  expect(await ui.browser.evaluate(() => document.fonts.check('18px Kalam'))).toBe(true);

  // Every request went to the page's own origin: no font CDN, no other host.
  const page = await ui.browser.evaluate(() => location.origin);
  const origins = [...new Set(requested.map((url) => new URL(url).origin))];
  expect(origins).toEqual([page]);
  await ui.browser.unrouteAll();
});

test('the page follows the system theme after load and its own switch', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  const light = (await shot(ui)).meanLuminance(CORNER);
  expect(light).toBeGreaterThan(0.85);

  // The system turns dark after the page loaded: the page follows.
  await ui.browser.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(async () => (await shot(ui)).meanLuminance(CORNER))
    .toBeLessThan(0.4);

  // The page's own switch brings it back.
  await ui.screen.getByRole('button', 'Light').click();
  await expect
    .poll(async () => (await shot(ui)).meanLuminance(CORNER))
    .toBeGreaterThan(0.85);
});

describe('a page that starts in system dark', () => {
  test('paints dark and offers the light switch', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await ui.browser.emulateMedia({ colorScheme: 'dark' });
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    // Dark paper on the first frame, and the switch names the theme it gives.
    expect((await shot(ui)).meanLuminance(CORNER)).toBeLessThan(0.4);
    await ui.screen.getByRole('button', 'Light').click();
    await expect
      .poll(async () => (await shot(ui)).meanLuminance(CORNER))
      .toBeGreaterThan(0.85);
  });
});

/**
 * One control of the Style menu, by the name it gives itself: the row's name
 * and the value's, so a test asks for the button a person clicks and never for
 * the markup around it. A control that is not offered has no such button.
 */
function control(ui: Ui, name: string) {
  return ui.screen.getByRole('button', { name });
}

/** A row of the Style menu, for the plain words it shows beside its buttons. */
function row(ui: Ui, name: string) {
  return ui.screen.getByRole('group', name);
}

/** None of these controls is offered: the buttons themselves are absent. */
async function expectNoControl(ui: Ui, names: readonly string[]): Promise<void> {
  for (const name of names) {
    expect(await control(ui, name).count(), name).toBe(0);
  }
}

test('the Style menu is open only while something is selected', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await expect(ui.screen.getByRole('dialog', 'Style')).toBeHidden();

  await clickScene(ui, { x: 100, y: 80 });
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();

  await ui.browser.keyboard.press('Escape');
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeHidden();
});

test('every style control changes the selected Element in the saved Scene', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await clickScene(ui, { x: 100, y: 80 });

  // One pick per row, each its own autosaved edit; the Scene after all of them
  // is what proves none was lost or written over another.
  await control(ui, 'Rough: cartoonist').click();
  await control(ui, 'Stroke: extra').click();
  await control(ui, 'Line: dotted').click();
  await control(ui, 'Fill: cross').click();
  await control(ui, 'Grey: grey 5').click();
  await control(ui, 'Tone: muted').click();
  await control(ui, 'Corners: round').click();

  const scene = await savedScene(ui);
  const box = scene.elements.find((element) => element.id === 'a');
  expect({
    roughness: box?.roughness,
    stroke: box?.stroke,
    fill: box?.fill,
    tone: box?.tone,
    corners: box?.corners,
  }).toEqual({
    roughness: 2,
    stroke: { width: 'extra', style: 'dotted' },
    fill: { kind: 'cross-hatch', grey: 5 },
    tone: 'muted',
    corners: 'round',
  });
  // A style is not a move: the box stays where it was.
  expect({ x: box?.x, y: box?.y, width: box?.width, height: box?.height }).toEqual({
    x: 40,
    y: 40,
    width: 120,
    height: 80,
  });
  await expectSvgMatchesCli(ui);
});

test('the menu offers only the controls the selection can use', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');

  // An arrow is a stroke: heads, no fill, no corners, nothing to roughen.
  await clickScene(ui, { x: 200, y: 280 }, [], MIXED);
  await expect(control(ui, 'Head ←: dot')).toBeVisible();
  await expect(control(ui, 'Head →: bar')).toBeVisible();
  await expect(control(ui, 'Rough: cartoonist')).toBeVisible();
  await expectNoControl(ui, [
    'Fill: hachure',
    'Grey: grey 5',
    'Corners: round',
    'Align: left',
  ]);

  await control(ui, 'Head ←: dot').click();
  await control(ui, 'Head →: bar').click();
  let scene = await savedScene(ui);
  expect(scene.elements.find((element) => element.id === 'shaft')?.heads).toEqual({
    start: 'dot',
    end: 'bar',
  });

  // A Text is only words: no stroke to widen, but a size and an alignment.
  await clickScene(ui, { x: 277, y: 110 }, [], MIXED);
  await expect(control(ui, 'Size: L')).toBeVisible();
  await expect(control(ui, 'Align: centre')).toBeVisible();
  await expectNoControl(ui, ['Rough: cartoonist', 'Stroke: extra']);

  await control(ui, 'Size: L').click();
  await control(ui, 'Align: centre').click();
  scene = await savedScene(ui);
  const word = scene.elements.find((element) => element.id === 'word');
  expect({ fontSize: word?.fontSize, textAlign: word?.textAlign }).toEqual({
    fontSize: 'L',
    textAlign: 'center',
  });
});

test('Align is offered for words and boxes, and hidden when the selection holds a shaft', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');

  // An ellipse's Label and a Text both take an alignment: no shaft is selected.
  await clickScene(ui, { x: 120, y: 110 }, [], MIXED);
  await clickScene(ui, { x: 277, y: 110 }, ['Shift'], MIXED);
  await expect(control(ui, 'Align: right')).toBeVisible();
  await control(ui, 'Align: right').click();
  const scene = await savedScene(ui);
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect([saved.get('oval')?.textAlign, saved.get('word')?.textAlign]).toEqual(['right', 'right']);

  // Adding the arrow takes Align away: a shaft's Label is always centred, so
  // the pick would save a value the drawing never shows. Size still applies.
  await clickScene(ui, { x: 200, y: 280 }, ['Shift'], MIXED);
  await expectNoControl(ui, ['Align: left', 'Align: centre', 'Align: right']);
  await expect(control(ui, 'Size: L')).toBeVisible();
});

test('a pick writes to every selected Element, and a row that shares no value says mixed', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await clickScene(ui, { x: 100, y: 80 });
  await clickScene(ui, { x: 250, y: 110 }, ['Shift']);

  // `a` and `b` are both bold and sharp, and disagree on line and tone.
  await expect(control(ui, 'Rough: artist')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(ui, 'Line').getByText('mixed')).toBeVisible();
  await expect(row(ui, 'Tone').getByText('mixed')).toBeVisible();
  await expect(control(ui, 'Line: solid')).not.toHaveAttribute('aria-pressed', 'true');

  await control(ui, 'Tone: ink').click();
  await control(ui, 'Line: dotted').click();

  const scene = await savedScene(ui);
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(saved.get('a')?.tone).toBe('ink');
  expect(saved.get('b')?.tone).toBe('ink');
  expect(saved.get('a')?.stroke).toEqual({ width: 'bold', style: 'dotted' });
  expect(saved.get('b')?.stroke).toEqual({ width: 'bold', style: 'dotted' });
});

test('the status bar sets the Scene default roughness, and only new Elements take it', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await ui.screen.getByRole('button', 'rough · artist').click();
  await expect(ui.screen.getByRole('button', 'rough · cartoonist')).toBeVisible();

  const scene = await savedScene(ui);
  expect(scene.defaults?.roughness).toBe(2);
  // The Elements in the Scene carry their own resolved style, so they keep it.
  expect(scene.elements.map((element) => element.roughness)).toEqual([1, 1]);
});

test('a style pick is one undo step', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await clickScene(ui, { x: 100, y: 80 });
  await control(ui, 'Rough: cartoonist').click();
  expect((await savedScene(ui)).elements[0]?.roughness).toBe(2);

  await ui.browser.keyboard.press('Meta+z');
  expect((await savedScene(ui)).elements[0]?.roughness).toBe(1);
});

test('undoing the Scene default roughness puts the status bar back', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await ui.screen.getByRole('button', 'rough · artist').click();
  await expect(ui.screen.getByRole('button', 'rough · cartoonist')).toBeVisible();

  await ui.browser.keyboard.press('Meta+z');
  await expect(ui.screen.getByRole('button', 'rough · artist')).toBeVisible();
  expect((await savedScene(ui)).defaults?.roughness).toBe(1);
});

test('the docked note never covers the selection: the view pans clear of it', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'edge.json': EDGE_SOURCE } }, 'edge.json');

  /** Everything left of the note, over the right-hand box. */
  const LEFT_OF_NOTE: Rect = { x: 600, y: 340, width: 340, height: 120 };
  const before = (await shot(ui)).darkCentre(LEFT_OF_NOTE, 0.6);
  expect(before.count).toBeGreaterThan(0);

  // The right-hand box sits under where the note will dock.
  await clickScene(ui, { x: 760, y: 80 }, [], EDGE);
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();

  // Panning is a view change, so the Scene on disk is untouched. Whether the
  // ink ends up clear of the note is a judgement of the painted page, made in
  // `tests/visual.e2e.ts`: the note is opaque, so pixels cannot see behind it.
  expect((await savedFiles(ui))['edge.json']).toBe(EDGE_SOURCE);

  const after = (await shot(ui)).darkCentre(LEFT_OF_NOTE, 0.6);
  expect(after.count).toBeGreaterThan(0);
  // The box moved left, which is what makes room for the note.
  expect(after.x).toBeLessThan(before.x - 20);
});

test('a selection wider than the room beside the note zooms out to fit', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await ui.browser.setViewport({ width: 1366, height: 768 });
  await openEditor(ui, { A: { 'wide.json': WIDE_SOURCE } }, 'wide.json');

  const zoomLabel = ui.screen.getByText(/^\d+%$/);
  await expect(zoomLabel).toHaveText('100%');

  // A bar wider than everything left of the note: no pan can clear it, so the
  // view zooms out just far enough to show the whole bar beside the note.
  await clickScene(ui, { x: 200, y: 80 }, [], WIDE_1366);
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();
  await expect
    .poll(async () => Number((await zoomLabel.textContent())?.replace('%', '')))
    .toBeLessThan(100);

  // The bar is still painted where the note leaves room, and a zoom is a view
  // change: the Scene on disk is byte for byte the one that was opened.
  const bar: Rect = { x: 200, y: 300, width: 600, height: 150 };
  expect((await shot(ui)).darkCount(bar, 0.6)).toBeGreaterThan(45000);
  expect((await savedFiles(ui))['wide.json']).toBe(WIDE_SOURCE);
});

test('a fit and a zoom of the view keep the selection clear of the note', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await ui.browser.setViewport({ width: 1366, height: 768 });
  await openEditor(ui, { A: { 'wide.json': WIDE_SOURCE } }, 'wide.json');

  const zoomLabel = ui.screen.getByText(/^\d+%$/);
  const zoom = async () => Number((await zoomLabel.textContent())?.replace('%', ''));
  /** Rows of the bar left of the note, where the view puts all of it when cleared. */
  const BESIDE: Rect = { x: 200, y: 355, width: 500, height: 60 };

  await clickScene(ui, { x: 200, y: 80 }, [], WIDE_1366);
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();
  await expect.poll(zoom).toBeLessThan(100);
  const cleared = await zoom();
  expect((await shot(ui)).darkCount(BESIDE, 0.6)).toBeGreaterThan(20000);

  // A fit puts the page at 100%, which hides the bar's right end under the note:
  // the clearance runs before the fit is painted, so it never shows covered.
  await ui.browser.keyboard.press('Meta+0');
  await expect.poll(zoom).toBeLessThan(100);
  expect(await zoom()).toBe(cleared);
  expect((await shot(ui)).darkCount(BESIDE, 0.6)).toBeGreaterThan(20000);

  // A wheel zoom-in would leave too little room for the bar, so the clearance
  // zooms back out: the bar does not slip under the note after the wheel either.
  await ui.browser.mouse.move(640, 400);
  await ui.browser.mouse.wheel(0, -240);
  await expect.poll(zoom).toBeLessThan(100);
  expect(await zoom()).toBe(cleared);
  expect((await shot(ui)).darkCount(BESIDE, 0.6)).toBeGreaterThan(20000);

  // Every one of those is a view change, not an edit.
  expect((await savedFiles(ui))['wide.json']).toBe(WIDE_SOURCE);
});

test('a bare vertical shaft is cleared of the note like a box', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'shaft.json': SHAFT_SOURCE } }, 'shaft.json');

  // At 1280 the note covers the right 328 pixels, and the shaft is drawn at
  // page x 1160: under the note, with a selection box that has no width at all.
  await clickScene(ui, { x: 1080, y: 180 }, [], SHAFT);
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();

  // The shaft is four pixels wide and 240 tall, so its column left of the note
  // holds most of a thousand ink pixels; under the note it held none.
  const COLUMN: Rect = { x: 900, y: 300, width: 60, height: 200 };
  expect((await shot(ui)).darkCount(COLUMN, 0.6)).toBeGreaterThan(300);
  expect((await savedFiles(ui))['shaft.json']).toBe(SHAFT_SOURCE);
});

test('a rectangle too wide for the note zooms out past the manual zoom floor', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await ui.browser.setViewport({ width: 1366, height: 768 });
  await openEditor(ui, { A: { 'long.json': LONG_SOURCE } }, 'long.json');

  const zoomLabel = ui.screen.getByText(/^\d+%$/);
  const zoom = async () => Number((await zoomLabel.textContent())?.replace('%', ''));

  // 15,000 units wide: the room left of the note fits it at about 6%, below the
  // 10% a person may zoom to by hand.
  await clickScene(ui, { x: 4000, y: 200 }, [], LONG_1366);
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();
  await expect.poll(zoom).toBeLessThan(10);

  // The whole bar is on the page beside the note, and a zoom is not an edit.
  const BESIDE: Rect = { x: 150, y: 372, width: 700, height: 24 };
  expect((await shot(ui)).darkCount(BESIDE, 0.6)).toBeGreaterThan(12000);
  expect((await savedFiles(ui))['long.json']).toBe(LONG_SOURCE);
});

test('the docked note fits a 1366×768 window', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await ui.browser.setViewport({ width: 1366, height: 768 });
  await openEditor(ui, { A: { 'edge.json': EDGE_SOURCE } }, 'edge.json');

  // A rectangle shows the longest set of rows: look, fill, greys, corners, words.
  await clickScene(ui, { x: 80, y: 70 }, [], EDGE_1366);
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();

  // Every row is offered, the last one included, and the note needed no zoom to
  // make room in this window. That its whole shape sits inside the window is a
  // judgement of the painted page, in `tests/visual.e2e.ts`.
  await expect(control(ui, 'Corners: sharp')).toBeVisible();
  await expect(control(ui, 'Order: front')).toBeVisible();
  await expect(ui.screen.getByText(/^\d+%$/)).toHaveText('100%');
});

test('Arrange moves the selection through the layers and leaves its geometry alone', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'three.json': THREE_SOURCE } }, 'three.json');

  // Select the middle one by itself.
  await clickScene(ui, { x: 200, y: 220 }, [], THREE);
  const ids = async () => (await savedScene(ui, 'three.json')).elements.map((element) => element.id);

  await control(ui, 'Order: front').click();
  expect(await ids()).toEqual(['p', 'r', 'q']);

  await control(ui, 'Order: back').click();
  expect(await ids()).toEqual(['q', 'p', 'r']);

  await control(ui, 'Order: forward').click();
  expect(await ids()).toEqual(['p', 'q', 'r']);

  await control(ui, 'Order: backward').click();
  expect(await ids()).toEqual(['q', 'p', 'r']);

  // Layer order is not geometry: every box keeps the box it had.
  const scene = await savedScene(ui, 'three.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(['p', 'q', 'r'].map((id) => [saved.get(id)?.x, saved.get(id)?.y])).toEqual([
    [40, 40],
    [160, 200],
    [400, 100],
  ]);
});

test('Arrange steps two adjacent layers together, and not at all at the boundary', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'three.json': THREE_SOURCE } }, 'three.json');

  const ids = async () => (await savedScene(ui, 'three.json')).elements.map((element) => element.id);

  // The two front-most layers: `forward` has nowhere to move them past.
  await clickScene(ui, { x: 200, y: 220 }, [], THREE);
  await clickScene(ui, { x: 420, y: 120 }, ['Shift'], THREE);
  await control(ui, 'Order: forward').click();
  expect(await ids()).toEqual(['p', 'q', 'r']);

  // `backward` takes both down one layer and keeps them in the order they had.
  await control(ui, 'Order: backward').click();
  expect(await ids()).toEqual(['q', 'r', 'p']);

  // They are the two back-most now, so `backward` has nowhere to go either.
  await control(ui, 'Order: backward').click();
  expect(await ids()).toEqual(['q', 'r', 'p']);
});

test('Arrange lines the selection up on each edge and in each middle', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'three.json': THREE_SOURCE } }, 'three.json');

  /** Every selected box's top left, as saved. */
  const corners = async () => {
    const scene = await savedScene(ui, 'three.json');
    const saved = new Map(scene.elements.map((element) => [element.id, element]));
    return ['p', 'q', 'r'].map((id) => [saved.get(id)?.x, saved.get(id)?.y]);
  };

  // A box around all three, clear of the rail and the note.
  await drag(ui, at({ x: 10, y: 10 }, THREE), at({ x: 490, y: 270 }, THREE));
  await expect(control(ui, 'Arrange: left')).toBeVisible();

  await control(ui, 'Arrange: left').click();
  expect(await corners()).toEqual([
    [40, 40],
    [40, 200],
    [40, 100],
  ]);

  await control(ui, 'Arrange: right').click();
  expect(await corners()).toEqual([
    [40, 40],
    [60, 200],
    [80, 100],
  ]);

  await control(ui, 'Arrange: top').click();
  expect(await corners()).toEqual([
    [40, 40],
    [60, 40],
    [80, 40],
  ]);

  await control(ui, 'Arrange: bottom').click();
  expect(await corners()).toEqual([
    [40, 40],
    [60, 60],
    [80, 40],
  ]);

  await control(ui, 'Arrange: centre').click();
  expect(await corners()).toEqual([
    [40, 40],
    [50, 60],
    [60, 40],
  ]);

  await control(ui, 'Arrange: middle').click();
  expect(await corners()).toEqual([
    [40, 40],
    [50, 50],
    [60, 40],
  ]);
});

test('Arrange spreads the selection with equal gaps on each axis', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'three.json': THREE_SOURCE } }, 'three.json');
  // A box around all three: Arrange needs two, Spread needs three.
  await drag(ui, at({ x: 10, y: 10 }, THREE), at({ x: 490, y: 270 }, THREE));

  // Left to right: 40, 400 and 40 wide 100, 80, 60. The outer two stay put and
  // the gaps even out at 90, so the middle one moves from 160 to 230.
  await control(ui, 'Spread: horizontal').click();
  // Top to bottom: 40, 100 and 200 tall 60, 60, 40; the gaps even out at 20, so
  // the middle of the three moves from 100 to 120.
  await control(ui, 'Spread: vertical').click();

  const scene = await savedScene(ui, 'three.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(['p', 'q', 'r'].map((id) => [saved.get(id)?.x, saved.get(id)?.y])).toEqual([
    [40, 40],
    [230, 200],
    [400, 120],
  ]);
});

test('Spread spaces boxes too wide for their gaps by their centres, never backwards', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'spread.json': SPREAD_SOURCE } }, 'spread.json');

  await clickScene(ui, { x: 5, y: 70 }, [], SPREAD);
  await clickScene(ui, { x: 40, y: 50 }, ['Shift'], SPREAD);
  await clickScene(ui, { x: 65, y: 90 }, ['Shift'], SPREAD);
  await control(ui, 'Spread: horizontal').click();

  // The middle box is 100 wide in a 70-wide span, so equal edge gaps would be
  // -25 and the starts would run backwards. The two outermost keep 0 and 60,
  // and the centres even out instead: 5, 35, 65, so the wide box lands on -15.
  const scene = await savedScene(ui, 'spread.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(['lead', 'wide', 'tail'].map((id) => saved.get(id)?.x)).toEqual([0, -15, 60]);
  expect(['lead', 'wide', 'tail'].map((id) => saved.get(id)?.width)).toEqual([10, 100, 10]);
});

test('Spread leaves a row alone when its pinned outer centres leave no room to walk forward', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'pinned.json': PINNED_SOURCE } }, 'pinned.json');

  // (0,200), (35,10), (70,10): the leading box is wider than the span, so its
  // middle is at 100 and the tail's at 75. Even middles would run the row
  // backwards, and spreading through the edges would cross them: nothing moves.
  await clickScene(ui, { x: 100, y: 60 }, [], PINNED);
  await clickScene(ui, { x: 40, y: 70 }, ['Shift'], PINNED);
  await clickScene(ui, { x: 75, y: 70 }, ['Shift'], PINNED);
  await control(ui, 'Spread: horizontal').click();

  const scene = await savedScene(ui, 'pinned.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(['lead', 'mid', 'tail'].map((id) => saved.get(id)?.x)).toEqual([0, 35, 70]);
  expect(scene.elements.map((element) => element.id)).toEqual(['lead', 'mid', 'tail']);
});

test('Spread spaces a negative gap by its centres even when the outer widths differ', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'uneven.json': UNEVEN_SOURCE } }, 'uneven.json');

  await clickScene(ui, { x: 20, y: 70 }, [], UNEVEN);
  await clickScene(ui, { x: 65, y: 50 }, ['Shift'], UNEVEN);
  await clickScene(ui, { x: 100, y: 90 }, ['Shift'], UNEVEN);
  await control(ui, 'Spread: horizontal').click();

  // 40, 70 and 20 wide across a 110 span, so equal edge gaps would be -10. The
  // outer two keep 0 and 90 and their middles 20 and 100 anchor the row: the
  // middle box's middle lands on 60, which moves it from 30 to 25.
  const scene = await savedScene(ui, 'uneven.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(['lead', 'broad', 'tail'].map((id) => saved.get(id)?.x)).toEqual([0, 25, 90]);
  expect(['lead', 'broad', 'tail'].map((id) => saved.get(id)?.width)).toEqual([40, 70, 20]);
});

test('Spread evens boxes and leaves a Snapped line to its targets', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'laced.json': LACED_SOURCE } }, 'laced.json');

  // Three boxes 60 wide at 40, 180 and 420, plus a line Snapped at its left end.
  await clickScene(ui, { x: 70, y: 70 }, [], LACED);
  await clickScene(ui, { x: 210, y: 70 }, ['Shift'], LACED);
  await clickScene(ui, { x: 450, y: 70 }, ['Shift'], LACED);
  await clickScene(ui, { x: 140, y: 70 }, ['Shift'], LACED);
  await control(ui, 'Spread: horizontal').click();

  // The line is not measured or moved, so the boxes are all Spread sees: the
  // outer two keep 40 and 420 and the gaps even out at 130, so the middle box
  // moves from 180 to 230. The line's own ends are not Spread's to rewrite.
  const scene = await savedScene(ui, 'laced.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(['frame', 'post', 'beam'].map((id) => saved.get(id)?.x)).toEqual([40, 230, 420]);
  expect(saved.get('tie')?.points).toEqual([
    { x: 100, y: 70, snap: 'frame' },
    { x: 180, y: 70 },
  ]);
  expect(scene.elements.map((element) => element.id)).toEqual(['frame', 'post', 'beam', 'tie']);
});

test('Arrange leaves a Snapped line to its targets', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'tether.json': TETHER_SOURCE } }, 'tether.json');

  // All four: only the two rectangles can be lined up, so only `post` moves.
  await clickScene(ui, { x: 110, y: 70 }, [], TETHER);
  await clickScene(ui, { x: 310, y: 70 }, ['Shift'], TETHER);
  await clickScene(ui, { x: 390, y: 70 }, ['Shift'], TETHER);
  await clickScene(ui, { x: 210, y: 70 }, ['Shift'], TETHER);
  await control(ui, 'Arrange: left').click();

  const scene = await savedScene(ui, 'tether.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect([saved.get('frame')?.x, saved.get('post')?.x]).toEqual([60, 60]);
  // A Snapped end follows its target by itself, so neither line is rewritten.
  expect(saved.get('tether')?.points).toEqual([
    { x: 260, y: 70, snap: 'post' },
    { x: 420, y: 70 },
  ]);
  expect(saved.get('weft')?.points).toEqual([
    { x: 160, y: 70, snap: 'frame' },
    { x: 260, y: 70, snap: 'post' },
  ]);
});

test('Arrange offers a disabled action when nothing it can move is selected', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'tether.json': TETHER_SOURCE } }, 'tether.json');

  // The line Snapped at one end and the one Snapped at both: nothing Arrange
  // could move, so its buttons are offered but disabled. Order still applies,
  // because a layer is a position in the list and not a place on the page.
  await clickScene(ui, { x: 390, y: 70 }, [], TETHER);
  await clickScene(ui, { x: 210, y: 70 }, ['Shift'], TETHER);
  await expect(control(ui, 'Arrange: left')).toBeDisabled();
  await expect(control(ui, 'Arrange: middle')).toBeDisabled();
  await expect(control(ui, 'Order: front')).toBeEnabled();
});

test('Arrange lines mixed types up, and spreads them without reordering them', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  const open = () => openEditor(ui, { A: { 'arrange.json': ARRANGE_SOURCE } }, 'arrange.json');
  /** All four: a Text, two rectangles and a free arrow. */
  const selectAll = async () => {
    await clickScene(ui, { x: 45, y: 50 }, [], ARRANGE);
    await clickScene(ui, { x: 250, y: 70 }, ['Shift'], ARRANGE);
    await clickScene(ui, { x: 370, y: 70 }, ['Shift'], ARRANGE);
    await clickScene(ui, { x: 490, y: 70 }, ['Shift'], ARRANGE);
  };

  await open();
  await selectAll();
  await control(ui, 'Arrange: left').click();
  let saved = new Map((await savedScene(ui, 'arrange.json')).elements.map((e) => [e.id, e]));
  // The Text's own left edge is the selection's left, so it stays and the rest
  // come to it: the arrow moves by the left end of its shaft.
  expect(['words', 'row-a', 'row-b'].map((id) => saved.get(id)?.x)).toEqual([40, 40, 40]);
  expect(saved.get('tail')?.points).toEqual([
    { x: 40, y: 70 },
    { x: 180, y: 70 },
  ]);

  // Spread keeps the Text and the arrow where they are, and evens the gaps
  // between what is left. The Text's width is Layout's to measure, so the gaps
  // between the boxes are compared with each other, from the saved bytes.
  await open();
  await selectAll();
  await control(ui, 'Spread: horizontal').click();
  const scene = await savedScene(ui, 'arrange.json');
  saved = new Map(scene.elements.map((e) => [e.id, e]));
  expect(saved.get('words')?.x).toBe(40);
  expect(saved.get('tail')?.points).toEqual([
    { x: 420, y: 70 },
    { x: 560, y: 70 },
  ]);
  const rowA = saved.get('row-a')?.x ?? 0;
  const rowB = saved.get('row-b')?.x ?? 0;
  expect(rowA).toBeGreaterThan(40);
  expect(rowB).toBeGreaterThan(rowA);
  expect(Math.abs(rowB - (rowA + 100) - (420 - (rowB + 100)))).toBeLessThanOrEqual(1);
  // Layer order is not Spread's to change.
  expect(scene.elements.map((element) => element.id)).toEqual([
    'words',
    'row-a',
    'row-b',
    'tail',
  ]);
});

// --------------------------------------------------------------- the palette

/** A command palette row, by the name and the shortcut the row shows. */
function command(ui: Ui, name: string | RegExp) {
  return ui.screen.getByRole('option', { name });
}

/** Open the palette the way the rail's left hand does. */
async function palette(ui: Ui): Promise<void> {
  await ui.browser.keyboard.press('q');
  await expect(ui.screen.getByRole('dialog', 'Commands')).toBeVisible();
}

test('Q opens the palette on every action, each with the key that does it', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await palette(ui);

  // A tool, a Scene-wide action and an Arrange action are all reachable here,
  // and the row says which key picks it: the rail, the menu and the palette are
  // one list of actions. A tool names the digit its place on the rail gives it,
  // and Delete names the Backspace and Delete beside its letter.
  await expect(command(ui, 'Select · V · 1')).toBeVisible();
  await expect(command(ui, 'Toggle Grid · G')).toBeVisible();
  await expect(command(ui, 'Zoom to fit · ⌘0')).toBeVisible();
  await expect(command(ui, 'Redo · ⇧⌘Z')).toBeVisible();
  await expect(command(ui, 'Copy · ⌘C')).toBeVisible();
  await expect(command(ui, 'Open folder…')).toBeVisible();
  await expect(command(ui, 'Arrange: left')).toBeVisible();
  await expect(command(ui, 'Export PNG (dark)')).toBeVisible();

  // Nothing is selected, so the actions that need one say they cannot run.
  await expect(command(ui, 'Delete · X · ⌫ · Del')).toBeDisabled();
  await expect(command(ui, 'Delete · X · ⌫ · Del')).toContainText('select an Element first');

  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
});

test('⌘K opens the palette, and a query keeps the rows whose name holds its words', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await browser.keyboard.press('Meta+k');
  await expect(screen.getByRole('dialog', 'Commands')).toBeVisible();

  // Words in any order, in any case: the two Exports survive, the tools do not.
  await browser.keyboard.type('PNG DARK');
  await expect(command(ui, 'Export PNG (dark)')).toBeVisible();
  await expect(command(ui, 'Export PNG (light)')).toBeHidden();
  await expect(command(ui, 'Select · V')).toBeHidden();

  // A query nothing answers leaves the list empty rather than every row back.
  await browser.keyboard.type('zzz');
  await expect(command(ui, 'Export PNG (dark)')).toBeHidden();
});

test('the palette runs a Scene-wide action and the page action by name', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The Grid, by name: the dots go with it, the Scene is untouched.
  const withGrid = (await shot(ui)).darkCount(GRID, 0.9);
  await palette(ui);
  await browser.keyboard.type('grid');
  await browser.keyboard.press('Enter');
  await settle(ui);
  expect((await shot(ui)).darkCount(GRID, 0.9)).toBeLessThan(withGrid - 100);

  // Light and dark belong to the page, so the action asks the page to switch.
  await palette(ui);
  await browser.keyboard.type('theme');
  await browser.keyboard.press('Enter');
  await expect
    .poll(async () => (await shot(ui)).meanLuminance(CORNER))
    .toBeLessThan(0.4);
  await expect(screen.getByRole('button', 'Light')).toBeVisible();
});

test('Enter runs the row it landed on, and the Scene carries the change', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await clickScene(ui, { x: 100, y: 80 });
  expect((await savedScene(ui)).elements.length).toBe(2);

  await palette(ui);
  await browser.keyboard.type('duplicate');
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();

  // The duplicate landed where a C would have put it, and the palette is gone.
  const scene = await savedScene(ui);
  expect(scene.elements.map((element) => element.type)).toEqual([
    'rectangle',
    'rectangle',
    'rectangle',
  ]);
  expect(scene.elements[2]?.id).not.toBe(scene.elements[0]?.id);
});

test('the arrows step over an action that cannot run, and Escape leaves the Scene alone', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // Nothing has been undone yet, so Undo is listed and greyed with its reason.
  await palette(ui);
  await browser.keyboard.type('undo');
  await expect(command(ui, 'Undo · ⌘Z')).toBeDisabled();
  await expect(command(ui, 'Undo · ⌘Z')).toContainText('nothing to undo');
  await browser.keyboard.press('Enter');
  // Enter ran nothing, so the palette is still open and the Scene untouched.
  await expect(screen.getByRole('dialog', 'Commands')).toBeVisible();

  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  const scene = await savedScene(ui);
  expect(scene.elements.length).toBe(2);
});

test('the palette stays shut while a Text is being typed', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await browser.keyboard.press('t');
  await clickScene(ui, { x: 100, y: 200 });
  // `q` would open the palette on the canvas; in the words it is a letter.
  await screen.getByRole('textbox', { name: 'Text' }).pressSequentially('qk');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  await screen.getByRole('textbox', { name: 'Text' }).press('Escape');

  const scene = await savedScene(ui);
  expect(scene.elements.at(-1)?.content).toBe('qk');
});

/** The middle of a row, so a pointer press can land on it where it is drawn. */
async function rowCentre(ui: Ui, name: string): Promise<{ x: number; y: number }> {
  return ui.browser.evaluate((wanted: string) => {
    const row = [...document.querySelectorAll('[role="option"]')].find(
      (node) => node.getAttribute('aria-label') === wanted,
    );
    if (row === undefined) {
      throw new Error(`no row called ${wanted}`);
    }
    const box = row.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, name);
}

/** Which of the page's two focus stops holds the focus: the search field or the canvas. */
function focusOf(ui: Ui): Promise<'canvas' | 'search' | 'other'> {
  return ui.browser.evaluate(() => {
    const active = document.activeElement;
    if (active === document.querySelector('.canvas')) {
      return 'canvas';
    }
    return active === document.querySelector('.palette input') ? 'search' : 'other';
  });
}

test('the focus the palette hands back never scrolls the paper', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // Where the paper is on the page: the view has panned the drawing down, and
  // the focus coming back to the canvas must not scroll any of it.
  const paperTop = (): Promise<number> =>
    browser.evaluate(
      () => Math.round(document.querySelector('esbozo-editor .board')!.getBoundingClientRect().top),
    );
  expect(await paperTop()).toBe(0);
  await palette(ui);
  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  await settle(ui);
  expect(await paperTop()).toBe(0);

  // And a click right after it lands on the ink that is drawn there: the first
  // Element's middle, which is a selection and its Style menu.
  await clickScene(ui, { x: 100, y: 80 });
  await expect(screen.getByRole('button', { name: 'Corners: sharp' })).toBeVisible();
});

test('the digits pick the tools by their place on the rail', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The palette says `Ellipse · E · 3`, and `3` is the key that picks it: the
  // digits and the rail read one list.
  await browser.keyboard.press('3');
  await expect(screen.getByRole('button', 'Ellipse')).toHaveAttribute('aria-pressed', 'true');
  await browser.keyboard.press('v');
  await expect(screen.getByRole('button', 'Select')).toHaveAttribute('aria-pressed', 'true');
});

test('Order is offered, disabled, until something is selected', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // Not an empty command: a row that needs a selection says what it waits for,
  // and Enter on it does nothing at all.
  await palette(ui);
  await browser.keyboard.type('order');
  await expect(command(ui, 'Order: front')).toBeDisabled();
  await expect(command(ui, 'Order: front')).toContainText('select an Element first');
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('dialog', 'Commands')).toBeVisible();
  await browser.keyboard.press('Escape');

  const before = (await savedScene(ui)).elements.map((element) => element.id);
  await clickScene(ui, { x: 100, y: 80 });
  await palette(ui);
  await browser.keyboard.type('front');
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  const after = (await savedScene(ui)).elements.map((element) => element.id);
  expect(after).toEqual([...before].reverse());
});

test('shutting the palette puts the focus back on the canvas', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // Escape closes it and the keys belong to the page again: `g` is the Grid,
  // not a letter the search field would have swallowed.
  await palette(ui);
  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  await expect.poll(async () => focusOf(ui)).toBe('canvas');
  const withGrid = (await shot(ui)).darkCount(GRID, 0.9);
  await browser.keyboard.press('g');
  await settle(ui);
  expect((await shot(ui)).darkCount(GRID, 0.9)).toBeLessThan(withGrid - 100);

  // Running a row closes the palette the same way, with the change made.
  await palette(ui);
  await browser.keyboard.type('grid');
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  await expect.poll(async () => focusOf(ui)).toBe('canvas');
  await expect.poll(async () => (await shot(ui)).darkCount(GRID, 0.9)).toBeGreaterThan(withGrid - 100);

  // A row that cannot run keeps the palette open and the caret in the search
  // field, so the person can keep typing instead of hunting for it.
  await palette(ui);
  await browser.keyboard.type('delete');
  // A person can press a greyed row; the press is what has to leave the
  // palette open and the caret where it was.
  const disabled = await rowCentre(ui, 'Delete · X · ⌫ · Del');
  await browser.mouse.move(disabled.x, disabled.y);
  await browser.mouse.down();
  await browser.mouse.up();
  await expect(screen.getByRole('dialog', 'Commands')).toBeVisible();
  await expect.poll(async () => focusOf(ui)).toBe('search');
  await browser.keyboard.type('zzz');
  await expect(command(ui, 'Delete · X · ⌫ · Del')).toBeHidden();
  expect((await savedScene(ui)).elements.length).toBe(2);
});

test('Copy, Cut and Paste say to use the keys where the page has no clipboard', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  // Selected, so the selection is not what the row is waiting for.
  await clickScene(ui, { x: 100, y: 80 });
  // A page served over plain HTTP has no async Clipboard API at all.
  await browser.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    return (navigator as { clipboard?: unknown }).clipboard === undefined;
  });

  await palette(ui);
  await browser.keyboard.type('copy');
  await expect(command(ui, 'Copy · ⌘C')).toBeDisabled();
  await expect(command(ui, 'Copy · ⌘C')).toContainText('use ⌘C / ⌘V');
  await browser.keyboard.press('Meta+a');
  await browser.keyboard.type('paste');
  await expect(command(ui, 'Paste · ⌘V')).toBeDisabled();
  await expect(command(ui, 'Paste · ⌘V')).toContainText('use ⌘C / ⌘V');
  await browser.keyboard.press('Escape');

  // The keys are the browser's own clipboard events, so they still work.
  await browser.keyboard.press('Meta+x');
  await expect.poll(async () => (await savedScene(ui)).elements.length).toBe(1);
  await browser.keyboard.press('Meta+v');
  await expect.poll(async () => (await savedScene(ui)).elements.length).toBe(2);
});

test('a cut deletes the Elements it copied, whatever is selected when it lands', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': THREE_SOURCE } }, 'scene.json');
  await holdClipboardWrites(ui);

  // Cut the first box by name: the copy is in the clipboard, and the delete
  // waits for the clipboard to accept it.
  await clickScene(ui, { x: 90, y: 70 }, [], THREE);
  await palette(ui);
  await browser.keyboard.type('cut');
  await browser.keyboard.press('Enter');

  // While that write is in flight, the selection moves to another box. A cut
  // deletes what it copied, not what happens to be selected when it lands.
  await clickScene(ui, { x: 200, y: 220 }, [], THREE);
  await releaseClipboardWrite(ui);

  await expect.poll(async () => (await savedScene(ui)).elements.map((element) => element.id)).toEqual([
    'q',
    'r',
  ]);
});

test('a cut deletes nothing when the Scene changed before the copy landed', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': THREE_SOURCE } }, 'scene.json');
  await holdClipboardWrites(ui);

  await clickScene(ui, { x: 200, y: 220 }, [], THREE);
  await palette(ui);
  await browser.keyboard.type('cut');
  await browser.keyboard.press('Enter');

  // The page keeps taking edits while the clipboard write runs: this drag moves
  // the third box, so the Scene is not the one the cut copied from.
  await dragBy(ui, { x: 430, y: 130 }, 0, 60, THREE);
  await expect.poll(async () => (await savedFiles(ui))['scene.json']).toContain('"y": 160');
  await releaseClipboardWrite(ui);

  // Nothing is deleted, and the status line says why: the drawing the paste
  // would land in is not the one the copy came from.
  await expect(screen.getByRole('status')).toContainText('the Scene changed');
  const files = await savedFiles(ui);
  expect(JSON.parse(files['scene.json'] ?? '{}').elements.map((element: { id: string }) => element.id)).toEqual([
    'p',
    'q',
    'r',
  ]);
});

test('Zoom in, Zoom out and Reset zoom run from the palette', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  const zoomLabel = screen.getByText(/^\d+%$/);
  await expect(zoomLabel).toHaveText('100%');

  await palette(ui);
  await browser.keyboard.type('zoom');
  await expect(command(ui, 'Zoom in · ⌘+')).toBeVisible();
  await browser.keyboard.press('Meta+a');
  await browser.keyboard.type('zoom in');
  await browser.keyboard.press('Enter');
  await expect(zoomLabel).toHaveText('120%');

  await palette(ui);
  await browser.keyboard.type('zoom out');
  await browser.keyboard.press('Enter');
  await expect(zoomLabel).toHaveText('100%');

  // The keys the rows name answer on the canvas too: one list of actions.
  await browser.keyboard.press('Meta+=');
  await expect(zoomLabel).toHaveText('120%');
  await browser.keyboard.press('Meta+-');
  await expect(zoomLabel).toHaveText('100%');
  await browser.keyboard.press('Meta+=');
  await expect(zoomLabel).toHaveText('120%');
  await browser.keyboard.press('Meta+0');
  await expect(zoomLabel).toHaveText('100%');

  // And the palette puts the view back to one pixel per unit.
  await browser.keyboard.press('Meta+=');
  await expect(zoomLabel).toHaveText('120%');
  await palette(ui);
  await browser.keyboard.type('reset');
  await browser.keyboard.press('Enter');
  await expect(zoomLabel).toHaveText('100%');
});

test('Open folder is offered only where the page can open one', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The stubbed directory picker is there, as it is in Chrome over a secure
  // origin, so the page can open a folder and the row says so by running.
  await palette(ui);
  await browser.keyboard.type('open folder');
  await expect(command(ui, 'Open folder…')).not.toBeDisabled();
  await browser.keyboard.press('Escape');

  // A page served as plain files over HTTP has no directory picker at all.
  await browser.evaluate(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    return true;
  });

  await palette(ui);
  await browser.keyboard.type('open folder');
  await expect(command(ui, 'Open folder…')).toBeDisabled();
  await expect(command(ui, 'Open folder…')).toContainText('this page cannot open a folder');

  // A greyed row is not a command: Enter runs nothing, the palette stays open
  // and the status line is not handed an error about an API the page never had.
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('dialog', 'Commands')).toBeVisible();
  await expect(screen.getByRole('status')).not.toContainText('File System Access');
});

// ---------------------------------------------------------------- PNG export

/** Export the open Scene from the palette, and read what the browser downloaded. */
async function exportFromPalette(ui: Ui, name: string): Promise<{ name: string; png: Buffer }> {
  await palette(ui);
  return exported(ui, () => command(ui, name).click());
}

/** A drawing that must not be an empty sheet: its ink covers a real share of its page. */
function inkShare(png: Buffer): number {
  const image = decodePng(png);
  let inked = 0;
  for (let at = 0; at < image.width * image.height; at += 1) {
    const luminance =
      (0.2126 * (image.data[at * image.channels] ?? 0) +
        0.7152 * (image.data[at * image.channels + 1] ?? 0) +
        0.0722 * (image.data[at * image.channels + 2] ?? 0)) /
      255;
    if (luminance < 0.5) {
      inked += 1;
    }
  }
  return inked / (image.width * image.height);
}

test('Export PNG (light) downloads the image `ez png` gives for the same Scene', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  // A Scene with words in it: the SVG the browser rasterises has to carry the
  // page's font, or the PNG would be the same drawing in another typeface.
  await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');

  const file = await exportFromPalette(ui, 'Export PNG (light)');
  expect(file.name).toBe('scene.light.png');

  const cli = await cliPng(await savedScene(ui), 'light');
  expect({ width: decodePng(file.png).width, height: decodePng(file.png).height }).toEqual({
    width: decodePng(cli).width,
    height: decodePng(cli).height,
  });
  const apart = difference(decodePng(file.png), decodePng(cli));
  // Two rasterisers antialias the same paths differently; the drawings agree.
  expect(apart.meanDelta).toBeLessThan(1);
  expect(apart.movedShare).toBeLessThan(0.01);
  expect(inkShare(file.png)).toBeGreaterThan(0.02);
});

test('Export PNG (dark) draws the paper and ink the page shows, as `ez png --theme dark`', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await clickScene(ui, { x: 100, y: 80 });
  // The page is dark, and the dark PNG is the drawing that page shows.
  await screen.getByRole('button', 'Dark').click();
  await settle(ui);

  const dark = await exportFromPalette(ui, 'Export PNG (dark)');
  expect(dark.name).toBe('scene.dark.png');
  const cli = await cliPng(await savedScene(ui), 'dark');
  const apart = difference(decodePng(dark.png), decodePng(cli));
  expect(apart.meanDelta).toBeLessThan(1);
  expect(apart.movedShare).toBeLessThan(0.01);

  // A dark page draws light ink on dark paper: the two exports are not one PNG.
  const light = await exportFromPalette(ui, 'Export PNG (light)');
  expect(decodePng(light.png).data).not.toEqual(decodePng(dark.png).data);
});

test('a dense page of words exports as `ez png` draws it, in light and dark', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': TEXT_SOURCE } }, 'scene.json');
  const scene = await savedScene(ui);
  // Words at every size and anchor, so this is a text comparison, not a stroke one.
  expect((await cliPng(scene, 'dark')).length).toBeGreaterThan(0);

  for (const theme of ['light', 'dark'] as const) {
    const file = await exportFromPalette(ui, `Export PNG (${theme})`);
    const cli = await cliPng(await savedScene(ui), theme);
    expect({ width: decodePng(file.png).width, height: decodePng(file.png).height }).toEqual({
      width: decodePng(cli).width,
      height: decodePng(cli).height,
    });
    const apart = difference(decodePng(file.png), decodePng(cli));
    // The browser draws the glyph outlines the font carries, so the two
    // rasterisers agree on the words, not just on the strokes around them.
    expect(apart.meanDelta, `${theme} mean delta ${apart.meanDelta}`).toBeLessThan(1);
    expect(apart.movedShare, `${theme} moved share ${apart.movedShare}`).toBeLessThan(0.01);
    expect(inkShare(file.png)).toBeGreaterThan(0.02);
  }
});

/** Where every line of ink ends, read from a PNG of a page of words. */
function inkLines(png: Buffer): { width: number; right: number[] } {
  const image = decodePng(png);
  const paper = [0, 1, 2].map((channel) => image.data[channel] ?? 0);
  const inked = (x: number, y: number): boolean => {
    const at = (y * image.width + x) * image.channels;
    return [0, 1, 2].some((channel) => Math.abs((image.data[at + channel] ?? 0) - paper[channel]!) > 64);
  };
  const right: number[] = [];
  let lastRow = -2;
  for (let y = 0; y < image.height; y += 1) {
    let edge = -1;
    for (let x = 0; x < image.width; x += 1) {
      if (inked(x, y)) {
        edge = x;
      }
    }
    if (edge < 0) {
      continue;
    }
    // A line is a band of inked rows: the next inked row continues it.
    if (y === lastRow + 1 && right.length > 0) {
      right[right.length - 1] = Math.max(right[right.length - 1]!, edge);
    } else {
      right.push(edge);
    }
    lastRow = y;
  }
  return { width: image.width, right };
}

test('five XL lines of one sentence export as `ez png` draws them, in light and dark', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  // The reviewer's page: five XL lines of the same words, which the browser
  // drew as the word `Kalam` alone because the path it was given held a NaN.
  await openEditor(ui, { A: { 'scene.json': XL_SOURCE } }, 'scene.json');

  for (const theme of ['light', 'dark'] as const) {
    const file = await exportFromPalette(ui, `Export PNG (${theme})`);
    const cli = await cliPng(await savedScene(ui), theme);
    expect({ width: decodePng(file.png).width, height: decodePng(file.png).height }).toEqual({
      width: decodePng(cli).width,
      height: decodePng(cli).height,
    });
    const apart = difference(decodePng(file.png), decodePng(cli));
    expect(apart.meanDelta, `${theme} mean delta ${apart.meanDelta}`).toBeLessThan(1);
    expect(apart.movedShare, `${theme} moved share ${apart.movedShare}`).toBeLessThan(0.01);

    // Every one of the five lines keeps its words: five bands of ink, each
    // reaching the end of the line the font measured.
    const lines = inkLines(file.png);
    expect(lines.right.length, `${theme} lines`).toBe(5);
    for (const edge of lines.right) {
      expect(edge, `${theme} line ends at ${edge} of ${lines.width}`).toBeGreaterThan(
        lines.width * 0.9,
      );
    }
  }
});

test('a page wider than 32,767 units exports at one pixel per unit', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  // 33,170×142: past the 32,767 a canvas may be a side, and inside the limit
  // the browser really draws at, so this page is the browser's to export.
  await openEditor(ui, { A: { 'wide.json': WIDE_WALL_SOURCE } }, 'wide.json');

  const file = await exportFromPalette(ui, 'Export PNG (light)');

  expect(file.name).toBe('wide.light.png');
  expect({ width: decodePng(file.png).width, height: decodePng(file.png).height }).toEqual({
    width: 33170,
    height: 142,
  });
  // The wall is drawn, not an empty sheet: its outline is ink across the page.
  expect(inkShare(file.png)).toBeGreaterThan(0.02);
});

test('a Scene too big for a canvas names the CLI command that draws it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'poster.json': BIG_SOURCE } }, 'poster.json');

  // The row stays enabled: the page's size is only known once it is drawn.
  await palette(ui);
  await browser.keyboard.type('export png dark');
  await expect(command(ui, 'Export PNG (dark)')).not.toBeDisabled();
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();

  // The status line says how big the page is and what draws it at 1:1 instead.
  const status = screen.getByRole('status');
  await expect(status).toContainText('70170×142');
  await expect(status).toContainText('ez png poster.json --theme dark');

  // The attempt changed nothing: the Scene on disk is the one that was opened.
  const files = await savedFiles(ui);
  expect(JSON.parse(files['poster.json'] ?? '{}').elements.length).toBe(1);
});

test('a Scene whose name holds a space is named so the command runs as written', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'big poster.json': BIG_SOURCE } }, 'big poster.json');

  await palette(ui);
  await browser.keyboard.type('export png dark');
  await browser.keyboard.press('Enter');
  const status = screen.getByRole('status');
  await expect(status).toContainText('70170×142');
  // A name with a space in it is quoted, so the shell hands the CLI one path.
  await expect(status).toContainText("ez png 'big poster.json' --theme dark");

  // The command as written draws the page: copied out of the status line, it
  // reads the Scene that is on disk and writes the PNG beside it.
  const command = /`([^`]+)`/.exec((await status.textContent()) ?? '')?.[1] ?? '';
  expect(command).toBe("ez png 'big poster.json' --theme dark");
  const written = await runAsWritten(command, await savedFiles(ui));
  expect(written.code).toBe(0);
  const png = decodePng(await readFile(join(written.folder, 'big poster.dark.png')));
  expect({ width: png.width, height: png.height }).toEqual({ width: 70170, height: 142 });
});
