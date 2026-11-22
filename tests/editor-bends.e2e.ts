/**
 * Seam 2: a bend point, the handle the editor shows on it and the drag that
 * moves it.
 *
 * Same rules as the editor suites: the input is a person's — a click on the
 * shaft, a press on the handle, the keys — and the assertion is the Scene the
 * editor saves, or the pixels it paints. A bend is stored as a point of its
 * arrow or line, so the saved `points` say whether the point moved, what its
 * `corner` still is and whether the ends kept their Snaps, without reading the
 * editor's state.
 *
 * The editor writes on its own clock, so a test reads the folder once the write
 * has landed there: `pointsIn` is what the file holds, and `expectPoints` polls
 * it until the editor has caught up. Reading the status alone would pass on the
 * `saved` an earlier step left.
 *
 * No test here uses the model, so `pnpm e2e` still passes with no key set.
 */
import { describe, test } from '@e2e-dev/web';
import { afterAll, expect } from 'e2e';
import { at, clickScene, drag, openEditor, savedFiles, savedScene, settle } from './helpers.ts';
import type { Point, SavedScene, Ui, View } from './helpers.ts';
import { zoomReadout } from './editor-shared.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';
import { removeTempFolders } from '../test/temp.ts';

// One folder of fixtures per test, made and removed by the same helper every
// suite uses.
afterAll(removeTempFolders);

/**
 * A free arrow through one bend, the bend written `sharp`: roughness 0, so the
 * page it draws is the numbers below.
 */
