/**
 * Browser seam: the view — Space and the wheel, a middle drag, the dot Grid, the tool
 * rail the page hangs the view's own chrome on, and the docked note the view has
 * to pan and zoom clear of. Asserted on where the ink lands and on the Scene,
 * which a pan must leave alone.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  EDGE,
  EDGE_1366,
  EDGE_SCENE,
  LONG_1366,
  LONG_SCENE,
  SHAFT,
  SHAFT_SCENE,
  WIDE_1366,
  WIDE_SCENE,
  at,
  clickScene,
  drag,
  settle,
  openEditor,
  VIEW,
  saveSettled,
  savedFiles,
  savedScene,
} from './helpers.ts';
import type { Point, Ui } from './helpers.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';
import { SCENE_SOURCE, GRID, command, control, fullInk, palette, zoomReadout } from './editor-shared.ts';

const EDGE_SOURCE = JSON.stringify(EDGE_SCENE, null, 2);

const WIDE_SOURCE = JSON.stringify(WIDE_SCENE, null, 2);
const LONG_SOURCE = JSON.stringify(LONG_SCENE, null, 2);

const SHAFT_SOURCE = JSON.stringify(SHAFT_SCENE, null, 2);

/** Both Elements and the space between them, clear of the rail and the status. */
const BOTH: Rect = { x: 400, y: 250, width: 700, height: 400 };

async function zoomPercent(ui: Ui): Promise<number> {
  return Number((await zoomReadout(ui).textContent())?.replace('%', ''));
}

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

/**
 * One filled box, alone on the page: however far the page pans, the only ink a
 * region can hold is this box's own, and a press that drew would be the second
 * Element the Scene never had.
 */
const LONE_SCENE = {
  version: 1,
  title: 'Lone box',
  defaults: { roughness: 1 },
  elements: [
    {
      id: 'lone',
      type: 'rectangle',
      x: 40,
      y: 40,
      width: 200,
      height: 160,
      fill: { kind: 'solid', grey: 6 },
    },
  ],
};
const LONE_SOURCE = JSON.stringify(LONE_SCENE, null, 2);

/** The view `LONE_SCENE` lands in: the page fitted with an 80px margin, 1:1. */
const LONE = { zoom: 1, panX: 500, panY: 280 };

/** Where `LONE_SCENE`'s box sits on the page, with room for a 20×30 pan. */
const LONE_BOX: Rect = { x: 510, y: 300, width: 280, height: 230 };

/** Where a pan presses on bare canvas, and how far it carries the page. */
const PAN_FROM: Point = { x: 300, y: 650 };
const PAN_TO: Point = { x: 320, y: 680 };
const PAN_BY: Point = { x: 20, y: 30 };

/**
 * Where a Rectangle preview would paint: the band the pointer sweeps, with the
 * pan under it, and clear of the lone box's ink before and after.
 */
const PREVIEW_AREA: Rect = { x: 288, y: 638, width: 64, height: 70 };

/**
 * A middle press on the bare canvas carried to `PAN_TO` and released, which is
 * how a person pans: the box moves exactly as far as the pointer did. `whileDown`
 * runs with the middle button still down and the page already carried.
 */
async function panLoneBox(ui: Ui, whileDown?: () => Promise<void>): Promise<void> {
  const start = (await shot(ui)).darkCentre(LONE_BOX, 0.6);
  expect(start.count).toBeGreaterThan(0);

  await drag(ui, PAN_FROM, PAN_TO, 'middle', whileDown);

  const panned = (await shot(ui)).darkCentre(LONE_BOX, 0.6);
  expect(panned.x).toBeCloseTo(start.x + PAN_BY.x, 0);
  expect(panned.y).toBeCloseTo(start.y + PAN_BY.y, 0);
}

