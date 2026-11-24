/**
 * One of the Label suites, split by what a person sees, not by module: `tests/labels-*.e2e.ts`.
 * Browser seam: a Label or a Text opens under a double-click or Enter, the keys type into it, and
 * the words are written back — or refused — when the person leaves them.
 */
import { describe, test } from '@e2e-dev/web';
import { afterAll, expect } from 'e2e';
import {
  BESIDE,
  MIXED,
  OVERFLOW,
  OVERFLOW_SCENE,
  PRESS,
  PRESS_SCENE,
  SHIFTED,
  SHIFTED_SCENE,
  cliCheck,
  cliCheckBytes,
  at,
  clickScene,
  doubleClickScene,
  drag,
  dragBy,
  openEditor,
  savedFiles,
  savedScene,
  settle,
} from './helpers.ts';
import { BESIDE_SOURCE, DARK, MIXED_SOURCE, SCENE_SOURCE } from './labels-shared.ts';
import { stillCaret } from './cdp.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';
import { removeTempFolders } from '../test/temp.ts';

afterAll(removeTempFolders);

const OVERFLOW_SOURCE = JSON.stringify(OVERFLOW_SCENE, null, 2);

const PRESS_SOURCE = JSON.stringify(PRESS_SCENE, null, 2);

const SHIFTED_SOURCE = JSON.stringify(SHIFTED_SCENE, null, 2);

/** A Label long enough that the box it is typed into has to grow downwards. */
const LONG_LABEL = 'words that wrap and grow';

