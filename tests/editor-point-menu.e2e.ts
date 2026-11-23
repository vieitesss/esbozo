/**
 * Seam 2: the point menu — the note a right-click on a bend point opens, its two
 * rows, and every way it closes.
 *
 * The input is a person's: a click that selects the shaft, the secondary press on
 * the handle a point draws, and the keys. The assertions are the Scene the editor
 * saved and the pixels it paints: a point the row removed is gone from `points`,
 * and the point the menu holds is drawn in the selection's own colour.
 *
 * The right button and a Ctrl+click are presses the page's fixture does not
 * send, so they go through the browser's own mouse (`tests/cdp.ts`), which is
 * where a press no role can drive belongs.
 *
 * No test here uses the model, so `pnpm e2e` still passes with no key set.
 */
import { describe, test } from '@e2e-dev/web';
import { afterAll, expect } from 'e2e';
import {
  allowWrites,
  at,
  clickScene,
  doubleClickScene,
  drag,
  holdWrites,
  openEditor,
  refuseWrite,
  savedFiles,
  savedScene,
  settle,
} from './helpers.ts';
import type { Point, SavedScene, Ui, View } from './helpers.ts';
import { livePage } from './cdp.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';
import { removeTempFolders } from '../test/temp.ts';

// One folder of fixtures per test, made and removed by the same helper every
// suite uses.
afterAll(removeTempFolders);

/** A box that holds the page still, so a Scene point lands at a known page point. */
const PAGE = { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 };

/**
 * An arrow through two bends: a peak at (250,150) whose legs both come down, and
 * a dip at (400,450) whose legs both go up. A menu that opens beside either lands
 * on bare paper, which is what lets a pixel count the row's own ink. The arrow
 * stays in the page's left half, so a selection never overlaps the docked note,
 * and no zoom moves the page to make room for it.
 */