/**
 * A middle press also has to keep the browser's own autoscroll from starting.
 * Headless Chromium has none to show: a real middle press on a page that can
 * scroll leaves it exactly where it was, even with nothing preventing the press,
 * so no test here can tell a suppressed autoscroll from an absent one. The pan
 * tests below cover the half a page can show — the press pans, and a press with
 * a tool armed draws nothing — and `src/editor/gestures.ts` keeps the press for
 * itself, with the reason written beside the `preventDefault`.
 */
test('a middle drag pans under the Select tool and keeps the selection it found', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': LONE_SOURCE } }, 'scene.json');

  // One Element selected: a middle press on the bare canvas has to pan the
  // page, not sweep a box that would drop the selection.
  await clickScene(ui, { x: 140, y: 120 }, [], LONE);
  await settle(ui);
  await panLoneBox(ui);

  // Nothing was drawn: the Scene the editor holds is the one it opened.
  expect((await savedFiles(ui))['scene.json']).toBe(LONE_SOURCE);

  // And the press kept the selection it found: a nudge moves the box, which
  // nothing had dropped.
  await browser.keyboard.press('Shift+ArrowRight');
  const scene = await savedScene(ui);
  expect(scene.elements.map((element) => [element.id, element.x])).toEqual([['lone', 50]]);
});

test('a press after a nudge reads the Scene the page holds, not the ink it drew before it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': LONE_SOURCE } }, 'scene.json');

  // `lone` is selected, from a press on the box's own ink.
  await clickScene(ui, { x: 60, y: 60 }, [], LONE);
  await settle(ui);

  // Fifteen nudges carry the box 150 units left, and the press that follows
  // lands on the centre it left behind. A real key and a real press each take a
  // task of their own, so the page paints the box where the Scene has it before
  // the press reads anything; the two are dispatched by hand in one task for
  // that reason, so no frame draws the box the nudges moved.
  const centre = at({ x: 140, y: 120 }, LONE);
  await browser.evaluate(
    (raw) => {
      const point = raw as unknown as { x: number; y: number };
      const board = document.querySelector('esbozo-editor .board')!;
      for (let step = 0; step < 15; step += 1) {
        board.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }),
        );
      }
      for (const type of ['pointerdown', 'pointerup']) {
        board.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            isPrimary: true,
            button: 0,
            clientX: point.x,
            clientY: point.y,
          }),
        );
      }
      return true;
    },
    { x: centre.x, y: centre.y },
  );
  await settle(ui);

  // The box moved the 150 units the nudges asked for, and nothing else did.
  const nudged = await savedScene(ui);
  expect(nudged.elements.map((element) => [element.id, element.x])).toEqual([['lone', -110]]);

  // The press found bare paper where the box used to be, so nothing is
  // selected: a nudge now moves nothing, because the ink the page drew before
  // the nudges is not where a press looks.
  await browser.keyboard.press('Shift+ArrowRight');
  await settle(ui);
  const after = await savedScene(ui);
  expect(after.elements.map((element) => [element.id, element.x])).toEqual([['lone', -110]]);
});

