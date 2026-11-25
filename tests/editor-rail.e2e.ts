/**
 * Browser seam: where the tool rail rests on the editor's screen and how a drag
 * moves it.
 *
 * The rail floats on the editor's box — top-middle, lying, 16 px in on a fresh
 * start — and follows the pointer live past the click slop, resting where
 * dropped with its orientation set by the box's corner-to-corner diagonals.
 * Asserted on the ink a screenshot holds and the stored place, never on a box
 * the page reports.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  openEditor,
  drag,
  savedFiles,
  savedScene,
  settle,
  holdWrites,
  allowWrites,
  releaseWrite,
  refuseWrite,
} from './helpers.ts';
import type { Ui } from './helpers.ts';
import { fullInk } from './editor-shared.ts';
import { blurPage, cancelTouch, livePage, touchCarry } from './cdp.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';

/** An empty Scene: bare paper, so the only ink up top is the strip's own. */
const BARE_SOURCE = JSON.stringify(
  { version: 1, title: 'Empty', defaults: {}, elements: [] },
  null,
  2,
);

/** A diagram larger than the frame's minimum, with room around it on every side. */
const BIG_SOURCE = JSON.stringify(
  {
    version: 1,
    title: 'Big',
    defaults: { roughness: 0 },
    elements: [
      { id: 'big', type: 'rectangle', x: 40, y: 40, width: 1000, height: 700, fill: { kind: 'solid', grey: 6 } },
    ],
  },
  null,
  2,
);

/** A diagram's box on screen at 3440×1440, used to verify a palette move leaves the view alone. */
const BIG_BOX: Rect = { x: 1210, y: 470, width: 1020, height: 200 };

/** The tool rail, as the accessibility tree offers it. */
function rail(ui: Ui) {
  return ui.screen.getByRole('navigation', { name: 'Tools' });
}

/** The seven tiles, in rail order: the order the strip draws them in on any side. */
const TILES = ['Select', 'Rectangle', 'Ellipse', 'Diamond', 'Arrow', 'Line', 'Text'];

/**
 * How long a tile's press waits to reach that tile. A press lands on the tile's own
 * middle, so chrome hanging over it keeps the pointer off it until this runs out.
 */
const PRESS_TIMEOUT = 2000;

/** Move the rail to an edge by name, the way a person does through the palette. */
async function placeRailAtEdge(ui: Ui, side: 'top' | 'bottom' | 'left' | 'right'): Promise<void> {
  const commands = ui.screen.getByRole('dialog', { name: 'Commands' });
  await ui.browser.keyboard.press('q');
  await expect(commands).toBeVisible();
  await ui.browser.keyboard.type(`tool rail ${side}`);
  await ui.browser.keyboard.press('Enter');
  await expect(commands).toBeHidden();
  await settle(ui);
}

/** Where the page hung the rail: the strip's middle, its top edge and its size. */
interface Place {
  centreX: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The strip's ink inside a band, as a place. The look turns the strip about its
 * middle, so a couple of pixels either way is the tilt and not the place; a band
 * keeps every other mark on the page out of the measure.
 */
async function railPlace(ui: Ui, band: Rect): Promise<Place> {
  const ink = await railInk(ui, band);
  return { centreX: ink.x + ink.width / 2, top: ink.y, width: ink.width, height: ink.height };
}

/** A place an action must not have changed, within the tilt's own slack. */
function expectHeld(before: Place, after: Place, action: string): void {
  expect(Math.abs(after.centreX - before.centreX), `${action} left the rail's middle`).toBeLessThan(3);
  expect(Math.abs(after.top - before.top), `${action} left the rail's top`).toBeLessThan(3);
  expect(Math.abs(after.width - before.width), `${action} left the rail's width`).toBeLessThan(3);
  expect(Math.abs(after.height - before.height), `${action} left the rail's height`).toBeLessThan(3);
}

/**
 * Where the strip's ink reaches inside a band, with a tile focused so the strip
 * is drawn at full ink: its outline is what the eye sees of where the rail is,
 * and the band keeps the status in the corners and any diagram below it out.
 */
async function railInk(ui: Ui, band: Rect): Promise<Rect> {
  await rail(ui).getByRole('button', 'Select').focus();
  await fullInk(ui);
  const ink = async (): Promise<Rect | null> => (await shot(ui)).darkBounds(band, 0.6);
  await expect.poll(async () => (await ink()) !== null, { timeout: 5000 }).toBe(true);
  return (await ink())!;
}

/** The stored rail place, or null while the page keeps none. */
interface StoredPlace {
  x: number;
  y: number;
  orientation: 'lying' | 'standing';
}

/** The place the page keeps for the next start, or null while it keeps none. */
async function keptPlace(ui: Ui): Promise<StoredPlace | null> {
  const raw = await ui.browser.evaluate(() => localStorage.getItem('esbozo.rail'));
  return raw === null ? null : (JSON.parse(raw) as StoredPlace);
}

/**
 * Record what the page throws, from its first script: an error a start swallowed
 * leaves the editor half-built, and a rail that happens to land somewhere is no
 * proof the start went well.
 */
async function recordProblems(ui: Ui): Promise<void> {
  await ui.browser.addInitScript(() => {
    const problems: string[] = [];
    (window as unknown as { __problems: string[] }).__problems = problems;
    window.addEventListener('error', (event) => problems.push(String(event.message)));
    window.addEventListener('unhandledrejection', (event) => problems.push(String(event.reason)));
  });
}

/** What the page threw since it started. */
async function problems(ui: Ui): Promise<string[]> {
  return ui.browser.evaluate(() => (window as unknown as { __problems?: string[] }).__problems ?? []);
}

/** An empty Scene, opened at the window a test set first. */
async function openBare(ui: Ui, window?: { width: number; height: number }): Promise<void> {
  if (window !== undefined) {
    await ui.browser.setViewport(window);
  }
  await openEditor(ui, { A: { 'bare.json': BARE_SOURCE } }, 'bare.json');
  await settle(ui);
}

/** Every tile takes the press a person would make on it, in the order the strip draws them. */
async function eachTileTakesItsPress(ui: Ui, where: string): Promise<void> {
  for (const name of TILES) {
    await rail(ui).getByRole('button', name).click({ timeout: PRESS_TIMEOUT });
    await expect(
      rail(ui).getByRole('button', { name, pressed: true }),
      `a press at the middle of ${name} picks it, ${where}`,
    ).toBeVisible();
  }
}

test('a corner that grows while a press holds the strip leaves it still, and the release clears it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 360, height: 330 });
  await openBare(ui);
  await placeRailAtEdge(ui, 'bottom');

  // A press on a tile is a press a person is making: the pointer is on the strip,
  // and no corner arriving under it may carry the strip out from under that hand.
  // The pan is named in the pill at the bottom of the status bar while it lasts,
  // which is the room the bottom-placed rail sits over.
  // The band holds the strip and stops above the pill the pan puts in the status
  // bar, so the strip's own ink is all it holds.
  const band: Rect = { x: 0, y: 150, width: 360, height: 110 };
  const grip = tileCentre(boxOfPlace(await railPlace(ui, band)), 3);
  await browser.mouse.move(grip.x, grip.y);
  await browser.mouse.down();
  const held = await railPlace(ui, band);
  await browser.keyboard.down('Space');
  await expect(screen.getByText('Panning')).toBeVisible();
  await settle(ui);
  // The pill's own words are ink inside this band too, below the strip's top, so the
  // strip's top and middle are what the press has to have kept.
  const still = await railPlace(ui, band);
  expect(Math.abs(still.top - held.top), 'a corner that grew under the pressed strip left its top').toBeLessThan(3);
  expect(
    Math.abs(still.centreX - held.centreX),
    'a corner that grew under the pressed strip left its middle',
  ).toBeLessThan(3);

  // The press ends as the click it was, on the tile it landed on: the placement the
  // corner asked for runs now, with the pointer off the strip.
  await browser.mouse.up();
  await expect(
    rail(ui).getByRole('button', { name: 'Select', pressed: true }),
    'the press that held the strip ended as the click on the tile it landed on',
  ).toBeHidden();
  await settle(ui);
  expect(
    (await railPlace(ui, band)).top,
    'the release the corner waited for hangs the strip in clear of the pill',
  ).toBeLessThan(held.top - 20);

  // The pill goes with the pan, and the corner that shrinks gives the room back.
  await browser.keyboard.up('Space');
  await settle(ui);
  expect(
    Math.abs((await railPlace(ui, band)).top - held.top),
    'the corner that shrinks puts the strip back',
  ).toBeLessThan(3);
});

