/**
 * Seam 2: the frame the tool rail hangs on.
 *
 * A Scene opens with the rail docked on the frame around its diagram: the
 * diagram's box on screen, at least 960×600 about its centre and cut to the
 * editor's box, with the rail's pencil outline one gap outside the side it hangs
 * on — the top, or any of the four once the palette moves it — and just inside
 * the editor's own edge when the frame leaves no room for it. Asserted on the ink
 * a screenshot holds, never on a box the page reports.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  openEditor,
  browseFolder,
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
import { fullInk, zoomReadout } from './editor-shared.ts';
import { blurPage, cancelTouch, cursorAt, livePage, touchCarry } from './cdp.ts';
import { shot } from './pixels.ts';
import type { Rect, Shot } from './pixels.ts';

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

/** A diagram far smaller than the frame's minimum: a thumbprint of a box. */
const TINY_SOURCE = JSON.stringify(
  {
    version: 1,
    title: 'Tiny',
    defaults: { roughness: 0 },
    elements: [{ id: 'tiny', type: 'rectangle', x: 40, y: 40, width: 40, height: 40, fill: { kind: 'solid', grey: 6 } }],
  },
  null,
  2,
);

/** A diagram wider than any window's fitted margin, so the fitted zoom follows the window. */
const WIDE_SOURCE = JSON.stringify(
  {
    version: 1,
    title: 'Wide',
    defaults: { roughness: 0 },
    elements: [
      { id: 'wide', type: 'rectangle', x: 0, y: 0, width: 2400, height: 700, fill: { kind: 'solid', grey: 6 } },
    ],
  },
  null,
  2,
);

/** A diagram taller than any window's fitted margin, so its frame's top moves a long way. */
const TALL_SOURCE = JSON.stringify(
  {
    version: 1,
    title: 'Tall',
    defaults: { roughness: 0 },
    elements: [
      { id: 'tall', type: 'rectangle', x: 0, y: 0, width: 400, height: 3000, fill: { kind: 'solid', grey: 6 } },
    ],
  },
  null,
  2,
);

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

/** A dock by name, the way a person moves it: the palette has no key, button or grip (D8). */
async function dockRail(ui: Ui, side: 'top' | 'bottom' | 'left' | 'right'): Promise<void> {
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

/**
 * The strip's fade to full ink, slowed down so a run can catch it mid-fade.
 *
 * Focusing a tile fades the strip from 0.58 to 1 over 0.22 s (`editor.css`). A
 * screenshot taken during that fade holds the tiles' ink while the pencil
 * outline around them is still too pale to pass the ink threshold, so the same
 * strip reads 26 px down instead of 8 px. Linux CI lost that race on main
 * (issue #29b); this hands every machine the same race, and no run gets lucky.
 */
async function slowFade(ui: Ui, seconds: number): Promise<void> {
  const slowed = await ui.browser.evaluate((duration) => {
    const strip = document.querySelector('esbozo-editor nav[aria-label="Tools"]');
    if (!(strip instanceof HTMLElement)) {
      return false;
    }
    strip.style.setProperty('transition-duration', `${duration}s`);
    return true;
  }, seconds);
  expect(slowed, 'the strip is the one this test slowed down').toBe(true);
}

/** The side the page keeps for the next start, or null while it keeps none. */
async function keptSide(ui: Ui): Promise<string | null> {
  return ui.browser.evaluate(() => localStorage.getItem('esbozo.rail'));
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

/** Make the page's folder picker answer with a long failure, or answer as the stub again. */
async function failPicking(ui: Ui, words: string | null): Promise<void> {
  await ui.browser.evaluate((message) => {
    const api = window as unknown as {
      showDirectoryPicker: (() => Promise<unknown>) | undefined;
      __picked: (() => Promise<unknown>) | undefined;
    };
    if (message === null) {
      api.showDirectoryPicker = api.__picked;
    } else {
      api.__picked = api.showDirectoryPicker;
      api.showDirectoryPicker = async () => {
        throw new Error(message);
      };
    }
    return true;
  }, words);
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

test('an empty Scene hangs the rail above a centred 960×600 frame, 20 px down at 1280×800', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);

  // The frame is 960×600 about the editor's middle, so its top side is 100 px
  // down; the strip's outline hangs the 16 px gap above it, and the strip is
  // 63 px tall, so the outline's top is about 20 px down. The tilt leans the
  // strip, so a couple of pixels either way is the look, not the place.
  const ink = await railInk(ui, { x: 400, y: 0, width: 480, height: 240 });
  expect(ink.y, 'the outline hangs above the frame').toBeGreaterThan(10);
  expect(ink.y, 'the outline hangs above the frame').toBeLessThan(28);

  // Horizontal: seven tiles wide against one tile tall.
  expect(ink.width).toBeGreaterThan(ink.height * 2);

  // Centred on the frame, which is centred on the editor: a strip turned about
  // its own middle keeps that middle where it was.
  expect(Math.abs(ink.x + ink.width / 2 - 1280 / 2), 'the strip is centred').toBeLessThan(4);
});

test('an empty Scene opened at 1280×760 keeps the frame’s gap, so the rail hangs about 1 px down', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui, { width: 1280, height: 760 });

  // The same 960×600 frame, its top side 80 px down in this window: the 16 px gap
  // and the 63 px outline leave the strip's box at 8 px and its outline at 1. A
  // dock pulled to the 15 px inset would sit the box at 15 and the outline at 8,
  // cutting the gap to 9 px, which is what this window shows of a clamp that
  // moves a rail already inside the editor.
  const ink = await railInk(ui, { x: 400, y: 0, width: 480, height: 240 });
  expect(ink.y, 'the measured dock holds the frame’s gap').toBeLessThan(5);
  expect(ink.width, 'the strip is the whole strip').toBeGreaterThan(ink.height * 2);
  expect(Math.abs(ink.x + ink.width / 2 - 1280 / 2), 'the strip is centred').toBeLessThan(4);
});

test('an empty Scene at 3440×1440 hangs the rail about 340 px down', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openBare(ui, { width: 3440, height: 1440 });

  // The same 960×600 frame, whose top side is 420 px down in a window this
  // tall: 420, less the 16 px gap and the 63 px strip, is about 340 px down.
  const ink = await railInk(ui, { x: 1320, y: 0, width: 800, height: 480 });
  expect(ink.y, 'the outline hangs above the frame').toBeGreaterThan(330);
  expect(ink.y, 'the outline hangs above the frame').toBeLessThan(352);
  expect(ink.width).toBeGreaterThan(ink.height * 2);
  expect(Math.abs(ink.x + ink.width / 2 - 3440 / 2), 'the strip is centred').toBeLessThan(4);
});

test('a diagram larger than the frame keeps the rail a gap above its own box, centred on it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 3440, height: 1440 });
  await openEditor(ui, { A: { 'big.json': BIG_SOURCE } }, 'big.json');
  await settle(ui);

  // The 1000×700 box is shown 1:1 in the middle of the window: its top stroke
  // is 370 px down. The strip is measured in a band that stops above that
  // stroke, and the box in one beside the strip's own reach.
  await rail(ui).getByRole('button', 'Select').focus();
  await fullInk(ui);
  const stripBand: Rect = { x: 1400, y: 0, width: 640, height: 366 };
  await expect
    .poll(async () => (await shot(ui)).darkBounds(stripBand, 0.6) !== null, { timeout: 5000 })
    .toBe(true);
  const picture = await shot(ui);
  const strip = picture.darkBounds(stripBand, 0.6)!;
  const box = picture.darkBounds({ x: 1230, y: 340, width: 330, height: 740 }, 0.6)!;

  // One gap above the diagram's own box, not the minimum's: the outline clears
  // the box, less the strip's tilt and the stroke the box paints outside its
  // bounds. Had the minimum framed it, the strip would be 50 px higher.
  const gap = box.y - (strip.y + strip.height);
  expect(gap, 'the outline clears the diagram by the gap').toBeGreaterThan(6);
  expect(gap, 'the outline clears the diagram by the gap').toBeLessThan(24);
  expect(strip.y, 'the dock follows the diagram, not the minimum').toBeLessThan(330);

  // Centred: the fitted page puts the diagram's middle at the window's, and the
  // strip's middle is on it.
  expect(Math.abs(strip.x + strip.width / 2 - 3440 / 2), 'the strip is centred').toBeLessThan(4);
});

test('a tiny diagram is framed at the minimum, so the rail clears it by far', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'tiny.json': TINY_SOURCE } }, 'tiny.json');
  await settle(ui);

  // The 40×40 box is a mark in the middle of the window; the frame around it is
  // the minimum, so the strip hangs where an empty Scene's does, 20 px down.
  const strip = await railInk(ui, { x: 400, y: 0, width: 480, height: 240 });
  expect(strip.y).toBeGreaterThan(10);
  expect(strip.y).toBeLessThan(28);
  expect(Math.abs(strip.x + strip.width / 2 - 1280 / 2), 'the strip is centred').toBeLessThan(4);

  // The diagram itself is nowhere near the strip: the frame, not the mark, is
  // what the rail is measured against.
  const mark = (await shot(ui)).darkBounds({ x: 560, y: 300, width: 180, height: 200 }, 0.6)!;
  expect(mark.y - (strip.y + strip.height)).toBeGreaterThan(200);
});

test('a diagram with no room above it puts the rail 15 px inside the editor top edge', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  // A short window: the diagram's frame is cut by the editor's own box, whose
  // top side leaves no room for the strip above it.
  await browser.setViewport({ width: 1280, height: 300 });
  await openEditor(ui, { A: { 'big.json': BIG_SOURCE } }, 'big.json');
  await settle(ui);

  const ink = await railInk(ui, { x: 400, y: 0, width: 480, height: 140 });
  expect(ink.y, 'the strip stops just inside the editor top edge').toBeGreaterThan(2);
  expect(ink.y, 'the strip stops just inside the editor top edge').toBeLessThan(18);
  expect(Math.abs(ink.x + ink.width / 2 - 1280 / 2), 'the strip is centred').toBeLessThan(4);
});

test('the rail is measured at its full ink, not at the tiles a fade shows first', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 1280, height: 300 });
  await openEditor(ui, { A: { 'big.json': BIG_SOURCE } }, 'big.json');
  await settle(ui);

  // Two seconds of fade: no screenshot can slip past it, and the reading is
  // taken while the strip is still on its way to the ink a person sees.
  await slowFade(ui, 2);
  const ink = await railInk(ui, { x: 400, y: 0, width: 480, height: 140 });
  expect(ink.y, 'the reading is the outline, not the tiles below it').toBeGreaterThan(2);
  expect(ink.y, 'the reading is the outline, not the tiles below it').toBeLessThan(18);
});