test('a middle drag pans with the Rectangle tool armed and draws nothing', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': LONE_SOURCE } }, 'scene.json');

  // The Rectangle tool is armed, so the canvas is a pencil: a middle press has
  // to pan the page, not sweep a second box into the Scene.
  await browser.keyboard.press('r');
  await settle(ui);
  await panLoneBox(ui, async () => {
    // The button is still down and the pointer has swept: a pencil would have
    // its preview on this paper by now, so bare paper is the pan's answer.
    await settle(ui);
    expect((await shot(ui)).darkCount(PREVIEW_AREA, 0.6)).toBe(0);
  });

  // Nothing was drawn: the box is the only Element the Scene holds.
  expect((await savedFiles(ui))['scene.json']).toBe(LONE_SOURCE);
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

test('the Style note never covers the selection: the view pans clear of it', async ({ app, browser, screen }) => {
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

  await expect(zoomReadout(ui)).toHaveText('100%');

  // A bar wider than everything left of the note: no pan can clear it, so the
  // view zooms out just far enough to show the whole bar beside the note.
  await clickScene(ui, { x: 200, y: 80 }, [], WIDE_1366);
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();
  await expect.poll(() => zoomPercent(ui)).toBeLessThan(100);

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

  const zoom = () => zoomPercent(ui);
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

  // 15,000 units wide: the room left of the note fits it at about 6%, below the
  // 10% a person may zoom to by hand.
  await clickScene(ui, { x: 4000, y: 200 }, [], LONG_1366);
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();
  await expect.poll(() => zoomPercent(ui)).toBeLessThan(10);

  // The whole bar is on the page beside the note, and a zoom is not an edit.
  const BESIDE: Rect = { x: 150, y: 372, width: 700, height: 24 };
  expect((await shot(ui)).darkCount(BESIDE, 0.6)).toBeGreaterThan(12000);
  expect((await savedFiles(ui))['long.json']).toBe(LONG_SOURCE);
});

test('the Style note fits a 1366×768 window', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await ui.browser.setViewport({ width: 1366, height: 768 });
  await openEditor(ui, { A: { 'edge.json': EDGE_SOURCE } }, 'edge.json');

  // A rectangle shows the longest set of rows: look, fill, greys, corners, words.
  await clickScene(ui, { x: 80, y: 70 }, [], EDGE_1366);
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();

  // Every row is offered, the last one included, and the note needed no zoom to
  // make room in this window. That the whole Element fits inside the window is a
  // judgement of the painted page, in `tests/visual.e2e.ts`.
  await expect(control(ui, 'Corners: sharp')).toBeVisible();
  await expect(control(ui, 'Order: front')).toBeVisible();
  await expect(ui.screen.getByText(/^\d+%$/)).toHaveText('100%');
});

// ----------------------------------------- the floating rail and the note's room

/**
 * One filled band the note covers: 900 units wide at 1:1, wider than the room
 * left of the note when the rail would have been a limit, but fitting at 100%
 * against the editor's own left edge.
 */
const CLEAR_SCENE = {
  version: 1,
  title: 'Clear',
  defaults: { roughness: 1 },
  elements: [
    { id: 'band', type: 'rectangle', x: 0, y: 0, width: 900, height: 120, fill: { kind: 'solid', grey: 6 } },
  ],
};
const CLEAR_SOURCE = JSON.stringify(CLEAR_SCENE, null, 2);

/**
 * The band's rows on the page, on the window's own middle: the note and a
 * standing rail at the left edge are centred there too, so this is the room
 * they share.
 */
const BAND_ROWS = { y: 350, height: 100 };

/**
 * Just right of a standing rail placed at the editor's left inset: the rail's
 * outline ends around 68, so this window holds band ink only when the note's
 * left limit ignores the rail.
 */
const RAIL_LIMIT: Rect = { x: 69, y: BAND_ROWS.y, width: 8, height: BAND_ROWS.height };

/**
 * The foot of a standing rail at the left edge, below the rows the band is
 * drawn in: the strip's own ink and nothing else.
 */
const STRIP_FOOT: Rect = { x: 8, y: 470, width: 300, height: 45 };

/**
 * Where the strip's ink reaches: the rail's own place, which opening the note
 * may not change. The pointer stays on the strip, held at full ink, so every
 * measure taken after this reads the rail at that ink.
 */
async function stripInk(ui: Ui): Promise<Rect> {
  await ui.browser.mouse.move(38, 470);
  await fullInk(ui);
  const foot = async (): Promise<Rect | null> => (await shot(ui)).darkBounds(STRIP_FOOT, 0.6);
  await expect.poll(foot, { timeout: 5000 }).not.toBeNull();
  return (await foot())!;
}

