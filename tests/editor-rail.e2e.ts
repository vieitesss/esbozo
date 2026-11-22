/**
 * Seam 2: the frame the tool rail hangs on.
 *
 * A Scene opens with the rail docked on the frame around its diagram: the
 * diagram's box on screen, at least 960×600 about its centre and cut to the
 * editor's box, with the rail's pencil outline one gap above the frame's top
 * side — or just inside the editor's top edge when the frame leaves no room for
 * it. Asserted on the ink a screenshot holds, never on a box the page reports.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { openEditor, settle } from './helpers.ts';
import type { Ui } from './helpers.ts';
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

/** The tool rail, as the accessibility tree offers it. */
function rail(ui: Ui) {
  return ui.screen.getByRole('navigation', { name: 'Tools' });
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
 * The strip is drawn at the ink a person sees, its fade to full ink finished.
 *
 * A tile taking the focus fades the strip from 0.58 to 1 over 0.22 s, and a
 * screenshot taken during that fade holds the tiles' ink while the thin pencil
 * outline around them is still too pale to pass the ink threshold: the strip's
 * top then reads 26 px where the outline paints 8 px. The opacity is the page's
 * own answer to when the fade is over, so a starved machine waits as long as it
 * takes; a stopwatch would be this machine's guess, and CI outlasted it.
 */
async function fullInk(ui: Ui): Promise<void> {
  await expect
    .poll(
      () =>
        ui.browser.evaluate(() => {
          const strip = document.querySelector('esbozo-editor nav[aria-label="Tools"]');
          return strip === null ? 0 : Number(getComputedStyle(strip).opacity);
        }),
      { timeout: 5000 },
    )
    .toBe(1);
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

  // A window narrower than the strip: no place keeps it in, so the left inset wins
  // and the far edge clips it. It is the size it was, not smaller: the rail never
  // shrinks, wraps or turns by itself (O3).
  await browser.setViewport({ width: 200, height: 500 });
  await settle(ui);
  const narrow = await railPlace(ui, { x: 0, y: 0, width: 200, height: 240 });
  expect(narrow.centreX - narrow.width / 2).toBeGreaterThan(2);
  expect(narrow.centreX - narrow.width / 2).toBeLessThan(16);
  expect(Math.abs(narrow.height - before.height)).toBeLessThan(3);

  // Growing the window back puts the rail back where the measurement had it: the
  // offset was kept through both resizes, not overwritten by the clamped place.
  await browser.setViewport({ width: 3440, height: 1440 });
  await settle(ui);
  expectHeld(before, await railPlace(ui, band), 'growing the window back');
});