test('a resize keeps the rail’s offset from the middle, pulls it inside, and growing back restores it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui, { width: 3440, height: 1440 });
  const band: Rect = { x: 1320, y: 0, width: 800, height: 480 };
  const before = await railPlace(ui, band);

  // The empty Scene's frame is the 960×600 minimum about the editor's middle, so
  // the strip's outline top is 341 px down: 720 − 300 − 16 − 63 + 7. Its middle is
  // the window's own, at 1720.
  expect(before.top).toBeGreaterThan(330);
  expect(before.top).toBeLessThan(352);
  expect(Math.abs(before.centreX - 1720)).toBeLessThan(4);

  // A short window: the 372 px the strip sat above the middle is now outside the
  // editor's box, so the strip stops 15 px inside its top edge, its outline 8 px
  // down. Sideways nothing was measured away from the middle, so it stays there.
  await browser.setViewport({ width: 3440, height: 500 });
  await settle(ui);
  const squeezed = await railPlace(ui, { x: 1320, y: 0, width: 800, height: 240 });
  expect(squeezed.top).toBeGreaterThan(2);
  expect(squeezed.top).toBeLessThan(16);
  expect(Math.abs(squeezed.centreX - 1720)).toBeLessThan(4);

  // A window that holds the whole 246 px outline, with the same dock: the strip
  // sits 15 px in and its ink runs 8..254, all of it on screen. This is the
  // strip the narrower window below has to be a cut of.
  await browser.setViewport({ width: 262, height: 500 });
  await settle(ui);
  const whole = await railPlace(ui, { x: 0, y: 0, width: 262, height: 240 });
  expect(whole.centreX - whole.width / 2, 'the whole outline starts at the inset').toBeGreaterThan(2);
  expect(whole.centreX + whole.width / 2, 'the whole outline is on screen').toBeLessThan(258);
  const edge: Rect = { x: 0, y: 0, width: 196, height: 240 };
  const part = (await shot(ui)).darkBounds(edge, 0.6)!;
  // The pressed Select tile is the 30 px tile main draws, filled with the ink a
  // tool in hand wears: the strip's contents are at their real size.
  const tile = (await shot(ui)).darkBounds({ x: 18, y: 20, width: 34, height: 44 }, 0.6)!;
  expect(tile.width, 'the tile is main’s own tile').toBeGreaterThan(26);

  // A window narrower than the strip's own 246 px outline: no place keeps it in,
  // so the left inset wins and the far edge clips it. What the window shows is the
  // strip's whole width from that inset to the edge — 200 − 15, so its ink runs on
  // to the edge — not a narrower strip: the rail never shrinks, wraps or turns by
  // itself (O3).
  await browser.setViewport({ width: 200, height: 500 });
  await settle(ui);
  const narrow = await railPlace(ui, { x: 0, y: 0, width: 200, height: 240 });
  expect(narrow.centreX - narrow.width / 2).toBeGreaterThan(2);
  expect(narrow.centreX - narrow.width / 2).toBeLessThan(16);
  expect(Math.abs(narrow.height - before.height)).toBeLessThan(3);
  expect(200 - (narrow.centreX + narrow.width / 2), 'the strip runs on to the far edge').toBeLessThan(
    4,
  );

  // Cut, not shrunk. The tile the narrow window holds is still main's own 30 px
  // tile, at its own size, so the strip is the same rail with its far end off
  // screen; and the width it shows plus the part the edge takes away is the whole
  // strip's width, measured in the window that holds it.
  const cutTile = (await shot(ui)).darkBounds({ x: 18, y: 20, width: 34, height: 44 }, 0.6)!;
  expect(Math.abs(cutTile.width - tile.width), 'the tiles keep main’s own size').toBeLessThan(2);
  const beyond = whole.centreX + whole.width / 2 - 200;
  expect(narrow.width + beyond, 'the strip is cut, not shrunk').toBeGreaterThan(whole.width - 4);
  expect(narrow.width + beyond, 'the strip is cut, not shrunk').toBeLessThan(whole.width + 4);
  const rounded = (rect: Rect): Rect => ({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });
  expect(rounded((await shot(ui)).darkBounds(edge, 0.6)!), 'the window shows the strip’s own left part').toEqual(
    rounded(part),
  );

  // Growing the window back puts the rail back where the measurement had it: the
  // offset was kept through both resizes, not overwritten by the clamped place.
  await browser.setViewport({ width: 3440, height: 1440 });
  await settle(ui);
  expectHeld(before, await railPlace(ui, band), 'growing the window back');
});

test('Zoom to fit measures the frame again, so a rail a resize carried off it goes back on', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 3440, height: 1440 });
  await openEditor(ui, { A: { 'wide.json': WIDE_SOURCE } }, 'wide.json');
  await settle(ui);

  // The 2400×700 diagram is shown 1:1: its top side is 370 px down, so the strip's
  // outline hangs 291 px down, one gap above it.
  const opened = await railPlace(ui, { x: 1320, y: 0, width: 800, height: 362 });
  expect(opened.top).toBeGreaterThan(280);
  expect(opened.top).toBeLessThan(310);

  // A window that fits the same diagram at 0.46. The resize carries the rail's
  // 422 px offset with the middle, which puts the strip at 78 px — not on the
  // frame the fitted view leaves, which is what a fit has to measure again.
  const band: Rect = { x: 400, y: 0, width: 480, height: 260 };
  await browser.setViewport({ width: 1280, height: 1000 });
  await settle(ui);
  const carried = await railPlace(ui, band);
  expect(carried.top).toBeGreaterThan(60);
  expect(carried.top).toBeLessThan(82);

  // A pan and a zoom draw the page somewhere else and leave the rail where it
  // was: neither measures the frame (D3).
  await drag(ui, { x: 400, y: 600 }, { x: 420, y: 630 }, 'middle');
  await browser.mouse.move(640, 400);
  await browser.mouse.wheel(0, 240);
  await settle(ui);
  expectHeld(carried, await railPlace(ui, band), 'a pan and a zoom');

  // Zoom to fit draws the page one way only, whatever view it replaces, so this is
  // where the frame is measured again: the diagram's fitted box is 600 px tall, so
  // the strip's outline is 121 px down. Had nothing measured, it would stay at 71.
  await browser.keyboard.press('Meta+0');
  await settle(ui);
  const fitted = await railPlace(ui, band);
  expect(fitted.top).toBeGreaterThan(110);
  expect(fitted.top).toBeLessThan(132);
  expect(Math.abs(fitted.centreX - 1280 / 2), 'the strip is centred').toBeLessThan(4);
});

test('a new box, an edit, undo, a pan, a zoom, a selection and the Style menu all leave the rail', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const band: Rect = { x: 400, y: 0, width: 480, height: 240 };
  const opened = await railPlace(ui, band);
  // The empty Scene hangs the strip above the 960×600 minimum frame, 21 px down.
  expect(opened.top).toBeGreaterThan(10);
  expect(opened.top).toBeLessThan(28);

  /** One action, and the strip's ink where it already was. */
  const held = async (action: string): Promise<void> => {
    await settle(ui);
    expectHeld(opened, await railPlace(ui, band), action);
  };

  // A new box is a new Element, a new selection and a docked note for it: the
  // strip still stays where the Scene opened it (D3, D4, criterion 5).
  await screen.getByRole('button', 'Rectangle').click();
  await drag(ui, { x: 400, y: 300 }, { x: 600, y: 450 });
  await held('penning a new box');
  const drawn = await savedScene(ui, 'bare.json');

  // Moving the box it drew is an edit, and an edit is not an opening. The file the
  // editor saved says the box moved, so a checkpoint that only measured the rail
  // cannot pass with the drag left out.
  await drag(ui, { x: 500, y: 375 }, { x: 540, y: 405 });
  await held('moving a box');
  const moved = await savedScene(ui, 'bare.json');
  expect(moved.elements[0]?.x ?? 0, 'the drag moved the box across').toBeGreaterThan(
    drawn.elements[0]?.x ?? 0,
  );
  expect(moved.elements[0]?.y ?? 0, 'the drag moved the box down').toBeGreaterThan(
    drawn.elements[0]?.y ?? 0,
  );

  // Undo takes the move back; an undo opens nothing either (I3), and the file says
  // the box is back where it was drawn.
  await browser.keyboard.press('Meta+z');
  await held('undo');
  expect((await savedScene(ui, 'bare.json')).elements, 'the undo put the box back').toEqual(
    drawn.elements,
  );

  // A pan carries the page under a rail that floats over the paper.
  await drag(ui, { x: 300, y: 600 }, { x: 320, y: 630 }, 'middle');
  await held('a pan');

  // A zoom draws the page bigger, and the rail is the page's chrome, not its ink.
  await browser.mouse.move(640, 400);
  await browser.mouse.wheel(0, -240);
  await held('a zoom');

  // Dropping the selection closes the note, which is no measurement either.
  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog', 'Style')).toBeHidden();
  await held('dropping the selection');

  // Selecting the box is what opens the Style menu (D4): the menu makes room for
  // itself in the view, and the rail does not follow the view.
  const select = async (): Promise<void> => {
    await browser.mouse.move(450, 400);
    await browser.mouse.down();
    await browser.mouse.up();
  };
  await select();
  await expect(screen.getByRole('dialog', 'Style')).toBeVisible();
  await held('selecting');

  // The same menu, opened a second time: the strip has not moved by a pixel.
  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog', 'Style')).toBeHidden();
  await select();
  await expect(screen.getByRole('dialog', 'Style')).toBeVisible();
  await held('opening the Style menu');
});

test('opening another Scene measures the frame again instead of keeping the last dock', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 3440, height: 1440 });
  await openEditor(
    ui,
    { A: { 'bare.json': BARE_SOURCE, 'tall.json': TALL_SOURCE } },
    'bare.json',
  );
  await settle(ui);

  // The empty Scene's 960×600 minimum frame hangs the strip 341 px down.
  const bare = await railPlace(ui, { x: 1320, y: 0, width: 800, height: 480 });
  expect(bare.top).toBeGreaterThan(330);
  expect(bare.top).toBeLessThan(352);

  // Another Scene in the same window: the 400×3000 diagram fits 633 px tall, so
  // its frame's top side is 87 px down and the strip hangs at 8. Measured again,
  // not carried from the Scene the page opened first.
  await browseFolder(ui, 'A');
  await screen.getByRole('button', 'tall.json').click();
  await settle(ui);
  const tall = await railPlace(ui, { x: 1320, y: 0, width: 800, height: 240 });
  expect(tall.top).toBeGreaterThan(0);
  expect(tall.top).toBeLessThan(20);
  expect(Math.abs(tall.centreX - 1720), 'the strip is centred on the new frame').toBeLessThan(4);
});