/** Place the rail at the editor's left edge through the command palette. */
async function placeRailLeft(ui: Ui): Promise<void> {
  await palette(ui);
  await ui.browser.keyboard.type('tool rail left');
  await expect(command(ui, 'Tool rail: left')).toBeVisible();
  await ui.browser.keyboard.press('Enter');
  await expect(ui.screen.getByRole('dialog', { name: 'Commands' })).toBeHidden();
  await settle(ui);
}

test('the note’s limit ignores the rail, wherever it rests', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'clear.json': CLEAR_SOURCE } }, 'clear.json');
  await ui.browser.keyboard.press('g');
  await settle(ui);
  await placeRailLeft(ui);

  const strip = await stripInk(ui);
  await drag(ui, { x: 600, y: 400 }, { x: 600, y: 400 }, 'left');
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();
  await settle(ui);

  // Opening the note never moves the rail and never edits the Scene.
  expect(await stripInk(ui)).toEqual(strip);
  expect((await savedFiles(ui))['clear.json']).toBe(CLEAR_SOURCE);

  // The Style note no longer makes room for the rail: the view pans to the
  // editor's own left edge at 100% zoom, and the band draws into RAIL_LIMIT.
  expect(await zoomPercent(ui)).toBe(100);
  expect((await shot(ui)).darkCount(RAIL_LIMIT, 0.6)).toBeGreaterThan(500);
});

// -------------------------------------------------------------- the tool rail

/** An empty Scene: bare paper, so a press that landed has ink of its own to show for it. */
const BARE_SOURCE = JSON.stringify({ version: 1, title: 'Empty', defaults: {}, elements: [] }, null, 2);

/** The rail's seven tools, in the order the rail shows them. */
const TILES = ['Select', 'Rectangle', 'Ellipse', 'Diamond', 'Arrow', 'Line', 'Text'];

/** The key that picks each tool, in the same order. */
const KEYS: Array<[string, string]> = [
  ['v', 'Select'],
  ['r', 'Rectangle'],
  ['e', 'Ellipse'],
  ['d', 'Diamond'],
  ['a', 'Arrow'],
  ['s', 'Line'],
  ['t', 'Text'],
];

/** The tool rail, as the accessibility tree offers it. */
function rail(ui: Ui) {
  return ui.screen.getByRole('navigation', { name: 'Tools' });
}

/**
 * The band the strip hangs in, right of the status that sits in the page's top
 * corners: with the Grid off and an empty Scene, the only ink there is the
 * strip's own.
 */
const TOP_BAND: Rect = { x: 300, y: 0, width: 980, height: 200 };

/**
 * The strip's right half while the page is untouched: no tile there is filled
 * with the ink a tool in hand wears, so faint ink is the only ink these pixels
 * can hold. Measured before the strip is looked at, it is a region, not a box.
 */
const RIGHT_HALF: Rect = { x: 644, y: 0, width: 136, height: 90 };

/**
 * Where the strip's ink reaches, with a tile focused so the strip is at full ink:
 * its outline is what the eye sees of where the rail is, and its tilt included.
 */
async function railInk(ui: Ui): Promise<Rect> {
  const bare = async (): Promise<Rect | null> => (await shot(ui)).darkBounds(TOP_BAND, 0.6);
  // The strip comes up from 58% to full ink, its transition and all.
  await rail(ui).getByRole('button', 'Select').focus();
  await expect.poll(async () => (await bare()) !== null, { timeout: 5000 }).toBe(true);
  return (await bare())!;
}

/** An empty Scene with the dot Grid off: bare paper, and the strip's ink alone up top. */
async function openBare(ui: Ui): Promise<void> {
  await openEditor(ui, { A: { 'bare.json': BARE_SOURCE } }, 'bare.json');
  await ui.browser.keyboard.press('g');
  await settle(ui);
}