test('a Rail dropped over the status corner rests clear of it, so every tile takes its press', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 360, height: 330 });
  await openBare(ui);

  // The strip starts below the Scene's own name in this narrow editor, so its
  // band starts under those words.
  const upper: Rect = { x: 0, y: 74, width: 360, height: 100 };
  const opened = await railPlace(ui, upper);

  // A person carries the strip down to the bottom of a short editor, where the
  // status bar's rows sit: the Rail rests clear of them so every tile takes its
  // press.
  await drag(ui, tileCentre(boxOfPlace(opened), 1), { x: 180, y: 300 });
  await settle(ui);
  const lower: Rect = { x: 0, y: 150, width: 360, height: 110 };
  const landed = await railPlace(ui, lower);
  expect(landed.top, 'the release rests the strip along the bottom').toBeGreaterThan(lower.y + 20);

  await eachTileTakesItsPress(ui, 'on a strip dropped over the status bar');
});

test('a palette move places the rail without touching the Scene, the folder or the undo history', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 3440, height: 1440 });
  await openEditor(
    ui,
    { A: { 'big.json': BIG_SOURCE, 'big.svg': '<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>' } },
    'big.json',
  );
  await settle(ui);
  const files = await savedFiles(ui);
  const before = (await shot(ui)).darkBounds(BIG_BOX, 0.6);

  // A write the move would have to make waits on the test: nothing answers it, so
  // a save the move sent would stay held and the test would find it.
  await holdWrites(ui, 'big.json');
  await placeRailAtEdge(ui, 'left');
  const held = await browser.evaluate(
    () => ((window as unknown as { __esbozoGates?: unknown[] }).__esbozoGates ?? []).length,
  );
  expect(held, 'a move sends no save').toBe(0);
  await allowWrites(ui);

  // The Scene's own file and the SVG beside it are the bytes they were, and the
  // view has not moved: the rail is the page's chrome, not the diagram's ink.
  expect(await savedFiles(ui), 'a move writes nothing').toEqual(files);
  expect((await shot(ui)).darkBounds(BIG_BOX, 0.6), 'a move leaves the view alone').toEqual(before);

  // And no undo step: Undo is still greyed, saying there is nothing to undo.
  await ui.browser.keyboard.press('q');
  await ui.browser.keyboard.type('undo');
  await expect(screen.getByRole('option', { name: 'Undo · ⌘Z' })).toBeDisabled();
  await expect(screen.getByRole('option', { name: 'Undo · ⌘Z' })).toContainText('nothing to undo');
  await ui.browser.keyboard.press('Escape');
});

test('a palette move puts the rail at an edge’s middle, 16 px in', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);

  const topBand: Rect = { x: 400, y: 0, width: 480, height: 120 };
  const opened = await railPlace(ui, topBand);

  // Drag the rail away from top-middle, then ask the palette for the top edge:
  // it returns to top-middle, 16 px in.
  await drag(ui, tileCentre(boxOfPlace(opened), 1), { x: 640, y: 300 });
  await settle(ui);
  await placeRailAtEdge(ui, 'top');
  expectHeld(opened, await railPlace(ui, topBand), 'Tool rail: top');

  // Asking for the left edge stands the rail at left-middle, 16 px in.
  await placeRailAtEdge(ui, 'left');
  const left = await railInk(ui, { x: 0, y: 200, width: 120, height: 400 });
  expect(left.x, 'the left edge rests 16 px in').toBeGreaterThan(4);
  expect(left.x, 'the left edge rests 16 px in').toBeLessThan(24);
  expect(left.height, 'the strip stands up along the left edge').toBeGreaterThan(left.width * 2);
  expect(Math.abs(left.y + left.height / 2 - 800 / 2), 'the strip is centred on the left edge').toBeLessThan(4);
});

test('a move to the left is kept, so the next editor starts there', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui, { width: 3440, height: 1440 });
  await placeRailAtEdge(ui, 'left');
  const stored = await keptPlace(ui);
  expect(stored?.orientation, 'the move is kept for the next start').toBe('standing');

  // The page starts again in a different window: the kept centre fractions and
  // orientation stand the rail along the left edge, centred vertically.
  await openBare(ui, { width: 1280, height: 800 });
  const ink = await railInk(ui, { x: 0, y: 200, width: 140, height: 400 });
  expect(ink.x, 'the strip rests near the left edge').toBeGreaterThan(4);
  expect(ink.x, 'the strip rests near the left edge').toBeLessThan(30);
  expect(ink.height, 'the strip stands up the side it was left on').toBeGreaterThan(ink.width * 2);
  expect(Math.abs(ink.y + ink.height / 2 - 800 / 2), 'the strip is centred vertically').toBeLessThan(4);
});

test('a move in a second editor does not move the one already open', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const first = browser.tabs()[0];
  if (first === undefined) {
    throw new Error('the editor is already open in a tab of its own');
  }
  const opened = await railInk(ui, { x: 400, y: 0, width: 480, height: 240 });
  expect(opened.width, 'the open editor starts along the top').toBeGreaterThan(opened.height * 2);

  // A second tab on the same origin, opened as a second editor: the rail moves
  // to the left there, and the place is kept for the next start rather than
  // broadcast to the editor already on the page.
  await browser.newTab();
  await openBare(ui);
  await placeRailAtEdge(ui, 'left');
  expect((await keptPlace(ui))?.orientation, 'the move is kept for the next start').toBe('standing');

  await first.activate();
  const held = await railInk(ui, { x: 400, y: 0, width: 480, height: 240 });
  expect(held.width, 'the open editor still lies along the top').toBeGreaterThan(held.height * 2);
  expect(Math.abs(held.y - opened.y), 'the open editor’s rail has not moved').toBeLessThan(3);
});

test('an unknown stored word starts the rail at the top, and the rail still moves', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await recordProblems(ui);
  await browser.addInitScript(() => {
    localStorage.setItem('esbozo.rail', 'diagonal');
  });
  await openBare(ui);

  const ink = await railInk(ui, { x: 400, y: 0, width: 480, height: 240 });
  expect(ink.y, 'the rail starts at the top').toBeGreaterThan(2);
  expect(ink.y, 'the rail starts at the top').toBeLessThan(28);
  expect(ink.width, 'the strip lies along the top').toBeGreaterThan(ink.height * 2);

  await placeRailAtEdge(ui, 'left');
  const moved = await railInk(ui, { x: 0, y: 200, width: 200, height: 400 });
  expect(moved.height, 'the rail still moves').toBeGreaterThan(moved.width * 2);
  expect((await keptPlace(ui))?.orientation, 'the move replaces the word it could not use').toBe('standing');
  expect(await problems(ui), 'an unknown word is no error').toEqual([]);
});

test('a storage that throws starts the rail at the top, and the rail still moves', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await recordProblems(ui);
  await browser.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('the storage is blocked');
      },
    });
  });
  await openBare(ui);

  const ink = await railInk(ui, { x: 400, y: 0, width: 480, height: 240 });
  expect(ink.y, 'the rail starts at the top').toBeGreaterThan(2);
  expect(ink.y, 'the rail starts at the top').toBeLessThan(28);
  expect(ink.width, 'the strip lies along the top').toBeGreaterThan(ink.height * 2);

  await placeRailAtEdge(ui, 'left');
  const moved = await railInk(ui, { x: 0, y: 200, width: 200, height: 400 });
  expect(moved.height, 'the rail still moves').toBeGreaterThan(moved.width * 2);
  expect(await problems(ui), 'a blocked storage is no error').toEqual([]);
});

