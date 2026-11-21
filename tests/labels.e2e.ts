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
  BESIDE,
  BESIDE_SCENE,
  EDGE,
  EDGE_SCENE,
  MIXED,
  MIXED_SCENE,
  OVERFLOW,
  OVERFLOW_SCENE,
  ROOM,
  ROOM_SCENE,
  SCENE,
  SHIFTED,
  SHIFTED_SCENE,
  SPACED_SCENE,
  WORDS,
  WORDS_SCENE,
  at,
  cliCheck,
  cliCheckBytes,
  clickScene,
  doubleClickScene,
  dragBy,
  middleDrag,
  openEditor,
  savedFiles,
  savedScene,
} from './helpers.ts';
import { imeCommit, imeCompose } from './cdp.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';

const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
const MIXED_SOURCE = JSON.stringify(MIXED_SCENE, null, 2);
const OVERFLOW_SOURCE = JSON.stringify(OVERFLOW_SCENE, null, 2);
const WORDS_SOURCE = JSON.stringify(WORDS_SCENE, null, 2);
const ROOM_SOURCE = JSON.stringify(ROOM_SCENE, null, 2);
const SPACED_SOURCE = JSON.stringify(SPACED_SCENE, null, 2);
const BESIDE_SOURCE = JSON.stringify(BESIDE_SCENE, null, 2);
const SHIFTED_SOURCE = JSON.stringify(SHIFTED_SCENE, null, 2);
const EDGE_SOURCE = JSON.stringify(EDGE_SCENE, null, 2);

/** A Label long enough that the box it is typed into has to grow downwards. */
const LONG_LABEL = 'words that wrap and grow';

/** A single word too wide for the box it is typed into. */
const LONG_WORD = 'antidisestablishmentarianism';

/** A word wide enough that the grown Element reaches under the docked note. */
const HUGE_WORD = LONG_WORD + LONG_WORD;