test('the tool rail runs along the editor top edge, centred, with its tools in order', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);

  const ink = await railInk(ui);

  // Horizontal, not the column it used to be: seven tiles wide, one tile tall.
  expect(ink.width).toBeGreaterThan(ink.height * 2);

  // The strip starts 16 px inside the editor's top edge, lying and centred.
  // The tilt leans the strip, so the outline reaches a couple of pixels higher.
  expect(ink.y, 'the rail rests 16 px inside the top edge').toBeGreaterThan(10);
  expect(ink.y, 'the rail rests 16 px inside the top edge').toBeLessThan(28);

  // Centred: a strip turned about its own middle keeps that middle where it was.
  expect(Math.abs(ink.x + ink.width / 2 - 1280 / 2), 'the rail is centred horizontally').toBeLessThan(3);
  expect(ink.x, 'the rail is centred horizontally').toBeGreaterThan(1280 / 2 - 140);
  expect(ink.x + ink.width, 'the rail is centred horizontally').toBeLessThan(1280 / 2 + 140);

  // Seven tiles, in the rail's order: the accessibility tree lists them left to
  // right, which is the order the horizontal strip shows them in.
  const tiles = await rail(ui).getByRole('button').all();
  expect(tiles.length).toBe(TILES.length);
  const names = await Promise.all(tiles.map((tile) => tile.getAttribute('aria-label')));
  expect(names).toEqual(TILES);
});

test('the rail is faint until it is looked at, and its outline surrounds all seven tools', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);

  // Faint, the strip's washes and glyphs are lighter than the ink a person reads
  // as drawn: the right half of it holds no dark pixel at all.
  const faint = (await shot(ui)).darkCount(RIGHT_HALF, 0.6);
  expect(faint, 'the rail is faint until it is looked at').toBe(0);

  // A tile focused brings the whole strip up to full ink, transition and all.
  const ink = await railInk(ui);
  await expect
    .poll(async () => (await shot(ui)).darkCount(RIGHT_HALF, 0.6), { timeout: 5000 })
    .toBeGreaterThan(100);

  // The pencil outline is a closed strip: ink on each of its four mid-edges, in
  // the padding around the tiles so no glyph of a tool can answer for it.
  const picture = await shot(ui);
  const surround: Array<[string, Rect]> = [
    ['top', { x: ink.x + 40, y: ink.y - 4, width: ink.width - 80, height: 10 }],
    ['bottom', { x: ink.x + 40, y: ink.y + ink.height - 5, width: ink.width - 80, height: 9 }],
    ['left', { x: ink.x - 4, y: ink.y + 10, width: 10, height: ink.height - 20 }],
    ['right', { x: ink.x + ink.width - 6, y: ink.y + 10, width: 10, height: ink.height - 20 }],
  ];
  for (const [side, band] of surround) {
    expect(picture.darkCount(band, 0.6), `the outline is drawn along the ${side} edge`).toBeGreaterThan(0);
  }
});

/**
 * The row of the strip's own padding below an outline that is drawn by hand and
 * so is not level: the first ink the column meets is the outline, and the padding
 * is the row past it. The tiles start below that band, so a press there moves the
 * rail rather than picking a tool with it, and paper just under it is paper a
 * press does not reach.
 */
async function paddingRow(ui: Ui, ink: Rect, x: number): Promise<number> {
  const picture = await shot(ui);
  const column = (row: number): number => picture.darkCount({ x, y: row, width: 8, height: 1 }, 0.6);
  const start = Math.round(ink.y);
  const end = start + 24;
  let row = start;
  while (row < end && column(row) === 0) row += 1;
  while (row < end && column(row) > 0) row += 1;
  return row + 1;
}