test('a move in a read-only Scene keeps the place and leaves the Scene’s file alone', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);

  // A box asks the folder to write and the folder answers `403`, so the editor
  // pages from then on may only read.
  await holdWrites(ui, 'bare.json');
  await browser.keyboard.press('r');
  await drag(ui, { x: 200, y: 200 }, { x: 260, y: 260 });
  await refuseWrite(ui, 'this folder is served read-only');
  await allowWrites(ui);
  await expect(screen.getByText('read-only')).toBeVisible();
  await settle(ui);
  const files = await savedFiles(ui);

  await placeRailAtEdge(ui, 'left');
  expect((await keptPlace(ui))?.orientation, 'a read-only Scene keeps the place all the same').toBe('standing');
  expect(await savedFiles(ui), 'a move writes no file').toEqual(files);
});

/**
 * The middle of one of the strip's seven tiles, as the ink of a strip lying along
 * the top says: its outline hangs 7 px outside the strip, the strip pads 9 px top
 * and bottom and 8 px across, and its 30 px tiles are 1 px apart. The tilt leans
 * the far tiles a couple of pixels, which a tile's own 30 px holds.
 */
function tileCentre(outline: Rect, index: number): { x: number; y: number } {
  return { x: outline.x + 7 + 8 + index * 31 + 15, y: outline.y + 7 + 9 + 16 };
}

/** A strip's ink as the box it is measured in. */
function boxOfPlace(place: Place): Rect {
  return { x: place.centreX - place.width / 2, y: place.top, width: place.width, height: place.height };
}

test('a press that moves 3 px on a tile picks that tool and leaves the rail where it was', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const band: Rect = { x: 400, y: 0, width: 480, height: 240 };
  const opened = await railPlace(ui, band);

  // The third tile is Ellipse, and a 3 px move is under the click's own 4 px.
  const tile = tileCentre(boxOfPlace(opened), 2);
  await drag(ui, tile, { x: tile.x + 3, y: tile.y + 2 });
  await settle(ui);

  // The press is a click: the tile it landed on is the tool in hand, and the rail
  // has not moved — a drag of the rail places it, and picks no tool at all.
  expect(await screen.getByRole('button', 'Ellipse').getAttribute('aria-pressed'), 'the tile picked its tool').toBe(
    'true',
  );
  expect(await screen.getByRole('button', 'Select').getAttribute('aria-pressed')).toBe('false');
  expectHeld(opened, await railPlace(ui, band), 'a 3 px press-move');

  // The keys a focused tile answers are still the tile's: a press on the rail is
  // no part of picking a tool with the keyboard.
  await screen.getByRole('button', 'Line').focus();
  await browser.keyboard.press('Enter');
  expect(await screen.getByRole('button', 'Line').getAttribute('aria-pressed'), 'the tile still answers Enter').toBe(
    'true',
  );
});

/**
 * Whether a tile is the tool in hand, as the page presses it: the one state a
 * person sees on the strip, read without touching the Scene a pick changes.
 */
async function picked(ui: Ui, name: string): Promise<string | null> {
  return ui.screen.getByRole('button', { name, exact: true }).getAttribute('aria-pressed');
}

test('a Space on a focused tile picks its tool, and a Space the pointer pans with picks nothing', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);

  // Space is the activation Enter is, so the tile the focus sits on is what a
  // keyboard person reaches: Rectangle is the tool in hand and Select is not.
  await screen.getByRole('button', { name: 'Rectangle', exact: true }).focus();
  await browser.keyboard.press('Space');
  await settle(ui);
  expect(await picked(ui, 'Rectangle'), 'the tile answered Space').toBe('true');
  expect(await picked(ui, 'Select')).toBe('false');

  // The Space a pointer took to pan the page is the page's, not the tile's: the
  // Ellipse keeps the focus, the page moves under the pointer, and the rail keeps
  // the Rectangle the keyboard picked in hand.
  await screen.getByRole('button', { name: 'Ellipse', exact: true }).focus();
  await browser.keyboard.down('Space');
  await drag(ui, { x: 640, y: 560 }, { x: 640, y: 420 });
  await browser.keyboard.up('Space');
  await settle(ui);
  expect(await picked(ui, 'Ellipse'), 'a Space that panned is no pick').toBe('false');
  expect(await picked(ui, 'Rectangle')).toBe('true');

  expect(await problems(ui), 'the page threw nothing').toEqual([]);
});

test('a Space whose focus moved before the release picks nothing, as a native button’s Space does not', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const rect = screen.getByRole('button', { name: 'Rectangle', exact: true });
  const ellipse = screen.getByRole('button', { name: 'Ellipse', exact: true });

  // A Space pressed on the Rectangle tile is the Rectangle's only while the focus
  // stays on it. The pointer picks the Ellipse before the key comes up, and a
  // release that lands on another tile is no activation at all: the person's own
  // pick stands, and the stale press clicks nothing behind it.
  await rect.focus();
  await browser.keyboard.down('Space');
  await ellipse.click();
  await settle(ui);
  expect(await picked(ui, 'Ellipse'), 'the pointer picked the Ellipse').toBe('true');
  await browser.keyboard.up('Space');
  await settle(ui);
  expect(await picked(ui, 'Rectangle'), 'a release whose focus moved clicks no tile').toBe('false');
  expect(await picked(ui, 'Ellipse'), 'the pointer’s pick stands').toBe('true');

  // The keys alone say the same: the focus moved between the press and the
  // release, so the release is nobody's activation.
  await rect.focus();
  await browser.keyboard.down('Space');
  await ellipse.focus();
  await browser.keyboard.up('Space');
  await settle(ui);
  expect(await picked(ui, 'Rectangle'), 'a focus that moved clicks nothing').toBe('false');
  expect(await picked(ui, 'Ellipse')).toBe('true');

  expect(await problems(ui), 'the page threw nothing').toEqual([]);
});

test('a Space held across a Scene switch picks nothing in the Scene it lands in', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'one.json': BARE_SOURCE, 'two.json': BARE_SOURCE } }, 'one.json');
  await settle(ui);
  const rect = screen.getByRole('button', { name: 'Rectangle', exact: true });

  // A press belongs to the Scene it was made in: the focus and the tile both go
  // with the switch, so the release in the new Scene activates nothing there.
  await rect.focus();
  await browser.keyboard.down('Space');
  await screen.getByRole('button', { name: /Open folder/ }).click();
  await screen.getByRole('button', { name: 'two.json', exact: true }).click();
  await settle(ui);
  await browser.keyboard.up('Space');
  await settle(ui);
  expect(await picked(ui, 'Rectangle'), 'a press from another Scene clicks no tile').toBe('false');
  expect(await picked(ui, 'Select'), 'the new Scene keeps the tool it opened with').toBe('true');

  expect(await problems(ui), 'the page threw nothing').toEqual([]);
});

test('a pinch that spans the rail and the paper draws nothing on the paper', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const band: Rect = { x: 400, y: 0, width: 480, height: 240 };
  const opened = await railPlace(ui, band);
  const files = await savedFiles(ui);

  // A finger presses a tile and carries the rail left; a second finger lands on
  // the paper and the two are drawn apart, which is how a pinch begins. The rail
  // drag owns its pointer, so the paper is no place for the second contact to
  // start a Rectangle on (D9, criterion 10).
  await screen.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await holdWrites(ui, 'bare.json');
  const page = livePage();
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Array<{ x: number; y: number; id: number }>) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const grip = tileCentre(boxOfPlace(opened), 1);
  const railFinger = { x: grip.x, y: grip.y, id: 0 };
  const boardFinger = { x: 920, y: 250, id: 1 };
  await touch('touchStart', [railFinger]);
  await touch('touchMove', [{ x: 250, y: 400, id: 0 }]);
  await touch('touchStart', [{ x: 250, y: 400, id: 0 }, boardFinger]);
  await touch('touchMove', [{ x: 200, y: 400, id: 0 }, { x: 1020, y: 350, id: 1 }]);
  await touch('touchEnd', []);
  await settle(ui);

  const held = await browser.evaluate(
    () => ((window as unknown as { __esbozoGates?: unknown[] }).__esbozoGates ?? []).length,
  );
  expect(held, 'a pinch on the paper sends no save').toBe(0);
  await allowWrites(ui);
  expect(await savedFiles(ui), 'a pinch on the paper writes no file').toEqual(files);
  expect((await keptPlace(ui))?.orientation, 'the rail drag it started still settles').toBe('standing');
});