/** Where the 1000×700 diagram of `BIG_SOURCE` draws, in two bands its ink can be measured in. */
const BIG_BOX: Rect = { x: 1210, y: 470, width: 1020, height: 200 };
const BIG_TOP: Rect = { x: 1400, y: 340, width: 640, height: 740 };
/** Where each dock's strip is measured, in a band the diagram's own ink is not in. */
const DOCK_BANDS: Record<'top' | 'bottom' | 'left' | 'right', Rect> = {
  top: { x: 1400, y: 0, width: 640, height: 364 },
  bottom: { x: 1400, y: 1076, width: 640, height: 360 },
  left: { x: 1000, y: 380, width: 208, height: 680 },
  right: { x: 2232, y: 380, width: 400, height: 680 },
};

test('an empty Scene’s left dock at 3440×1440 stands up, its outline about 1,160 px in', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui, { width: 3440, height: 1440 });
  await dockRail(ui, 'left');

  // The empty Scene's frame is the 960×600 minimum about the middle: its left
  // side is 1,240 px in, so the 60 px outline stands one 16 px gap outside it and
  // starts at about 1,164. A couple of pixels either way is the strip's tilt.
  const ink = await railInk(ui, { x: 1000, y: 300, width: 400, height: 840 });
  expect(ink.x, 'the outline starts about 1,160 px in').toBeGreaterThan(1150);
  expect(ink.x, 'the outline starts about 1,160 px in').toBeLessThan(1180);

  // Standing up the side, not lying along it: one tile wide, seven tiles tall.
  expect(ink.height, 'the strip stands up').toBeGreaterThan(ink.width * 2);

  // Centred on the frame's side, which is the editor's own middle here.
  expect(Math.abs(ink.y + ink.height / 2 - 1440 / 2), 'the strip is centred').toBeLessThan(4);
});

test('a diagram larger than the frame keeps every dock outside its box by the gap, centred', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 3440, height: 1440 });
  await openEditor(ui, { A: { 'big.json': BIG_SOURCE } }, 'big.json');
  await settle(ui);

  // The box the frame is, on screen: 1,220..2,220 across and 370..1,070 down. Its
  // left and right edges are measured in a band no dock reaches into, its top and
  // bottom in a band across the middle of it.
  const wide = (await shot(ui)).darkBounds(BIG_BOX, 0.6);
  const tall = (await shot(ui)).darkBounds(BIG_TOP, 0.6);
  if (wide === null || tall === null) {
    throw new Error('the diagram draws no ink in its own box');
  }
  expect(Math.abs(wide.x - 1220), 'the diagram is where the fitted view puts it').toBeLessThan(4);
  expect(Math.abs(wide.x + wide.width - 2220), 'the diagram is where the fitted view puts it').toBeLessThan(4);
  expect(Math.abs(tall.y - 370), 'the diagram is where the fitted view puts it').toBeLessThan(4);
  expect(Math.abs(tall.y + tall.height - 1070), 'the diagram is where the fitted view puts it').toBeLessThan(4);
  const box = { x: wide.x, y: tall.y, width: wide.width, height: tall.height };

  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    await dockRail(ui, side);
    const strip = await railInk(ui, DOCK_BANDS[side]);
    const across = side === 'top' || side === 'bottom' ? strip.x + strip.width / 2 : strip.y + strip.height / 2;
    const centre = side === 'top' || side === 'bottom' ? box.x + box.width / 2 : box.y + box.height / 2;
    const gaps = {
      top: box.y - (strip.y + strip.height),
      bottom: strip.y - (box.y + box.height),
      left: box.x - (strip.x + strip.width),
      right: strip.x - (box.x + box.width),
    };
    expect(gaps[side], `the ${side} dock clears the box by the gap`).toBeGreaterThan(6);
    expect(gaps[side], `the ${side} dock clears the box by the gap`).toBeLessThan(24);
    expect(Math.abs(across - centre), `the ${side} dock is centred on the box’s side`).toBeLessThan(4);
    // The side sets the orientation: horizontal along the top and bottom.
    const standing = side === 'left' || side === 'right';
    expect(
      standing ? strip.height > strip.width * 2 : strip.width > strip.height * 2,
      `the ${side} dock ${standing ? 'stands up' : 'lies along'} the side`,
    ).toBe(true);
  }
});

test('a dock in a very small editor clears the status, so every tile takes its own press', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 360, height: 330 });
  await openBare(ui);

  /**
   * Every tile of one dock takes the press a person would make on it: the pointer
   * reaches the tile at its own middle, and the tile is the tool in hand after it.
   * The status chrome sits above the rail, so a strip hanging under a corner there
   * hands its nearest tile's press to another control (O2).
   */
  const pressEveryTile = async (side: 'top' | 'bottom' | 'left' | 'right', window: { width: number; height: number }) => {
    await dockRail(ui, side);
    for (const name of TILES) {
      const tile = rail(ui).getByRole('button', name);
      await tile.click({ timeout: PRESS_TIMEOUT });
      await expect(
        rail(ui).getByRole('button', name, { pressed: true }),
        `a press at the middle of ${name} picks it, on the ${side} dock at ${window.width}×${window.height}`,
      ).toBeVisible();
    }
  };

  // A window that holds the horizontal strip but leaves the status in its way: the
  // bottom dock meets the mode corner and the top the Scene's own name.
  for (const side of ['top', 'bottom'] as const) {
    await pressEveryTile(side, { width: 360, height: 330 });
  }

  // Standing up the side of a short editor, the left dock's middle meets the
  // top-left status, which would take its top tiles' presses.
  await browser.setViewport({ width: 360, height: 240 });
  await settle(ui);
  await pressEveryTile('left', { width: 360, height: 240 });

  // The right dock may sit under the Style menu while it is open, and the status
  // chrome is what its tiles still have to clear.
  await browser.setViewport({ width: 360, height: 330 });
  await settle(ui);
  await pressEveryTile('right', { width: 360, height: 330 });
});

test('a left dock moved clear of the bottom status stops clear of the Shortcuts box too', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 1280, height: 800 });
  await openBare(ui);
  await browser.setViewport({ width: 280, height: 266 });
  await settle(ui);
  await dockRail(ui, 'left');

  // The strip stopped at the editor's inset meets the bottom left corner first, and
  // the room it takes to clear that corner is the room the Shortcuts button stands
  // in: a move measured against the one corner it met would stop under the other.
  // The press says which control got it, and the pointer is a person's.
  await rail(ui).getByRole('button', 'Text').click({ timeout: PRESS_TIMEOUT });
  await expect(rail(ui).getByRole('button', 'Text', { pressed: true })).toBeVisible();
  await expect(screen.getByRole('dialog', { name: 'Shortcuts' })).toBeHidden();
});

test('an open hangs the rail clear of the status that open leaves, as a dock there does', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  const long = `${'L'.repeat(37)}.json`;
  await browser.setViewport({ width: 360, height: 330 });
  await openEditor(ui, { A: { 'a.json': BARE_SOURCE, [long]: BARE_SOURCE } }, long);
  await settle(ui);

  /**
   * How far down the page the strip's ink reaches. The Scene is bare paper, so the
   * only ink above the band's floor is the strip's own and the words in the status
   * corner: the strip is the lower of the two, and its foot is where it hangs.
   */
  const band: Rect = { x: 0, y: 0, width: 360, height: 240 };
  const foot = async (): Promise<number> => {
    const ink = await railInk(ui, band);
    return ink.y + ink.height;
  };

  // The status the open leaves is part of the chrome the rail clears: a Scene's
  // name adds the row the save message sits in, and a dock beside it measures the
  // corner as it is afterwards. An open that measured the corner before its own
  // save message arrived would hang the strip over that message.
  const opened = await foot();
  await dockRail(ui, 'top');
  const docked = await foot();
  expect(
    Math.abs(opened - docked),
    'a first open hangs the strip where the same dock hangs it',
  ).toBeLessThan(3);

  // A folder that will not be picked says so in the same corner, at as many lines
  // as the words take. The next good open must not keep the room that answer took.
  await failPicking(ui, 'Folder unavailable; the file provider cannot open the folder right now. '.repeat(4));
  await screen.getByRole('button', { name: /Open folder/ }).click();
  await expect(screen.getByRole('status').filter({ hasText: 'Folder unavailable' })).toBeVisible();
  await failPicking(ui, null);

  await screen.getByRole('button', { name: /Open folder/ }).click();
  await screen.getByRole('button', { name: 'a.json', exact: true }).click();
  await expect(screen.getByRole('status').filter({ hasText: 'saved' })).toBeVisible();
  const recovered = await foot();
  await dockRail(ui, 'top');
  const redocked = await foot();
  expect(
    Math.abs(recovered - redocked),
    'an open after a failed pick hangs the strip where the same dock hangs it',
  ).toBeLessThan(3);
});

