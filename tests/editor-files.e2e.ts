/**
 * Seam 2: the editor's files — opening a Scene, the folder a person picks, the
 * name a new Scene is saved under, and the save status that follows the bytes
 * that are on disk. Driven the way a person drives it, the folder button and
 * the file name, and asserted on the files the editor wrote.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  BROKEN_SCENE,
  SCENE,
  allowWrites,
  browseFolder,
  clickScene,
  dragBy,
  expectSvgMatchesCli,
  holdWrites,
  openEditor,
  openNewScene,
  releaseWrite,
  savedFiles,
  savedScene,
} from './helpers.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';
import { SCENE_SOURCE } from './editor-shared.ts';

const BROKEN_SOURCE = JSON.stringify(BROKEN_SCENE, null, 2);

/** The middle of `b`, the one solid grey box in the fixture. */
const GREY_BOX: Rect = { x: 700, y: 390, width: 40, height: 40 };
/** Bare paper: no Element, no rail, no status, no note. */
const PAPER: Rect = { x: 900, y: 550, width: 40, height: 40 };

test('opening a Scene file paints it with the Renderer', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The grey box is painted, and it is painted darker than bare paper.
  const view = await shot(ui);
  const fill = view.meanLuminance(GREY_BOX);
  const paper = view.meanLuminance(PAPER);
  expect(fill).toBeLessThan(paper - 0.2);
});

test('a Scene that will not parse is reported and left alone on disk', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'broken.esbozo': BROKEN_SOURCE } }, 'broken.esbozo');

  await expect(ui.screen.getByRole('status')).toContainText('width must be at least 1 pixel');
  await expect(ui.screen.getByRole('status')).toContainText('box-a');
  const files = await savedFiles(ui);
  expect(files['broken.esbozo']).toBe(BROKEN_SOURCE);
  expect(files['broken.svg']).toBeUndefined();
});

test('a picked folder lists its Scenes, not the other JSON files beside them', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(
    ui,
    {
      A: {
        'scene.esbozo': SCENE_SOURCE,
        'package.json': '{ "name": "not-a-scene" }',
        'broken.json': '{ this is not JSON',
      },
    },
    'scene.esbozo',
  );

  // The Scene opens and is painted, whatever its extension is.
  const view = await shot(ui);
  expect(view.meanLuminance(GREY_BOX)).toBeLessThan(view.meanLuminance(PAPER) - 0.2);

  // The note lists the folder while it is open, and loading a Scene hides it — a
  // button nobody can see is no evidence that the list left it out.
  await browseFolder(ui, 'A');
  await expect(screen.getByRole('button', 'scene.esbozo')).toBeVisible();
  await expect(screen.getByRole('button', 'package.json')).toHaveCount(0);
  await expect(screen.getByRole('button', 'broken.json')).toHaveCount(0);
  await browser.keyboard.press('Escape');

  // An .esbozo Scene saves its SVG beside it, by the same rule as a .json one.
  await dragBy(ui, { x: 100, y: 80 }, 37, 23);
  await expect(screen.getByRole('status')).toHaveText('saved');
  const files = await savedFiles(ui);
  expect(files['scene.esbozo']).toBeTruthy();
  expect(files['scene.svg']).toBeTruthy();
});

test('a Scene that is not there opens empty and is saved as Scene and SVG', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  // Asked for by name, so it is a Scene at once: empty, and on disk with its SVG.
  await openNewScene(ui, { A: {} }, 'fresh.json');

  await expect(ui.screen.getByRole('status')).toHaveText('saved');
  const files = await savedFiles(ui);
  expect(Object.keys(files).sort()).toEqual(['fresh.json', 'fresh.svg']);

  const scene = JSON.parse(files['fresh.json'] ?? '{}');
  expect(scene.elements).toEqual([]);
  expect(scene.title).toBe('fresh');
  // check-rules: markup of a written SVG file, not the page
  expect(files['fresh.svg']).toMatch(/<title[^>]*>fresh<\/title>/);

  // An empty Scene paints nothing where the grey box would have been.
  const view = await shot(ui);
  expect(view.meanLuminance(GREY_BOX)).toBeGreaterThan(0.85);
});

