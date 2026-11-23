/**
 * Seam 2: moving the selection — a drag and a nudge, the autosave that follows
 * both, the gesture the browser takes away, and the Snapped arrow ends a move
 * has to free. Asserted on the saved Scene, and on the pixels a half-finished
 * gesture leaves behind.
 */
import { test } from '@e2e-dev/web';
import { afterAll, expect } from 'e2e';
import {
  MIXED,
  SNAPPED,
  SNAPPED_SCENE,
  at,
  clickScene,
  drag,
  dragBy,
  expectSvgMatchesCli,
  settle,
  openEditor,
  savedFiles,
  savedScene,
} from './helpers.ts';
import type { Ui } from './helpers.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';
import { SCENE_SOURCE, MIXED_SOURCE } from './editor-shared.ts';
import { removeTempFolders } from '../test/temp.ts';

afterAll(removeTempFolders);

const SNAPPED_SOURCE = JSON.stringify(SNAPPED_SCENE, null, 2);

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

test('Escape drops a move in flight, and the release that follows saves nothing', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'block.json': BLOCK_SOURCE } }, 'block.json');
  const alone = await savedScene(ui, 'block.json');

  // Half a drag, the pointer still down: the box is where the pointer carried
  // it, and the Scene has not moved.
  await carryBlock(ui);
  expect((await shot(ui)).meanLuminance(MOVED_BLOCK)).toBeLessThan(0.2);

  // Escape is the person saying no, and it answers at once: the preview goes
  // back to the place the Scene holds while the button is still down.
  await browser.keyboard.press('Escape');
  await settle(ui);
  const dropped = await shot(ui);
  expect(dropped.meanLuminance(HELD_BLOCK)).toBeLessThan(0.2);
  expect(dropped.meanLuminance(MOVED_BLOCK)).toBeGreaterThan(0.85);

  // The release that follows settles nothing: the file is the file, and the box
  // is still selected, so nothing was picked or opened by that release.
  await browser.mouse.up();
  await settle(ui);
  expect(await savedScene(ui, 'block.json')).toEqual(alone);
  await expect(screen.getByRole('dialog', 'Style')).toBeVisible();

  // A fresh drag afterwards still lands, and the single step it earned is the
  // first undo: the drag Escape dropped recorded no step of its own.
  await carryBlock(ui);
  await browser.mouse.up();
  await settle(ui);
  const moved = await savedScene(ui, 'block.json');
  expect({ x: moved.elements[0]?.x, y: moved.elements[0]?.y }).toEqual({ x: 100, y: 160 });
  await browser.keyboard.press('Meta+z');
  const undone = await savedScene(ui, 'block.json');
  expect({ x: undone.elements[0]?.x, y: undone.elements[0]?.y }).toEqual({ x: 40, y: 40 });

  // Escape with no drag keeps the behaviour it had: the selection goes and the
  // file is left alone.
  const quiet = await savedFiles(ui);
  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog', 'Style')).toBeHidden();
  expect(await savedFiles(ui)).toEqual(quiet);
});

test('Escape drops a resize in flight, and the release that follows saves nothing', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');
  await clickScene(ui, { x: 120, y: 110 }, [], MIXED);
  const alone = await savedScene(ui);

  // Room only an ellipse stretched to the pointer's corner covers: the Scene's
  // own oval stops short of it, and so does the selection's outline.
  const stretched: Rect = { x: 640, y: 345, width: 30, height: 30 };
  const bare = (await shot(ui)).darkCount(stretched, 0.6);

  await drag(ui, at({ x: 180, y: 160 }, MIXED), at({ x: 250, y: 220 }, MIXED), 'left', async () => {
    expect((await shot(ui)).darkCount(stretched, 0.6)).toBeGreaterThan(bare);

    // Escape answers before the release: the oval is the Scene's own again.
    await browser.keyboard.press('Escape');
    await settle(ui);
    expect((await shot(ui)).darkCount(stretched, 0.6)).toBe(bare);
  });
  await settle(ui);

  // Nothing of the dropped resize reached the file, and the oval kept its
  // selection.
  expect(await savedScene(ui)).toEqual(alone);
  await expect(screen.getByRole('dialog', 'Style')).toBeVisible();

  // A fresh resize afterwards lands normally, as one step: one undo is the
  // Scene's own size again.
  await drag(ui, at({ x: 180, y: 160 }, MIXED), at({ x: 210, y: 180 }, MIXED));
  const resized = await savedScene(ui);
  const oval = resized.elements.find((element) => element.id === 'oval');
  expect({ width: oval?.width, height: oval?.height }).toEqual({ width: 150, height: 120 });
  await browser.keyboard.press('Meta+z');
  const undone = await savedScene(ui);
  const back = undone.elements.find((element) => element.id === 'oval');
  expect({ width: back?.width, height: back?.height }).toEqual({ width: 120, height: 100 });
});