test('a status corner that grows after the strip is placed hangs it where a dock that measured the corner hangs it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  const long = 'Folder unavailable; the file provider cannot open the folder right now. '.repeat(4);
  await browser.setViewport({ width: 360, height: 330 });
  await openBare(ui);

  /** How far down the page the strip's ink reaches: the corner's words are above it. */
  const TOP_BAND: Rect = { x: 0, y: 0, width: 360, height: 240 };
  const foot = async (): Promise<number> => {
    const ink = await railInk(ui, TOP_BAND);
    return ink.y + ink.height;
  };
  /** How far down the page the strip's ink starts: the pill's words are below it. */
  const BOTTOM_BAND: Rect = { x: 0, y: 150, width: 360, height: 180 };
  const top = async (): Promise<number> => (await railInk(ui, BOTTOM_BAND)).y;

  // The corner above the strip is as tall as the words it holds, and a folder's
  // failure says more than a Scene's name does. The words are drawn above the rail,
  // so a strip that kept the room they took before they arrived hangs under them.
  await failPicking(ui, long);
  await screen.getByRole('button', { name: /Open folder/ }).click();
  await expect(screen.getByRole('status').filter({ hasText: 'Folder unavailable' })).toBeVisible();
  await dockRail(ui, 'top');
  const tall = await foot();

  // The corner an open leaves is the short one, and a strip placed against it stands
  // higher up the page.
  await failPicking(ui, null);
  await screen.getByRole('button', { name: /Open folder/ }).click();
  await screen.getByRole('button', { name: 'bare.json', exact: true }).click();
  await expect(screen.getByRole('status').filter({ hasText: 'saved' })).toBeVisible();
  await settle(ui);
  expect(await foot(), 'the short corner leaves the strip higher up').toBeLessThan(tall - 20);

  // The same words arrive again under a strip already placed, and the corner is
  // measured again: the strip hangs where a dock made with those words in the corner
  // hangs it, rather than keeping the room the short corner gave back.
  await failPicking(ui, long);
  await screen.getByRole('button', { name: /Open folder/ }).click();
  await expect(screen.getByRole('status').filter({ hasText: 'Folder unavailable' })).toBeVisible();
  await settle(ui);
  expect(
    Math.abs((await foot()) - tall),
    'a corner that grows after the placement hangs the strip where a dock that measured it does',
  ).toBeLessThan(3);
  await eachTileTakesItsPress(ui, 'under a corner that grew on the top dock');
  await failPicking(ui, null);

  // The mode the page is in is the other corner that grows under a placed strip: a
  // Space held names the pan in the pill at the bottom, which is what a bottom dock
  // hangs above.
  await dockRail(ui, 'bottom');
  const inset = await top();
  await browser.keyboard.down('Space');
  await expect(screen.getByText('Panning')).toBeVisible();
  await settle(ui);
  expect(await top(), 'the pill that arrives after the placement moves the strip in clear of it').toBeLessThan(
    inset - 20,
  );
  await eachTileTakesItsPress(ui, 'above a pill that arrived on the bottom dock');

  // The pill goes with the pan, and the corner that shrinks gives the room back.
  await browser.keyboard.up('Space');
  await settle(ui);
  expect(Math.abs((await top()) - inset), 'the corner that shrinks puts the strip back').toBeLessThan(3);
});

test('a corner that grows while a press holds the strip leaves it still, and the release clears it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 360, height: 330 });
  await openBare(ui);
  await dockRail(ui, 'bottom');

  // A press on a tile is a press a person is making: the pointer is on the strip,
  // and no corner arriving under it may carry the strip out from under that hand.
  // The pan is named in the pill at the bottom of the status bar while it lasts,
  // which is the room the bottom dock hangs over.
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

test('a drag released over the status docks the strip clear of it, so every tile takes its press', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 360, height: 330 });
  await openBare(ui);

  // The top dock hangs below the Scene's own name, so the strip's own band starts
  // under it: the words in the corner are ink too, and they are no part of where
  // the strip is.
  const upper: Rect = { x: 0, y: 74, width: 360, height: 100 };
  const opened = await railPlace(ui, upper);

  // A person carries the strip down to the bottom side of a short editor, where the
  // editor's own inset stops it: the status bar's rows are over the place the
  // release lands, and a strip hung on the frame alone (D3) hands its nearest
  // tiles' presses to Grid and Shortcuts (O2).
  await drag(ui, tileCentre(boxOfPlace(opened), 1), { x: 180, y: 300 });
  await settle(ui);
  const lower: Rect = { x: 0, y: 150, width: 360, height: 110 };
  const landed = await railPlace(ui, lower);
  expect(landed.top, 'the release docks the strip along the bottom').toBeGreaterThan(lower.y + 20);

  await eachTileTakesItsPress(ui, 'on a strip a drag released over the status bar');
});

test('a corner that grows over a dragged strip hangs it clear, and the corner that shrinks gives the place back', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 360, height: 330 });
  await openBare(ui);
  const upper: Rect = { x: 0, y: 74, width: 360, height: 100 };
  const opened = await railPlace(ui, upper);

  // The strip a person dragged hangs where their release docked it, which is the
  // place this corner later grows over: the pan is named in the pill of the bottom
  // status corner, and the band stops above the pill's own words.
  await drag(ui, tileCentre(boxOfPlace(opened), 1), { x: 180, y: 300 });
  await settle(ui);
  const lower: Rect = { x: 0, y: 150, width: 360, height: 110 };
  const dragged = await railPlace(ui, lower);

  await browser.keyboard.down('Space');
  await expect(screen.getByText('Panning')).toBeVisible();
  await settle(ui);
  const grew = await railPlace(ui, lower);
  expect(grew.top, 'a corner that grew over the dragged strip hangs it in clear of the pill').toBeLessThan(
    dragged.top - 20,
  );
  expect(
    Math.abs(grew.centreX - dragged.centreX),
    'the strip slides in clear across its side and keeps the place the drag gave it along it',
  ).toBeLessThan(3);
  await eachTileTakesItsPress(ui, 'on a dragged strip a corner grew over');

  // The pill goes with the pan, and the strip returns to the place the drag left it
  // in rather than to a place the corner's arrival chose.
  await browser.keyboard.up('Space');
  await settle(ui);
  expect(
    Math.abs((await railPlace(ui, lower)).top - dragged.top),
    'the corner that shrinks gives the dragged strip its own place back',
  ).toBeLessThan(3);
});

test('a resize hangs the strip on the frame again, clear of the corners that stayed behind', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 360, height: 330 });
  await openBare(ui);
  await dockRail(ui, 'bottom');

  // The bottom dock of this short window hangs 45 px in to clear its two bottom
  // corners. A wider window sets those corners back from the strip's own middle,
  // and the frame's dock there needs none of that room: the resize hangs the
  // strip where a dock on the same side hangs it.
  await browser.setViewport({ width: 900, height: 330 });
  await settle(ui);
  const wide: Rect = { x: 300, y: 230, width: 300, height: 100 };
  const resized = await railPlace(ui, wide);
  await dockRail(ui, 'bottom');
  const redocked = await railPlace(ui, wide);
  expect(
    Math.abs(resized.top - redocked.top),
    'a wider window hangs the strip where the same dock hangs it',
  ).toBeLessThan(3);
  expect(
    Math.abs(resized.centreX - redocked.centreX),
    'the resize keeps the strip’s place along its side',
  ).toBeLessThan(3);

  // The window back to its short size brings those corners over the place the
  // wide dock hangs on, and a dock measured here clears them: every tile of the
  // strip the resize left takes its own press.
  await browser.setViewport({ width: 360, height: 330 });
  await settle(ui);
  await eachTileTakesItsPress(ui, 'on the bottom dock a shrunken window left under the status');
});

test('a shorter window keeps the strip clear of the corner its lost height brings over it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  const long = `${'L'.repeat(37)}.json`;
  await browser.setViewport({ width: 360, height: 550 });
  await openEditor(ui, { A: { 'a.json': BARE_SOURCE, [long]: BARE_SOURCE } }, long);
  await settle(ui);
  await failPicking(ui, 'Folder unavailable; the file provider cannot open the folder right now. '.repeat(4));
  await screen.getByRole('button', { name: /Open folder/ }).click();
  await expect(screen.getByRole('status').filter({ hasText: 'Folder unavailable' })).toBeVisible();
  await failPicking(ui, null);

  // The top dock hangs below the Scene's name and the folder's answer, which are
  // the corner nearest it. A window 100 px shorter puts the frame's own dock 15 px
  // inside the top edge, under that corner: the room the strip needed was measured
  // in a window that is gone.
  const band: Rect = { x: 0, y: 0, width: 360, height: 240 };
  const foot = async (): Promise<number> => {
    const ink = await railInk(ui, band);
    return ink.y + ink.height;
  };
  await browser.setViewport({ width: 360, height: 450 });
  await settle(ui);
  const shrunk = await foot();
  await eachTileTakesItsPress(ui, 'on the top dock a shorter window brought a corner over');
  await dockRail(ui, 'top');
  const redocked = await foot();
  expect(
    Math.abs(shrunk - redocked),
    'a shorter window hangs the strip where the same dock hangs it',
  ).toBeLessThan(3);
});

test('the left dock stands the strip up, faint until it is looked at, its outline around all seven', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  await dockRail(ui, 'left');

  // Faint, the strip's washes and glyphs are lighter than the ink a person reads
  // as drawn, so the strip's own band holds no dark pixel at all: what shows
  // there is the emptiness the rail leaves until it is looked at. The band starts
  // below the Select tile, which wears the ink a tool in hand does.
  const TILES_BAND: Rect = { x: 40, y: 340, width: 160, height: 190 };
  expect((await shot(ui)).darkCount(TILES_BAND, 0.6), 'the rail is faint until it is looked at').toBe(0);
  const ink = await railInk(ui, { x: 0, y: 240, width: 200, height: 320 });
  await expect
    .poll(async () => (await shot(ui)).darkCount(TILES_BAND, 0.6), { timeout: 5000 })
    .toBeGreaterThan(100);

  // Standing up the side the frame put it on.
  expect(ink.height, 'the strip stands up').toBeGreaterThan(ink.width * 2);

  // The pencil outline is a closed strip around the seven tiles: ink on each of
  // its four mid-edges, in the padding around them, so no glyph can answer for it.
  const picture = await shot(ui);
  const surround: Array<[string, Rect]> = [
    ['top', { x: ink.x + 12, y: ink.y - 4, width: ink.width - 24, height: 10 }],
    ['bottom', { x: ink.x + 12, y: ink.y + ink.height - 5, width: ink.width - 24, height: 9 }],
    ['left', { x: ink.x - 4, y: ink.y + 12, width: 10, height: ink.height - 24 }],
    ['right', { x: ink.x + ink.width - 6, y: ink.y + 12, width: 10, height: ink.height - 24 }],
  ];
  for (const [side, band] of surround) {
    expect(picture.darkCount(band, 0.6), `the outline is drawn along the ${side} edge`).toBeGreaterThan(0);
  }

  // Seven tiles, in the rail's order: the accessibility tree lists them top to
  // bottom, which is the order the standing strip shows them in.
  const tiles = await rail(ui).getByRole('button').all();
  expect(tiles.length).toBe(TILES.length);
  expect(await Promise.all(tiles.map((tile) => tile.getAttribute('aria-label')))).toEqual(TILES);
});

