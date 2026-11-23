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
  refuseWrite,
} from './helpers.ts';
import type { Ui } from './helpers.ts';
import { fullInk, zoomReadout } from './editor-shared.ts';
import { livePage } from './cdp.ts';
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
  // far: 4 px against the top's 646.
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
  // 650 px below the press: the release is 646 px nearer the frame's bottom side
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
  await allowWrites(ui);
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
  await allowWrites(ui);
  const drawn = (await savedScene(ui, 'bare.json')).elements[0];
  expect([drawn?.width, drawn?.height], 'the touch’s own Rectangle is what was saved').toEqual([200, 60]);

  await pen('mouseReleased', 250, 400);
  await settle(ui);
  expect(await keptSide(ui), 'the pen’s release docks the rail').toBe('left');
});