/**
 * The browser protocol with a pointer of its own: a pen, a touch and the mouse,
 * each pressed and let go when the test says so. e2e's fixtures each drive the
 * primary pointer, and the gestures below are one pointer's while another holds
 * the rail — a pen dragging the strip with a finger still on the paper, which no
 * fixture can produce.
 */
async function mixedPointers() {
  const page = livePage();
  const client = await page.context().newCDPSession(page);
  /** A press, a move or a release of the pen's or the mouse's own pointer. */
  const press = async (
    pointerType: 'pen' | 'mouse',
    type: 'mousePressed' | 'mouseMoved' | 'mouseReleased',
    x: number,
    y: number,
  ): Promise<void> => {
    await client.send('Input.dispatchMouseEvent', {
      pointerType,
      type,
      x,
      y,
      button: type === 'mouseMoved' ? 'none' : 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
    });
  };
  return {
    pen: (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number, y: number) => press('pen', type, x, y),
    mouse: (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number, y: number) =>
      press('mouse', type, x, y),
    /** The touch's contacts, every one of them on every call, as the protocol takes them. */
    touch: async (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      points: Array<{ x: number; y: number; id: number }>,
    ): Promise<void> => {
      await client.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    },
  };
}

/** How many writes the page has asked the stubbed folder for, held or landed. */
async function writeCount(ui: Ui): Promise<number> {
  return ui.browser.evaluate(
    () => ((window as unknown as { __esbozoGates?: unknown[] }).__esbozoGates ?? []).length,
  );
}

test('a finger a rail drag ignored ends as ignored, so its release leaves the mouse’s Rectangle alone', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const band: Rect = { x: 400, y: 0, width: 480, height: 240 };
  const opened = await railPlace(ui, band);
  await screen.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await holdWrites(ui, 'bare.json');
  const { pen, mouse, touch } = await mixedPointers();
  const grip = tileCentre(boxOfPlace(opened), 1);

  // A pen presses the rail and carries it left; a finger lands on the paper and
  // stays there; the pen lets go, so the rail lands with the finger still down.
  // Neither contact carries Ctrl: the board ignores the finger because a rail
  // drag owns a pointer, not because a menu owns its press.
  await pen('mousePressed', grip.x, grip.y);
  await pen('mouseMoved', 250, 400);
  await touch('touchStart', [{ x: 1000, y: 360, id: 0 }]);
  await pen('mouseReleased', 250, 400);
  await settle(ui);
  expect((await keptPlace(ui))?.orientation, 'the pen’s release placed the rail').toBe('standing');

  // A mouse draws a 100×80 Rectangle while the finger is still down, and the
  // finger is lifted first: its release is its own, so the Rectangle the mouse is
  // still drawing is not the finger's to settle (criterion 10).
  await mouse('mouseMoved', 700, 200);
  await mouse('mousePressed', 700, 200);
  await mouse('mouseMoved', 750, 240);
  await mouse('mouseMoved', 800, 280);
  await touch('touchEnd', []);
  await settle(ui);
  expect(await writeCount(ui), 'the ignored finger’s release saves nothing').toBe(0);

  // The mouse's own release is the one that finishes the Rectangle it drew.
  await mouse('mouseReleased', 800, 280);
  await expect.poll(() => writeCount(ui), { timeout: 5000 }).toBe(1);
  await releaseWrite(ui);
  const drawn = (await savedScene(ui, 'bare.json')).elements[0];
  expect([drawn?.width, drawn?.height], 'the mouse’s own Rectangle is what was saved').toEqual([100, 80]);
});

test('a mouse a held rail drag ignored ends as ignored, so an in-flight touch draw saves itself', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const band: Rect = { x: 400, y: 0, width: 480, height: 240 };
  const opened = await railPlace(ui, band);
  await screen.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await holdWrites(ui, 'bare.json');
  const { pen, mouse, touch } = await mixedPointers();
  const grip = tileCentre(boxOfPlace(opened), 1);

  // A finger draws a 200×60 Rectangle on the paper and stays down; a pen then
  // presses the rail and carries it left, so a drag owns a pointer while the
  // draw is still in flight.
  await touch('touchStart', [{ x: 900, y: 300, id: 0 }]);
  await touch('touchMove', [{ x: 1000, y: 330, id: 0 }]);
  await touch('touchMove', [{ x: 1100, y: 360, id: 0 }]);
  await pen('mousePressed', grip.x, grip.y);
  await pen('mouseMoved', 250, 400);

  // The mouse presses the paper and lets go while the rail is still held: the
  // board ignores both, and neither is the touch draw's to settle.
  await mouse('mouseMoved', 700, 200);
  await mouse('mousePressed', 700, 200);
  await mouse('mouseReleased', 700, 200);
  await settle(ui);
  expect(await writeCount(ui), 'the ignored mouse’s release saves nothing').toBe(0);

  // The finger's own release is the one that finishes its Rectangle, and the pen
  // still places the rail it is holding.
  await touch('touchEnd', []);
  await expect.poll(() => writeCount(ui), { timeout: 5000 }).toBe(1);
  await releaseWrite(ui);
  const drawn = (await savedScene(ui, 'bare.json')).elements[0];
  expect([drawn?.width, drawn?.height], 'the touch’s own Rectangle is what was saved').toEqual([200, 60]);

  await pen('mouseReleased', 250, 400);
  await settle(ui);
  expect((await keptPlace(ui))?.orientation, 'the pen’s release places the rail').toBe('standing');
});

test('a tap picks nothing on a tile while another pointer holds a drag of the rail, and picks again after it lets go', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const band: Rect = { x: 400, y: 0, width: 480, height: 240 };
  const opened = await railPlace(ui, band);
  const { pen, touch } = await mixedPointers();
  const grip = tileCentre(boxOfPlace(opened), 1);

  // A pen presses Rectangle and carries it 20 px, past the click's 4 px slop, and
  // stays down: the strip is that one pointer's until it lets go (D6).
  await pen('mousePressed', grip.x, grip.y);
  await pen('mouseMoved', grip.x + 20, grip.y);
  await settle(ui);

  // A finger taps the Ellipse tile while the pen still holds the drag. The tap is
  // no pick of its own — a second contact under a drag picks nothing (D9) — so
  // the drag keeps the strip and Select stays the tool in hand.
  const ellipse = tileCentre(boxOfPlace(opened), 2);
  await touch('touchStart', [{ x: ellipse.x, y: ellipse.y, id: 0 }]);
  await touch('touchEnd', []);
  await settle(ui);
  expect(await picked(ui, 'Ellipse'), 'the tap under the drag picked nothing').toBe('false');
  expect(await picked(ui, 'Select')).toBe('true');

  // The pen lets go and the rail lands where its drag would; a tile is a pick
  // again, with the pointer that presses it as the one that owns the strip.
  await pen('mouseReleased', grip.x + 20, grip.y);
  await settle(ui);
  await screen.getByRole('button', { name: 'Ellipse', exact: true }).click();
  await settle(ui);
  expect(await picked(ui, 'Ellipse'), 'a tap picks again once the drag is over').toBe('true');

  expect(await problems(ui), 'the page threw nothing').toEqual([]);
});

// ------------------------------------------------------- calling a drag off

/** The band the empty Scene's strip hangs in: bare paper and the strip alone. */
const TOP_BAND: Rect = { x: 400, y: 0, width: 480, height: 240 };

/**
 * The page's whole ink, with the strip drawn at full ink and the pointer resting
 * on bare paper: any mark an exit left behind is ink
 * that was not there before. The fade is waited out and the hover is the same
 * both times, so neither can decide the measure.
 */
