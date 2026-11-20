/**
 * Seam 2: the editor in a browser.
 *
 * Everything is driven the way a person drives it — the folder button, the file
 * name, the pointer and the keys — and asserted on the Scene the editor hands
 * to the file system and on the pixels it paints. The fixtures and the fixed
 * viewport put every Element at a known page point, so pointer input needs no
 * transform read, and a wrapper or a class name can change without a test
 * noticing.
 */
import { expect, test } from '@playwright/test';
import {
  CROSSED,
  CROSSED_SCENE,
  MIXED,
  MIXED_SCENE,
  SCENE,
  allowWrites,
  at,
  browseFolder,
  clickScene,
  drag,
  dragBy,
  expectSvgMatchesCli,
  holdWrites,
  openEditor,
  openNewScene,
  releaseWrite,
  savedFiles,
  savedScene,
} from './helpers.js';
import { shot } from './pixels.js';
import type { Rect } from './pixels.js';

const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
const MIXED_SOURCE = JSON.stringify(MIXED_SCENE, null, 2);
const CROSSED_SOURCE = JSON.stringify(CROSSED_SCENE, null, 2);

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

test('opening a Scene file paints it with the Renderer', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The grey box is painted, and it is painted darker than bare paper.
  const view = await shot(page);
  const fill = view.meanLuminance(GREY_BOX);
  const paper = view.meanLuminance(PAPER);
  expect(fill).toBeLessThan(paper - 0.2);
});

test('a Scene that will not parse is reported and left alone on disk', async ({ page }) => {
  const broken = JSON.stringify({
    version: 1,
    elements: [{ id: 'box-a', type: 'rectangle', x: 10, y: 10, width: 0, height: 40 }],
  });
  await openEditor(page, { A: { 'broken.json': broken } }, 'broken.json');

  await expect(page.getByRole('status')).toContainText('width must be at least 1 pixel');
  await expect(page.getByRole('status')).toContainText('box-a');
  const files = await savedFiles(page);
  expect(files['broken.json']).toBe(broken);
  expect(files['broken.svg']).toBeUndefined();
});

test('a Scene that is not there opens empty and is saved as Scene and SVG', async ({ page }) => {
  await openNewScene(page, { A: {} }, 'fresh.json');

  await expect(page.getByRole('status')).toHaveText('saved');
  const files = await savedFiles(page);
  expect(Object.keys(files).sort()).toEqual(['fresh.json', 'fresh.svg']);

  const scene = JSON.parse(files['fresh.json'] ?? '{}');
  expect(scene.elements).toEqual([]);
  expect(scene.title).toBe('fresh');
  expect(files['fresh.svg']).toMatch(/<title[^>]*>fresh<\/title>/);

  // An empty Scene paints nothing where the grey box would have been.
  const view = await shot(page);
  expect(view.meanLuminance(GREY_BOX)).toBeGreaterThan(0.85);
});

test('dragging an Element moves it smoothly and autosaves Scene plus SVG', async ({ page }) => {
  const prompts: string[] = [];
  page.on('dialog', async (dialog) => {
    prompts.push(dialog.message());
    await dialog.dismiss();
  });
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // 37 and 23 are not on the 22px Grid, so a saved 77/63 proves no snapping.
  await dragBy(page, { x: 100, y: 80 }, 37, 23);

  const scene = await savedScene(page);
  const box = scene.elements.find((element) => element.id === 'a');
  expect({ x: box?.x, y: box?.y }).toEqual({ x: 77, y: 63 });
  await expectSvgMatchesCli(page);
  expect(prompts).toEqual([]);
});

test('click selects one Element, shift-click adds another, and both move', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // Selecting `b` on top of `a` and moving: both end up in the saved Scene.
  await clickScene(page, { x: 100, y: 80 });
  await clickScene(page, { x: 250, y: 110 }, ['Shift']);
  await dragBy(page, { x: 250, y: 110 }, 11, 7);

  const scene = await savedScene(page);
  expect(scene.elements.map((element) => [element.id, element.x, element.y])).toEqual([
    ['a', 51, 47],
    ['b', 211, 67],
  ]);
});

test('dragging a box around the Elements selects both, and the page keeps no text selection', async ({
  page,
}) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  const from = at({ x: 10, y: 10 });
  const to = at({ x: 320, y: 180 });
  await drag(page, from, to);

  // The browser's own selection stays empty: a drag cannot catch page text.
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

  // Both Elements are selected: a nudge moves both.
  await page.keyboard.press('Shift+ArrowRight');
  const scene = await savedScene(page);
  expect(scene.elements.map((element) => element.x)).toEqual([50, 210]);
});