const SHARP_SCENE = {
  version: 1,
  title: 'Sharp bend',
  defaults: { roughness: 0 },
  elements: [
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 50, y: 50 },
        { x: 300, y: 250, corner: 'sharp' },
        { x: 550, y: 50 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const SHARP_SOURCE = JSON.stringify(SHARP_SCENE, null, 2);

/** The view `SHARP_SCENE` lands in: its page fitted 1:1 into a 1280×800 window. */
const SHARP: View = { zoom: 1, panX: 340, panY: 251 };

/** On the arrow's first run, on no Element: where a press selects it. */
const SHARP_ON = { x: 175, y: 150 };

/** Where the sharp bend is stored, and so where its handle sits on the page. */
const SHARP_BEND = { x: 300, y: 250 };

/** The points of `SHARP_SCENE` as the file holds them, and where a drag carries the bend. */
const SHARP_POINTS: SavedPoint[] = [
  { x: 50, y: 50 },
  { x: 300, y: 250, corner: 'sharp' },
  { x: 550, y: 50 },
];
const DRAGGED_POINTS: SavedPoint[] = [
  { x: 50, y: 50 },
  { x: 340, y: 270, corner: 'sharp' },
  { x: 550, y: 50 },
];

/** The part of the page the arrow, its selection and its bend handle paint in. */
const SHARP_AREA: Rect = { x: 480, y: 380, width: 260, height: 240 };

/**
 * An arrow with one `sharp` bend and one `round` bend, on a box that holds the
 * page still: the box is what the view fits, so where each handle sits is the
 * box's own arithmetic and no bent ink moves it.
 */
const SHAPES_SCENE = {
  version: 1,
  title: 'Two bends',
  defaults: { roughness: 0 },
  elements: [
    { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 150, y: 300 },
        { x: 300, y: 180, corner: 'sharp' },
        { x: 500, y: 180, corner: 'round' },
        { x: 650, y: 300 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const SHAPES_SOURCE = JSON.stringify(SHAPES_SCENE, null, 2);

/** The view `SHAPES_SCENE` lands in: its 800×560 box fitted 1:1. */
const SHAPES: View = { zoom: 1, panX: 240, panY: 120 };

/** On the arrow's first run, on no box edge: where a press selects the arrow. */
const SHAPES_ON = { x: 225, y: 240 };

/** Where the arrow's two bends are stored, and so where their handles sit. */
const SHARP_MARK = { x: 300, y: 180 };
const ROUND_MARK = { x: 500, y: 180 };

/**
 * One pixel of the page, at an offset from a bend's handle: what a square puts
 * ink on and a circle leaves alone, and the other way round. The offsets are the
 * inks the two shapes paint at an eight-pixel handle, read as pixels and never
 * as markup.
 */
function pixelAt(handle: Point, dx: number, dy: number): Rect {
  return { x: handle.x + dx, y: handle.y + dy, width: 1, height: 1 };
}

/**
 * A line through one bend, on a box that holds the page still: the Element's
 * own corner is `round` and the point writes none, so the bend it draws is the
 * Element's and a drag has to keep that.
 */
const LINE_SCENE = {
  version: 1,
  title: 'Round bend',
  defaults: { roughness: 0 },
  elements: [
    { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
    {
      id: 'bent',
      type: 'line',
      corners: 'round',
      points: [
        { x: 150, y: 300 },
        { x: 350, y: 180 },
        { x: 600, y: 300 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const LINE_SOURCE = JSON.stringify(LINE_SCENE, null, 2);

/** The view `LINE_SCENE` lands in: its 800×560 box fitted 1:1. */
const LINE: View = { zoom: 1, panX: 240, panY: 120 };

/** The line's bend, stored on its ink: a press there selects the line. */
const LINE_BEND = { x: 350, y: 180 };

/**
 * The view one zoom-in step leaves: `Meta+=` zooms by 1.2 around the middle of
 * the 1280×800 page, so Scene (400,280) stays at the middle and everything else
 * spreads from it.
 */
const LINE_ZOOMED: View = { zoom: 1.2, panX: 160, panY: 64 };

/**
 * An arrow with both ends Snapped to a box each, and two bends between them, on
 * a box that holds the page still: the drags below read which end kept its Snap
 * and which bend stayed where it was.
 */
const SNAPPED_SCENE = {
  version: 1,
  title: 'Snapped bends',
  defaults: { roughness: 0 },
  elements: [
    { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
    { id: 'a', type: 'rectangle', x: 100, y: 100, width: 100, height: 100 },
    { id: 'b', type: 'rectangle', x: 600, y: 300, width: 100, height: 100 },
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 150, y: 150, snap: 'a' },
        { x: 350, y: 200, corner: 'sharp' },
        { x: 550, y: 300, corner: 'round' },
        { x: 650, y: 350, snap: 'b' },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const SNAPPED_SOURCE = JSON.stringify(SNAPPED_SCENE, null, 2);

/** The view `SNAPPED_SCENE` lands in: its 800×560 box fitted 1:1. */
const SNAPPED: View = { zoom: 1, panX: 240, panY: 120 };

/** On the arrow's first run, past box `a` and clear of box `b`: where a press selects it. */
const SNAPPED_ON = { x: 275, y: 181 };

/** The sharp bend between the two Snapped ends, where its handle sits on the page. */
const SNAPPED_BEND = { x: 350, y: 200 };

/**
 * The Scene files the `bends.json` fixture folder holds, by the name a person opens.
 * `A` is the folder every helper in this suite reads back.
 */
const SCENES = {
  A: {
    'bends.json': SHARP_SOURCE,
    'line.json': LINE_SOURCE,
    'snapped.json': SNAPPED_SOURCE,
    'shapes.json': SHAPES_SOURCE,
  },
};

/** One point of a shaft as the editor saved it: every field a bend may carry. */
interface SavedPoint {
  x: number;
  y: number;
  snap?: string;
  corner?: string;
}

/** Open one of the bend fixtures. */
async function open(ui: Ui, name = 'bends.json'): Promise<void> {
  await openEditor(ui, SCENES, name);
}

/** The bytes of a saved Scene as the stub folder holds them, or undefined while there are none. */
async function savedSource(ui: Ui, name = 'bends.json'): Promise<string | undefined> {
  return (await savedFiles(ui))[name];
}

/** The whole `points` of the bent shaft in a saved Scene file, or null before it writes one. */
function pointsIn(source: string | undefined): SavedPoint[] | null {
  if (source === undefined) {
    return null;
  }
  const scene = JSON.parse(source) as SavedScene;
  return (scene.elements.find((element) => element.id === 'bent')?.points ??
    []) as unknown as SavedPoint[];
}

/** Wait for the editor's own write to land, then assert the shaft's whole `points`. */
async function expectPoints(
  ui: Ui,
  expected: SavedPoint[],
  name = 'bends.json',
): Promise<void> {
  await expect.poll(async () => pointsIn(await savedSource(ui, name))).toEqual(expected);
  expect(pointsIn(await savedSource(ui, name))).toEqual(expected);
}

describe('a bend point handle', () => {
  test('a sharp bend of an arrow drags to a new place, at zoom one', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, SHARP_ON, [], SHARP);
    await drag(ui, at(SHARP_BEND, SHARP), at({ x: 340, y: 270 }, SHARP));

    await expectPoints(ui, [
      { x: 50, y: 50 },
      { x: 340, y: 270, corner: 'sharp' },
      { x: 550, y: 50 },
    ]);
  });

  test('a round bend of a line drags at another zoom, keeping the Element its corner', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'line.json');

    await clickScene(ui, LINE_BEND, [], LINE);
    await browser.keyboard.press('Meta+=');
    await expect(zoomReadout(ui)).toHaveText('120%');

    const from = at(LINE_BEND, LINE_ZOOMED);
    await drag(ui, from, { x: from.x + 60, y: from.y - 24 });

    await expectPoints(
      ui,
      [
        { x: 150, y: 300 },
        { x: 400, y: 160 },
        { x: 600, y: 300 },
      ],
      'line.json',
    );
    const scene = await savedScene(ui, 'line.json');
    expect(scene.elements.find((element) => element.id === 'bent')?.corners).toBe('round');
  });

  test('dragging a bend keeps both Snaps and the other bend', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');

    await clickScene(ui, SNAPPED_ON, [], SNAPPED);
    await drag(ui, at(SNAPPED_BEND, SNAPPED), at({ x: 390, y: 220 }, SNAPPED));

    await expectPoints(
      ui,
      [
        { x: 150, y: 150, snap: 'a' },
        { x: 390, y: 220, corner: 'sharp' },
        { x: 550, y: 300, corner: 'round' },
        { x: 650, y: 350, snap: 'b' },
      ],
      'snapped.json',
    );
  });

  test('dropping a bend over a box does not Snap it', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');

    await clickScene(ui, SNAPPED_ON, [], SNAPPED);
    // From the sharp bend into the middle of box `a`: an end there would attach,
    // and a bend dropped there is a bend and only a bend.
    await drag(ui, at(SNAPPED_BEND, SNAPPED), at({ x: 120, y: 120 }, SNAPPED));

    await expectPoints(
      ui,
      [
        { x: 150, y: 150, snap: 'a' },
        { x: 120, y: 120, corner: 'sharp' },
        { x: 550, y: 300, corner: 'round' },
        { x: 650, y: 350, snap: 'b' },
      ],
      'snapped.json',
    );
  });

  test('a click on a bend handle writes nothing, and one undo takes the whole drag back', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, SHARP_ON, [], SHARP);
    const handle = at(SHARP_BEND, SHARP);
    await drag(ui, handle, at({ x: 340, y: 270 }, SHARP));
    await expectPoints(ui, DRAGGED_POINTS);
    const dragged = await savedSource(ui);

    // A press and release on the handle is a click on it: no write, no step.
    await clickScene(ui, { x: 340, y: 270 }, [], SHARP);
    await settle(ui);
    expect(await savedSource(ui)).toBe(dragged);
    // The first undo takes the drag back, so the click recorded no step of its
    // own: a history it had written would be the one undone here instead.
    await browser.keyboard.press('Meta+z');
    await expectPoints(ui, SHARP_POINTS);
    // And the drag is one step forward again.
    await browser.keyboard.press('Shift+Meta+z');
    await expectPoints(ui, DRAGGED_POINTS);
  });

  test('Escape mid-drag leaves the file, the history and the shaft as they were', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, SHARP_ON, [], SHARP);
    await drag(ui, at(SHARP_BEND, SHARP), at({ x: 340, y: 270 }, SHARP));
    await expectPoints(ui, DRAGGED_POINTS);
    const dragged = await savedSource(ui);
    const before = (await shot(ui)).darkBounds(SHARP_AREA, 0.6);

    // Half a drag is not a Scene: Escape drops the preview, and the release
    // that follows it settles nothing.
    const from = at({ x: 340, y: 270 }, SHARP);
    await drag(ui, from, { x: from.x + 40, y: from.y + 20 }, 'left', async () => {
      await browser.keyboard.press('Escape');
    });
    await settle(ui);

    expect(await savedSource(ui)).toBe(dragged);
    expect((await shot(ui)).darkBounds(SHARP_AREA, 0.6)).toEqual(before);
    // The selection is kept, and so is the single step the drag earned: the
    // first undo still takes that drag back, not a second one.
    await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();
    await browser.keyboard.press('Meta+z');
    await expectPoints(ui, SHARP_POINTS);
  });

  test('a sharp bend is marked by a square', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'shapes.json');
    await clickScene(ui, SHAPES_ON, [], SHAPES);

    // A square's corner reaches past where a circle of the same eight pixels
    // stops, so ink there is the square and only the square.
    const corner = pixelAt(at(SHARP_MARK, SHAPES), 4, -4);
    expect((await shot(ui)).darkCount(corner, 0.6)).toBeGreaterThan(0);
  });

  test('a round bend is marked by a circle', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'shapes.json');
    await clickScene(ui, SHAPES_ON, [], SHAPES);
    const painted = await shot(ui);

    // The circle's stroke crosses the diagonal inside the square's corner: ink
    // there is the circle's, and a square of the same size is bare fill.
    const stroke = pixelAt(at(ROUND_MARK, SHAPES), 3, -3);
    expect(painted.darkCount(stroke, 0.6)).toBeGreaterThan(0);
    const corner = pixelAt(at(ROUND_MARK, SHAPES), 4, -4);
    expect(painted.darkCount(corner, 0.6)).toBe(0);
  });
});