async function pageInk(ui: Ui): Promise<Rect | null> {
  await ui.browser.mouse.move(200, 200);
  await rail(ui).getByRole('button', 'Select').focus();
  await fullInk(ui);
  return (await shot(ui)).darkBounds({ x: 0, y: 0, width: 1280, height: 800 }, 0.6);
}

/** What an exit must not touch: the strip, the place the page keeps and the folder. */
interface Kept {
  place: Place;
  stored: StoredPlace | null;
  files: Record<string, string>;
  /** The tool in hand and whether the note is open: the press's own tool and selection. */
  tools: string[];
  note: boolean;
}

/** The tool in hand, as the rail presses it: the tiles of the seven it says are picked. */
async function toolInHand(ui: Ui): Promise<string[]> {
  const pressed: string[] = [];
  for (const name of TILES) {
    const tile = ui.screen.getByRole('button', { name, exact: true });
    if ((await tile.getAttribute('aria-pressed')) === 'true') {
      pressed.push(name);
    }
  }
  return pressed;
}

/**
 * The page a drag is called off on: a Rectangle drawn on the paper, the folder's
 * writes held so a save the exit made would wait where the test finds it, and the
 * strip, the kept side, the folder's files, the tool in hand and the selection as
 * the exit must leave them (D7, D9, I6).
 *
 * `keep` is what the drawing leaves that the press must not take: its own
 * `selection`, the box it drew standing in the note, or the `rectangle` tile this
 * then picks — a tile drops the selection, so the two are two states and not one.
 */
async function beforeCancel(
  ui: Ui,
  keep: 'selection' | 'rectangle',
): Promise<Kept & { grip: { x: number; y: number } }> {
  await openBare(ui);
  await ui.screen.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await drag(ui, { x: 400, y: 300 }, { x: 600, y: 450 });
  await settle(ui);
  if (keep === 'rectangle') {
    await ui.screen.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await settle(ui);
  }
  await holdWrites(ui, 'bare.json');
  const place = await railPlace(ui, TOP_BAND);
  return {
    place,
    stored: await keptPlace(ui),
    files: await savedFiles(ui),
    tools: await toolInHand(ui),
    note: await ui.screen.getByRole('dialog', 'Style').isVisible(),
    grip: tileCentre(boxOfPlace(place), 1),
  };
}

/**
 * The rail, the stored place, the tool, the selection, the folder and the page's
 * ink as the press found them: a called-off drag puts every one of them back.
 */
async function expectCalledOff(ui: Ui, before: Kept, ink: Rect | null): Promise<void> {
  const place = await railPlace(ui, TOP_BAND);
  expectHeld(before.place, place, 'a called-off drag');
  expect(place.width, 'the strip lies along the top, as it did').toBeGreaterThan(place.height * 2);
  expect(await keptPlace(ui), 'a cancel stores no place').toEqual(before.stored);
  expect(await savedFiles(ui), 'a cancel writes no file').toEqual(before.files);
  expect(await toolInHand(ui), 'a cancel keeps the tool in hand and picks no other').toEqual(before.tools);
  const note = ui.screen.getByRole('dialog', 'Style');
  if (before.note) {
    await expect(note).toBeVisible();
  } else {
    await expect(note).toBeHidden();
  }
  expect(await pageInk(ui), 'a cancel leaves no mark on the page').toEqual(ink);
}

/** One undo takes back the press's own drawing, so the exit added no step of its own. */
async function expectNoStep(ui: Ui): Promise<void> {
  await ui.browser.keyboard.press('Meta+z');
  await expect.poll(() => writeCount(ui), { timeout: 5000 }).toBe(1);
  await releaseWrite(ui);
  await expect
    .poll(async () => (await savedScene(ui, 'bare.json')).elements.length, { timeout: 5000 })
    .toBe(0);
}

/**
 * The page goes out of sight, as the tab behind another one does. A headless
 * Chromium keeps every page visible, so this is the event the hidden page gets,
 * taken the way `tests/editor-interrupts.e2e.ts` takes the same exit.
 */
async function hidePage(ui: Ui): Promise<void> {
  await ui.browser.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      delete (document as unknown as { visibilityState?: string }).visibilityState;
    }
    return true;
  });
}

test('Escape during a drag of the rail puts the strip back and leaves the tool, the selection and the store alone', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  const before = await beforeCancel(ui, 'selection');
  const ink = await pageInk(ui);

  // The drag has passed the click's 4 px and carried the strip most of the way to
  // the left side; Escape calls it off with the button still down.
  await drag(ui, before.grip, { x: 300, y: 400 }, 'left', async () => {
    await browser.keyboard.press('Escape');
    await settle(ui);
  });
  await settle(ui);

  // The release that follows the cancel places nothing and picks no tool: the
  // strip, the side, the tool, the selection and the folder are the press's own.
  expect(await writeCount(ui), 'a cancel sends no save').toBe(0);
  await expectCalledOff(ui, before, ink);
  await expectNoStep(ui);
});

test('a window that loses the focus during a drag of the rail puts the strip back', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  const before = await beforeCancel(ui, 'rectangle');
  const ink = await pageInk(ui);

  // The pointer a drag was following comes up in another window, so the drag ends
  // here rather than wait for a release it will never get (D7).
  await drag(ui, before.grip, { x: 300, y: 400 }, 'left', async () => {
    await blurPage();
    await settle(ui);
  });
  await settle(ui);

  expect(await writeCount(ui), 'a blur sends no save').toBe(0);
  await expectCalledOff(ui, before, ink);
  await expectNoStep(ui);
});

test('a hidden tab during a drag of the rail puts the strip back', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  const before = await beforeCancel(ui, 'selection');
  const ink = await pageInk(ui);

  await drag(ui, before.grip, { x: 300, y: 400 }, 'left', async () => {
    await hidePage(ui);
    await settle(ui);
  });
  await settle(ui);

  expect(await writeCount(ui), 'a hidden tab sends no save').toBe(0);
  await expectCalledOff(ui, before, ink);
  await expectNoStep(ui);
});

test('a cancelled mouse during a drag of the rail puts the strip back', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  const before = await beforeCancel(ui, 'rectangle');
  const ink = await pageInk(ui);

  // No protocol command cancels a mouse, so this is the event the browser would
  // have sent for the pointer the drag holds, as `tests/editor-interrupts.e2e.ts`
  // keeps the same cell.
  await drag(ui, before.grip, { x: 300, y: 400 }, 'left', async () => {
    await browser.evaluate(() => {
      window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, isPrimary: true }));
      return true;
    });
    await settle(ui);
  });
  await settle(ui);

  expect(await writeCount(ui), 'a cancelled pointer sends no save').toBe(0);
  await expectCalledOff(ui, before, ink);
  await expectNoStep(ui);
});

test('a finger the browser cancels during a drag of the rail puts the strip back', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  const before = await beforeCancel(ui, 'rectangle');
  const ink = await pageInk(ui);

  // A finger presses the Rectangle tile and carries the strip most of the way to
  // the left side; the browser then takes the press over, as it does for a scroll,
  // and cancels it — a real `pointercancel`, with the pointer the drag really had.
  await touchCarry(before.grip, { x: 300, y: 400 }, 5);
  await cancelTouch();
  await settle(ui);

  expect(await writeCount(ui), 'a cancelled finger sends no save').toBe(0);
  await expectCalledOff(ui, before, ink);
  await expectNoStep(ui);
});

