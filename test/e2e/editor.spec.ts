/**
 * Seam 2: the editor in a browser.
 *
 * Everything is driven the way a person drives it — the folder button, the
 * Scene name, the pointer, the keys — and asserted on the files the editor
 * hands to the file system, plus the SVG it paints. Nothing reads the editor's
 * own state, so the implementation stays free to change shape.
 */
import { expect, test } from '@playwright/test';
import {
  SCENE,
  clickScene,
  drag,
  expectSvgMatchesCli,
  browseFolder,
  openEditor,
  openNewScene,
  savedFiles,
  savedScene,
  screenPoint,
  viewOf,
} from './helpers.js';

const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);

test('opening a Scene file paints it with the Renderer', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  const painted = page.locator('.painted svg');
  await expect(painted).toHaveCount(1);
  await expect(page.locator('.painted svg title')).toHaveText('Two boxes');
  // Ink, muted and the grey ladder come from the theme's variables, and both
  // Elements are on the page.
  await expect(page.locator('.painted path[stroke="var(--ink)"]').first()).toBeAttached();
  await expect(page.locator('.painted path[stroke="var(--muted)"]').first()).toBeAttached();
  await expect(page.locator('.painted path[fill^="color-mix("]').first()).toBeAttached();
  await expect(page.locator('.zoom')).toHaveText('100%');
});

test('a Scene that will not parse is reported and left alone on disk', async ({ page }) => {
  const broken = JSON.stringify({
    version: 1,
    elements: [{ id: 'box-a', type: 'rectangle', x: 10, y: 10, width: 0, height: 40 }],
  });
  await openEditor(page, { A: { 'broken.json': broken } }, 'broken.json');

  await expect(page.locator('.saved')).toContainText('width must be at least 1 pixel');
  await expect(page.locator('.saved')).toContainText('box-a');
  const files = await savedFiles(page);
  expect(files['broken.json']).toBe(broken);
  expect(files['broken.svg']).toBeUndefined();
});

test('a Scene that is not there opens empty and is saved as Scene and SVG', async ({ page }) => {
  await openNewScene(page, { A: {} }, 'fresh.json');

  await expect(page.locator('.saved')).toHaveText('saved');
  const files = await savedFiles(page);
  expect(Object.keys(files).sort()).toEqual(['fresh.json', 'fresh.svg']);

  const scene = JSON.parse(files['fresh.json'] ?? '{}');
  expect(scene.elements).toEqual([]);
  expect(scene.title).toBe('fresh');
  expect(files['fresh.svg']).toMatch(/<title[^>]*>fresh<\/title>/);
  await expect(page.locator('.painted svg')).toHaveCount(1);
});

test('dragging an Element moves it smoothly and autosaves Scene plus SVG', async ({ page }) => {
  const prompts: string[] = [];
  page.on('dialog', async (dialog) => {
    prompts.push(dialog.message());
    await dialog.dismiss();
  });
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  const from = await screenPoint(page, { x: 100, y: 80 });
  // 37 and 23 are not on the 22px Grid, so a saved 77/63 proves no snapping.
  await drag(page, from, { x: from.x + 37, y: from.y + 23 });

  const scene = await savedScene(page);
  const box = scene.elements.find((element) => element.id === 'a');
  expect({ x: box?.x, y: box?.y }).toEqual({ x: 77, y: 63 });
  await expectSvgMatchesCli(page);
  expect(prompts).toEqual([]);
});

test('click selects one Element, shift-click adds another, and both move', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await clickScene(page, { x: 100, y: 80 });
  await expect(page.locator('.handle')).toHaveCount(8);

  await clickScene(page, { x: 250, y: 110 }, ['Shift']);
  await expect(page.locator('.handle')).toHaveCount(0);
  const union = page.locator('.selection');
  await expect(union).toHaveCount(1);
  expect(Number(await union.getAttribute('width'))).toBeGreaterThan(260);

  const from = await screenPoint(page, { x: 250, y: 110 });
  await drag(page, from, { x: from.x + 11, y: from.y + 7 });

  const scene = await savedScene(page);
  expect(scene.elements.map((element) => [element.id, element.x, element.y])).toEqual([
    ['a', 51, 47],
    ['b', 211, 67],
  ]);
});

test('dragging on empty canvas box-selects and selects no page text', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  const from = await screenPoint(page, { x: 10, y: 10 });
  const to = await screenPoint(page, { x: 320, y: 180 });
  await drag(page, from, to);

  await expect(page.locator('.selection')).toHaveCount(1);
  await expect(page.locator('.handle')).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  expect(
    await page.locator('esbozo-editor').evaluate((node) => getComputedStyle(node).userSelect),
  ).toBe('none');

  // Both Elements are selected: a nudge moves both.
  await page.keyboard.press('Shift+ArrowRight');
  const scene = await savedScene(page);
  expect(scene.elements.map((element) => element.x)).toEqual([50, 210]);
});

test('a resize handle changes the saved geometry', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await clickScene(page, { x: 100, y: 80 });

  const handle = page.locator('.handle-se');
  await expect(handle).toHaveCount(1);
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const centre = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await drag(page, centre, { x: centre.x + 30, y: centre.y + 10 });

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
  const before = await viewOf(page);
  const savedBefore = (await savedFiles(page))['scene.json'];

  await page.keyboard.down('Space');
  await drag(page, { x: 640, y: 400 }, { x: 660, y: 430 });
  await page.keyboard.up('Space');

  const panned = await viewOf(page);
  expect(panned.panX).toBeCloseTo(before.panX + 20, 0);
  expect(panned.panY).toBeCloseTo(before.panY + 30, 0);
  expect(panned.zoom).toBe(before.zoom);

  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -240);
  const zoomed = await viewOf(page);
  expect(zoomed.zoom).toBeGreaterThan(before.zoom);
  await expect(page.locator('.zoom')).not.toHaveText('100%');

  await page.keyboard.press('Meta+=')
  expect((await viewOf(page)).zoom).toBeGreaterThan(zoomed.zoom);

  // Panning and zooming are view changes, not Scene changes.
  expect((await savedFiles(page))['scene.json']).toBe(savedBefore);
});

test('G shows and hides the dot Grid', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await expect(page.locator('.grid-rect')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.locator('.grid-rect')).toBeHidden();
  await page.keyboard.press('g');
  await expect(page.locator('.grid-rect')).toBeVisible();
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

test('a box that only overlaps an Element does not select it', async ({ page }) => {
  await openEditor(page, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The box crosses `a` and clips `b`, enclosing neither.
  const from = await screenPoint(page, { x: 10, y: 10 });
  const to = await screenPoint(page, { x: 250, y: 100 });
  await drag(page, from, to);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

  // Nothing is selected, so a nudge writes nothing.
  await page.keyboard.press('Shift+ArrowRight');
  expect((await savedFiles(page))['scene.json']).toBe(SCENE_SOURCE);
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
