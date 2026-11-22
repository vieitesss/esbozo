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