test('a box that only overlaps an Element does not select it', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The box crosses `a` and clips `b`, enclosing neither.
  await drag(page, at({ x: 10, y: 10 }), at({ x: 250, y: 100 }));
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

  // Nothing is selected, so a nudge writes nothing.
  await page.keyboard.press('Shift+ArrowRight');
  expect((await savedFiles(page))['scene.json']).toBe(SCENE_SOURCE);
});

test('a thick horizontal line is picked a pixel off its centre', async ({ page }) => {
  await openEditor(page, { A: { 'crossed.json': CROSSED_SOURCE } }, 'crossed.json');

  // The line draws at y 200 with a 4px stroke; its box has no height at all.
  await clickScene(page, { x: 190, y: 201 }, [], CROSSED);
  await page.keyboard.press('Shift+ArrowRight');

  const scene = await savedScene(page, 'crossed.json');
  expect(scene.elements.find((element) => element.id === 'rule')?.points).toEqual([
    { x: 70, y: 200 },
    { x: 330, y: 200 },
  ]);
});

test('a click on a rectangle inside an arrow\'s box selects the rectangle', async ({ page }) => {
  await openEditor(page, { A: { 'crossed.json': CROSSED_SOURCE } }, 'crossed.json');

  // The point is inside the diagonal arrow's box but 15px off its ink.
  await clickScene(page, { x: 120, y: 70 }, [], CROSSED);
  await page.keyboard.press('Shift+ArrowRight');

  const scene = await savedScene(page, 'crossed.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(saved.get('sheet')?.x).toBe(50);
  expect(saved.get('slant')?.points).toEqual([
    { x: 40, y: 40 },
    { x: 240, y: 160 },
  ]);
});

test('a box drag starts inside an arrow\'s empty box', async ({ page }) => {
  await openEditor(page, { A: { 'crossed.json': CROSSED_SOURCE } }, 'crossed.json');

  // The drag starts in the arrow's box and sweeps up its own box left edge:
  // the rectangle is the only Element fully enclosed, and it is the only one
  // that moves.
  await drag(page, at({ x: 40, y: 160 }, CROSSED), at({ x: 200, y: 20 }, CROSSED));
  await page.keyboard.press('Shift+ArrowRight');

  const scene = await savedScene(page, 'crossed.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(saved.get('sheet')?.x).toBe(50);
  expect(saved.get('slant')?.points).toEqual([
    { x: 40, y: 40 },
    { x: 240, y: 160 },
  ]);
});

test('a resize handle changes the saved geometry', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await clickScene(page, { x: 100, y: 80 });

  // The bottom right handle of `a` sits on its corner.
  await dragBy(page, { x: 160, y: 120 }, 30, 10);

  const scene = await savedScene(page);
  const resized = scene.elements.find((element) => element.id === 'a');
  expect({
    x: resized?.x,
    y: resized?.y,
    width: resized?.width,
    height: resized?.height,
  }).toEqual({ x: 40, y: 40, width: 150, height: 90 });
  await expectSvgMatchesCli(page);
});

test('Space pans and the wheel zooms without touching the Scene', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  const savedBefore = (await savedFiles(page))['scene.json'];
  const start = (await shot(page)).darkCentre(BOTH, 0.6);
  expect(start.count).toBeGreaterThan(0);

  await page.keyboard.down('Space');
  await drag(page, { x: 640, y: 400 }, { x: 660, y: 430 });
  await page.keyboard.up('Space');

  // The grey box moved exactly as far as the pointer did.
  const panned = (await shot(page)).darkCentre(BOTH, 0.6);
  expect(panned.x).toBeCloseTo(start.x + 20, 0);
  expect(panned.y).toBeCloseTo(start.y + 30, 0);

  // Zooming in makes the same box cover more pixels.
  const before = (await shot(page)).darkCount(BOTH, 0.6);
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(100);
  const wheeled = (await shot(page)).darkCount(BOTH, 0.6);
  expect(wheeled).toBeGreaterThan(before * 1.3);

  await page.keyboard.press('Meta+=');
  await page.waitForTimeout(100);
  expect((await shot(page)).darkCount(BOTH, 0.6)).toBeGreaterThan(wheeled);

  // Panning and zooming are view changes, not Scene changes.
  expect((await savedFiles(page))['scene.json']).toBe(savedBefore);
});

test('G shows and hides the dot Grid', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  const withGrid = (await shot(page)).darkCount(GRID, 0.9);
  await page.keyboard.press('g');
  const bare = (await shot(page)).darkCount(GRID, 0.9);
  expect(withGrid).toBeGreaterThan(bare + 500);

  await page.keyboard.press('g');
  expect((await shot(page)).darkCount(GRID, 0.9)).toBeGreaterThan(bare + 500);
});