test('a new Scene takes .esbozo when the name is bare', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openNewScene(ui, { A: {} }, 'fresh');

  await expect(ui.screen.getByRole('status')).toHaveText('saved');
  const files = await savedFiles(ui);
  expect(Object.keys(files).sort()).toEqual(['fresh.esbozo', 'fresh.svg']);
  expect(JSON.parse(files['fresh.esbozo'] ?? '{}').title).toBe('fresh');
});

test('a new Scene with no name is scene.esbozo', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openNewScene(ui, { A: {} }, '');

  await expect(ui.screen.getByRole('status')).toHaveText('saved');
  const files = await savedFiles(ui);
  expect(Object.keys(files).sort()).toEqual(['scene.esbozo', 'scene.svg']);
});

test('browsing another folder never moves where the open Scene saves', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  const other = JSON.stringify({ ...SCENE, title: 'B copy' }, null, 2);
  // Two folders that both hold a `same.json`: only the opened one may change.
  await openEditor(
    ui,
    { A: { 'same.json': SCENE_SOURCE }, B: { 'same.json': other } },
    'same.json',
    ['A', 'B'],
  );

  await browseFolder(ui, 'B');
  await expect(ui.screen.getByRole('button', 'same.json')).toBeVisible();
  await ui.browser.keyboard.press('Escape');

  await clickScene(ui, { x: 100, y: 80 });
  await ui.browser.keyboard.press('Shift+ArrowRight');

  const opened = await savedScene(ui, 'same.json', 'A');
  expect(opened.elements.find((element) => element.id === 'a')?.x).toBe(50);
  await expectSvgMatchesCli(ui, 'same.json', 'A');

  const browsed = await savedScene(ui, 'same.json', 'B');
  expect(browsed.title).toBe('B copy');
  expect(browsed.elements.find((element) => element.id === 'a')?.x).toBe(40);
  expect((await savedFiles(ui, 'B'))['same.svg']).toBeUndefined();
});

test('reopening a Scene waits for the save already in flight', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The disk goes quiet with the first edit still unwritten.
  await holdWrites(ui, 'scene.json');
  await clickScene(ui, { x: 100, y: 80 });
  await ui.browser.keyboard.press('Shift+ArrowRight');
  await expect(ui.screen.getByRole('status')).toHaveText('saving…');

  // Reopening the same file from the note waits for that write to land.
  await browseFolder(ui, 'A');
  await ui.screen.getByRole('button', 'scene.json').click();
  await releaseWrite(ui);
  await allowWrites(ui);
  await expect(ui.screen.getByRole('status')).toHaveText('saved');

  // The reopened Scene carries the first nudge (x 50), so the second reaches 60.
  await clickScene(ui, { x: 100, y: 80 });
  await ui.browser.keyboard.press('Shift+ArrowRight');
  const scene = await savedScene(ui);
  expect(scene.elements.find((element) => element.id === 'a')?.x).toBe(60);
});

test('the status says saved only for the bytes that are on disk', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await holdWrites(ui, 'scene.json');

  await clickScene(ui, { x: 100, y: 80 });
  await ui.browser.keyboard.press('Shift+ArrowRight');
  await ui.browser.keyboard.press('Shift+ArrowRight');

  // The first write lands (x 50) while the edit that made it stale (x 60) is
  // still queued: the newest bytes are not on disk, so nothing is "saved".
  await releaseWrite(ui);
  await expect
    .poll(async () => {
      const files = await savedFiles(ui);
      const scene = JSON.parse(files['scene.json'] ?? '{}') as {
        elements: Array<{ id: string; x?: number }>;
      };
      return scene.elements.find((element) => element.id === 'a')?.x;
    })
    .toBe(50);
  await expect(ui.screen.getByRole('status')).toHaveText('saving…');

  await releaseWrite(ui);
  await allowWrites(ui);
  const scene = await savedScene(ui);
  expect(scene.elements.find((element) => element.id === 'a')?.x).toBe(60);
});
