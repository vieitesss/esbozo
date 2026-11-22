/**
 * One of the Label suites, split by what a person sees, not by module: `tests/labels-*.e2e.ts`.
 * Seam 2: the view moving under the words — a pan, a wheel zoom, the note that must not hide
 * them — and the focus or the page taking the words away.
 */
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  MIXED,
  ROOM,
  SCENE,
  at,
  clickScene,
  doubleClickScene,
  openEditor,
  savedFiles,
  savedScene,
} from './helpers.ts';
import { DARK, LONG_WORD, MIXED_SOURCE, ROOM_SOURCE, SCENE_SOURCE } from './labels-shared.ts';
import { livePage } from './cdp.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';

/**
 * Scene text one middle click could paste: one rectangle, the smallest fragment
 * the Scene takes, as the words a person leaves on the primary selection.
 */
const STRAY_FRAGMENT = JSON.stringify({
  elements: [{ id: 'stray', type: 'rectangle', x: 0, y: 0, width: 20, height: 20 }],
});

/** A word wide enough that the grown Element reaches under the docked note. */
const HUGE_WORD = LONG_WORD + LONG_WORD;

describe('labels view', () => {
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
    // The browser's primary selection still holds the words a person selected
    // before typing over them, and on Linux the middle button pastes that
    // selection: leave some here, so the pan is the only thing that can put
    // words in the open Label and the test does not lean on an earlier one.
    await label.pressSequentially('cd');
    await label.press('ControlOrMeta+a');
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

  test('a middle drag with the words closed pastes nothing into the Scene', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    // The primary selection is the one a person leaves behind by typing over the
    // words they had selected, so the words it holds are the ones no field shows
    // any more. On Linux the middle button pastes it on release, and Scene text
    // on the clipboard is Elements: leave a fragment of a Scene there, close the
    // words, and the pan below is the only thing that could paste it in.
    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially(STRAY_FRAGMENT);
    await label.press('ControlOrMeta+a');
    await label.pressSequentially('Orders');
    await label.press('Escape');
    await expect(label).toHaveCount(0);
    const before = await savedFiles(ui);

    const from = at({ x: 100, y: 80 });
    const page = livePage();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button: 'middle' });
    for (let step = 1; step <= 5; step += 1) {
      const share = step / 5;
      await page.mouse.move(from.x + 100 * share, from.y + 70 * share);
    }
    await page.mouse.up({ button: 'middle' });

    expect((await savedScene(ui)).elements).toHaveLength(SCENE.elements.length);
    expect(await savedFiles(ui)).toEqual(before);
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
});