test('every Element type moves, and only a box-like one gets resize handles', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');

  // The ellipse: select it, resize it from its corner handle, then move it.
  await clickScene(page, { x: 120, y: 110 }, [], MIXED);
  await dragBy(page, { x: 180, y: 160 }, 30, 20, MIXED);
  await dragBy(page, { x: 120, y: 110 }, 30, 20, MIXED);

  // Text carries no width and height, so its corner drags it; nothing resizes.
  await clickScene(page, { x: 277, y: 110 }, [], MIXED);
  await dragBy(page, { x: 295, y: 130 }, 10, 10, MIXED);

  // An arrow moves by both of its ends.
  await dragBy(page, { x: 200, y: 280 }, 0, -20, MIXED);

  const scene = await savedScene(page);
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
  await expectSvgMatchesCli(page);

  // A box around the arrow alone selects only the arrow, ends included.
  await drag(page, at({ x: 40, y: 190 }, MIXED), at({ x: 360, y: 340 }, MIXED));
  await page.keyboard.press('Shift+ArrowRight');
  const nudged = await savedScene(page);
  const moved = new Map(nudged.elements.map((element) => [element.id, element]));
  expect(moved.get('shaft')?.points).toEqual([
    { x: 70, y: 210 },
    { x: 350, y: 310 },
  ]);
  expect(moved.get('oval')?.x).toBe(90);
  expect(moved.get('word')?.x).toBe(270);
});

test('browsing another folder never moves where the open Scene saves', async ({ page }) => {
  const other = JSON.stringify({ ...SCENE, title: 'B copy' }, null, 2);
  // Two folders that both hold a `same.json`: only the opened one may change.
  await openEditor(
    page,
    { A: { 'same.json': SCENE_SOURCE }, B: { 'same.json': other } },
    'same.json',
    ['A', 'B'],
  );

  await browseFolder(page, 'B');
  await expect(page.getByRole('button', { name: 'same.json', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await clickScene(page, { x: 100, y: 80 });
  await page.keyboard.press('Shift+ArrowRight');

  const opened = await savedScene(page, 'same.json', 'A');
  expect(opened.elements.find((element) => element.id === 'a')?.x).toBe(50);
  await expectSvgMatchesCli(page, 'same.json', 'A');

  const browsed = await savedScene(page, 'same.json', 'B');
  expect(browsed.title).toBe('B copy');
  expect(browsed.elements.find((element) => element.id === 'a')?.x).toBe(40);
  expect((await savedFiles(page, 'B'))['same.svg']).toBeUndefined();
});

test('reopening a Scene waits for the save already in flight', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The disk goes quiet with the first edit still unwritten.
  await holdWrites(page, 'scene.json');
  await clickScene(page, { x: 100, y: 80 });
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByRole('status')).toHaveText('saving…');

  // Reopening the same file from the note waits for that write to land.
  await browseFolder(page, 'A');
  await page.getByRole('button', { name: 'scene.json', exact: true }).click();
  await releaseWrite(page);
  await allowWrites(page);
  await expect(page.getByRole('status')).toHaveText('saved');

  // The reopened Scene carries the first nudge (x 50), so the second reaches 60.
  await clickScene(page, { x: 100, y: 80 });
  await page.keyboard.press('Shift+ArrowRight');
  const scene = await savedScene(page);
  expect(scene.elements.find((element) => element.id === 'a')?.x).toBe(60);
});

test('the status says saved only for the bytes that are on disk', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await holdWrites(page, 'scene.json');

  await clickScene(page, { x: 100, y: 80 });
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');

  // The first write lands (x 50) while the edit that made it stale (x 60) is
  // still queued: the newest bytes are not on disk, so nothing is "saved".
  await releaseWrite(page);
  await expect
    .poll(async () => {
      const files = await savedFiles(page);
      const scene = JSON.parse(files['scene.json'] ?? '{}') as {
        elements: Array<{ id: string; x?: number }>;
      };
      return scene.elements.find((element) => element.id === 'a')?.x;
    })
    .toBe(50);
  await expect(page.getByRole('status')).toHaveText('saving…');

  await releaseWrite(page);
  await allowWrites(page);
  const scene = await savedScene(page);
  expect(scene.elements.find((element) => element.id === 'a')?.x).toBe(60);
});

test('the page serves the hand font itself and nothing from a font CDN', async ({ page }) => {
  const remote: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4319/')) {
      remote.push(request.url());
    }
  });
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('18px Kalam'))).toBe(true);
  expect(remote).toEqual([]);
});

test('the page follows the system theme after load and its own switch', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  const light = (await shot(page)).meanLuminance(CORNER);
  expect(light).toBeGreaterThan(0.85);

  // The system turns dark after the page loaded: the page follows.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(100);
  expect((await shot(page)).meanLuminance(CORNER)).toBeLessThan(0.4);

  // The page's own switch brings it back.
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.waitForTimeout(100);
  expect((await shot(page)).meanLuminance(CORNER)).toBeGreaterThan(0.85);
});