test('a cancel while the paper holds a finger it refused puts the strip back, and that finger settles nothing', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  const before = await beforeCancel(ui, 'selection');
  const ink = await pageInk(ui);
  const { pen, touch } = await mixedPointers();
  const saved = (await savedScene(ui, 'bare.json')).elements;

  // A pen presses the Rectangle tile and carries the strip towards the left side;
  // a finger lands on the paper while the drag owns a pointer and stays there, so
  // the board refuses it (29g). Escape then calls the drag off.
  await pen('mousePressed', before.grip.x, before.grip.y);
  await pen('mouseMoved', 400, 400);
  await pen('mouseMoved', 300, 400);
  await touch('touchStart', [{ x: 1000, y: 360, id: 0 }]);
  await browser.keyboard.press('Escape');
  await settle(ui);

  // The refused finger was never half a gesture, so the move and the release it
  // sends after the cancel settle nothing either: no Rectangle, no save.
  await touch('touchMove', [{ x: 700, y: 500, id: 0 }]);
  await touch('touchEnd', []);
  await settle(ui);
  expect(await writeCount(ui), 'the refused finger settles no gesture').toBe(0);
  expect((await savedScene(ui, 'bare.json')).elements, 'the refused finger draws nothing').toEqual(saved);

  // And the pen's own release places nothing, because its drag was called off.
  await pen('mouseReleased', 300, 400);
  await settle(ui);
  expect(await writeCount(ui), 'the cancelled pen places nothing').toBe(0);
  await expectCalledOff(ui, before, ink);
  await expectNoStep(ui);
});

test('a fresh drag after a cancel moves the rail as any other', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const opened = await railPlace(ui, TOP_BAND);
  const grip = tileCentre(boxOfPlace(opened), 1);

  // Called off on its way to the left space, so the strip is where it opened and
  // the page keeps no place...
  await drag(ui, grip, { x: 300, y: 400 }, 'left', async () => {
    await browser.keyboard.press('Escape');
    await settle(ui);
  });
  await settle(ui);
  expectHeld(opened, await railPlace(ui, TOP_BAND), 'a called-off drag');
  expect(await keptPlace(ui), 'a cancel keeps no place').toBeNull();

  // ...and a second drag from the same tile moves it, as a drag always does.
  await drag(ui, grip, { x: 300, y: 400 });
  await settle(ui);
  expect((await keptPlace(ui))?.orientation, 'the second drag stands in the left space').toBe('standing');
  const ink = await railInk(ui, { x: 200, y: 200, width: 200, height: 400 });
  expect(ink.height, 'the strip stands where dropped').toBeGreaterThan(ink.width * 2);
  expect(await screen.getByRole('button', 'Select').getAttribute('aria-pressed'), 'a drag picks no tool').toBe(
    'true',
  );
});

// -------------------------------------------- the pointer a cancel leaves down

/**
 * The page a called-off press leaves its pointer in: the bare Scene open, the
 * strip along the top with Select in hand, and the folder's writes held, so a
 * save the late input made would wait where the test finds it.
 */
async function openForLateInput(ui: Ui): Promise<{ grip: { x: number; y: number } }> {
  await openBare(ui);
  const opened = await railPlace(ui, TOP_BAND);
  await holdWrites(ui, 'bare.json');
  return { grip: tileCentre(boxOfPlace(opened), 1) };
}

/** The Rectangle tile's pressed state: the tool a real click on it picks. */
async function rectanglePressed(ui: Ui): Promise<string | null> {
  return ui.screen.getByRole('button', { name: 'Rectangle', exact: true }).getAttribute('aria-pressed');
}

/**
 * The exits that call a drag off with the pointer still in the person's hand:
 * Escape, the window losing the focus, a hidden tab, and the browser taking the
 * pointer over. None of them takes the press away, so the pointer's own moves
 * and release arrive after it.
 */
const CALLS_OFF: Array<{ name: string; drive: (ui: Ui) => Promise<unknown> }> = [
  { name: 'Escape', drive: (ui) => ui.browser.keyboard.press('Escape') },
  { name: 'a lost focus', drive: () => blurPage() },
  { name: 'a hidden tab', drive: (ui) => hidePage(ui) },
  {
    name: 'a cancelled pointer',
    // No protocol command cancels a mouse, so this is the event the browser would
    // send for the pointer the drag holds, as the test above keeps the same cell.
    drive: (ui) =>
      ui.browser.evaluate(() => {
        window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, isPrimary: true }));
        return true;
      }),
  },
];

for (const exit of CALLS_OFF) {
  test(`a mouse let go back on a tile after ${exit.name} picks no tool and moves nothing`, async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    const { grip } = await openForLateInput(ui);
    const { mouse } = await mixedPointers();

    // The mouse presses the Rectangle tile, carries the strip past the click's 4
    // px — a drag of the rail from there — and the exit calls it off with the
    // button still down. The mouse then comes back to where it pressed and lets go
    // there, which is a place of its own: the press the exit called off sent both.
    await mouse('mouseMoved', grip.x, grip.y);
    await mouse('mousePressed', grip.x, grip.y);
    await mouse('mouseMoved', 300, 400);
    await exit.drive(ui);
    await settle(ui);
    await mouse('mouseMoved', grip.x, grip.y);
    await mouse('mouseReleased', grip.x, grip.y);
    await settle(ui);

    expect(await keptPlace(ui), 'a called-off drag stores no place').toBeNull();
    expect(await rectanglePressed(ui), 'the press the exit called off picks no tool').toBe('false');
    expect(await writeCount(ui), 'a called-off drag sends no save').toBe(0);

    // The next press of the same pointer is a press of its own: the tile's own
    // click picks the tool, as a click there always does.
    await mouse('mousePressed', grip.x, grip.y);
    await mouse('mouseReleased', grip.x, grip.y);
    await settle(ui);
    expect(await rectanglePressed(ui), 'the next press on the tile picks Rectangle').toBe('true');
  });
}

test('a pen a cancel left down carries no gesture and settles none', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  const { grip } = await openForLateInput(ui);
  await screen.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const { pen, touch } = await mixedPointers();

  // A pen presses the Rectangle tile and carries the strip towards the left side;
  // Escape calls the drag off with the pen still down.
  await pen('mousePressed', grip.x, grip.y);
  await pen('mouseMoved', 1080, 400);
  await browser.keyboard.press('Escape');
  await settle(ui);
  expect(await toolInHand(ui), 'a called-off drag keeps Rectangle in hand').toEqual(['Rectangle']);

  // A finger draws a 100×80 Rectangle on the paper, and the pen the cancel left
  // down is carried over the paper and let go there while the finger is still
  // down. Neither is the finger's gesture to take or to settle.
  await touch('touchStart', [{ x: 400, y: 300, id: 0 }]);
  await touch('touchMove', [{ x: 500, y: 380, id: 0 }]);
  await pen('mouseMoved', 700, 460);
  await pen('mouseReleased', 700, 460);
  await settle(ui);
  expect(await writeCount(ui), 'the cancelled pen settles no gesture').toBe(0);

  // The finger's own release is the one that draws, and it draws what it carried.
  await touch('touchEnd', []);
  await expect.poll(() => writeCount(ui), { timeout: 5000 }).toBe(1);
  await releaseWrite(ui);
  const elements = (await savedScene(ui, 'bare.json')).elements;
  expect(elements.length, 'one Rectangle, drawn by the finger').toBe(1);
  const [drawn] = elements;
  expect([drawn?.width, drawn?.height], 'the finger’s own Rectangle is what was saved').toEqual([100, 80]);
  expect(await keptPlace(ui), 'a called-off drag stores no place').toBeNull();

  // And the pen's next press is a press of its own: it carries the strip into
  // the left diagonal space as any drag does.
  await pen('mouseMoved', grip.x, grip.y);
  await pen('mousePressed', grip.x, grip.y);
  await pen('mouseMoved', 60, 340);
  await pen('mouseReleased', 60, 340);
  await settle(ui);
  expect((await keptPlace(ui))?.orientation, 'the pen’s next press drags the rail').toBe('standing');
});

// ------------------------------------ a cancel is the page's, not an editor's

/**
 * A second editor beside the first, as a host page places two of them: each
 * takes half the window, the first on the left and the appended one on the right.
 * Pointer ids are the page's, so a press one editor calls off is a press the
 * editor beside it must not take either.
 */