const ZIG_SCENE = {
  version: 1,
  title: 'Two bends',
  defaults: { roughness: 0 },
  elements: [
    PAGE,
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 100, y: 480 },
        { x: 250, y: 150, corner: 'sharp' },
        { x: 400, y: 420 },
        { x: 500, y: 80 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const ZIG_SOURCE = JSON.stringify(ZIG_SCENE, null, 2);

/** The view every 800×560 page here lands in: fitted 1:1 into the 1280×800 window. */
const ZIG: View = { zoom: 1, panX: 240, panY: 120 };

/** On the arrow's first leg, on its ink and clear of the dot halfway along it. */
const ZIG_ON = { x: 125, y: 425 };

/** The peak, whose legs both come down from it, and the dip, whose legs both go up. */
const PEAK = { x: 250, y: 150 };
const DIP = { x: 400, y: 420 };

/**
 * Bare paper: off the page box, above the status bar, clear of every note and of
 * the tool rail's own strip along the top edge.
 */
const PAPER = { x: 1100, y: 40 };

/** On the arrow's first leg, away from every handle: ink that is not a point. */
const ON_INK = { x: 200, y: 260 };

/**
 * A short arrow in the page's lower left, through one sharp bend. It is small and
 * far enough left that a bend carried to the window's own edges leaves the arrow
 * clear of the docked note, so neither the selection nor a pan makes the page
 * move: the bend stays where the pan put it.
 */
const EDGE_SCENE = {
  version: 1,
  title: 'One short bend',
  defaults: { roughness: 0 },
  elements: [
    PAGE,
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 300, y: 440 },
        { x: 450, y: 320, corner: 'sharp' },
        { x: 600, y: 440 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const EDGE_SOURCE = JSON.stringify(EDGE_SCENE, null, 2);

/** On the short arrow's first leg, clear of the dot halfway along it. */
const EDGE_ON = { x: 350, y: 400 };
/** The short arrow's bend, where its handle sits in the view every page lands in. */
const EDGE_BEND = { x: 450, y: 320 };

/**
 * How far the page is carried to put that bend past each edge: a menu that did
 * not make room for itself would hang off the window and lose its words.
 */
const TO_RIGHT = { x: 580, y: 260 };
const TO_BOTTOM = { x: -570, y: 92 };

/** The view each of those pans leaves the page in, and so where the bend draws. */
const RIGHT: View = { zoom: 1, panX: ZIG.panX + TO_RIGHT.x, panY: ZIG.panY + TO_RIGHT.y };
const BOTTOM: View = {
  zoom: 1,
  panX: RIGHT.panX + TO_BOTTOM.x,
  panY: RIGHT.panY + TO_BOTTOM.y,
};

/**
 * The rows' words at each edge, in the pixels they have to keep whole: the panel
 * sits inside the edge, and the box is measured inside the panel it draws, deep
 * enough for both rows so every edge is asked the same question.
 */
const RIGHT_INK: Rect = { x: 1174, y: 708, width: 90, height: 40 };
const BOTTOM_INK: Rect = { x: 708, y: 742, width: 90, height: 40 };

/** The view one zoom-in step leaves the page in: ⌘= zooms around the window's middle. */
const ZIG_ZOOMED: View = { zoom: 1.2, panX: 160, panY: 64 };

/** A line through one round bend, in the same page box, so the handle is a circle. */
const LINE_SCENE = {
  ...ZIG_SCENE,
  title: 'One round bend',
  elements: [
    PAGE,
    {
      id: 'bent',
      type: 'line',
      points: [
        { x: 100, y: 480 },
        { x: 250, y: 150 },
        { x: 400, y: 420 },
      ],
    },
  ],
};
const LINE_SOURCE = JSON.stringify(LINE_SCENE, null, 2);

/**
 * The same arrow in a page whose Elements turn `round`: both bends take the
 * Element's corner, so switching one to `sharp` has to write the point's own and
 * switching it back has to leave the key out.
 */
const ROUND_SCENE = {
  ...ZIG_SCENE,
  title: 'Round corners',
  defaults: { roughness: 0, corners: 'round' },
  elements: [
    PAGE,
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 100, y: 480 },
        { x: 250, y: 150 },
        { x: 400, y: 420 },
        { x: 500, y: 80 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const ROUND_SOURCE = JSON.stringify(ROUND_SCENE, null, 2);

/** The points of `ROUND_SCENE` as the file holds them: neither bend writes a corner. */
const ROUND_POINTS: SavedPoint[] = [
  { x: 100, y: 480 },
  { x: 250, y: 150 },
  { x: 400, y: 420 },
  { x: 500, y: 80 },
];

/**
 * An arrow that leaves a box and comes back to it through one bend: the Scene
 * has such a loop, and the last bend of one cannot be removed.
 */
const LOOP_SCENE = {
  ...ZIG_SCENE,
  title: 'A loop',
  elements: [
    PAGE,
    { id: 'a', type: 'rectangle', x: 300, y: 400, width: 200, height: 100 },
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 400, y: 450, snap: 'a' },
        { x: 400, y: 200, corner: 'sharp' },
        { x: 450, y: 450, snap: 'a' },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const LOOP_SOURCE = JSON.stringify(LOOP_SCENE, null, 2);

/** On the loop's left leg, on its ink and clear of the dot halfway along it. */
const LOOP_ON = { x: 363, y: 350 };
/** The bend between the loop's two Snapped ends, where its handle sits. */
const LOOP_BEND = { x: 400, y: 200 };

/** The arrow of `ZIG_SCENE` with words on it, so a double-click can open them. */
const WORDS_SCENE = {
  ...ZIG_SCENE,
  title: 'With words',
  elements: [PAGE, { ...ZIG_SCENE.elements[1], label: 'bend words' }],
};
const WORDS_SOURCE = JSON.stringify(WORDS_SCENE, null, 2);

/** One point of a shaft as the editor saved it: every field a bend may carry. */
interface SavedPoint {
  x: number;
  y: number;
  snap?: string;
  corner?: string;
}

/** The points of `ZIG_SCENE` as the file holds them. */
const ZIG_POINTS: SavedPoint[] = [
  { x: 100, y: 480 },
  { x: 250, y: 150, corner: 'sharp' },
  { x: 400, y: 420 },
  { x: 500, y: 80 },
];

/** The points of `LOOP_SCENE`, which a menu row may not change. */
const LOOP_POINTS: SavedPoint[] = [
  { x: 400, y: 450, snap: 'a' },
  { x: 400, y: 200, corner: 'sharp' },
  { x: 450, y: 450, snap: 'a' },
];

/** One folder of fixtures per test: the Scenes each test opens by name. */
const SCENES = {
  A: {
    'zig.json': ZIG_SOURCE,
    'line.json': LINE_SOURCE,
    'corners.json': ROUND_SOURCE,
    'loop.json': LOOP_SOURCE,
    'words.json': WORDS_SOURCE,
    'edge.json': EDGE_SOURCE,
  },
};

/** Open one of the fixtures above. */
async function open(ui: Ui, name = 'zig.json'): Promise<void> {
  await openEditor(ui, SCENES, name);
  await expect(ui.screen.getByRole('status')).toHaveText('saved');
}

/** The menu itself, by the role a screen reader reads and the name it gives itself. */
function menu(ui: Ui) {
  return ui.screen.getByRole('menu', 'Bend point');
}

/** The menu's removal, the row it opens on. */
function deletePoint(ui: Ui) {
  return ui.screen.getByRole('menuitem', 'Delete point');
}

/** The menu's corner row, named for the corner it would switch the point to. */
function cornerRow(ui: Ui, corner: 'Round' | 'Sharp') {
  return ui.screen.getByRole('menuitem', `${corner} corner`);
}

/** The points of the shaft a saved Scene holds, or null where it has no shaft. */
function pointsOf(scene: SavedScene): SavedPoint[] | null {
  const shaft = scene.elements.find((element) => element.points !== undefined);
  return (shaft?.points as SavedPoint[] | undefined) ?? null;
}

/** Where a Scene point lands on the page, as the page is now. */
function pagePoint(point: Point, view: View = ZIG): Point {
  return at(point, view);
}

/**
 * Select the shaft the way a person does, and wait for the handles it draws:
 * a press repaints on the frame after it, and the handle is what a secondary
 * press lands on.
 */
async function selectShaft(ui: Ui, on: Point = ZIG_ON, view: View = ZIG): Promise<void> {
  await clickScene(ui, on, [], view);
  await settle(ui);
}

/**
 * The secondary press a person makes with the right button, on a Scene point:
 * Playwright's own mouse, because the page's fixture presses the primary button
 * only.
 */
async function rightClick(ui: Ui, point: Point, view: View = ZIG): Promise<void> {
  const where = pagePoint(point, view);
  await livePage().mouse.click(where.x, where.y, { button: 'right' });
}

/** A press, a Space pan and its frames: the page moves by `by` page pixels. */
async function panBy(ui: Ui, from: Point, by: Point): Promise<void> {
  await ui.browser.keyboard.down('Space');
  await drag(ui, from, { x: from.x + by.x, y: from.y + by.y });
  await ui.browser.keyboard.up('Space');
  await settle(ui);
}

/** A Ctrl+click, which macOS reads as the same secondary press. */
async function ctrlClick(ui: Ui, point: Point, view: View = ZIG): Promise<void> {
  const where = pagePoint(point, view);
  const keyboard = livePage().keyboard;
  await keyboard.down('Control');
  await livePage().mouse.click(where.x, where.y);
  await keyboard.up('Control');
}

/** The pixels a bend's own mark paints in, inside its 8px handle. */
function atHandle(point: Point, view: View = ZIG): Rect {
  const where = pagePoint(point, view);
  return { x: where.x - 2, y: where.y - 2, width: 4, height: 4 };
}

/**
 * The one pixel at a square handle's lower right corner: inside the square's
 * fill, and beyond the reach of a circle of the same size.
 */
function handleCorner(point: Point, view: View = ZIG): Rect {
  const where = pagePoint(point, view);
  return { x: where.x + 3, y: where.y + 3, width: 1, height: 1 };
}

/** The ink of the rows' words, inside a panel the pointer put at `where`. */
function rowInk(where: Point): Rect {
  // Inside the panel's padding and deep enough for both of its rows: the panel's
  // border and the shadow below it are dark enough to be counted, and they are
  // not words.
  return { x: where.x + 8, y: where.y + 8, width: 90, height: 40 };
}

describe('the point menu', () => {
  test('a right-click on a sharp bend point picks it and opens its menu by the pointer', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    // A click on the ink selects the arrow, and the point's own handle with it:
    // no menu is open yet, and the handle is the paper's colour.
    await selectShaft(ui);
    await expect(menu(ui)).toBeHidden();
    await settle(ui);
    expect((await shot(ui)).meanLuminance(atHandle(PEAK))).toBeGreaterThan(0.8);

    await rightClick(ui, PEAK);

    // The menu is there with its one row, and the point it is for is filled with
    // the selection's colour: the mark reads as the goods the row acts on.
    await expect(menu(ui)).toBeVisible();
    await expect(deletePoint(ui)).toBeVisible();
    await settle(ui);
    expect((await shot(ui)).meanLuminance(atHandle(PEAK))).toBeLessThan(0.6);

    // A press in the panel's own margin belongs to the menu: a menu put anywhere
    // else would have read it as a press outside, and shut.
    const where = pagePoint(PEAK);
    await screen.tapAt({ x: where.x + 4, y: where.y + 4 });
    await expect(menu(ui)).toBeVisible();

    // Opening the menu is not a change: the Scene still holds both bends.
    expect(pointsOf(await savedScene(ui, 'zig.json'))).toEqual(ZIG_POINTS);
  });

  test('a right-click on a round point of a line opens the same menu', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'line.json');

    // The line's bend is its own peak: the same press, on a circle instead of a
    // square, has to offer the same row.
    await selectShaft(ui);
    await expect(menu(ui)).toBeHidden();
    await rightClick(ui, PEAK);

    await expect(menu(ui)).toBeVisible();
    await expect(deletePoint(ui)).toBeVisible();
  });

  test('a press that shuts a note leaves the keys with the menu it opened', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    const sheet = ui.screen.getByRole('dialog', 'Shortcuts');

    // The sheet over the shaft, so the press below is one outside a note, and
    // the handle the press aims at is drawn under it.
    await selectShaft(ui);
    await screen.getByRole('button', 'Shortcuts').click();
    await expect(sheet).toBeVisible();

    // The secondary press on the peak shuts the sheet and opens the menu over
    // the point: where the press was aimed is where the keys have to be.
    await rightClick(ui, PEAK);
    await expect(sheet).toBeHidden();
    await expect(menu(ui)).toBeVisible();

    // Escape is the menu's, as it is when no note was over it: a note shutting
    // cannot take the keys from the press's own destination.
    await browser.keyboard.press('Escape');
    await expect(menu(ui)).toBeHidden();
  });

  test('the corner row switches a round point sharp and back round', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'corners.json');
    await selectShaft(ui);

    await rightClick(ui, PEAK);

    // Two rows, and the upper one names the corner this point would switch to:
    // it takes the Element's round corner today, so what it offers is `sharp`.
    await expect(menu(ui)).toBeVisible();
    await expect(cornerRow(ui, 'Sharp')).toBeVisible();
    await expect(deletePoint(ui)).toBeVisible();

    // The arrows reach the row above the one the menu opens on, and Enter runs
    // the row that holds the keys. The point's own corner is written, because it
    // is not the Element's, and every other point is left as it was.
    await browser.keyboard.press('ArrowUp');
    await browser.keyboard.press('Enter');
    await expect(menu(ui)).toBeHidden();
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect(pointsOf(await savedScene(ui, 'corners.json'))).toEqual([
      ROUND_POINTS[0],
      { x: 250, y: 150, corner: 'sharp' },
      ROUND_POINTS[2],
      ROUND_POINTS[3],
    ]);

    // The same point again: the row named the corner it came from, and running it
    // leaves the key out, because round is the Element's own corner after all.
    await rightClick(ui, PEAK);
    await expect(cornerRow(ui, 'Round')).toBeVisible();
    await browser.keyboard.press('ArrowUp');
    await browser.keyboard.press('Enter');
    await expect(menu(ui)).toBeHidden();
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect(pointsOf(await savedScene(ui, 'corners.json'))).toEqual(ROUND_POINTS);
  });

  test('the corner row on a point of a sharp Element writes round and then drops it', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await selectShaft(ui);

    // The dip writes no corner and its Element is `sharp`, so the row offers the
    // other one; taking it writes the point's own corner.
    await rightClick(ui, DIP);
    await expect(cornerRow(ui, 'Round')).toBeVisible();
    await browser.keyboard.press('ArrowUp');
    await browser.keyboard.press('Enter');
    await expect(menu(ui)).toBeHidden();
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect(pointsOf(await savedScene(ui, 'zig.json'))).toEqual([
      ZIG_POINTS[0],
      ZIG_POINTS[1],
      { x: 400, y: 420, corner: 'round' },
      ZIG_POINTS[3],
    ]);

    // And back: sharp is the Element's own corner, so the point writes none.
    await rightClick(ui, DIP);
    await expect(cornerRow(ui, 'Sharp')).toBeVisible();
    await browser.keyboard.press('ArrowUp');
    await browser.keyboard.press('Enter');
    await expect(menu(ui)).toBeHidden();
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect(pointsOf(await savedScene(ui, 'zig.json'))).toEqual(ZIG_POINTS);
  });

  test('undo takes a switched corner back, and redo switches it again', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'corners.json');
    await selectShaft(ui);

    await rightClick(ui, PEAK);
    await browser.keyboard.press('ArrowUp');
    await browser.keyboard.press('Enter');
    await expect(menu(ui)).toBeHidden();
    const switched = [
      ROUND_POINTS[0],
      { x: 250, y: 150, corner: 'sharp' },
      ROUND_POINTS[2],
      ROUND_POINTS[3],
    ];
    expect(pointsOf(await savedScene(ui, 'corners.json'))).toEqual(switched);

    // One step, so one undo puts the corner the point wrote back to none at all.
    await browser.keyboard.press('Meta+z');
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect(pointsOf(await savedScene(ui, 'corners.json'))).toEqual(ROUND_POINTS);

    await browser.keyboard.press('ControlOrMeta+Shift+z');
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect(pointsOf(await savedScene(ui, 'corners.json'))).toEqual(switched);
  });

  test('the arrow keys move between the rows, and Enter runs the one it is on', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'corners.json');
    await selectShaft(ui);

    // The menu opens on the removal, the row Enter ran when it was the only one.
    // Up is the corner row and down is the removal again: the point the removal
    // is for goes, and no corner is touched.
    await rightClick(ui, PEAK);
    await expect(menu(ui)).toBeVisible();
    await browser.keyboard.press('ArrowUp');
    await expect(cornerRow(ui, 'Sharp')).toBeVisible();
    await browser.keyboard.press('ArrowDown');
    await browser.keyboard.press('Enter');
    await expect(menu(ui)).toBeHidden();
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect(pointsOf(await savedScene(ui, 'corners.json'))).toEqual([
      ROUND_POINTS[0],
      ROUND_POINTS[2],
      ROUND_POINTS[3],
    ]);
  });

  test('the handle is a circle on a round point and a square once it turns sharp', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'corners.json');
    await selectShaft(ui);

    // The press picks the point, and it stays picked once the menu shuts, so the
    // mark is filled and the shape it draws is what the pixels are measured on. A
    // circle of this size leaves its lower right corner as paper (0.90 here), and
    // a square fills it with the selection's colour (0.35): the threshold sits
    // between them, clear of either drawing's antialiasing.
    await rightClick(ui, PEAK);
    await browser.keyboard.press('Escape');
    await expect(menu(ui)).toBeHidden();
    await settle(ui);
    expect((await shot(ui)).meanLuminance(handleCorner(PEAK))).toBeGreaterThan(0.8);

    // Switched sharp, the same mark inks the corner the circle could not reach.
    await rightClick(ui, PEAK);
    await browser.keyboard.press('ArrowUp');
    await browser.keyboard.press('Enter');
    await expect(menu(ui)).toBeHidden();
    await settle(ui);
    expect((await shot(ui)).meanLuminance(handleCorner(PEAK))).toBeLessThan(0.55);
  });

  test('the menu stays inside the editor at its right and bottom edges', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'edge.json');
    await selectShaft(ui, EDGE_ON);

    // The bend away from every edge: the row's words, whole, with nothing making
    // room for them. This is the ink both edges have to show just the same.
    await rightClick(ui, EDGE_BEND);
    await expect(menu(ui)).toBeVisible();
    await settle(ui);
    const whole = (await shot(ui)).darkBounds(
      rowInk(pagePoint(EDGE_BEND)),
      0.6,
    );
    if (whole === null) {
      throw new Error('the menu painted no words over the paper');
    }
    await browser.keyboard.press('Escape');
    await expect(menu(ui)).toBeHidden();

    // The same bend carried to the window's right edge: a menu that opened at
    // the pointer would hang off the page, and the end of its words with it.
    await panBy(ui, { x: 60, y: 100 }, TO_RIGHT);
    await rightClick(ui, EDGE_BEND, RIGHT);
    await expect(menu(ui)).toBeVisible();
    await settle(ui);
    const right = (await shot(ui)).darkBounds(RIGHT_INK, 0.6);
    if (right === null) {
      throw new Error('the menu at the right edge painted no words at all');
    }
    expect(Math.abs(right.width - whole.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(right.height - whole.height)).toBeLessThanOrEqual(2);
    await browser.keyboard.press('Escape');
    await expect(menu(ui)).toBeHidden();

    // And carried to the bottom edge: the row is whole there too, and it is a row
    // a person can run, so Enter removes the point from it.
    await panBy(ui, { x: 700, y: 150 }, TO_BOTTOM);
    await rightClick(ui, EDGE_BEND, BOTTOM);
    await expect(menu(ui)).toBeVisible();
    await settle(ui);
    const bottom = (await shot(ui)).darkBounds(BOTTOM_INK, 0.6);
    if (bottom === null) {
      throw new Error('the menu at the bottom edge painted no words at all');
    }
    expect(Math.abs(bottom.width - whole.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(bottom.height - whole.height)).toBeLessThanOrEqual(2);

    await browser.keyboard.press('Enter');
    await expect(menu(ui)).toBeHidden();
    expect(pointsOf(await savedScene(ui, 'edge.json'))).toEqual([
      { x: 300, y: 440 },
      { x: 600, y: 440 },
    ]);
  });

  test('a Ctrl+click on a point opens the menu and moves nothing', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await selectShaft(ui);
    await expect(menu(ui)).toBeHidden();

    await ctrlClick(ui, PEAK);

    // The same menu by the same point, and the point where it was: a press the
    // platform reads as a secondary click carries no drag with it.
    await expect(menu(ui)).toBeVisible();
    await settle(ui);
    expect((await shot(ui)).meanLuminance(atHandle(PEAK))).toBeLessThan(0.6);
    expect(pointsOf(await savedScene(ui, 'zig.json'))).toEqual(ZIG_POINTS);
  });

  test('a right-click on the paper opens nothing, and shuts a menu it did not open', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    // The browser's own menu never opens over the paper: the page answers the
    // event by cancelling it, which is the one thing a pixel cannot show.
    await browser.evaluate(() => {
      const seen = window as unknown as { cancelled: boolean };
      seen.cancelled = false;
      document.addEventListener('contextmenu', (event) => {
        seen.cancelled = event.defaultPrevented;
      });
      return true;
    });

    await selectShaft(ui);
    const style = screen.getByRole('dialog', 'Style');
    await expect(style).toBeVisible();

    // A secondary press on the ink, away from the handle: nothing opens, and
    // nothing about the selection changes either.
    await livePage().mouse.click(pagePoint(ON_INK).x, pagePoint(ON_INK).y, { button: 'right' });
    await expect(menu(ui)).toBeHidden();
    await expect(style).toBeVisible();
    const cancelled = await browser.evaluate(
      () => (window as unknown as { cancelled: boolean }).cancelled,
    );
    expect(cancelled).toBe(true);
    expect(pointsOf(await savedScene(ui, 'zig.json'))).toEqual(ZIG_POINTS);

    // With a menu open, the same press shuts it and leaves the arrow alone: it
    // is the one thing a right-click away from a point does.
    await rightClick(ui, PEAK);
    await expect(menu(ui)).toBeVisible();
    await livePage().mouse.click(pagePoint(ON_INK).x, pagePoint(ON_INK).y, { button: 'right' });
    await expect(menu(ui)).toBeHidden();
    await expect(style).toBeVisible();
    expect(pointsOf(await savedScene(ui, 'zig.json'))).toEqual(ZIG_POINTS);
  });

  test('only the connected editor cancels the browser menu after DOM moves', async ({
    app,
    browser,
    screen,
  }) => {
    await open({ app, browser, screen });

    const cancelled = await browser.evaluate(({ x, y }: { x: number; y: number }) => {
      const paper = document.elementFromPoint(x, y);
      const editor = paper?.closest('esbozo-editor');
      const host = editor?.parentElement;
      if (!paper || !editor || !host) {
        throw new Error('No editor paper at the click point');
      }
      // A detached target cannot receive a real click, but it can still cancel an event.
      const menuCancelled = () =>
        !paper.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      const answers = [menuCancelled()];
      for (let move = 0; move < 2; move += 1) {
        editor.remove();
        answers.push(menuCancelled());
        host.append(editor);
        answers.push(menuCancelled());
      }
      return answers;
    }, { ...pagePoint(ON_INK) });

    expect(cancelled).toEqual([true, false, true, false, true]);
  });

  test('a point a self-loop must keep is offered as a disabled row', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'loop.json');
    await selectShaft(ui, LOOP_ON);

    const before = (await savedScene(ui, 'loop.json')).elements;

    await rightClick(ui, LOOP_BEND);

    // The point is the menu's, and the row says what it cannot do: a removed
    // point would leave a two-point loop, so the Scene keeps the arrow.
    await expect(menu(ui)).toBeVisible();
    await expect(deletePoint(ui)).toBeDisabled();
    await browser.keyboard.press('Enter');
    await expect(menu(ui)).toBeVisible();
    expect(pointsOf(await savedScene(ui, 'loop.json'))).toEqual(LOOP_POINTS);
    expect((await savedScene(ui, 'loop.json')).elements).toEqual(before);
  });

  test('Delete point removes the point, as one step with one save', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await selectShaft(ui);

    await rightClick(ui, DIP);
    await expect(menu(ui)).toBeVisible();
    await expect(deletePoint(ui)).toBeEnabled();

    // Enter runs the row the menu holds. The point goes, the shaft keeps the
    // selection, and the file that lands is the remaining three points in order.
    await browser.keyboard.press('Enter');
    await expect(menu(ui)).toBeHidden();
    await expect(screen.getByRole('status')).toHaveText('saved');
    await expect(screen.getByRole('dialog', 'Style')).toBeVisible();
    expect(pointsOf(await savedScene(ui, 'zig.json'))).toEqual([
      ZIG_POINTS[0],
      ZIG_POINTS[1],
      ZIG_POINTS[3],
    ]);

    // One step, not one per point: the undo the editor offers puts the whole
    // point back, in the place it held.
    await browser.keyboard.press('Meta+z');
    expect(pointsOf(await savedScene(ui, 'zig.json'))).toEqual(ZIG_POINTS);
  });

  test('Escape shuts only the menu, and Backspace then removes the point', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await selectShaft(ui);
    await rightClick(ui, PEAK);
    await expect(menu(ui)).toBeVisible();

    // Escape is the menu's own: the point it was for is still the selection's,
    // drawn filled, and the shaft's note is still there.
    await browser.keyboard.press('Escape');
    await expect(menu(ui)).toBeHidden();
    await settle(ui);
    expect((await shot(ui)).meanLuminance(atHandle(PEAK))).toBeLessThan(0.6);
    await expect(screen.getByRole('dialog', 'Style')).toBeVisible();

    // The keys are the editor's again, and the point they act on is the same one.
    await browser.keyboard.press('Backspace');
    expect(pointsOf(await savedScene(ui, 'zig.json'))).toEqual([
      ZIG_POINTS[0],
      ZIG_POINTS[2],
      ZIG_POINTS[3],
    ]);
  });

  test('no key edits the Scene while the menu is open', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await selectShaft(ui);
    await rightClick(ui, PEAK);
    await expect(menu(ui)).toBeVisible();

    // The menu holds the keys: the ones that would remove the point, take an
    // edit back or paste one do nothing at all, and the menu stays open on it.
    await browser.keyboard.press('Backspace');
    await browser.keyboard.press('Delete');
    await browser.keyboard.press('Meta+z');
    await browser.keyboard.press('Meta+v');
    await expect(menu(ui)).toBeVisible();
    expect(pointsOf(await savedScene(ui, 'zig.json'))).toEqual(ZIG_POINTS);
    await settle(ui);
    expect((await shot(ui)).meanLuminance(atHandle(PEAK))).toBeLessThan(0.6);
  });

  test('Space runs no row, on either of them', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await selectShaft(ui);

    // The menu opens on the removal, which is a button the browser's own Space
    // would press. The menu holds the key instead: the point stays, nothing is
    // written, and the menu is still open on it.
    await rightClick(ui, PEAK);
    await expect(deletePoint(ui)).toBeVisible();
    await browser.keyboard.press('Space');
    await expect(menu(ui)).toBeVisible();
    expect(pointsOf(await savedScene(ui, 'zig.json'))).toEqual(ZIG_POINTS);

    // And on the corner row: the keys move there, and Space still does nothing.
    await browser.keyboard.press('ArrowUp');
    await browser.keyboard.press('Space');
    await expect(menu(ui)).toBeVisible();
    expect(pointsOf(await savedScene(ui, 'zig.json'))).toEqual(ZIG_POINTS);
  });

  test('Tab is no way out of the menu, and Escape still shuts it', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await selectShaft(ui);

    // The keys stay in the menu, so Escape still shuts it and leaves the point it
    // was for selected.
    await rightClick(ui, PEAK);
    await expect(menu(ui)).toBeVisible();
    await browser.keyboard.press('Tab');
    await browser.keyboard.press('Escape');
    await expect(menu(ui)).toBeHidden();
    await settle(ui);
    expect((await shot(ui)).meanLuminance(atHandle(PEAK))).toBeLessThan(0.6);
    expect(pointsOf(await savedScene(ui, 'zig.json'))).toEqual(ZIG_POINTS);

    // The same in the other direction, on a fresh open.
    await rightClick(ui, PEAK);
    await expect(menu(ui)).toBeVisible();
    await browser.keyboard.press('Shift+Tab');
    await browser.keyboard.press('Escape');
    await expect(menu(ui)).toBeHidden();
    expect(pointsOf(await savedScene(ui, 'zig.json'))).toEqual(ZIG_POINTS);
  });

  test('a press on a row runs it, as Enter does', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'corners.json');
    await selectShaft(ui);

    // The corner row by the pointer is the switch Enter makes on it: the point's
    // own corner is written, and the menu shuts on the way.
    await rightClick(ui, PEAK);
    await expect(cornerRow(ui, 'Sharp')).toBeVisible();
    await cornerRow(ui, 'Sharp').click();
    await expect(menu(ui)).toBeHidden();
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect(pointsOf(await savedScene(ui, 'corners.json'))).toEqual([
      ROUND_POINTS[0],
      { x: 250, y: 150, corner: 'sharp' },
      ROUND_POINTS[2],
      ROUND_POINTS[3],
    ]);

    // And the removal by the pointer, on the point the next press is for.
    await rightClick(ui, PEAK);
    await expect(deletePoint(ui)).toBeEnabled();
    await deletePoint(ui).click();
    await expect(menu(ui)).toBeHidden();
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect(pointsOf(await savedScene(ui, 'corners.json'))).toEqual([
      ROUND_POINTS[0],
      ROUND_POINTS[2],
      ROUND_POINTS[3],
    ]);
  });

  test('a press outside shuts the menu and still does its own job', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await selectShaft(ui);
    const style = screen.getByRole('dialog', 'Style');

    // A click on the paper is still the click it was: it shuts the menu, and it
    // takes the selection away with the note.
    await rightClick(ui, PEAK);
    await expect(menu(ui)).toBeVisible();
    await screen.tapAt(PAPER);
    await expect(menu(ui)).toBeHidden();
    await expect(style).toBeHidden();

    // A tool is still the tool it was: the press that arms it shuts the menu too.
    await selectShaft(ui);
    await rightClick(ui, PEAK);
    await expect(menu(ui)).toBeVisible();
    const arrowTool = screen.getByRole('button', { name: 'Arrow' });
    await arrowTool.click();
    await expect(menu(ui)).toBeHidden();
    await expect(arrowTool).toHaveAttribute('aria-pressed', 'true');
  });

  test('the wheel zooms and shuts the menu with it', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await selectShaft(ui);
    await rightClick(ui, PEAK);
    await expect(menu(ui)).toBeVisible();

    // A zoom moves the page under the menu: it is no longer a place beside the
    // point it was opened on, so it goes rather than pointing at the wrong ink.
    const zoom = screen.getByText(/^\d+%$/);
    await expect(zoom).toHaveText('100%');
    await browser.mouse.move(PAPER.x, PAPER.y);
    await browser.mouse.wheel(0, -120);
    await expect(menu(ui)).toBeHidden();
    await expect(zoom).not.toHaveText('100%');
  });

  test('a right-click finds the handle at a zoom other than one', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await selectShaft(ui);

    // The page at 120%: the handle is still drawn on its point, at the size a
    // press can take, and the menu opens where the pointer put it.
    await browser.keyboard.press('Meta+=');
    await expect(screen.getByText(/^\d+%$/)).toHaveText('120%');
    await settle(ui);
    await rightClick(ui, PEAK, ZIG_ZOOMED);

    await expect(menu(ui)).toBeVisible();
    await settle(ui);
    expect((await shot(ui)).meanLuminance(atHandle(PEAK, ZIG_ZOOMED))).toBeLessThan(0.6);
  });

  test('a page that may only read opens no menu', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await selectShaft(ui);

    // An edit asks the folder to write and the folder answers `403`: from now on
    // the page may only read, and the arrow keeps its selection and its handles.
    await holdWrites(ui, 'zig.json');
    await browser.keyboard.press('Shift+ArrowRight');
    await refuseWrite(ui, 'this folder is served read-only');
    await expect(screen.getByText('read-only')).toBeVisible();
    await allowWrites(ui);
    await settle(ui);

    // The same press on the handle the nudge carried: the mark is drawn, and the
    // menu that could change the Scene is not.
    await rightClick(ui, { x: PEAK.x + 10, y: PEAK.y });
    await expect(menu(ui)).toBeHidden();
    const source = (await savedFiles(ui))['zig.json'];
    expect(pointsOf(JSON.parse(source ?? '') as SavedScene)).toEqual(ZIG_POINTS);
  });

  test('a right-click while words are typed does what it did before', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'words.json');

    // A double-click on the arrow opens its Label, and the field holds the keys.
    await doubleClickScene(ui, ZIG_ON, ZIG);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await expect(label).toBeVisible();

    // A press on the canvas takes the focus off the field, so the words are
    // committed and the field goes with them: the press's own doing, on a page
    // with a menu or without one. What the menu owes it is to open nothing over
    // the words that were still open when it landed.
    await rightClick(ui, PEAK);
    await expect(menu(ui)).toBeHidden();
    await expect(label).toBeHidden();
    expect((await savedScene(ui, 'words.json')).elements[1]?.label).toBe('bend words');
  });
});
