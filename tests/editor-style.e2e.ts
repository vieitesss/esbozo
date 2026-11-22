/**
 * Seam 2: the Style menu — the controls a selection can use, the value a pick
 * writes to every selected Element, the one undo step a pick is, and the Scene
 * default roughness the status bar sets. Asserted on the saved Scene.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { MIXED, clickScene, expectSvgMatchesCli, openEditor, savedScene } from './helpers.ts';
import type { Ui } from './helpers.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';
import { SCENE_SOURCE, MIXED_SOURCE, control } from './editor-shared.ts';

/** None of these controls is offered: the buttons themselves are absent. */
async function expectNoControl(ui: Ui, names: readonly string[]): Promise<void> {
  for (const name of names) {
    expect(await control(ui, name).count(), name).toBe(0);
  }
}

test('the Style menu is open only while something is selected', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await expect(ui.screen.getByRole('dialog', 'Style')).toBeHidden();

  await clickScene(ui, { x: 100, y: 80 });
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();

  await ui.browser.keyboard.press('Escape');
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeHidden();
});

test('every style control changes the selected Element in the saved Scene', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await clickScene(ui, { x: 100, y: 80 });

  // One pick per row, each its own autosaved edit; the Scene after all of them
  // is what proves none was lost or written over another.
  await control(ui, 'Rough: cartoonist').click();
  await control(ui, 'Stroke: extra').click();
  await control(ui, 'Line: dotted').click();
  await control(ui, 'Fill: cross').click();
  await control(ui, 'Grey: grey 5').click();
  await control(ui, 'Tone: muted').click();
  await control(ui, 'Corners: round').click();

  const scene = await savedScene(ui);
  const box = scene.elements.find((element) => element.id === 'a');
  expect({
    roughness: box?.roughness,
    stroke: box?.stroke,
    fill: box?.fill,
    tone: box?.tone,
    corners: box?.corners,
  }).toEqual({
    roughness: 2,
    stroke: { width: 'extra', style: 'dotted' },
    fill: { kind: 'cross-hatch', grey: 5 },
    tone: 'muted',
    corners: 'round',
  });
  // A style is not a move: the box stays where it was.
  expect({ x: box?.x, y: box?.y, width: box?.width, height: box?.height }).toEqual({
    x: 40,
    y: 40,
    width: 120,
    height: 80,
  });
  await expectSvgMatchesCli(ui);
});

test('the menu offers only the controls the selection can use', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');

  // An arrow is a stroke: heads, no fill, no corners, and words that take a size
  // and an alignment of their own on the block the shaft gives them.
  await clickScene(ui, { x: 200, y: 280 }, [], MIXED);
  await expect(control(ui, 'Head ←: dot')).toBeVisible();
  await expect(control(ui, 'Head →: bar')).toBeVisible();
  await expect(control(ui, 'Rough: cartoonist')).toBeVisible();
  await expect(control(ui, 'Align: centre')).toBeVisible();
  await expectNoControl(ui, ['Fill: hachure', 'Grey: grey 5', 'Corners: round']);

  await control(ui, 'Head ←: dot').click();
  await control(ui, 'Head →: bar').click();
  let scene = await savedScene(ui);
  expect(scene.elements.find((element) => element.id === 'shaft')?.heads).toEqual({
    start: 'dot',
    end: 'bar',
  });

  // A Text is only words: no stroke to widen, but a size and an alignment.
  await clickScene(ui, { x: 277, y: 110 }, [], MIXED);
  await expect(control(ui, 'Size: L')).toBeVisible();
  await expect(control(ui, 'Align: centre')).toBeVisible();
  await expectNoControl(ui, ['Rough: cartoonist', 'Stroke: extra']);

  await control(ui, 'Size: L').click();
  await control(ui, 'Align: centre').click();
  scene = await savedScene(ui);
  const word = scene.elements.find((element) => element.id === 'word');
  expect({ fontSize: word?.fontSize, textAlign: word?.textAlign }).toEqual({
    fontSize: 'L',
    textAlign: 'center',
  });
});