test('a palette move docks the rail without touching the Scene, the folder or the undo history', async ({
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
  await dockRail(ui, 'left');
  const held = await browser.evaluate(
    () => ((window as unknown as { __esbozoGates?: unknown[] }).__esbozoGates ?? []).length,
  );
  expect(held, 'a move sends no save').toBe(0);
  await allowWrites(ui);

  // The Scene's own file and the SVG beside it are the bytes they were, and the
  // view has not moved: the dock is the page's chrome, not the diagram's ink.
  expect(await savedFiles(ui), 'a move writes nothing').toEqual(files);
  expect((await shot(ui)).darkBounds(BIG_BOX, 0.6), 'a move leaves the view alone').toEqual(before);

  // And no undo step: Undo is still greyed, saying there is nothing to undo.
  await ui.browser.keyboard.press('q');
  await ui.browser.keyboard.type('undo');
  await expect(screen.getByRole('option', { name: 'Undo · ⌘Z' })).toBeDisabled();
  await expect(screen.getByRole('option', { name: 'Undo · ⌘Z' })).toContainText('nothing to undo');
  await ui.browser.keyboard.press('Escape');
});

test('a palette move measures the frame even for the side already in use', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 3440, height: 1440 });
  await openEditor(ui, { A: { 'big.json': BIG_SOURCE } }, 'big.json');
  await settle(ui);

  // The box's top side is 370 px down, so the strip's outline hangs at 291.
  const band: Rect = { x: 1400, y: 0, width: 640, height: 364 };
  const opened = await railPlace(ui, band);
  expect(opened.top).toBeGreaterThan(280);
  expect(opened.top).toBeLessThan(310);

  // A pan draws the page 100 px lower and the rail stays where it was: a pan is
  // not a measurement (D3).
  await drag(ui, { x: 1500, y: 900 }, { x: 1500, y: 1000 }, 'middle');
  await settle(ui);
  expectHeld(opened, await railPlace(ui, band), 'a pan');

  // Choosing the side already in use measures the frame again, so the rail
  // follows the diagram the pan moved (I4).
  await dockRail(ui, 'top');
  const moved = await railPlace(ui, { x: 1400, y: 0, width: 640, height: 464 });
  expect(moved.top - opened.top, 'the move measured the panned frame').toBeGreaterThan(90);
  expect(moved.top - opened.top, 'the move measured the panned frame').toBeLessThan(110);
});

test('a move to the left is kept, so the next editor starts there on a frame of its own', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui, { width: 3440, height: 1440 });
  await dockRail(ui, 'left');
  expect(await keptSide(ui), 'the move is kept for the next start').toBe('left');

  // The page starts again in a window the first dock was never measured in: the
  // empty Scene's frame is the 960×600 minimum about the new middle, so its left
  // side is 160 px in and the 60 px outline starts at about 84. A dock kept as a
  // place would still be the 1,164 px one, which this window has no room for.
  await openBare(ui, { width: 1280, height: 800 });
  const ink = await railInk(ui, { x: 0, y: 200, width: 240, height: 400 });
  expect(ink.x, 'the outline hangs one gap outside the newly measured frame').toBeGreaterThan(76);
  expect(ink.x, 'the outline hangs one gap outside the newly measured frame').toBeLessThan(92);
  expect(ink.height, 'the strip stands up the side it was left on').toBeGreaterThan(ink.width * 2);
  expect(Math.abs(ink.y + ink.height / 2 - 800 / 2), 'the strip is centred on the frame’s side').toBeLessThan(4);
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
  // to the left there, and the side is kept for the next start rather than
  // broadcast to the editor already on the page (D10).
  await browser.newTab();
  await openBare(ui);
  await dockRail(ui, 'left');
  expect(await keptSide(ui), 'the move is kept for the next start').toBe('left');

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
  expect(ink.y, 'the rail starts at the top').toBeGreaterThan(10);
  expect(ink.y, 'the rail starts at the top').toBeLessThan(28);
  expect(ink.width, 'the strip lies along the top').toBeGreaterThan(ink.height * 2);

  await dockRail(ui, 'left');
  const moved = await railInk(ui, { x: 0, y: 200, width: 200, height: 400 });
  expect(moved.height, 'the rail still moves').toBeGreaterThan(moved.width * 2);
  expect(await keptSide(ui), 'the move replaces the word it could not use').toBe('left');
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
  expect(ink.y, 'the rail starts at the top').toBeGreaterThan(10);
  expect(ink.y, 'the rail starts at the top').toBeLessThan(28);
  expect(ink.width, 'the strip lies along the top').toBeGreaterThan(ink.height * 2);

  await dockRail(ui, 'left');
  const moved = await railInk(ui, { x: 0, y: 200, width: 200, height: 400 });
  expect(moved.height, 'the rail still moves').toBeGreaterThan(moved.width * 2);
  expect(await problems(ui), 'a blocked storage is no error').toEqual([]);
});

test('a move in a read-only Scene keeps the side and leaves the Scene’s file alone', async ({
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

  await dockRail(ui, 'left');
  expect(await keptSide(ui), 'a read-only Scene keeps the side all the same').toBe('left');
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
  // has not moved — a drag of the rail docks, and picks no tool at all.
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

test('a mouse drag from a tile docks the rail on the nearest side and picks no tool', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const band: Rect = { x: 400, y: 0, width: 480, height: 240 };
  const opened = await railPlace(ui, band);

  // Rectangle, carried 340 px left of the empty Scene's frame and released level
  // with its middle: the left side is the nearest of the four by far.
  await drag(ui, tileCentre(boxOfPlace(opened), 1), { x: 300, y: 400 });
  await settle(ui);

  // The release docks, so no tool was picked: Select is still the one in hand.
  expect(await screen.getByRole('button', 'Select').getAttribute('aria-pressed'), 'no tool was picked').toBe('true');
  expect(await screen.getByRole('button', 'Rectangle').getAttribute('aria-pressed')).toBe('false');

  // Standing up the frame's left side, which the empty Scene's 960×600 frame puts
  // 160 px in: the 60 px outline hangs one 16 px gap outside it, at about 84.
  const ink = await railInk(ui, { x: 0, y: 200, width: 240, height: 400 });
  expect(ink.height, 'the strip stands up the left side').toBeGreaterThan(ink.width * 2);
  expect(ink.x, 'the outline hangs one gap outside the frame').toBeGreaterThan(76);
  expect(ink.x, 'the outline hangs one gap outside the frame').toBeLessThan(92);
  expect(Math.abs(ink.y + ink.height / 2 - 800 / 2), 'the strip is centred on the frame’s side').toBeLessThan(4);
});

test('a touch drag from the strip’s padding docks the rail on the nearest side and picks no tool', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const band: Rect = { x: 400, y: 0, width: 480, height: 240 };
  const opened = await railPlace(ui, band);
  const strip = boxOfPlace(opened);

  // A finger on the strip's own padding rather than on a tile: 10 px in from the
  // outline's left edge, where the tiles start at 15. It is carried down past the
  // frame's bottom side, which is the nearest dock by 80 px against the top's 680.
  const page = livePage();
  const cdp = await page.context().newCDPSession(page);
  const from = { x: strip.x + 10, y: strip.y + 11 };
  const to = { x: 640, y: 780 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 400, y: 400 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle(ui);

  // Nothing was picked — a press on the padding picks nothing anyway — and the
  // strip is docked along the bottom, a gap under the empty Scene's 700 px frame.
  expect(await screen.getByRole('button', 'Select').getAttribute('aria-pressed')).toBe('true');
  const ink = await railInk(ui, { x: 400, y: 700, width: 480, height: 100 });
  expect(ink.width, 'the strip lies along the bottom').toBeGreaterThan(ink.height * 2);
  expect(ink.y, 'the outline hangs one gap under the frame').toBeGreaterThan(706);
  expect(ink.y, 'the outline hangs one gap under the frame').toBeLessThan(726);
  expect(Math.abs(ink.x + ink.width / 2 - 1280 / 2), 'the strip is centred').toBeLessThan(4);
});

test('a drag in a read-only Scene docks the rail and leaves the Scene’s file alone', async ({
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

  // A drag is the page's chrome, not an edit: it docks on the left like any
  // other, keeps the side, and writes nothing (D9). The box the refused draw left
  // in the page frames the diagram at 0..710 across, so a release at (60, 265) is
  // 60 px from the left side and 265 px from the frame's top and bottom.
  const band: Rect = { x: 400, y: 0, width: 480, height: 240 };
  const opened = await railPlace(ui, band);
  await drag(ui, tileCentre(boxOfPlace(opened), 1), { x: 60, y: 265 });
  await settle(ui);

  const ink = await railInk(ui, { x: 0, y: 100, width: 190, height: 400 });
  expect(ink.height, 'the strip stands up the left side').toBeGreaterThan(ink.width * 2);
  expect(ink.x, 'the strip stops inside the editor’s left edge').toBeLessThan(70);
  expect(await keptSide(ui), 'a read-only Scene keeps the side all the same').toBe('left');
  expect(await savedFiles(ui), 'a drag writes no file').toEqual(files);
});

test('a drag docks the rail without touching the Scene, the SVG, the undo history or the view', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 3440, height: 1440 });
  await openEditor(
    ui,
    {
      A: {
        'big.json': BIG_SOURCE,
        'big.svg': '<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>',
      },
    },
    'big.json',
  );
  await settle(ui);
  const files = await savedFiles(ui);
  const before = (await shot(ui)).darkBounds(BIG_BOX, 0.6);
  const opened = await railPlace(ui, { x: 1400, y: 0, width: 640, height: 364 });

  // A write the drag would have to make waits on the test: nothing answers it, so
  // a save the drag sent would stay held and the test would find it.
  await holdWrites(ui, 'big.json');
  // The Arrow tile, carried 220 px left of the 1220 px frame and released level
  // with its middle, which is the nearest of the four docks.
  await drag(ui, tileCentre(boxOfPlace(opened), 3), { x: 1000, y: 720 });
  const held = await browser.evaluate(
    () => ((window as unknown as { __esbozoGates?: unknown[] }).__esbozoGates ?? []).length,
  );
  expect(held, 'a drag sends no save').toBe(0);
  await allowWrites(ui);

  // The Scene's own file and the SVG beside it are the bytes they were, the view
  // has not moved, and no tool was picked: the dock is the page's chrome. It is a
  // dock, though — the strip stands up the frame's left side, one gap outside it —
  // so a drag that did nothing at all cannot satisfy this test either.
  expect(await savedFiles(ui), 'a drag writes nothing').toEqual(files);
  expect((await shot(ui)).darkBounds(BIG_BOX, 0.6), 'a drag leaves the view alone').toEqual(before);
  expect(await screen.getByRole('button', 'Arrow').getAttribute('aria-pressed'), 'the drag picked no tool').toBe(
    'false',
  );
  const docked = await railInk(ui, DOCK_BANDS.left);
  expect(docked.height, 'the strip stands up the left side').toBeGreaterThan(docked.width * 2);
  // The frame's left side is 1,220 px in, and the strip's outline hangs one gap
  // outside it: somewhere between 6 and 24 px of paper between the ink and the box.
  const gap = 1220 - (docked.x + docked.width);
  expect(gap, 'the outline hangs one gap outside the frame').toBeGreaterThan(6);
  expect(gap, 'the outline hangs one gap outside the frame').toBeLessThan(24);
  expect(Math.abs(docked.y + docked.height / 2 - 720), 'the strip is centred on the frame’s side').toBeLessThan(4);

  // And no undo step: Undo is still greyed, saying there is nothing to undo.
  await browser.keyboard.press('q');
  await browser.keyboard.type('undo');
  await expect(screen.getByRole('option', { name: 'Undo · ⌘Z' })).toBeDisabled();
  await expect(screen.getByRole('option', { name: 'Undo · ⌘Z' })).toContainText('nothing to undo');
  await browser.keyboard.press('Escape');
});

