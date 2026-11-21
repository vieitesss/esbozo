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
  BLANK_SCENE,
  MIXED,
  MIXED_SCENE,
  OVERFLOW,
  OVERFLOW_SCENE,
  PRESS,
  PRESS_SCENE,
  ROOM,
  ROOM_SCENE,
  SCENE,
  SHIFTED,
  SHIFTED_SCENE,
  SPACED_SCENE,
  WORDS,
  WORDS_SCENE,
  EMPTY,
  at,
  cliCheck,
  cliCheckBytes,
  clickScene,
  doubleClickScene,
  dragBy,
  openEditor,
  savedFiles,
  savedScene,
  settle,
} from './helpers.ts';
import { imeCommit, imeCompose, livePage, stillCaret } from './cdp.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';

const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
const MIXED_SOURCE = JSON.stringify(MIXED_SCENE, null, 2);
const OVERFLOW_SOURCE = JSON.stringify(OVERFLOW_SCENE, null, 2);
const PRESS_SOURCE = JSON.stringify(PRESS_SCENE, null, 2);
const WORDS_SOURCE = JSON.stringify(WORDS_SCENE, null, 2);
const ROOM_SOURCE = JSON.stringify(ROOM_SCENE, null, 2);
const SPACED_SOURCE = JSON.stringify(SPACED_SCENE, null, 2);
const BESIDE_SOURCE = JSON.stringify(BESIDE_SCENE, null, 2);
const SHIFTED_SOURCE = JSON.stringify(SHIFTED_SCENE, null, 2);
const BLANK_SOURCE = JSON.stringify(BLANK_SCENE, null, 2);

/** A Label long enough that the box it is typed into has to grow downwards. */
const LONG_LABEL = 'words that wrap and grow';

/** A single word too wide for the box it is typed into. */
const LONG_WORD = 'antidisestablishmentarianism';

/** An empty page: the only ink on it is the words a test types. */
const BARE_SOURCE = JSON.stringify(
  { version: 1, title: 'Bare', defaults: { roughness: 1 }, elements: [] },
  null,
  2,
);

/** A single letter: enough words to have ink, and no more. */
const ONE_LETTER = 'w';

/** Where an empty Scene's first Text lands, and the room its words take there. */
const TYPED: Rect = { x: 500, y: 320, width: 260, height: 90 };

/** The same words at six times the Zoom, which keeps them where they were. */
const TYPED_ZOOMED: Rect = { x: 300, y: 100, width: 600, height: 500 };

/** A Scene point, and the page one it is drawn at in an empty Scene. */
type Spot = { x: number; y: number };

/** A word wide enough that the grown Element reaches under the docked note. */
const HUGE_WORD = LONG_WORD + LONG_WORD;

/** Ink: the ink of a Scene is near black on near white, so half way is the line. */
const DARK = 0.5;

/**
 * The caret's blue is lighter than ink, and a column of it is a pixel or two of
 * antialiasing; a Grid dot is fainter still. So a caret is looked for between
 * the two: darker than paper and a dot, lighter than ink.
 */
const CARET = 0.7;

/**
 * Darker than the caret's blue and lighter than paper: the glyphs' own ink,
 * read without the caret that stands beside them.
 */
const GLYPH = 0.3;

/**
 * Darker than paper under the selection's wash, and darker than the wash laid
 * over ink: the pixels that are the ink itself, whatever is behind them.
 */
const INK_ONLY = 0.13;

/**
 * The inside of `SCENE`'s left-hand box on the page, clear of its outline and of
 * the resize handles of the selection around it. The box's own words are the
 * only ink that can be in here.
 */
