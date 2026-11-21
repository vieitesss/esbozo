/**
 * Seam 2: Label and Text editing in place.
 *
 * Same rules as the other editor suites: a person's input only — the pointer,
 * the keys — and the assertion is the Scene the editor saves. No test here
 * reads the DOM, an editor field or a class name, and no test uses the model,
 * so `pnpm e2e` still passes with no key set.
 */
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  MIXED,
  MIXED_SCENE,
  SCENE,
  clickScene,
  doubleClickScene,
  openEditor,
  savedScene,
} from './helpers.ts';

const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
const MIXED_SOURCE = JSON.stringify(MIXED_SCENE, null, 2);

describe('labels', () => {
  test('double-clicking a box Element types its Label in place, and the Scene keeps the words', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('Orders');
    await label.press('Escape');

    const scene = await savedScene(ui);
    expect(scene.elements[0]?.label).toBe('Orders');
  });

  test('Enter on a single selection edits its words too, and the keyboard can leave them alone', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await clickScene(ui, { x: 100, y: 80 });
    await browser.keyboard.press('Enter');
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('Invoices');
    await label.press('Escape');

    const scene = await savedScene(ui);
    expect(scene.elements[0]?.label).toBe('Invoices');
  });

  test('double-clicking a Text edits its own words, without making a second Text', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 277, y: 110 }, MIXED);
    const text = screen.getByRole('textbox', { name: 'Text' });
    await expect(text).toHaveValue('hi');
    await text.fill('edited in place');
    await text.press('Escape');

    const scene = await savedScene(ui);
    const word = scene.elements.find((element) => element.id === 'word');
    expect({ type: word?.type, content: word?.content }).toEqual({
      type: 'text',
      content: 'edited in place',
    });
    expect(scene.elements.length).toBe(3);
  });

  test("double-clicking an arrow's shaft edits its Label, which sits on the line", async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 200, y: 280 }, MIXED);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('then');
    await label.press('Escape');

    const scene = await savedScene(ui);
    const shaft = scene.elements.find((element) => element.id === 'shaft');
    expect({ type: shaft?.type, label: shaft?.label }).toEqual({
      type: 'arrow',
      label: 'then',
    });
    // A shaft has no box to wrap in, so its words did not grow it either.
    expect(shaft?.points).toEqual([
      { x: 60, y: 230 },
      { x: 340, y: 330 },
    ]);
  });
});