async function addSecondEditor(ui: Ui): Promise<void> {
  const added = await ui.browser.evaluate(() => {
    const first = document.querySelector('esbozo-editor');
    if (!(first instanceof HTMLElement)) {
      return false;
    }
    first.style.cssText = 'inset:0 auto 0 0;width:50%';
    const second = document.createElement('esbozo-editor');
    second.style.cssText = 'inset:0 0 0 auto;width:50%';
    document.body.append(second);
    return true;
  });
  expect(added, 'the page holds a second editor beside the first').toBe(true);
  await expect(ui.screen.getByRole('navigation', { name: 'Tools' })).toHaveCount(2);

  // An editor the page made itself opens no Scene until it is asked to: the same
  // stubbed folder and the same Scene in both, so a draw in either has somewhere
  // to land and the file it lands in says which editor wrote it.
  await ui.screen.getByRole('button', /Open folder/).nth(1).click();
  await ui.screen.getByRole('button', { name: 'bare.json' }).click();
  await settle(ui);
}

/**
 * The elements the stubbed folder holds for the Scene, once both editors have
 * saved: two editors each say `saved` in a status of their own, so the folder is
 * what the test reads.
 */
async function heldElements(ui: Ui): Promise<Array<{ width?: number; height?: number }>> {
  const saved = (await savedFiles(ui))['bare.json'] ?? '{}';
  return ((JSON.parse(saved) as { elements?: Array<{ width?: number; height?: number }> }).elements ?? []);
}

test('a pen a cancel left down in one editor settles nothing in the editor beside it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const place = await railPlace(ui, TOP_BAND);
  const grip = tileCentre(boxOfPlace(place), 1);
  const { pen, touch } = await mixedPointers();

  // A pen presses the Rectangle tile and carries the strip; Escape calls that drag
  // off with the pen still down, so the pointer it left down is the page's to
  // refuse until it comes up.
  await pen('mousePressed', grip.x, grip.y);
  await pen('mouseMoved', 540, 400);
  await browser.keyboard.press('Escape');
  await settle(ui);

  // A second editor takes the right half of the window, with the same folder and
  // Scene, and is armed with Rectangle so a finger on its paper draws there.
  await addSecondEditor(ui);
  await screen.getByRole('button', { name: 'Rectangle', exact: true }).nth(1).click();
  await settle(ui);

  // The finger draws; the cancelled pen is then carried over the second editor and
  // let go there while the finger is still down. Pointer ids are the page's, not an
  // editor's, so the editor beside the cancel must refuse that pointer too.
  await touch('touchStart', [{ x: 1040, y: 300, id: 0 }]);
  await touch('touchMove', [{ x: 1140, y: 380, id: 0 }]);
  await pen('mouseMoved', 1200, 460);
  await pen('mouseReleased', 1200, 460);
  await settle(ui);
  expect(await heldElements(ui), 'the cancelled pen writes nothing').toEqual([]);
  expect(await keptPlace(ui), 'a called-off drag stores no place').toBeNull();

  // The finger's own release is the one that draws, and it draws what it carried:
  // one 100×80 Rectangle, on the finger's lift and nothing else.
  await touch('touchEnd', []);
  await expect.poll(async () => (await heldElements(ui)).length, { timeout: 5000 }).toBe(1);
  const elements = await heldElements(ui);
  expect([elements[0]?.width, elements[0]?.height], 'the finger’s own Rectangle is what was saved').toEqual([
    100, 80,
  ]);
});

test('an Enter that picks another tool after a cancel keeps it from the old press’s release', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  const { grip } = await openForLateInput(ui);
  const { mouse } = await mixedPointers();
  const ellipse = screen.getByRole('button', { name: 'Ellipse', exact: true });

  // The mouse presses the Rectangle tile and carries the strip past the click's
  // 4 px; Escape calls the drag off with the button still down.
  await mouse('mouseMoved', grip.x, grip.y);
  await mouse('mousePressed', grip.x, grip.y);
  await mouse('mouseMoved', 300, 400);
  await browser.keyboard.press('Escape');
  await settle(ui);

  // The person then picks Ellipse from the keys. That click is the person's, not
  // the cancelled press's, so it runs — and the debt the cancelled press owes is
  // still the cancelled press's to pay.
  await ellipse.focus();
  await browser.keyboard.press('Enter');
  await settle(ui);
  expect(await ellipse.getAttribute('aria-pressed'), 'Enter picks Ellipse').toBe('true');

  // The old press comes back to the tile it started on and lets go there: its own
  // click picks no tool, and Ellipse is still the tool in hand.
  await mouse('mouseMoved', grip.x, grip.y);
  await mouse('mouseReleased', grip.x, grip.y);
  await settle(ui);
  expect(await ellipse.getAttribute('aria-pressed'), 'the old release keeps Ellipse').toBe('true');
  expect(await rectanglePressed(ui), 'the old release picks no tool').toBe('false');
  expect(await keptPlace(ui), 'a called-off drag stores no place').toBeNull();
});

test('a finger pressed on a tile before a cancel keeps the click it makes after it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  const { grip } = await openForLateInput(ui);
  const place = await railPlace(ui, TOP_BAND);
  const at = tileCentre(boxOfPlace(place), 2);
  const { pen, touch } = await mixedPointers();

  // A pen presses the Rectangle tile and carries the strip off it; a finger then
  // presses the Ellipse tile while that drag is still in flight, so the rail takes
  // no drag of the finger's. Escape calls the pen's drag off.
  await pen('mousePressed', grip.x, grip.y);
  await pen('mouseMoved', 1080, 400);
  await touch('touchStart', [{ x: at.x, y: at.y, id: 0 }]);
  await browser.keyboard.press('Escape');
  await settle(ui);

  // The pen is let go over the paper, so its own click lands on no tile; the
  // finger's release is a real touch click on Ellipse, and it is the finger's.
  await pen('mouseMoved', 900, 380);
  await pen('mouseReleased', 900, 380);
  await touch('touchEnd', []);
  await settle(ui);
  expect(
    await screen.getByRole('button', { name: 'Ellipse', exact: true }).getAttribute('aria-pressed'),
    'the finger’s own click picks Ellipse',
  ).toBe('true');
  expect(await rectanglePressed(ui), 'the cancelled pen picks no tool').toBe('false');
  expect(await keptPlace(ui), 'a called-off drag stores no place').toBeNull();
});

test('a drag past the slop carries the strip with the pointer and rests it where dropped', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);

  const opened = await railPlace(ui, TOP_BAND);
  const grip = tileCentre(boxOfPlace(opened), 1);
  const midBand: Rect = { x: 560, y: 80, width: 460, height: 180 };

  await browser.mouse.move(grip.x, grip.y);
  await browser.mouse.down();
  await browser.mouse.move(780, 180);
  await settle(ui);

  // Mid-drag, before release, the strip has already moved to follow the pointer.
  const midInk = (await shot(ui)).darkBounds(midBand, 0.6);
  expect(midInk, 'the strip follows the pointer mid-drag').not.toBeNull();
  const carried: Place = {
    centreX: midInk!.x + midInk!.width / 2,
    top: midInk!.y,
    width: midInk!.width,
    height: midInk!.height,
  };
  expect(carried.centreX, 'the strip moved right with the pointer').toBeGreaterThan(opened.centreX + 100);
  expect(carried.top, 'the strip moved down with the pointer').toBeGreaterThan(opened.top + 80);

  await browser.mouse.up();
  await settle(ui);
  expectHeld(carried, await railPlace(ui, midBand), 'release');
});

test('dragging from the top space into the left space stands the strip up under the grabbed tile', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);

  const opened = await railPlace(ui, TOP_BAND);
  const grip = tileCentre(boxOfPlace(opened), 5);
  const drop = { x: 220, y: 400 };

  await drag(ui, grip, drop);
  await settle(ui);

  const stood = await railInk(ui, { x: 140, y: 120, width: 160, height: 560 });
  expect(stood.height, 'the strip stands up in the left space').toBeGreaterThan(stood.width * 2);
  expect(drop.x, 'the strip encloses the drop point horizontally').toBeGreaterThanOrEqual(stood.x);
  expect(drop.x, 'the strip encloses the drop point horizontally').toBeLessThanOrEqual(stood.x + stood.width);
  expect(drop.y, 'the strip encloses the drop point vertically').toBeGreaterThanOrEqual(stood.y);
  expect(drop.y, 'the strip encloses the drop point vertically').toBeLessThanOrEqual(stood.y + stood.height);

  // Tile 5 is Line: clicking where the drag ended picks Line, proving the grabbed
  // tile stayed under the pointer across the turn.
  await browser.mouse.move(drop.x, drop.y);
  await browser.mouse.down();
  await browser.mouse.up();
  await expect(
    rail(ui).getByRole('button', { name: 'Line', pressed: true }),
    'the tile under the pointer at the press is still under it after the turn',
  ).toBeVisible();
});