test('a drag’s side is kept, so the next editor starts there on a frame of its own', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const band: Rect = { x: 400, y: 0, width: 480, height: 240 };
  const opened = await railPlace(ui, band);

  // Released 40 px right of the empty Scene's frame, whose right side is 1,120
  // px in: the right dock is the nearest by far.
  await drag(ui, tileCentre(boxOfPlace(opened), 1), { x: 1080, y: 400 });
  await settle(ui);
  expect(await keptSide(ui), 'the drag is kept for the next start').toBe('right');
  const docked = await railInk(ui, { x: 1000, y: 200, width: 280, height: 400 });
  expect(docked.height, 'the strip stands up the right side').toBeGreaterThan(docked.width * 2);
  expect(docked.x, 'the outline hangs one gap outside the frame').toBeGreaterThan(1128);
  expect(docked.x, 'the outline hangs one gap outside the frame').toBeLessThan(1144);

  // The page starts again in a window the first dock was never measured in: the
  // empty Scene's frame is the 960×600 minimum about the new middle, so its right
  // side is 2,200 px in and the 60 px outline hangs one gap outside it at 2,216.
  // A side kept as a place would still be the 1,136 px one.
  await openBare(ui, { width: 3440, height: 1440 });
  const ink = await railInk(ui, { x: 2100, y: 500, width: 340, height: 440 });
  expect(ink.x, 'the outline hangs one gap outside the newly measured frame').toBeGreaterThan(2208);
  expect(ink.x, 'the outline hangs one gap outside the newly measured frame').toBeLessThan(2224);
  expect(ink.height, 'the strip stands up the side it was left on').toBeGreaterThan(ink.width * 2);
  expect(Math.abs(ink.y + ink.height / 2 - 1440 / 2), 'the strip is centred on the frame’s side').toBeLessThan(4);
});

test('a drag in an editor set inside the page docks on the side the release is nearest it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);

  // The editor sits 480 px right and 80 px down inside the page, as a host page
  // places it. The pointer arrives in the page's pixels, and the frame is
  // measured from the editor's own corner: a drag that reads one as the other
  // docks on the side across the editor.
  const placed = await browser.evaluate(() => {
    const editor = document.querySelector('esbozo-editor');
    if (!(editor instanceof HTMLElement)) return false;
    editor.style.cssText = 'position:absolute;left:480px;top:80px;width:600px;height:650px';
    return true;
  });
  expect(placed, 'the editor is the one this test places').toBe(true);
  // The move measures where the editor now is: the empty Scene's frame is the
  // 960×600 minimum cut to the 600×650 editor, whose middle is its own (300, 325).
  await dockRail(ui, 'top');
  const opened = await railPlace(ui, { x: 700, y: 80, width: 180, height: 120 });

  // Released 20 px in from the editor's left edge and level with the frame's
  // middle: 20 px from the left side, and 300 from the top and the bottom.
  await drag(ui, tileCentre(boxOfPlace(opened), 1), { x: 500, y: 405 });
  await settle(ui);

  expect(await screen.getByRole('button', 'Select').getAttribute('aria-pressed'), 'the drag picked no tool').toBe(
    'true',
  );
  expect(await keptSide(ui), 'the release is nearest the editor’s left side').toBe('left');
  const ink = await railInk(ui, { x: 482, y: 280, width: 140, height: 260 });
  expect(ink.height, 'the strip stands up the left side').toBeGreaterThan(ink.width * 2);
  expect(ink.x, 'the outline stops inside the editor’s left edge').toBeGreaterThan(484);
  expect(ink.x, 'the outline stops inside the editor’s left edge').toBeLessThan(500);
  expect(Math.abs(ink.y + ink.height / 2 - 405), 'the strip is centred on the frame’s side').toBeLessThan(4);
});

/**
 * A mouse whose press, moves and release are three separate places, as
 * Chromium's own protocol sends them: `browser.mouse` always releases where it
 * last moved, and a release the page must read on its own cannot be faked by an
 * event a test dispatched.
 */
async function protocolMouse() {
  const page = livePage();
  const client = await page.context().newCDPSession(page);
  return async (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', x: number, y: number): Promise<void> => {
    await client.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: type === 'mouseMoved' ? 'none' : 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
    });
  };
}

test('a rail released past the slop with no move before it docks on the release’s side', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const band: Rect = { x: 400, y: 0, width: 480, height: 240 };
  const opened = await railPlace(ui, band);
  const mouse = await protocolMouse();
  const from = tileCentre(boxOfPlace(opened), 1);

  // Pressed on the tile and let go 650 px down, with no move between: the release
  // is the whole gesture, and it is past the click's 4 px slop, so it docks. The
  // empty Scene's frame ends 700 px down, so the bottom side is the nearest by
  // far: 4 px against the top's 604.
  await mouse('mouseMoved', from.x, from.y);
  await mouse('mousePressed', from.x, from.y);
  await mouse('mouseReleased', from.x, from.y + 650);
  await settle(ui);

  expect(await keptSide(ui), 'the release past the slop is a drag of the rail').toBe('bottom');
  expect(await screen.getByRole('button', 'Select').getAttribute('aria-pressed'), 'the drag picked no tool').toBe(
    'true',
  );
  expect(await screen.getByRole('button', 'Rectangle').getAttribute('aria-pressed')).toBe('false');
});

test('a rail whose last move went the other way docks where it is released', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const band: Rect = { x: 400, y: 0, width: 480, height: 240 };
  const opened = await railPlace(ui, band);
  const mouse = await protocolMouse();
  const from = tileCentre(boxOfPlace(opened), 1);

  // The pointer moves 5 px right with the button down, then the button is let go
  // 650 px below the press: the release is 600 px nearer the frame's bottom side
  // than its top, and that is the side the rail docks on. A drag that docked at
  // its last move would take the top, level with the top side.
  await mouse('mouseMoved', from.x, from.y);
  await mouse('mousePressed', from.x, from.y);
  await mouse('mouseMoved', from.x + 5, from.y);
  await mouse('mouseReleased', from.x, from.y + 650);
  await settle(ui);

  expect(await keptSide(ui), 'the release decides the side, not the last move').toBe('bottom');
  expect(await screen.getByRole('button', 'Select').getAttribute('aria-pressed'), 'the drag picked no tool').toBe(
    'true',
  );
});

test('a zoom in the middle of a rail drag leaves the dock where the press measured it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  // A window a wide diagram is fitted into, so its frame's bottom side is 200 px
  // above the editor's own edge and the bottom dock hangs clear of its ink.
  await browser.setViewport({ width: 1280, height: 1000 });
  await openEditor(ui, { A: { 'wide.json': WIDE_SOURCE } }, 'wide.json');
  await settle(ui);
  const band: Rect = { x: 400, y: 0, width: 480, height: 300 };

  // The same press and the same release twice, and the second drag zooms the page
  // while the button is still down. The frame was measured at the press (D3), so
  // the zoom moves the diagram and not the dock: a release that measured the
  // frame again would hang the strip 30 px right of where the first drag left it.
  const zoom = await zoomReadout(ui).textContent();
  const opened = await railPlace(ui, band);
  await drag(ui, tileCentre(boxOfPlace(opened), 1), { x: 200, y: 780 });
  await settle(ui);
  expect(await keptSide(ui), 'the release is nearest the frame’s bottom side').toBe('bottom');
  expect(await zoomReadout(ui).textContent(), 'nothing zoomed the first drag').toBe(zoom);
  const still = await railInk(ui, { x: 400, y: 700, width: 480, height: 300 });

  await dockRail(ui, 'top');
  const again = await railPlace(ui, band);
  await drag(ui, tileCentre(boxOfPlace(again), 1), { x: 200, y: 780 }, 'left', async () => {
    await ui.browser.mouse.wheel(0, -100);
  });
  await settle(ui);

  expect(await zoomReadout(ui).textContent(), 'the wheel zoomed the page mid-drag').not.toBe(zoom);
  expect(await keptSide(ui), 'the release is still nearest the frame’s bottom side').toBe('bottom');
  const zoomed = await railInk(ui, { x: 400, y: 700, width: 480, height: 300 });
  const middle = (ink: Rect): number => ink.x + ink.width / 2;
  expect(Math.abs(middle(zoomed) - middle(still)), 'the dock is the one the press measured').toBeLessThan(4);
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
  expect(await keptSide(ui), 'the rail drag it started still docks').toBe('left');
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
  // stays there; the pen lets go, so the rail docks with the finger still down.
  // Neither contact carries Ctrl: the board ignores the finger because a rail
  // drag owns a pointer, not because a menu owns its press.
  await pen('mousePressed', grip.x, grip.y);
  await pen('mouseMoved', 250, 400);
  await touch('touchStart', [{ x: 1000, y: 360, id: 0 }]);
  await pen('mouseReleased', 250, 400);
  await settle(ui);
  expect(await keptSide(ui), 'the pen’s release docked the rail').toBe('left');

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
  // still docks the rail it is holding.
  await touch('touchEnd', []);
  await expect.poll(() => writeCount(ui), { timeout: 5000 }).toBe(1);
  await releaseWrite(ui);
  const drawn = (await savedScene(ui, 'bare.json')).elements[0];
  expect([drawn?.width, drawn?.height], 'the touch’s own Rectangle is what was saved').toEqual([200, 60]);

  await pen('mouseReleased', 250, 400);
  await settle(ui);
  expect(await keptSide(ui), 'the pen’s release docks the rail').toBe('left');
});

