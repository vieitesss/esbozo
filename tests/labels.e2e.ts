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
  OVERFLOW,
  OVERFLOW_SCENE,
  SCENE,
  clickScene,
  cliCheck,
  doubleClickScene,
  openEditor,
  savedFiles,
  savedScene,
} from './helpers.ts';

const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
const MIXED_SOURCE = JSON.stringify(MIXED_SCENE, null, 2);
const OVERFLOW_SOURCE = JSON.stringify(OVERFLOW_SCENE, null, 2);

/** A Label long enough that the box it is typed into has to grow downwards. */
const LONG_LABEL = 'words that wrap and grow';

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

  test('typing a Label grows its Element downwards, keeping the width the author gave it', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially(LONG_LABEL);
    await label.press('Escape');

    const scene = await savedScene(ui);
    const box = scene.elements[0];
    expect(box?.label).toBe(LONG_LABEL);
    expect(box?.width).toBe(120);
    expect(box?.height).toBeGreaterThan(80);
    // The rule `ez check` reports is the one the editor grew by: the words fit.
    expect(await cliCheck(scene)).toEqual({ code: 0, reported: '' });
  });

  test('an emptied Label leaves no label behind, and an emptied Text is gone', async ({
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
    expect((await savedScene(ui)).elements[0]?.label).toBe('Orders');

    await doubleClickScene(ui, { x: 100, y: 80 });
    const again = screen.getByRole('textbox', { name: 'Label' });
    await again.fill('');
    await again.press('Escape');
    expect(Object.hasOwn((await savedScene(ui)).elements[0] ?? {}, 'label')).toBe(false);
  });

  test('an emptied Text is deleted from the Scene', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 277, y: 110 }, MIXED);
    const text = screen.getByRole('textbox', { name: 'Text' });
    await text.fill('');
    await text.press('Escape');

    const scene = await savedScene(ui);
    expect(scene.elements.map((element) => element.id).sort()).toEqual(['oval', 'shaft']);
  });

  test('Escape on words nobody changed writes nothing at all', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': OVERFLOW_SOURCE } }, 'scene.json');
    const before = await savedFiles(ui);

    await doubleClickScene(ui, { x: 90, y: 60 }, OVERFLOW);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await expect(label).toHaveValue('words that wrap');
    await label.press('Escape');

    // No edit, so no step and no write: the disk still holds the same bytes.
    expect(await savedFiles(ui)).toEqual(before);
    await expect(screen.getByRole('status')).toHaveText('saved');
  });

  test('one undo takes back the whole editing session, its growth included', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially(LONG_LABEL);
    await label.press('Escape');
    expect((await savedScene(ui)).elements[0]?.height).toBeGreaterThan(80);

    await browser.keyboard.press('ControlOrMeta+z');
    const undone = await savedScene(ui);
    const box = undone.elements[0];
    expect({ label: box?.label, width: box?.width, height: box?.height }).toEqual({
      label: undefined,
      width: 120,
      height: 80,
    });
  });

  test('a click outside commits the words, and does not also click the canvas', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 100, y: 80 });
    await screen.getByRole('textbox', { name: 'Label' }).pressSequentially('Orders');
    await clickScene(ui, { x: 700, y: 600 });

    expect((await savedScene(ui)).elements[0]?.label).toBe('Orders');
  });

  test('the keys that drive the editor type instead while the words are open', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    // Every one of these is a tool, a delete, a duplicate or the Grid on the page.
    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('xcv r t 1 2 g');
    await label.press('Escape');

    const scene = await savedScene(ui);
    expect(scene.elements.map((element) => element.id)).toEqual(['a', 'b']);
    expect(scene.elements[0]?.label).toBe('xcv r t 1 2 g');
  });

  test('the field keeps its own undo: the Scene is not what Cmd+Z takes back inside it', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    const before = await savedFiles(ui);

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('Orders');
    // The field's own undo, one typed letter at a time: the Scene's history is
    // not what Cmd+Z reaches while the words have the focus.
    for (let letter = 0; letter < 'Orders'.length; letter += 1) {
      await label.press('ControlOrMeta+z');
    }
    await expect(label).toHaveValue('');
    await label.press('Escape');

    // The field undid the typing, so there is nothing to commit: the Scene on
    // disk is byte for byte what it was.
    expect(await savedFiles(ui)).toEqual(before);
  });

  test('a Label the Scene cannot hold is refused, and the Element is left as it was', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    const before = await savedFiles(ui);

    // U+0001 cannot go in the SVG, so the Scene's own parser refuses it.
    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.fill('above\u0001below');
    await label.press('Escape');

    await expect(screen.getByRole('status')).toContainText('XML');
    expect(await savedFiles(ui)).toEqual(before);
  });

  test('a Label that does not fit its Element is what ez check exits 6 on', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    // The same Scene the model judges the red outline on, below in visual.e2e.ts.
    const checked = await cliCheck(OVERFLOW_SCENE);
    expect(checked.code).toBe(6);
    expect(checked.reported).toContain('box: label does not fit');

    // And the editor's own bytes are the ones the check read: opening it writes
    // nothing, and the check on the saved Scene is the same verdict.
    await openEditor(ui, { A: { 'scene.json': OVERFLOW_SOURCE } }, 'scene.json');
    expect((await cliCheck(await savedScene(ui))).code).toBe(6);
  });
});