const INSIDE: Rect = { x: 517, y: 346, width: 106, height: 66 };

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

  test('a middle or right press finishes the words before an input method can confirm them', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };

    for (const [where, button] of [
      ['Tools', 'middle'],
      ['Tools', 'right'],
      ['Style', 'middle'],
      ['Style', 'right'],
    ] as const) {
      await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
      await doubleClickScene(ui, { x: 100, y: 80 });
      const label = screen.getByRole('textbox', { name: 'Label' });
      await label.pressSequentially('Keep');
      await imeCompose('にほん');
      await expect(label).toHaveValue('Keepにほん');

      // Chromium confirms a preedit when the press takes the focus, so the
      // session has to end first or the reading is kept as if it were words.
      // Both presses are real input: the fixture's pointer has one button, so
      // the page's own mouse sends the ones a person pans and opens a menu with.
      await livePage().getByRole(where === 'Style' ? 'dialog' : 'navigation', { name: where }).click({
        button,
      });
      await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveCount(0);

      // Whatever the press left behind is in the Scene by the next write: moving
      // another Element queues one, and the Scene it saves is the one in hand.
      // The confirmed words land, as a press away has always made them, and the
      // reading that was never chosen does not: no input method confirmed it.
      await dragBy(ui, { x: 250, y: 110 }, 40, 40);
      const scene = await savedScene(ui);
      expect(scene.elements.find((element) => element.id === 'a')?.label).toBe('Keep');
    }
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

  test('a middle drag pans the page and keeps the words open, ink and all', async ({
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
    // The ink of the words travels with the page: it is the canvas's, drawn at
    // the glyphs, and nothing else on the screen holds a copy of them.
    const written: Rect = { x: 545, y: 368, width: 52, height: 20 };
    const writtenCarried: Rect = {
      x: written.x + 100,
      y: written.y + 70,
      width: written.width,
      height: written.height,
    };
    const drawn = await shot(ui);
    expect(drawn.darkCount(written, DARK)).toBeGreaterThan(0);

    // The middle button is a pan, not a click away: the words stay open, and
    // the page's own mouse sends it, because the fixture's pointer has one
    // button and a synthesized event would skip the focus change a real press
    // makes. The frame that matters is the one before the release.
    const from = at({ x: 100, y: 80 });
    const page = livePage();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button: 'middle' });
    for (let step = 1; step <= 5; step += 1) {
      const share = step / 5;
      await page.mouse.move(from.x + 100 * share, from.y + 70 * share);
    }
    await expect(label).toHaveCount(1);
    // The canvas still draws the words, carried by the pan, while the button is
    // still down: the page never falls back to the committed Scene.
    const panned = await shot(ui);
    expect(panned.darkCount(written, DARK)).toBe(0);
    expect(panned.darkCount(writtenCarried, DARK)).toBeGreaterThan(0);
    // Nothing of the pan is a Scene: the words are nobody's until they land.
    expect(await savedFiles(ui)).toEqual(before);

    await page.mouse.up({ button: 'middle' });
    await expect(label).toHaveValue('Orders');
    expect(await savedFiles(ui)).toEqual(before);

    await label.press('Escape');
    expect((await savedScene(ui)).elements[0]?.label).toBe('Orders');
  });

  test('a wheel zoom carries the words of a new Text, and their caret, with the page', async ({
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

    // The words are drawn where the zoom puts them, and the caret is still on them.
    const zoomed = await shot(ui);
    expect(zoomed.darkCount(typed, DARK)).toBe(0);
    expect(zoomed.darkCount({ x: 668, y: 486, width: 130, height: 22 }, DARK)).toBeGreaterThan(0);
    await expect(field).toHaveValue('hello');

    await field.press('Escape');
    expect((await savedScene(ui)).elements.length).toBe(3);
  });

  test('a Label long enough to reach the note is panned clear of it, caret and all', async ({
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
    // nor the caret on its glyphs is drawn over the note: its ink is its own.
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

  test('a pan the keyboard ends carries nothing into the next gesture', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');
    const shaft: Rect = { x: 800, y: 500, width: 200, height: 160 };

    // A hand on the page, ended by the Space key coming up while the button is
    // still down: the pointer in hand ends with it, and the move that follows
    // moves nothing.
    const from = at({ x: 200, y: 280 }, MIXED);
    await browser.mouse.move(from.x, from.y);
    await browser.keyboard.down('Space');
    await browser.mouse.down();
    await browser.mouse.move(from.x + 60, from.y + 40);
    await browser.keyboard.up('Space');
    const panned = (await shot(ui)).darkCentre(shaft, DARK);
    await browser.mouse.move(from.x + 140, from.y + 120);
    expect((await shot(ui)).darkCentre(shaft, DARK)).toEqual(panned);
    await browser.mouse.up();

    // The next press is the next gesture: it selects the ellipse, and the
    // arrow keys move it.
    await clickScene(ui, { x: 120, y: 110 }, [], MIXED);
    await browser.keyboard.press('Shift+ArrowRight');
    const moved = (await savedScene(ui, 'scene.json')).elements.find(
      (element) => element.id === 'oval',
    );
    expect(moved?.x).toBe(70);
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

  test('the caret is drawn where the words are typed, and no copy of them is drawn beside', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    await stillCaret();

    await doubleClickScene(ui, { x: 100, y: 80 });
    // An empty Label is no words and no outline of its own: the only ink inside
    // the box is the caret, and it is where the words would start.
    const drawn = await shot(ui);
    const caret = drawn.darkBounds(INSIDE, CARET);
    expect(caret).not.toBeNull();
    const slot = caret as Rect;
    expect(slot.width).toBeLessThan(4);
    expect(slot.height).toBeGreaterThan(20);
    expect(Math.abs(slot.x + slot.width / 2 - 570)).toBeLessThan(2);

    // Nothing is drawn beside the words any more: the plain field that used to
    // mirror them lived under the box, and bare paper is there now.
    expect(drawn.darkCount({ x: 500, y: 430, width: 150, height: 40 }, DARK)).toBe(0);
  });

  test('a press inside the drawn words puts the caret on the glyph under it', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('orders and');
    // Where the page drew the words: their ink, not a field's.
    const ink = (await shot(ui)).darkBounds(INSIDE, DARK);
    expect(ink).not.toBeNull();
    const words = ink as Rect;

    // A press in the middle of them is the words', not the canvas's.
    await browser.mouse.move(words.x + words.width / 2, words.y + words.height / 2);
    await browser.mouse.down();
    await browser.mouse.up();
    await label.pressSequentially('X');
    await label.press('Escape');

    // The letter landed where the press did: among the words, at neither end.
    const landed = (await savedScene(ui)).elements[0]?.label ?? '';
    expect(landed.length).toBe('orders and'.length + 1);
    expect(landed.replace('X', '')).toBe('orders and');
    expect(landed.indexOf('X')).toBeGreaterThan(0);
    expect(landed.indexOf('X')).toBeLessThan('orders and'.length);
  });

  test('a Text placed a half pixel off keeps its caret on the drawn glyphs', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'bare.json': BARE_SOURCE } }, 'bare.json');
    // Bare paper: no Grid dot can be mistaken for the caret's own pixels.
    await browser.keyboard.press('g');
    await stillCaret();

    /** The glyphs' own ink: dark enough to be the words, and not the caret's blue. */
    const glyphs = async (room: Rect): Promise<Rect> => {
      const bounds = (await shot(ui)).darkBounds(room, GLYPH);
      expect(bounds).not.toBeNull();
      return bounds as Rect;
    };

    /**
     * Where the caret stands from the glyphs it belongs to, six times over: a
     * Zoom in about the words themselves, so the page keeps them under the
     * pointer while half a Scene pixel becomes a visible one. The caret is the
     * darker-than-paper, lighter-than-ink line the words are drawn beside, and
     * only the room to the left of the glyphs is measured, where nothing else is.
     */
    const caretFromGlyphs = async (at: Spot): Promise<number> => {
      await browser.keyboard.press('t');
      await clickScene(ui, at, [], EMPTY);
      const field = screen.getByRole('textbox', { name: 'Text' });
      await field.pressSequentially(ONE_LETTER);
      await field.press('Home');

      const typed = await glyphs(TYPED);
      await browser.mouse.move(typed.x + typed.width / 2, typed.y + typed.height / 2);
      await browser.mouse.wheel(0, -1200);
      await expect(screen.getByText(/^\d+%$/)).toHaveText('605%');
      const drawn = await glyphs(TYPED_ZOOMED);
      const carets = (await shot(ui)).darkBounds(
        { x: drawn.x - 40, y: drawn.y + 2, width: 38, height: drawn.height - 4 },
        CARET,
      );
      expect(carets).not.toBeNull();

      await field.press('Escape');
      // The words are nobody's until the release: one Text lands, and goes.
      expect((await savedScene(ui, 'bare.json')).elements.length).toBe(1);
      await browser.keyboard.press('Delete');
      // Back to the view the next Text is placed in, about the same point.
      await browser.mouse.wheel(0, 1200);
      await expect(screen.getByText(/^\d+%$/)).toHaveText('100%');
      return (carets as Rect).x - drawn.x;
    };

    const halfPixel = await caretFromGlyphs({ x: 100.5, y: 80.5 });
    const wholePixel = await caretFromGlyphs({ x: 100, y: 80 });

    // The Scene rounds a Text placed off a whole pixel, and the page draws that
    // Text: the caret has to stand on it at either anchor, not a Scene pixel
    // beside it — and a Scene pixel is six of them at this Zoom.
    expect(Math.abs(halfPixel - wholePixel)).toBeLessThan(1.5);
  });

  test('Up walks to the line above the caret, not to a soft-wrapped row of the field', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'words.json': WORDS_SOURCE } }, 'words.json');

    await doubleClickScene(ui, { x: 100, y: 80 }, WORDS);
    const label = screen.getByRole('textbox', { name: 'Label' });
    // Three lines of the person's own, with the caret after the last of them.
    await label.fill('');
    await label.pressSequentially('wax');
    await label.press('Enter');
    await label.pressSequentially('wax');
    await label.press('Enter');
    await label.pressSequentially('wax');

    // Up takes the drawn line above at the same column, which is the end of the
    // second line. A field this narrow would soft-wrap one letter per line and
    // walk those rows instead: one letter back, inside the last word.
    await label.press('ArrowUp');
    await label.pressSequentially('X');
    await label.press('Escape');

    expect((await savedScene(ui, 'words.json')).elements[0]?.label).toBe('wax\nwaxX\nwax');
  });

  test('Home walks to the start of the drawn line the caret is on', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'words.json': WORDS_SOURCE } }, 'words.json');

    await doubleClickScene(ui, { x: 100, y: 80 }, WORDS);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.fill('');
    await label.pressSequentially('wax');
    await label.press('Enter');
    await label.pressSequentially('wax');
    await label.press('Enter');
    await label.pressSequentially('wax');

    // Home takes the start of the last drawn line, not of the row the field
    // soft-wrapped the last letter into and not of the whole value.
    await label.press('Home');
    await label.pressSequentially('X');
    await label.press('Escape');

    expect((await savedScene(ui, 'words.json')).elements[0]?.label).toBe('wax\nwax\nXwax');
  });

  test('End walks to the end of the drawn line, not to the end of the field', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'words.json': WORDS_SOURCE } }, 'words.json');

    await doubleClickScene(ui, { x: 100, y: 80 }, WORDS);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.fill('');
    await label.pressSequentially('wax');
    await label.press('Enter');
    await label.pressSequentially('wax');
    await label.press('Enter');
    await label.pressSequentially('wax');

    // Up and Home are the keys it takes to stand on the first drawn line, and
    // End there is that line's end rather than the value's.
    await label.press('Home');
    await label.press('ArrowUp');
    await label.press('ArrowUp');
    await label.press('End');
    await label.pressSequentially('X');
    await label.press('Escape');

    expect((await savedScene(ui, 'words.json')).elements[0]?.label).toBe('waxX\nwax\nwax');
  });

  test('a wrapped Label walks its drawn lines too: Up takes the line above', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    // The two words are the same word, so they wrap into two drawn lines of the
    // same width with no newline in the value: the line above ends in the column
    // the last line ends in. A field of its own would walk one letter-wide row
    // of the wrapped words instead.
    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('waxwaxwax waxwaxwax');
    await label.press('ArrowUp');
    await label.pressSequentially('X');
    await label.press('Escape');

    // The letter lands at the end of the first drawn line, before the space the
    // wrap broke on — not a letter back inside the last word.
    expect((await savedScene(ui)).elements[0]?.label).toBe('waxwaxwaxX waxwaxwax');
  });

  test('a drag right to left selects the words it crosses, and a letter replaces them', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('abc def ghi');
    await settle(ui);
    const ink = (await shot(ui)).darkBounds(INSIDE, DARK) as Rect;

    // The drag starts after the last glyph and ends before the first one, so the
    // selection it makes runs backwards through the words.
    await browser.mouse.move(ink.x + ink.width + 2, ink.y + ink.height / 2);
    await browser.mouse.down();
    await browser.mouse.move(ink.x - 3, ink.y + ink.height / 2);
    await browser.mouse.up();
    await label.pressSequentially('X');
    await label.press('Escape');

    // A backwards run is a selection like any other: the letter takes its place.
    expect((await savedScene(ui)).elements[0]?.label).toBe('X');
  });

  test('a Shift+click left of the caret selects from the caret back to the glyph', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    // The caret opens after the words, so a Shift+click on the first glyph is a
    // selection running backwards from where the caret was.
    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('abc def ghi');
    await settle(ui);
    const ink = (await shot(ui)).darkBounds(INSIDE, DARK) as Rect;

    await browser.keyboard.down('Shift');
    await browser.mouse.move(ink.x, ink.y + ink.height / 2);
    await browser.mouse.down();
    await browser.mouse.up();
    await browser.keyboard.up('Shift');
    await label.pressSequentially('X');
    await label.press('Escape');

    expect((await savedScene(ui)).elements[0]?.label).toBe('X');
  });

  test('a click after a drag places the caret, though it lands where the drag began', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('abc def ghi');
    await settle(ui);
    const ink = (await shot(ui)).darkBounds(INSIDE, DARK) as Rect;
    const y = ink.y + ink.height / 2;

    // A drag across the words, and then a click on the glyph the drag started
    // from, quickly enough to be a double-click if the drag were a click.
    await browser.mouse.move(ink.x + 1, y);
    await browser.mouse.down();
    await browser.mouse.move(ink.x + ink.width, y);
    await browser.mouse.up();
    await browser.mouse.move(ink.x + 1, y);
    await browser.mouse.down();
    await browser.mouse.up();
    await label.pressSequentially('X');
    await label.press('Escape');

    // The click is a click: the caret goes where it was pressed, at the start of
    // the words, and the letter lands there rather than over a selected word.
    expect((await savedScene(ui)).elements[0]?.label).toBe('Xabc def ghi');
  });

  test('a drag across the words being typed keeps them drawn', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    // A new Text is not in the Scene until its words land, so the only reason
    // its words are on the page is the preview a drag inside them has to keep.
    await browser.keyboard.press('t');
    await clickScene(ui, { x: 420, y: 300 });
    const text = screen.getByRole('textbox', { name: 'Text' });
    await text.pressSequentially('orders and');
    await settle(ui);

    const drawn: Rect = { x: 880, y: 592, width: 130, height: 40 };
    const ink = await shot(ui);
    const words = ink.darkBounds(drawn, DARK) as Rect;
    const typed = ink.darkCount(drawn, DARK);
    expect(typed).toBeGreaterThan(100);

    await browser.mouse.move(words.x + 1, words.y + words.height / 2);
    await browser.mouse.down();
    await browser.mouse.move(words.x + words.width / 2, words.y + words.height / 2);
    await settle(ui);
    const midway = await shot(ui);

    // The drag draws a wash over the words it crosses and never takes them off
    // the page: the pointer is still down, and they are still the ink it typed.
    expect(midway.darkCount(drawn, DARK)).toBeGreaterThan(typed * 0.9);

    await browser.mouse.up();
    await text.press('Escape');
    expect((await savedScene(ui)).elements.at(-1)?.content).toBe('orders and');
  });

  test('a drag inside the drawn words selects them, and the selection is drawn behind the glyphs', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('orders');
    const ink = (await shot(ui)).darkBounds(INSIDE, DARK);
    const words = ink as Rect;
    const before = await shot(ui);

    // A drag that starts at the first glyph and runs past the last one selects
    // every word the line drew.
    await browser.mouse.move(words.x - 3, words.y + words.height / 2);
    await browser.mouse.down();
    await browser.mouse.move(words.x + words.width + 30, words.y + words.height / 2);
    await browser.mouse.up();

    // The highlight is a wash behind the glyphs, drawn on the canvas: the paper
    // around them darkens, and the ink itself keeps the colour it had, which a
    // wash above it would have lifted.
    const selected = await shot(ui);
    const glyphs: Rect = { x: words.x, y: words.y, width: words.width, height: words.height };
    expect(before.meanLuminance(glyphs)).toBeGreaterThan(selected.meanLuminance(glyphs) + 0.02);
    expect(selected.darkCount(glyphs, INK_ONLY)).toBeGreaterThan(before.darkCount(glyphs, INK_ONLY) * 0.9);

    // Typing replaces what was selected: the words the press took in are gone.
    await label.pressSequentially('X');
    await label.press('Escape');
    expect((await savedScene(ui)).elements[0]?.label).toBe('X');
  });

  test('a double-click inside the drawn words selects a word', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('ab cd');
    const ink = (await shot(ui)).darkBounds(INSIDE, DARK);
    const words = ink as Rect;

    // A double-click on the second word takes it whole, and a letter replaces it.
    await screen.doubleTapAt({
      x: words.x + words.width * 0.65,
      y: words.y + words.height / 2,
    });
    await label.pressSequentially('X');
    await label.press('Escape');

    expect((await savedScene(ui)).elements[0]?.label).toBe('ab X');
  });

  test("an input method's preedit is drawn in place and underlined, and its words land on commit", async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    await stillCaret();

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await imeCompose('abc');

    // The preedit is words the page draws like any others, with a rule under
    // them: they are the input method's until the person picks one. The rule is
    // at the bottom of the line, which for the box's 18px words is page y 391.
    const composing = await shot(ui);
    expect(composing.darkCount(INSIDE, DARK)).toBeGreaterThan(50);
    const rule: Rect = { x: INSIDE.x, y: 391, width: INSIDE.width, height: 3 };
    expect(composing.darkCount(rule, DARK)).toBeGreaterThan(10);

    await imeCommit();
    await label.press('Escape');
    const landed = await shot(ui);

    // The words land where they were drawn, and the rule under them goes. They
    // are measured where the landed page inked them, which is clear of both the
    // caret at their end and the rule below them.
    expect(landed.darkCount(rule, DARK)).toBe(0);
    const glyphs = landed.darkBounds(INSIDE, DARK) as Rect;
    const live = composing.darkCentre(glyphs, DARK);
    const saved = landed.darkCentre(glyphs, DARK);
    expect(live.count).toBeGreaterThan(50);
    expect(Math.abs(live.x - saved.x)).toBeLessThan(1);
    expect(Math.abs(live.y - saved.y)).toBeLessThan(1);
    expect((await savedScene(ui)).elements[0]?.label).toBe('abc');
  });

  test("an input method's preedit is underlined whole, wherever its own caret is", async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    // Composed with the input method's caret at its first letter: the person is
    // still choosing, and the rule under the words is what says they are not
    // confirmed — all of them, not only the letters the caret is behind.
    await imeCompose('abc', 0);

    const composing = await shot(ui);
    const ink = composing.darkBounds({ x: INSIDE.x, y: 371, width: INSIDE.width, height: 20 }, DARK) as Rect;
    const rule = composing.darkBounds({ x: INSIDE.x, y: 391, width: INSIDE.width, height: 3 }, DARK) as Rect;
    expect(ink).not.toBeNull();
    expect(rule).not.toBeNull();
    expect(rule.width).toBeGreaterThan(ink.width - 6);

    await imeCommit();
    await label.press('Escape');
    expect((await savedScene(ui)).elements[0]?.label).toBe('abc');
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
    // The words are drawn in the frame the session opens on: the shot has to be
    // of that frame, not of the one before it.
    await settle(ui);
    const typing = await shot(ui);
    await screen.getByRole('textbox', { name: 'Label' }).press('Escape');
    await settle(ui);
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

  test('whitespace alone is not words: it clears a Label, and is not refused', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'spaced.json': SPACED_SOURCE } }, 'spaced.json');

    await doubleClickScene(ui, { x: 100, y: 80 }, WORDS);
    const label = screen.getByRole('textbox', { name: 'Label' });
    // XML can hold a space, a tab and a newline, so the Scene has nothing to
    // refuse: they are simply not words, and a Label of them is no Label.
    await label.fill(' \n\t ');
    await label.press('Escape');

    await expect(screen.getByRole('status')).toHaveText('saved');
    const element = (await savedScene(ui, 'spaced.json')).elements[0];
    expect(Object.hasOwn(element ?? {}, 'label')).toBe(false);
  });

  test('a new Text with no words closes on Enter or a click away, and writes nothing', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    const before = await savedFiles(ui);

    // Enter on a field nobody typed in is the person leaving, not words the
    // Scene has to refuse for being empty.
    await browser.keyboard.press('t');
    await clickScene(ui, { x: 420, y: 300 });
    await screen.getByRole('textbox', { name: 'Text' }).press('Enter');
    await expect(screen.getByRole('textbox', { name: 'Text' })).toHaveCount(0);
    await expect(screen.getByRole('status')).not.toContainText('content must be');
    expect(await savedFiles(ui)).toEqual(before);

    // And so is a click away, which is how most people leave one.
    await browser.keyboard.press('t');
    await clickScene(ui, { x: 460, y: 320 });
    await expect(screen.getByRole('textbox', { name: 'Text' })).toHaveValue('');
    await clickScene(ui, { x: 700, y: 600 });
    await expect(screen.getByRole('textbox', { name: 'Text' })).toHaveCount(0);
    await expect(screen.getByRole('status')).not.toContainText('content must be');
    expect(await savedFiles(ui)).toEqual(before);
  });

  test('the canvas shows the trimmed words a commit keeps, a blank outer line included', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'blank.json': BLANK_SOURCE } }, 'blank.json');

    // The author's Label starts with a blank line, so the drawn words sit a line
    // lower than the trimmed words a commit keeps. The box is `WORDS_SCENE`'s,
    // at page (548, 348), and this is its inside, clear of the outline.
    const inside: Rect = { x: 556, y: 356, width: 184, height: 104 };
    await doubleClickScene(ui, { x: 100, y: 80 }, WORDS);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await expect(label).toHaveValue('\nKeep');
    await label.pressSequentially('!');

    const typing = await shot(ui);
    await label.press('Escape');
    const saved = await shot(ui);

    // What the page drew while the words were typed is what the Scene draws once
    // they land: the same ink in the same place, no jump as the blank line goes.
    // The same Renderer draws both, so the ink lands on the same rows; the one
    // ink the page draws while typing and not after is the caret, and the region
    // is mostly outline, so a caret's worth of ink moves the centre by under 4px
    // where a line that jumped would move it by a whole line's 29.
    const live = typing.darkCentre(inside, DARK);
    expect(live.count).toBeGreaterThan(100);
    expect(Math.abs(live.y - saved.darkCentre(inside, DARK).y)).toBeLessThan(4);
    expect(typing.bands(inside, DARK)).toBe(saved.bands(inside, DARK));
    expect((await savedScene(ui, 'blank.json')).elements[0]?.label).toBe('Keep!');
  });

  test('the words a person puts back are the ones they leave, with no jump and no write', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'blank.json': BLANK_SOURCE } }, 'blank.json');

    // The Label begins with a blank line. The person types a word after it and
    // presses Backspace, so the field holds the words the Element already had:
    // a commit of those is no edit, and nothing is saved.
    await doubleClickScene(ui, { x: 100, y: 80 }, WORDS);
    const label = screen.getByRole('textbox', { name: 'Label' });
    const before = await savedFiles(ui);
    await label.press('End');
    await label.pressSequentially('!');
    await label.press('Backspace');
    await expect(label).toHaveValue('\nKeep');

    const typing = await shot(ui);
    await label.press('Escape');
    const left = await shot(ui);

    // Escape leaves the words exactly as they were, so the ink it leaves is the
    // ink the page drew while they were typed: no jump back as the session ends.
    // As above, the caret is the one ink that goes, and it is worth under 4px of
    // centre where a line that moved would be worth 29.
    const inside: Rect = { x: 556, y: 356, width: 184, height: 104 };
    const live = typing.darkCentre(inside, DARK);
    expect(live.count).toBeGreaterThan(100);
    expect(Math.abs(live.y - left.darkCentre(inside, DARK).y)).toBeLessThan(4);
    expect(typing.bands(inside, DARK)).toBe(left.bands(inside, DARK));
    expect(await savedFiles(ui)).toEqual(before);
  });
});