// ------------------------------------------------------- calling a drag off

/** The band the empty Scene's strip hangs in: bare paper and the strip alone. */
const TOP_BAND: Rect = { x: 400, y: 0, width: 480, height: 240 };

/**
 * The page's whole ink, with the strip drawn at full ink and the pointer resting
 * on bare paper: a dock preview, or any other mark an exit left behind, is ink
 * that was not there before. The fade is waited out and the hover is the same
 * both times, so neither can decide the measure.
 */
async function pageInk(ui: Ui): Promise<Rect | null> {
  await ui.browser.mouse.move(200, 200);
  await rail(ui).getByRole('button', 'Select').focus();
  await fullInk(ui);
  return (await shot(ui)).darkBounds({ x: 0, y: 0, width: 1280, height: 800 }, 0.6);
}

/** What an exit must not touch: the strip, the side the page keeps and the folder. */
interface Kept {
  place: Place;
  side: string | null;
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
    side: await keptSide(ui),
    files: await savedFiles(ui),
    tools: await toolInHand(ui),
    note: await ui.screen.getByRole('dialog', 'Style').isVisible(),
    grip: tileCentre(boxOfPlace(place), 1),
  };
}

/**
 * The rail, the side, the tool, the selection, the folder and the page's ink as
 * the press found them: a called-off drag puts every one of them back (D7, I6).
 */
async function expectCalledOff(ui: Ui, before: Kept, ink: Rect | null): Promise<void> {
  const place = await railPlace(ui, TOP_BAND);
  expectHeld(before.place, place, 'a called-off drag');
  expect(place.width, 'the strip lies along the top, as it did').toBeGreaterThan(place.height * 2);
  expect(await keptSide(ui), 'a cancel stores no side').toEqual(before.side);
  expect(await savedFiles(ui), 'a cancel writes no file').toEqual(before.files);
  expect(await toolInHand(ui), 'a cancel keeps the tool in hand and picks no other').toEqual(before.tools);
  const note = ui.screen.getByRole('dialog', 'Style');
  if (before.note) {
    await expect(note).toBeVisible();
  } else {
    await expect(note).toBeHidden();
  }
  expect(await pageInk(ui), 'a cancel leaves no dock preview or other mark on the page').toEqual(ink);
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
  // the left dock; Escape calls it off with the button still down (D7).
  await drag(ui, before.grip, { x: 300, y: 400 }, 'left', async () => {
    await browser.keyboard.press('Escape');
    await settle(ui);
  });
  await settle(ui);

  // The release that follows the cancel docks nothing and picks no tool: the
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
  // the left dock; the browser then takes the press over, as it does for a scroll,
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

  // A pen presses the Rectangle tile and carries the strip towards the left dock;
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

  // And the pen's own release docks nothing, because its drag was called off.
  await pen('mouseReleased', 300, 400);
  await settle(ui);
  expect(await writeCount(ui), 'the cancelled pen docks nothing').toBe(0);
  await expectCalledOff(ui, before, ink);
  await expectNoStep(ui);
});

test('a fresh drag after a cancel docks the rail as any other', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const opened = await railPlace(ui, TOP_BAND);
  const grip = tileCentre(boxOfPlace(opened), 1);

  // Called off on its way to the left dock, so the strip is where it opened and
  // the page keeps no side...
  await drag(ui, grip, { x: 300, y: 400 }, 'left', async () => {
    await browser.keyboard.press('Escape');
    await settle(ui);
  });
  await settle(ui);
  expectHeld(opened, await railPlace(ui, TOP_BAND), 'a called-off drag');
  expect(await keptSide(ui), 'a cancel keeps no side').toBeNull();

  // ...and a second drag from the same tile docks it, as a drag always does.
  await drag(ui, grip, { x: 300, y: 400 });
  await settle(ui);
  expect(await keptSide(ui), 'the second drag docks on the left').toBe('left');
  const ink = await railInk(ui, { x: 0, y: 200, width: 240, height: 400 });
  expect(ink.height, 'the strip stands up the left side').toBeGreaterThan(ink.width * 2);
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
  test(`a mouse let go back on a tile after ${exit.name} picks no tool and docks nothing`, async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    const { grip } = await openForLateInput(ui);
    const mouse = await protocolMouse();

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

    expect(await keptSide(ui), 'a called-off drag stores no side').toBeNull();
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

  // A pen presses the Rectangle tile and carries the strip towards the left dock;
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
  expect(await keptSide(ui), 'a called-off drag stores no side').toBeNull();

  // And the pen's next press is a press of its own: it carries the strip to the
  // left dock as any drag does. The release is 60 px from the editor's left edge,
  // nearer the frame's left side than any other.
  await pen('mouseMoved', grip.x, grip.y);
  await pen('mousePressed', grip.x, grip.y);
  await pen('mouseMoved', 60, 340);
  await pen('mouseReleased', 60, 340);
  await settle(ui);
  expect(await keptSide(ui), 'the pen’s next press drags the rail').toBe('left');
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
  expect(await keptSide(ui), 'a called-off drag stores no side').toBeNull();

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
  const mouse = await protocolMouse();
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
  expect(await keptSide(ui), 'a called-off drag stores no side').toBeNull();
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
  expect(await keptSide(ui), 'a called-off drag stores no side').toBeNull();
});

// ------------------------------------------- the four docks a drag would take

/**
 * The window the docks are read at: an empty Scene's 960×600 frame runs from 160
 * to 1120 across and 200 to 800 down, so every dock hangs clear of the status
 * bar's corners and of the mode pill at the bottom's middle (O2).
 */
const DOCK_WINDOW = { width: 1280, height: 1000 };

/** The frame an empty Scene's rail hangs on at `DOCK_WINDOW` (D2). */
const DOCK_FRAME: Rect = { x: 160, y: 200, width: 960, height: 600 };

/** The gap the strip's pencil outline keeps outside the frame (I2). */
const DOCK_GAP = 16;

/**
 * The strip's pencil outline as it measures each way it hangs, from the shapes
 * the sheet draws (D12, O3): seven 30 px tiles 1 px apart inside 8 px of padding
 * across and 9 px above and below, with the 7 px outline `rail-art` draws outside
 * all of it. A dock is drawn in its own orientation, so both measures are needed.
 */
const LYING_OUTLINE = { width: 7 * 30 + 6 + 2 * 8 + 2 * 7, height: 31 + 2 * 9 + 2 * 7 };
const STANDING_OUTLINE = { width: 30 + 2 * 8 + 2 * 7, height: 7 * 31 + 6 + 2 * 9 + 2 * 7 };

/** Where a drag draws one of the four docks: the outline the strip would wear there (D6). */
function dockMark(side: 'top' | 'bottom' | 'left' | 'right'): Rect {
  const outline = side === 'top' || side === 'bottom' ? LYING_OUTLINE : STANDING_OUTLINE;
  const middleX = DOCK_FRAME.x + DOCK_FRAME.width / 2;
  const middleY = DOCK_FRAME.y + DOCK_FRAME.height / 2;
  switch (side) {
    case 'top':
      return { x: middleX - outline.width / 2, y: DOCK_FRAME.y - DOCK_GAP - outline.height, ...outline };
    case 'bottom':
      return { x: middleX - outline.width / 2, y: DOCK_FRAME.y + DOCK_FRAME.height + DOCK_GAP, ...outline };
    case 'left':
      return { x: DOCK_FRAME.x - DOCK_GAP - outline.width, y: middleY - outline.height / 2, ...outline };
    case 'right':
      return { x: DOCK_FRAME.x + DOCK_FRAME.width + DOCK_GAP, y: middleY - outline.height / 2, ...outline };
  }
}

/** A band holding one dock and the few pixels its pencil wanders, and no other dock. */
function markBand(mark: Rect): Rect {
  return { x: mark.x - 10, y: mark.y - 10, width: mark.width + 20, height: mark.height + 20 };
}

/** Bare paper beside every dock, at both windows the rail is read at: what a band with no ink reads. */
const BARE_PAPER: Rect = { x: 300, y: 620, width: 180, height: 100 };

/**
 * The ink a band holds, whichever way the theme draws it: how far its mean sits
 * from the bare paper beside it. A drawn dock differs from paper; an empty band
 * is the paper itself, grid and all.
 */
function inkOverPaper(shown: Shot, band: Rect): number {
  return Math.abs(shown.meanLuminance(band) - shown.meanLuminance(BARE_PAPER));
}

/**
 * A dock drawn where the frame puts it, in its own orientation: its pencil
 * outline is drawn a few pixels inside its box the way the strip's own is, so the
 * measure is its middle and its span, never its corners.
 */
function expectMark(ink: Rect | null, mark: Rect, side: string): void {
  expect(ink, `the ${side} dock is drawn`).not.toBeNull();
  const found = ink!;
  const across = (box: Rect): number => box.x + box.width / 2;
  const down = (box: Rect): number => box.y + box.height / 2;
  expect(Math.abs(across(found) - across(mark)), `the ${side} dock’s middle across`).toBeLessThan(5);
  expect(Math.abs(down(found) - down(mark)), `the ${side} dock’s middle down`).toBeLessThan(5);
  expect(Math.abs(found.width - mark.width), `the ${side} dock’s width`).toBeLessThan(10);
  expect(Math.abs(found.height - mark.height), `the ${side} dock’s height`).toBeLessThan(10);
}

/** The band a strip lying along the top of `DOCK_WINDOW` hangs in, and the one it stands in at its left. */
const DOCK_BAND: Rect = { x: 400, y: 0, width: 480, height: 240 };
const LEFT_BAND: Rect = { x: 0, y: 300, width: 240, height: 400 };

/** The middle of a standing strip's top padding: a press that drags without picking a tile (D6). */
async function paddingGrip(ui: Ui): Promise<{ x: number; y: number }> {
  const box = boxOfPlace(await railPlace(ui, LEFT_BAND));
  return { x: box.x + 30, y: box.y + 11 };
}