/** Ink: the ink of a Scene is near black on near white, so half way is the line. */
const DARK = 0.5;

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

  test('an unconfirmed preedit never reaches the Scene', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    const before = await savedFiles(ui);

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await imeCompose('にほん');
    await expect(label).toHaveValue('にほん');

    // A key is not the end of a composition: Escape waits for the IME.
    await label.press('Escape');
    await expect(label).toHaveValue('にほん');
    expect(await savedFiles(ui)).toEqual(before);

    // Finishing the session drops the preedit: only confirmed words are words.
    await clickScene(ui, { x: 700, y: 600 });
    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveCount(0);
    expect(await savedFiles(ui)).toEqual(before);
  });

  test('an outside press finishes the words before an input method can confirm them', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    const before = await savedFiles(ui);

    // The rail takes the focus off the field. Chromium confirms an open preedit
    // when that happens, so the session has to end first or the preedit is kept.
    await doubleClickScene(ui, { x: 100, y: 80 });
    await imeCompose('にほん');
    await screen.getByRole('navigation', { name: 'Tools' }).click({ position: { x: 2, y: 2 } });
    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveCount(0);
    expect(await savedFiles(ui)).toEqual(before);

    // The Style note docks over the page, and is no different: the words are
    // finished before anything it does can take the focus.
    await doubleClickScene(ui, { x: 100, y: 80 });
    await imeCompose('にほん');
    await screen.getByRole('dialog', { name: 'Style' }).click({ position: { x: 4, y: 4 } });
    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveCount(0);
    expect(await savedFiles(ui)).toEqual(before);
  });

  test('what an input method confirms is what the Scene keeps', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await imeCompose('にほん');
    // The person picks a candidate: what lands is the word chosen, not the reading.
    await imeCommit('日本');
    await expect(label).toHaveValue('日本');
    await label.press('Escape');

    expect((await savedScene(ui)).elements[0]?.label).toBe('日本');
  });

  test('a preedit the person deletes leaves the words as they were', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    const before = await savedFiles(ui);

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await imeCompose('にほん');
    // Deleting the reading leaves the preedit empty: nothing was chosen, so no
    // words were typed, and the field still holds the words it opened with.
    await imeCompose('');
    await expect(label).toHaveValue('');
    await label.press('Escape');

    expect(await savedFiles(ui)).toEqual(before);
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

  test('a double-click whose second press lands on the Style note opens the first click’s words', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'edge.json': EDGE_SOURCE } }, 'edge.json');

    // `far` sits under where the note docks: the first click selects it and the
    // note slides over the pointer, so the second press of the double-click
    // lands on the note itself. The words that open are still `far`'s.
    await doubleClickScene(ui, { x: 790, y: 80 }, EDGE);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await expect(label).toHaveValue('');
    await label.pressSequentially('at the edge');
    await label.press('Escape');

    const scene = await savedScene(ui, 'edge.json');
    expect(scene.elements.find((element) => element.id === 'far')?.label).toBe('at the edge');
    expect(scene.elements.find((element) => element.id === 'near')?.label).toBeUndefined();
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

  test('a middle-drag pans the page and leaves the words open', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('Orders');
    // The box sits under the box it edits, and its words are ink like any other.
    const under: Rect = { x: 512, y: 428, width: 120, height: 24 };
    const carried: Rect = { x: under.x - 60, y: under.y - 40, width: under.width, height: under.height };
    expect((await shot(ui)).darkCount(under, DARK)).toBeGreaterThan(0);

    // The middle button is a pan, not a click away: the words stay open.
    const from = at({ x: 100, y: 80 });
    await middleDrag(ui, from, { x: from.x - 60, y: from.y - 40 });

    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveCount(1);
    await expect(label).toHaveValue('Orders');
    // And the pan carried the box with the page: its words left where they were.
    const panned = await shot(ui);
    expect(panned.darkCount(under, DARK)).toBe(0);
    expect(panned.darkCount(carried, DARK)).toBeGreaterThan(0);

    await label.press('Escape');
    expect((await savedScene(ui)).elements[0]?.label).toBe('Orders');
  });

  test('a wheel zoom carries the open field of a new Text with the page', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await browser.keyboard.press('t');
    await clickScene(ui, { x: 420, y: 300 });
    const field = screen.getByRole('textbox', { name: 'Text' });
    await field.pressSequentially('hello');
    const typed: Rect = { x: 880, y: 590, width: 120, height: 40 };
    expect((await shot(ui)).darkCount(typed, DARK)).toBeGreaterThan(0);

    // A zoom around a point away from the words moves the page under them.
    await browser.mouse.move(300, 300);
    await browser.mouse.wheel(0, 300);
    await expect(screen.getByText(/^\d+%$/)).toHaveText('64%');

    // The words are drawn where the zoom puts them, and the box is still their own.
    const zoomed = await shot(ui);
    expect(zoomed.darkCount(typed, DARK)).toBe(0);
    expect(zoomed.darkCount({ x: 668, y: 486, width: 130, height: 22 }, DARK)).toBeGreaterThan(0);
    await expect(field).toHaveValue('hello');

    await field.press('Escape');
    expect((await savedScene(ui)).elements.length).toBe(3);
  });

  test('a Label long enough to reach the note is panned clear of it, box and all', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'room.json': ROOM_SOURCE } }, 'room.json');

    await doubleClickScene(ui, { x: 100, y: 80 }, ROOM);
    const label = screen.getByRole('textbox', { name: 'Label' });
    // The note's room: docked to the right edge, 312px wide, a 16px margin out.
    const noteRoom: Rect = { x: 944, y: 120, width: 330, height: 600 };
    const baseline = (await shot(ui)).darkCount(noteRoom, DARK);

    await label.pressSequentially(HUGE_WORD);

    // The words the person typed are on the page, and neither the grown Element
    // nor the box holding the caret is drawn over the note: its ink is its own.
    const grown = await shot(ui);
    expect(grown.darkCount(noteRoom, DARK)).toBeLessThanOrEqual(baseline + 50);

    await label.press('Escape');
    const element = (await savedScene(ui, 'room.json')).elements[0];
    expect(element?.label).toBe(HUGE_WORD);
    expect(element?.width).toBeGreaterThan(400);
  });

  test('a lone control character is refused, and never deletes a Label', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    const before = await savedFiles(ui);

    // U+000B is whitespace to a trim and unrepresentable to XML: it may never
    // become the empty words that quietly take the Label away.
    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.fill('\u000B');
    await clickScene(ui, { x: 700, y: 600 });

    // Refused words keep the field and say why; Escape is the way out of them.
    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveCount(1);
    await expect(screen.getByRole('status')).toContainText('label must be');
    expect(await savedFiles(ui)).toEqual(before);
    await label.press('Escape');
    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveCount(0);
    expect(await savedFiles(ui)).toEqual(before);
  });

  test('a lone control character is refused, and never deletes a Text', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');

    const before = await savedFiles(ui);
    await doubleClickScene(ui, { x: 277, y: 110 }, MIXED);
    const text = screen.getByRole('textbox', { name: 'Text' });
    await text.fill('\u000B');
    await clickScene(ui, { x: 700, y: 600 }, [], MIXED);

    await expect(screen.getByRole('textbox', { name: 'Text' })).toHaveCount(1);
    await expect(screen.getByRole('status')).toContainText('content must be');
    expect(await savedFiles(ui)).toEqual(before);
    await text.press('Escape');
    await expect(screen.getByRole('textbox', { name: 'Text' })).toHaveCount(0);
    const scene = JSON.parse((await savedFiles(ui))['scene.json'] ?? '') as {
      elements: Array<{ id: string }>;
    };
    expect(scene.elements.map((element) => element.id).sort()).toEqual(['oval', 'shaft', 'word']);
  });

  test('Escape on words the Scene refused leaves no ink behind, and the next press is a press', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');
    // Bare paper to the right of where the Text's own words end: anything dark
    // there is words the page is still showing from a session that is over.
    const pastTheWords: Rect = { x: 750, y: 290, width: 250, height: 40 };
    expect((await shot(ui)).darkCount(pastTheWords, DARK)).toBe(0);

    await doubleClickScene(ui, { x: 277, y: 110 }, MIXED);
    const text = screen.getByRole('textbox', { name: 'Text' });
    await text.fill('edited in place');
    await text.fill('\u000B');
    // The click away is refused, and the field keeps the words that cannot land.
    await clickScene(ui, { x: 900, y: 620 }, [], MIXED);
    await expect(screen.getByRole('status')).toContainText('content must be');
    await expect(text).toHaveCount(1);

    await text.press('Escape');
    await expect(screen.getByRole('textbox', { name: 'Text' })).toHaveCount(0);

    // The page is the Scene again: no ink of the words nobody kept.
    expect((await shot(ui)).darkCount(pastTheWords, DARK)).toBe(0);

    // And the next press is a press on the canvas: it selects the Text, so the
    // arrow keys move it.
    await clickScene(ui, { x: 277, y: 110 }, [], MIXED);
    await browser.keyboard.press('Shift+ArrowRight');
    const moved = (await savedScene(ui, 'scene.json')).elements.find(
      (element) => element.id === 'word',
    );
    expect(moved?.x).toBe(270);

    // A double-click opens the words the Scene holds, not the ones refused.
    await doubleClickScene(ui, { x: 277, y: 110 }, MIXED);
    await expect(screen.getByRole('textbox', { name: 'Text' })).toHaveValue('hi');
  });

  test('the focus leaving the words ends them once, and the page shows the Scene', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('Invoices');
    // Tab takes the focus away: a blur, which is the way out nobody clicks.
    await browser.keyboard.press('Tab');

    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveCount(0);
    expect((await savedScene(ui)).elements[0]?.label).toBe('Invoices');
  });

  test('a page that takes the editor away ends the words being typed, and their ink', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');
    const pastTheWords: Rect = { x: 750, y: 290, width: 250, height: 40 };

    await doubleClickScene(ui, { x: 277, y: 110 }, MIXED);
    const text = screen.getByRole('textbox', { name: 'Text' });
    await text.fill('edited');

    // The host takes the editor off its page and puts it back: the words a
    // person was typing do not come back with it.
    await browser.evaluate(() => {
      const editor = document.querySelector('esbozo-editor');
      if (editor === null) {
        throw new Error('the page has no editor');
      }
      const { parentElement, nextSibling } = editor;
      editor.remove();
      parentElement!.insertBefore(editor, nextSibling);
      return true;
    });

    await expect(screen.getByRole('textbox', { name: 'Text' })).toHaveCount(0);
    // Words nobody ended are not an edit: the Scene is the one that was read.
    const kept = (await savedScene(ui, 'scene.json')).elements.find(
      (element) => element.id === 'word',
    );
    expect(kept?.content).toBe('hi');
    expect((await shot(ui)).darkCount(pastTheWords, DARK)).toBe(0);

    // The editor answers the page it came back on: a double-click still opens
    // the words the Scene holds.
    await doubleClickScene(ui, { x: 277, y: 110 }, MIXED);
    await expect(screen.getByRole('textbox', { name: 'Text' })).toHaveValue('hi');
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
    await expect(label).toHaveValue('up');
    await label.pressSequentially('ward');
    await label.press('Escape');

    const scene = await savedScene(ui, 'beside.json');
    expect(scene.elements[0]?.label).toBe('upward');
  });

  test('the canvas shows the words as they will save, on every keystroke', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'words.json': WORDS_SOURCE } }, 'words.json');

    // The box is at page (548, 348); its words fit inside it, so the space
    // between the two views is the ink of the same two lines, and the box the
    // caret sits in is below it, out of the way.
    const inside: Rect = { x: 556, y: 356, width: 184, height: 104 };
    const drawn = await shot(ui);
    const before = drawn.darkCentre(inside, DARK);
    expect(before.count).toBeGreaterThan(100);

    await doubleClickScene(ui, { x: 100, y: 80 }, WORDS);
    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue(LONG_LABEL);
    const typing = await shot(ui);
    await screen.getByRole('textbox', { name: 'Label' }).press('Escape');
    const saved = await shot(ui);

    // The page is the words: same size, same lines, same place while they are
    // typed as after they are saved, because one Renderer draws both.
    for (const view of [typing, saved]) {
      const centre = view.darkCentre(inside, DARK);
      expect(Math.abs(centre.x - before.x)).toBeLessThan(2);
      expect(Math.abs(centre.y - before.y)).toBeLessThan(2);
      expect(view.bands(inside, DARK)).toBe(drawn.bands(inside, DARK));
    }
  });

  test('one long word grows the box and stays on one line while it is typed', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'room.json': ROOM_SOURCE } }, 'room.json');

    await doubleClickScene(ui, { x: 100, y: 80 }, ROOM);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially(LONG_WORD);
    const typing = await shot(ui);
    await label.press('Escape');

    // The page drew the grown box and the word in it as they arrived: the word
    // is on one line inside an outline that holds it, not cut off at the width
    // the author gave the box. Everything past that width — and inside the
    // grown outline — is one line of the word's own ink.
    const box = (await savedScene(ui, 'room.json')).elements[0];
    expect(box?.width).toBeGreaterThan(200);
    expect(box?.height).toBe(80);
    const grown: Rect = {
      x: ROOM.panX + (box?.x ?? 0) + 128,
      y: ROOM.panY + (box?.y ?? 0) + 8,
      width: (box?.width ?? 0) - 136,
      height: (box?.height ?? 0) - 16,
    };
    expect(typing.bands(grown, DARK)).toBe(1);
    expect(typing.darkCount(grown, DARK)).toBeGreaterThan(100);
  });

  test("an arrow's Label widens away from the shaft, staying centred on it", async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'beside.json': BESIDE_SOURCE } }, 'beside.json');

    await doubleClickScene(ui, { x: 287, y: 220 }, BESIDE);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.fill('spelled out sideways');
    const typing = await shot(ui);
    await label.press('Escape');

    expect((await savedScene(ui, 'beside.json')).elements[0]?.label).toBe('spelled out sideways');

    // The shaft is at page x = 651 and its words hang to their own side: nothing
    // of them crosses it, however long they get. The words keep the shaft's
    // middle as their middle, so they stay on the shaft's line vertically too.
    expect(typing.darkCount({ x: 660, y: 330, width: 140, height: 140 }, DARK)).toBe(0);
    const words = typing.darkCentre({ x: 480, y: 340, width: 160, height: 120 }, DARK);
    expect(Math.abs(words.y - 400)).toBeLessThan(5);
  });

  test('words nobody touched keep the spaces the author wrote', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'spaced.json': SPACED_SOURCE } }, 'spaced.json');
    const before = await savedFiles(ui);

    await doubleClickScene(ui, { x: 100, y: 80 }, WORDS);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.press('Escape');

    // Unchanged is unchanged: no trim, no write, the same bytes on disk.
    expect(await savedFiles(ui)).toEqual(before);
  });

  test('a control character before the words is refused, not trimmed away', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    const before = await savedFiles(ui);

    // U+000B is whitespace to a trim and unrepresentable to XML, so the Scene
    // has to be the one to refuse the words as they were typed.
    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.fill('\u000BHello');
    await label.press('Escape');

    await expect(screen.getByRole('status')).toContainText('XML');
    expect(await savedFiles(ui)).toEqual(before);
  });
});