test('a pointer within 16 px of a diagonal keeps the strip’s orientation, and past the band it turns', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);

  const opened = await railPlace(ui, TOP_BAND);
  const grip = tileCentre(boxOfPlace(opened), 3);

  // In a 1280×800 editor the top-left diagonal is y = 0.625 * x, so at x = 320
  // the diagonal is at y = 200. (320, 210) is ~8.5 px into the left space
  // (inside the 16 px hold band); (320, 230) is ~25.4 px past it.
  await browser.mouse.move(grip.x, grip.y);
  await browser.mouse.down();
  await browser.mouse.move(320, 210);
  await settle(ui);
  const within = (await shot(ui)).darkBounds({ x: 120, y: 120, width: 400, height: 200 }, 0.6);
  expect(within, 'the strip is visible inside the hold band').not.toBeNull();
  expect(within!.width, 'within 16 px of the diagonal, the strip keeps lying').toBeGreaterThan(within!.height * 2);

  await browser.mouse.move(320, 230);
  await settle(ui);
  const past = (await shot(ui)).darkBounds({ x: 220, y: 60, width: 200, height: 400 }, 0.6);
  expect(past, 'the strip is visible past the hold band').not.toBeNull();
  expect(past!.height, 'past 16 px from the diagonal, the strip turns to standing').toBeGreaterThan(past!.width * 2);

  await browser.mouse.up();
  await settle(ui);
});

test('a drop stores centre fractions and orientation, and a reload starts there', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);

  const opened = await railPlace(ui, TOP_BAND);
  await drag(ui, tileCentre(boxOfPlace(opened), 3), { x: 760, y: 640 });
  await settle(ui);

  const band: Rect = { x: 560, y: 540, width: 400, height: 200 };
  const dropped = await railPlace(ui, band);
  const stored = await keptPlace(ui);
  expect(stored, 'the drop stores a place').not.toBeNull();
  expect(stored!.orientation, 'the stored orientation is lying').toBe('lying');
  expect(Math.abs(stored!.x - dropped.centreX / 1280), 'stored x is the centre fraction').toBeLessThan(0.01);
  expect(
    Math.abs(stored!.y - (dropped.top + dropped.height / 2) / 800),
    'stored y is the centre fraction',
  ).toBeLessThan(0.01);

  await openBare(ui);
  expectHeld(dropped, await railPlace(ui, band), 'reload');
});

test('pan, zoom, Zoom to fit and opening another Scene leave the strip where it was', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  const smallScene = JSON.stringify(
    {
      version: 1,
      title: 'Small',
      defaults: { roughness: 0 },
      elements: [{ id: 'box', type: 'rectangle', x: 40, y: 40, width: 120, height: 80 }],
    },
    null,
    2,
  );
  await openEditor(ui, { A: { 'one.json': smallScene, 'two.json': BARE_SOURCE } }, 'one.json');
  await settle(ui);

  const opened = await railPlace(ui, TOP_BAND);
  await drag(ui, tileCentre(boxOfPlace(opened), 3), { x: 960, y: 660 });
  await settle(ui);

  const band: Rect = { x: 760, y: 560, width: 400, height: 200 };
  const before = await railPlace(ui, band);

  // Pan with Space-drag on the canvas, moving the diagram up-left away from the strip.
  await browser.keyboard.down('Space');
  await drag(ui, { x: 520, y: 460 }, { x: 400, y: 400 });
  await browser.keyboard.up('Space');
  await settle(ui);
  expectHeld(before, await railPlace(ui, band), 'pan');

  // Zoom in via the command palette.
  const commands = screen.getByRole('dialog', { name: 'Commands' });
  await browser.keyboard.press('q');
  await expect(commands).toBeVisible();
  await browser.keyboard.type('zoom in');
  await browser.keyboard.press('Enter');
  await expect(commands).toBeHidden();
  await settle(ui);
  expectHeld(before, await railPlace(ui, band), 'zoom in');

  // Zoom to fit via the command palette.
  await browser.keyboard.press('q');
  await expect(commands).toBeVisible();
  await browser.keyboard.type('zoom to fit');
  await browser.keyboard.press('Enter');
  await expect(commands).toBeHidden();
  await settle(ui);
  expectHeld(before, await railPlace(ui, band), 'Zoom to fit');

  // Open another Scene from the folder drawer.
  await screen.getByRole('button', { name: /Open folder/ }).click();
  await screen.getByRole('button', { name: 'two.json', exact: true }).click();
  await settle(ui);
  expectHeld(before, await railPlace(ui, band), 'opening another Scene');
});

test('a window resize keeps the strip’s centre at the same fraction of the editor’s box', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);

  const opened = await railPlace(ui, TOP_BAND);
  await drag(ui, tileCentre(boxOfPlace(opened), 3), { x: 860, y: 600 });
  await settle(ui);

  const stored = await keptPlace(ui);
  expect(stored, 'the drop stores centre fractions').not.toBeNull();

  await browser.setViewport({ width: 960, height: 600 });
  await settle(ui);

  const expectedX = stored!.x * 960;
  const expectedY = stored!.y * 600;
  const ink = await railInk(ui, {
    x: Math.round(expectedX - 200),
    y: Math.round(expectedY - 80),
    width: 400,
    height: 160,
  });
  expect(
    Math.abs(ink.x + ink.width / 2 - expectedX),
    'the strip’s horizontal centre stays at the stored fraction',
  ).toBeLessThan(4);
  expect(
    Math.abs(ink.y + ink.height / 2 - expectedY),
    'the strip’s vertical centre stays at the stored fraction',
  ).toBeLessThan(4);
  expect(await keptPlace(ui), 'a window resize keeps the stored fractions').toEqual(stored);
});

test('a stored old side word starts the strip at that edge’s middle, 16 px in, standing', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.addInitScript(() => localStorage.setItem('esbozo.rail', 'right'));
  await openBare(ui);

  const ink = await railInk(ui, { x: 1160, y: 200, width: 120, height: 400 });
  expect(ink.height, 'the strip stands along the right edge').toBeGreaterThan(ink.width * 2);
  expect(1280 - (ink.x + ink.width), 'the strip rests 16 px inside the right edge').toBeGreaterThan(4);
  expect(1280 - (ink.x + ink.width), 'the strip rests 16 px inside the right edge').toBeLessThan(24);
  expect(Math.abs(ink.y + ink.height / 2 - 800 / 2), 'the strip is centred vertically').toBeLessThan(4);
});

test('in an editor too short for a standing strip, a drop in the left space falls back to lying inside the box', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui, { width: 600, height: 240 });

  const opened = await railPlace(ui, { x: 140, y: 0, width: 340, height: 100 });
  await drag(ui, tileCentre(boxOfPlace(opened), 3), { x: 100, y: 120 });
  await settle(ui);

  const ink = await railInk(ui, { x: 0, y: 50, width: 420, height: 140 });
  expect(ink.width, 'the strip falls back to lying when too short to stand').toBeGreaterThan(ink.height * 2);
  expect(ink.x, 'the strip stays inside the left edge').toBeGreaterThanOrEqual(0);
  expect(ink.x + ink.width, 'the strip stays inside the right edge').toBeLessThanOrEqual(600);
  expect(ink.y, 'the strip stays inside the top edge').toBeGreaterThanOrEqual(0);
  expect(ink.y + ink.height, 'the strip stays inside the bottom edge').toBeLessThanOrEqual(240);
});