test('a drag past the click’s slop shows the four docks and marks the one it will take', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui, DOCK_WINDOW);
  const opened = await railPlace(ui, DOCK_BAND);
  const left = dockMark('left');
  const right = dockMark('right');
  const bottom = dockMark('bottom');

  // Pressed on the Rectangle tile and carried to the frame's left side, with the
  // button still down: the frame is the one the press measured, so the four docks
  // are the places it would hang the strip, and the release is nearest the left.
  await drag(ui, tileCentre(boxOfPlace(opened), 1), { x: 200, y: 500 }, 'left', async () => {
    await settle(ui);
    const shown = await shot(ui);
    // The strip lies where the top dock hangs, so its own outline is that mark;
    // the other three are drawn clear of anything else on the paper.
    expectMark(shown.darkBounds(markBand(left), 0.6), left, 'left');
    expectMark(shown.darkBounds(markBand(right), 0.6), right, 'right');
    expectMark(shown.darkBounds(markBand(bottom), 0.6), bottom, 'bottom');

    // Exactly one of the three a release could take is the highlighted one: it is
    // filled in as well as drawn, so it holds far more ink than the other two.
    expect(inkOverPaper(shown, left), 'the dock a release takes is the highlighted one').toBeGreaterThan(0.15);
    expect(inkOverPaper(shown, right), 'the right dock is a quiet outline').toBeLessThan(0.09);
    expect(inkOverPaper(shown, bottom), 'the bottom dock is a quiet outline').toBeLessThan(0.09);
  });
  await settle(ui);

  expect(await keptSide(ui), 'the release docks on the side the highlight named').toBe('left');
  expect(
    await screen.getByRole('button', 'Select', { exact: true }).getAttribute('aria-pressed'),
    'the drag picks no tool',
  ).toBe('true');

  // The release takes the docks with it: the three the strip is no longer near
  // hold paper again.
  const after = await shot(ui);
  for (const [side, mark] of [
    ['top', dockMark('top')],
    ['right', right],
    ['bottom', bottom],
  ] as const) {
    expect(inkOverPaper(after, markBand(mark)), `the ${side} dock goes with the release`).toBeLessThan(0.03);
  }
});

test('a mouse drag across the frame’s middle moves the highlight, and the release takes it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui, DOCK_WINDOW);
  await dockRail(ui, 'left');
  const top = dockMark('top');
  const bottom = dockMark('bottom');
  const grip = await paddingGrip(ui);

  // The strip waits at the left dock, so the top and bottom docks are drawn where
  // nothing else on the page is.
  await browser.mouse.move(grip.x, grip.y);
  await browser.mouse.down();

  // 480 px down is 280 px from the frame's top side and 320 from its bottom, so
  // the nearest dock is the top one...
  await browser.mouse.move(640, 480);
  await settle(ui);
  const over = await shot(ui);
  expect(inkOverPaper(over, top), 'the top dock is highlighted above the middle').toBeGreaterThan(0.15);
  expect(inkOverPaper(over, bottom), 'the bottom dock is quiet above the middle').toBeLessThan(0.09);

  // ...and 520 px down is 320 from the top and 280 from the bottom, which carries
  // the highlight across the frame's middle without a release.
  await browser.mouse.move(640, 520);
  await settle(ui);
  const under = await shot(ui);
  expect(inkOverPaper(under, bottom), 'the highlight follows the pointer across the middle').toBeGreaterThan(0.15);
  expect(inkOverPaper(under, top), 'the top dock goes quiet').toBeLessThan(0.09);

  await browser.mouse.up();
  await settle(ui);
  expect(await keptSide(ui), 'the release docks where the highlight was').toBe('bottom');
});

test('a touch drag across the frame’s middle moves the highlight, and the release takes it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui, DOCK_WINDOW);
  await dockRail(ui, 'left');
  const top = dockMark('top');
  const bottom = dockMark('bottom');
  const grip = await paddingGrip(ui);
  const { touch } = await mixedPointers();

  // A finger presses the strip's padding and carries the strip 40 px nearer the
  // frame's top side than its left one...
  await touch('touchStart', [{ x: grip.x, y: grip.y, id: 0 }]);
  await touch('touchMove', [{ x: 400, y: 420, id: 0 }]);
  await settle(ui);
  const over = await shot(ui);
  expect(inkOverPaper(over, top), 'the top dock is highlighted above the middle').toBeGreaterThan(0.15);
  expect(inkOverPaper(over, bottom), 'the bottom dock is quiet above the middle').toBeLessThan(0.09);

  // ...and 160 px further down it is 220 px from the bottom side and 380 from the
  // top, so the highlight changes sides under the finger.
  await touch('touchMove', [{ x: 400, y: 580, id: 0 }]);
  await settle(ui);
  const under = await shot(ui);
  expect(inkOverPaper(under, bottom), 'the highlight follows the finger across the middle').toBeGreaterThan(0.15);
  expect(inkOverPaper(under, top), 'the top dock goes quiet').toBeLessThan(0.09);

  await touch('touchEnd', []);
  await settle(ui);
  expect(await keptSide(ui), 'the finger’s release docks where the highlight was').toBe('bottom');
});

test('a press under the click’s slop on a tile shows no dock and still picks its tool', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui, DOCK_WINDOW);
  const opened = await railPlace(ui, DOCK_BAND);
  const quiet = async (): Promise<number[]> => {
    const shown = await shot(ui);
    return [dockMark('left'), dockMark('right'), dockMark('bottom')].map((mark) => inkOverPaper(shown, markBand(mark)));
  };
  // The measure is not blind: with nothing pressed, the three docks away from the
  // strip hold no ink at all.
  for (const [index, held] of (await quiet()).entries()) {
    expect(held, `the dock at ${index} is not drawn before the press`).toBeLessThan(0.03);
  }

  // The third tile is Ellipse, and a 3 px move is under the click's own 4 px: a
  // press that never leaves the slop is the click it has always been (D6).
  const tile = tileCentre(boxOfPlace(opened), 2);
  await drag(ui, tile, { x: tile.x + 3, y: tile.y });
  await settle(ui);

  expect(
    await screen.getByRole('button', { name: 'Ellipse', exact: true }).getAttribute('aria-pressed'),
    'a press under the slop picks its tool',
  ).toBe('true');
  expect(await keptSide(ui), 'a click moves nothing').toBeNull();
  for (const [index, held] of (await quiet()).entries()) {
    expect(held, `the dock at ${index} is not drawn by a click`).toBeLessThan(0.03);
  }
});

for (const exit of CALLS_OFF) {
  test(`a drag ${exit.name} calls off leaves no dock behind`, async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await openBare(ui);
    const ink = await pageInk(ui);
    const opened = await railPlace(ui, TOP_BAND);

    // The docks are on the page before the exit, and the exit takes them away with
    // the drag: the strip, the side, the tool and the page's ink are the press's.
    await drag(ui, tileCentre(boxOfPlace(opened), 1), { x: 180, y: 500 }, 'left', async () => {
      await settle(ui);
      const shown = await shot(ui);
      expect(inkOverPaper(shown, dockMark('left')), 'the left dock is drawn before the exit').toBeGreaterThan(
        0.15,
      );
      await exit.drive(ui);
      await settle(ui);
    });
    await settle(ui);

    expectHeld(opened, await railPlace(ui, TOP_BAND), `${exit.name} during a drag`);
    expect(await keptSide(ui), `${exit.name} stores no side`).toBeNull();
    expect(await pageInk(ui), `${exit.name} leaves no dock and no highlight behind`).toEqual(ink);
  });
}

test('a dock a drag draws takes no press, so the paper under it is still the paper', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openBare(ui);
  const opened = await railPlace(ui, TOP_BAND);
  const mark = dockMark('left');
  const middle = { x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 };
  const { pen, mouse } = await mixedPointers();
  await holdWrites(ui, 'bare.json');
  const grip = tileCentre(boxOfPlace(opened), 1);

  // A pen presses the Rectangle tile and carries the strip past the slop towards
  // the dock the release will take, so the four docks are on the page.
  await browser.keyboard.down('Space');
  await pen('mousePressed', grip.x, grip.y);
  await pen('mouseMoved', mark.x + 40, middle.y);
  await settle(ui);

  // The open hand a held Space shows is the board's, so the pointer over a dock
  // is over the paper: the layer a drag draws takes no pointer at all (D5).
  expect(await cursorAt(middle), 'a dock a drag draws takes no pointer').toBe('grab');

  // A press inside a dock is the paper's, and the board refuses it while the rail
  // drag owns a pointer: it draws nothing and saves nothing (29g).
  await mouse('mousePressed', middle.x, middle.y);
  await mouse('mouseMoved', middle.x - 120, middle.y + 80);
  await mouse('mouseReleased', middle.x - 120, middle.y + 80);
  await settle(ui);
  expect(await writeCount(ui), 'a press on a dock draws nothing').toBe(0);

  await browser.keyboard.up('Space');
  await pen('mouseReleased', mark.x + 40, middle.y);
  await settle(ui);
  expect(await keptSide(ui), 'the pen’s release docks where the docks showed').toBe('left');
});

/**
 * A drag towards the frame's left side, read while it runs: the dock the release
 * will take carries far more ink than the three quiet ones, and the quiet ones are
 * still drawn, whichever way the page is lit (D12).
 */
async function expectDocksRead(ui: Ui, theme: string, grip: { x: number; y: number }): Promise<void> {
  // The strip hangs in the same place whichever way the page is lit, so the press
  // that starts the drag is the one the light theme measured once.
  await dockRail(ui, 'top');
  const left = dockMark('left');
  const right = dockMark('right');
  await drag(ui, grip, { x: 200, y: 500 }, 'left', async () => {
    await settle(ui);
    const shown = await shot(ui);
    expect(inkOverPaper(shown, left), `the dock a release takes is the darkest ink in ${theme}`).toBeGreaterThan(0.15);
    expect(inkOverPaper(shown, right), `the quiet docks are drawn in ${theme}`).toBeGreaterThan(0.02);
    expect(inkOverPaper(shown, right), `the quiet docks stay quiet in ${theme}`).toBeLessThan(0.09);
  });
  await settle(ui);
  expect(await keptSide(ui), `the release docks where the ink was in ${theme}`).toBe('left');
}

test('the four docks and the mark on them read in both themes', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openBare(ui, DOCK_WINDOW);
  const grip = tileCentre(boxOfPlace(await railPlace(ui, DOCK_BAND)), 1);
  await expectDocksRead(ui, 'the light theme', grip);

  // The page's own switch, which the served page starts on light.
  await screen.getByRole('button', { name: 'Dark' }).click();
  await settle(ui);
  await expectDocksRead(ui, 'the dark theme', grip);
});