describe('labels edit', () => {
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

  test('a sweep in flight shows the committed words, not the ones being typed under it', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');
    await stillCaret();

    // One Text selected, so Enter opens its words; the Shift sweep adds to that
    // selection, so the sweep is still in flight when the typing starts.
    await clickScene(ui, { x: 277, y: 110 }, [], MIXED);
    await settle(ui);
    const row: Rect = {
      x: at({ x: 250, y: 80 }, MIXED).x,
      y: at({ x: 250, y: 80 }, MIXED).y,
      width: 200,
      height: 120,
    };
    const words = (await shot(ui)).darkBounds(row, DARK);
    expect(words).not.toBeNull();
    // The strip just past the words the Scene holds, where a longer draft's own
    // glyphs stand. It is bare as long as the page shows the committed words.
    const pastTheWords: Rect = {
      x: (words as Rect).x + (words as Rect).width + 6,
      y: (words as Rect).y,
      width: 80,
      height: (words as Rect).height,
    };

    await browser.keyboard.down('Shift');
    await drag(ui, at({ x: 10, y: 180 }, MIXED), at({ x: 50, y: 210 }, MIXED), 'left', async () => {
      // The pointer is still down: the page owes the Scene's own words until the
      // sweep ends, however far the session under it has got.
      await browser.keyboard.up('Shift');
      await browser.keyboard.press('Enter');
      await screen.getByRole('textbox', { name: 'Text' }).press('ControlOrMeta+a');
      await browser.keyboard.type('Box draft');
      await settle(ui);
      const held = await shot(ui);
      expect(held.darkCount(pastTheWords, DARK)).toBe(0);
      expect(held.darkBounds(row, DARK)).toEqual(words);
    });
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

  test('an emptied Label leaves no label behind', async ({ app, browser, screen }) => {
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
    await openEditor(ui, { A: { 'overflow.json': OVERFLOW_SOURCE } }, 'overflow.json');

    // The editor shrinks the box through its east handle, so the words that
    // already did not fit fit even less: the bytes the check reads are the ones
    // the editor saved, not the fixture it opened.
    await clickScene(ui, { x: 60, y: 60 }, [], OVERFLOW);
    await dragBy(ui, { x: 140, y: 60 }, -40, 0, OVERFLOW);
    const scene = await savedScene(ui, 'overflow.json');
    expect(scene.elements[0]?.width).toBe(60);

    // The bytes the check reads are the ones the editor wrote, unturned.
    const files = await savedFiles(ui);
    const checked = await cliCheckBytes(files['overflow.json'] ?? '');
    expect(checked.code).toBe(6);
    expect(checked.reported).toContain('box: label does not fit');
  });

  test('a double-click opens the words under its first click, though the note moved the view', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'shifted.json': SHIFTED_SOURCE } }, 'shifted.json');

    // `far` sits under the Style note: the first click selects it and the view
    // pans clear, which slides `other` under the pointer for the second click.
    // The words that open still belong to what the first click found.
    await doubleClickScene(ui, { x: 778, y: 80 }, SHIFTED);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('far away');
    await label.press('Escape');

    const scene = await savedScene(ui, 'shifted.json');
    expect(scene.elements.find((element) => element.id === 'far')?.label).toBe('far away');
    expect(scene.elements.find((element) => element.id === 'other')?.label).toBeUndefined();
  });

  test('a double-click whose second press lands on a Style row opens the words and no Style', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'press.json': PRESS_SOURCE } }, 'press.json');

    // `far` reaches under where the note docks: the first click selects it and
    // the note slides over the pointer, so the second press of the double-click
    // lands on `Tone: ink`, a row that would change the box from muted. The
    // words that open are still `far`'s, and the click Chromium follows every
    // press with is the press's own: it applies no Style.
    await doubleClickScene(ui, { x: 900, y: 94 }, PRESS);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await expect(label).toHaveValue('');
    await label.pressSequentially('at the edge');
    await label.press('Escape');

    const scene = await savedScene(ui, 'press.json');
    const far = scene.elements.find((element) => element.id === 'far');
    expect(far?.label).toBe('at the edge');
    expect(scene.elements.find((element) => element.id === 'near')?.label).toBeUndefined();
    // The words opened, and the row under the press ran nothing: the box is the
    // tone it had, not the one it was pressed over.
    expect(far?.tone).toBe('muted');
  });

  test('a press that came up off the row leaves the keyboard’s own click alone', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'press.json': PRESS_SOURCE } }, 'press.json');

    // The first click finds `far` and the note docks under the pointer, so the
    // second press lands on `Tone: ink` and opens `far`'s words. It comes up on
    // the paper to the left of the note, though, so the click that closes the
    // press never reaches the row: nothing was applied and nothing is owed.
    await clickScene(ui, { x: 900, y: 94 }, [], PRESS);
    await browser.mouse.move(1050, 414);
    await browser.mouse.down();
    await browser.mouse.move(890, 414);
    await browser.mouse.up();
    const label = screen.getByRole('textbox', { name: 'Label' });
    await expect(label).toHaveValue('');
    await label.press('Escape');

    // The keyboard's click is the person's own, asked for after the press: the
    // first Enter applies the row, and no stale debt of the press eats it.
    await screen.getByRole('button', { name: 'Tone: ink' }).press('Enter');
    const far = (await savedScene(ui, 'press.json')).elements.find(
      (element) => element.id === 'far',
    );
    expect(far?.tone).toBe('ink');
  });

  test('a click, a drag of another Element and another click are not a double-click', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    // `a` is pressed once; then the pointer carries `b` somewhere else and comes
    // back to `a` for another click. Between the two clicks the pointer was
    // busy with a drag, so the second click is a new sequence, not the second
    // half of a double-click on what the first one found.
    await clickScene(ui, { x: 100, y: 80 });
    await dragBy(ui, { x: 250, y: 110 }, 40, 40);
    await clickScene(ui, { x: 100, y: 80 });

    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveCount(0);
  });

  test('a click, a zoom and another click are not a double-click', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await clickScene(ui, { x: 100, y: 80 });
    await browser.mouse.move(400, 300);
    await browser.mouse.wheel(0, -120);
    await clickScene(ui, { x: 100, y: 80 });

    // The zoom is a view change, not part of the double-click: nothing opened.
    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveCount(0);
  });

  test("a double-click on an arrow's words edits them, though they are ink beside the shaft", async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'beside.json': BESIDE_SOURCE } }, 'beside.json');

    // The Label sits to the left of a vertical shaft: the words are 13px off the
    // line, further than a click picks a shaft by, so they have their own hit.
    await doubleClickScene(ui, { x: 287, y: 220 }, BESIDE);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('ward');
    await label.press('Escape');

    const scene = await savedScene(ui, 'beside.json');
    expect(scene.elements[0]?.label).toBe('upward');
  });
});