test('Escape drops an end drag in flight, and the release that follows saves nothing', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');
  await clickScene(ui, { x: 200, y: 280 }, [], MIXED);
  const alone = await savedScene(ui);

  // A shaft carried to the pointer's own height crosses this patch of paper;
  // the Scene's arrow passes under it, and the selection's outline above it.
  const swept: Rect = { x: 640, y: 370, width: 40, height: 25 };
  const bare = (await shot(ui)).darkCount(swept, 0.6);

  await drag(ui, at({ x: 340, y: 330 }, MIXED), at({ x: 340, y: 130 }, MIXED), 'left', async () => {
    expect((await shot(ui)).darkCount(swept, 0.6)).toBeGreaterThan(bare);

    // Escape answers before the release: the end is back where the Scene
    // holds it.
    await browser.keyboard.press('Escape');
    await settle(ui);
    expect((await shot(ui)).darkCount(swept, 0.6)).toBe(bare);
  });
  await settle(ui);

  expect(await savedScene(ui)).toEqual(alone);
  await expect(screen.getByRole('dialog', 'Style')).toBeVisible();

  // A fresh end drag afterwards lands normally, as one step: one undo is the
  // Scene's own shaft again.
  await drag(ui, at({ x: 340, y: 330 }, MIXED), at({ x: 340, y: 130 }, MIXED));
  const dragged = await savedScene(ui);
  expect(dragged.elements[2]?.points).toEqual([
    { x: 60, y: 230 },
    { x: 340, y: 130 },
  ]);
  await browser.keyboard.press('Meta+z');
  const undone = await savedScene(ui);
  expect(undone.elements[2]?.points).toEqual([
    { x: 60, y: 230 },
    { x: 340, y: 330 },
  ]);
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

test('dragging an arrow Snapped at both ends moves nothing and keeps both Snaps', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'snapped.json': SNAPPED_SOURCE } }, 'snapped.json');

  // A two-point arrow has no bend to move in its Snapped ends' place, so the
  // drag carries nothing: both ends keep the places and the Snaps they had.
  await dragBy(ui, { x: 230, y: 80 }, 10, 20, SNAPPED);

  const scene = await savedScene(ui, 'snapped.json');
  expect(scene.elements[2]?.points).toEqual([
    { x: 160, y: 80, snap: 'from' },
    { x: 300, y: 80, snap: 'to' },
  ]);

  // The arrow is still selected, and the note still names a Snap on each end:
  // the drag did not let either go.
  await expect(screen.getByRole('button', { name: 'Detach: start' })).toBeVisible();
  await expect(screen.getByRole('button', { name: 'Detach: end' })).toBeVisible();
});

test('nudging an arrow Snapped at both ends moves nothing and keeps both Snaps', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'snapped.json': SNAPPED_SOURCE } }, 'snapped.json');

  await clickScene(ui, { x: 230, y: 80 }, [], SNAPPED);
  await expect(screen.getByRole('button', { name: 'Detach: end' })).toBeVisible();
  await ui.browser.keyboard.press('Shift+ArrowRight');

  // A nudge follows the drag rule for a two-point shaft: only a free end moves,
  // and both ends here follow an Element, so the step changes nothing at all.
  const scene = await savedScene(ui, 'snapped.json');
  expect(scene.elements[2]?.points).toEqual([
    { x: 160, y: 80, snap: 'from' },
    { x: 300, y: 80, snap: 'to' },
  ]);
  await expect(screen.getByRole('button', { name: 'Detach: start' })).toBeVisible();
  await expect(screen.getByRole('button', { name: 'Detach: end' })).toBeVisible();
});