test('a press on the rail draws and selects nothing, and the press below it reaches the canvas', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The page is carried so that `a`'s top stroke lies 32 px down, in the strip's
  // own top padding: paper that a press would otherwise find, with the rail over
  // it, and its bottom stroke 80 px lower, clear of the strip's reach.
  let view = { ...VIEW, panX: VIEW.panX + 60, panY: VIEW.panY - 308 };
  await browser.keyboard.down('Space');
  await drag(ui, { x: 600, y: 600 }, { x: 660, y: 292 });
  await browser.keyboard.up('Space');
  await settle(ui);

  // A pencil armed makes the strip's own answer visible: the sweep starts on the
  // padding, which drags the rail to where it is dropped rather than drawing, so
  // the strip moves right and the Scene is the one the editor opened.
  await browser.keyboard.press('r');
  await settle(ui);
  await drag(ui, { x: 600, y: 32 }, { x: 640, y: 32 });
  await settle(ui);
  const stored = JSON.parse((await browser.evaluate(() => localStorage.getItem('esbozo.rail'))) ?? 'null') as {
    x: number;
    y: number;
    orientation: string;
  } | null;
  expect(stored?.orientation, 'the sweep dragged the rail while lying').toBe('lying');
  expect(stored?.x, 'the sweep dragged the rail right').toBeGreaterThan(0.51);
  const moved = await railInk(ui);
  await saveSettled(ui);
  expect((await savedFiles(ui))['scene.json']).toBe(SCENE_SOURCE);

  // Carry `a`'s top stroke under the moved strip's padding, with its bottom
  // stroke clear of the strip.
  const column = Math.round(at({ x: 100, y: 40 }, view).x);
  const padding = await paddingRow(ui, moved, column);
  const drop = Math.round(padding - at({ x: 100, y: 40 }, view).y);
  await browser.keyboard.down('Space');
  await drag(ui, { x: 600, y: 600 }, { x: 600, y: 600 + drop });
  await browser.keyboard.up('Space');
  await settle(ui);
  view = { ...view, panY: view.panY + drop };

  const top = at({ x: 100, y: 40 }, view);
  const bottom = at({ x: 100, y: 120 }, view);

  // The page carries `a`'s top stroke under that padding now: the ink left of
  // the strip, level with the padding row, is the paper's own.
  const carried = await shot(ui);
  expect(
    carried.darkCount({ x: 552, y: padding - 1, width: 22, height: 3 }, 0.6),
    'the paper lies under the strip padding',
  ).toBeGreaterThan(0);

  // Select in hand, the press on the strip's own padding selects nothing,
  // though `a`'s top stroke is under it.
  await browser.keyboard.press('v');
  await settle(ui);
  const onPadding = { x: Math.round(top.x), y: padding };
  await drag(ui, onPadding, onPadding, 'left');
  await settle(ui);
  await expect(screen.getByRole('dialog', 'Style')).toBeHidden();

  // The same press a little lower, clear of the strip, reaches that stroke.
  const onStroke = { x: Math.round(bottom.x), y: Math.round(bottom.y) };
  await drag(ui, onStroke, onStroke, 'left');
  await expect(screen.getByRole('dialog', 'Style')).toBeVisible();

  // Two presses on a stroke and a sweep with a pencil: neither edited the Scene.
  await saveSettled(ui);
  expect((await savedFiles(ui))['scene.json']).toBe(SCENE_SOURCE);
});

test('V R E D A S T and 1–7 pick the rail tools with the rail at the top', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openBare(ui);

  // Each letter and each digit marks the one tile the rail names for that tool,
  // so the keys and the rail read one list in one order.
  for (const [key, tool] of KEYS) {
    await browser.keyboard.press(key);
    await expect(screen.getByRole('button', { name: tool }), `${key} picks ${tool}`).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  for (const [index, tool] of TILES.entries()) {
    await browser.keyboard.press(String(index + 1));
    await expect(screen.getByRole('button', { name: tool }), `${index + 1} picks ${tool}`).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }

  // And a tool picked by its key still draws on the paper the strip leaves free.
  await browser.keyboard.press('4');
  await drag(ui, { x: 560, y: 200 }, { x: 660, y: 280 });
  const scene = await savedScene(ui, 'bare.json');
  expect(scene.elements.map((element) => element.type)).toEqual(['diamond']);
});