test('Align is offered for words and boxes, a shaft’s Label among them', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');

  // An ellipse's Label, a Text and a shaft's Label all take an alignment: one
  // pick writes it into every Element in the selection, the shaft included.
  await clickScene(ui, { x: 120, y: 110 }, [], MIXED);
  await clickScene(ui, { x: 277, y: 110 }, ['Shift'], MIXED);
  await clickScene(ui, { x: 200, y: 280 }, ['Shift'], MIXED);
  await expect(control(ui, 'Align: right')).toBeVisible();
  await control(ui, 'Align: right').click();
  const scene = await savedScene(ui);
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect([
    saved.get('oval')?.textAlign,
    saved.get('word')?.textAlign,
    saved.get('shaft')?.textAlign,
  ]).toEqual(['right', 'right', 'right']);
});

test('a pick writes to every selected Element, and a row that shares no value says mixed', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await clickScene(ui, { x: 100, y: 80 });
  await clickScene(ui, { x: 250, y: 110 }, ['Shift']);

  // `a` and `b` are both bold and sharp, and disagree on line and tone.
  await expect(control(ui, 'Rough: artist')).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Line', 'Tone']) {
    await expect(ui.screen.getByRole('group', name).getByText('mixed')).toBeVisible();
  }
  await expect(control(ui, 'Line: solid')).not.toHaveAttribute('aria-pressed', 'true');

  await control(ui, 'Tone: ink').click();
  await control(ui, 'Line: dotted').click();

  const scene = await savedScene(ui);
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(saved.get('a')?.tone).toBe('ink');
  expect(saved.get('b')?.tone).toBe('ink');
  expect(saved.get('a')?.stroke).toEqual({ width: 'bold', style: 'dotted' });
  expect(saved.get('b')?.stroke).toEqual({ width: 'bold', style: 'dotted' });
});

test('the status bar sets the Scene default roughness, and only new Elements take it', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await ui.screen.getByRole('button', 'rough artist').click();
  await expect(ui.screen.getByRole('button', 'rough cartoonist')).toBeVisible();

  const scene = await savedScene(ui);
  expect(scene.defaults?.roughness).toBe(2);
  // The Elements in the Scene carry their own resolved style, so they keep it.
  expect(scene.elements.map((element) => element.roughness)).toEqual([1, 1]);
});

test('a style pick is one undo step', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await clickScene(ui, { x: 100, y: 80 });
  await control(ui, 'Rough: cartoonist').click();
  expect((await savedScene(ui)).elements[0]?.roughness).toBe(2);

  await ui.browser.keyboard.press('Meta+z');
  expect((await savedScene(ui)).elements[0]?.roughness).toBe(1);
});

test('the roughness label stays quiet and the value is in ink', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await ui.browser.setViewport({ width: 1366, height: 768 });
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await expect(ui.screen.getByRole('button', 'rough artist')).toBeVisible();

  // The bottom left corner, one line of what the view is doing: Grid — pressed,
  // so in ink too — then `rough artist`. The label is the page's quiet grey and
  // the value is the near black of the ink, so a threshold between the two counts
  // the word that answers and nothing of the word that asks.
  const LABEL: Rect = { x: 50, y: 730, width: 34, height: 20 };
  const VALUE: Rect = { x: 84, y: 730, width: 34, height: 20 };
  const page = await shot(ui);
  expect(page.darkCount(LABEL, 0.3)).toBe(0);
  expect(page.darkCount(VALUE, 0.3)).toBeGreaterThan(0);
});

test('undoing the Scene default roughness puts the status bar back', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await ui.screen.getByRole('button', 'rough artist').click();
  await expect(ui.screen.getByRole('button', 'rough cartoonist')).toBeVisible();

  await ui.browser.keyboard.press('Meta+z');
  await expect(ui.screen.getByRole('button', 'rough artist')).toBeVisible();
  expect((await savedScene(ui)).defaults?.roughness).toBe(1);
});
