/**
 * One of the Label suites, split by what a person sees, not by module: `tests/labels-*.e2e.ts`.
 * Browser seam: selecting the drawn words — a drag across them, a Shift+click, a word taken by a
 * double-click — and the selection drawn behind the glyphs and over a fill.
 */
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  MIXED,
  clickScene,
  doubleClickScene,
  openEditor,
  savedScene,
  settle,
} from './helpers.ts';
import { DARK, GLYPH, INK_ONLY, INSIDE, MIXED_SOURCE, SCENE_SOURCE } from './labels-shared.ts';
import { stillCaret } from './cdp.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';

describe('labels select', () => {
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

  test('a two-pixel drag across a glyph boundary is no double-click on the next press', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    // Three narrow letters: one is four pixels wide, so two pixels of drag cross
    // the boundary in the middle of one and leave that letter selected.
    await label.pressSequentially('i i i');
    await settle(ui);

    const ink = (await shot(ui)).darkBounds(INSIDE, DARK) as Rect;
    const y = ink.y + ink.height / 2;
    await browser.mouse.move(ink.x, y);
    await browser.mouse.down();
    await browser.mouse.move(ink.x + 2, y);
    await browser.mouse.up();

    // The press at the drag's own start is a press, not the second half of a
    // double-click: the caret goes where it landed, before the first letter.
    await browser.mouse.move(ink.x, y);
    await browser.mouse.down();
    await browser.mouse.up();
    await label.pressSequentially('X');
    await label.press('Escape');

    expect((await savedScene(ui)).elements[0]?.label).toBe('Xi i i');
  });

  test('two Shift presses in a row add to the selection instead of taking a word', async ({
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

    // The words open with the caret after them, so a Shift press on the first
    // letter selects the whole line backwards. A second one there is another
    // Shift press, not a double-click that takes the first word.
    const ink = (await shot(ui)).darkBounds(INSIDE, DARK) as Rect;
    await browser.keyboard.down('Shift');
    for (let press = 0; press < 2; press += 1) {
      await browser.mouse.move(ink.x + 1, ink.y + ink.height / 2);
      await browser.mouse.down();
      await browser.mouse.up();
    }
    await browser.keyboard.up('Shift');
    await label.pressSequentially('X');
    await label.press('Escape');

    expect((await savedScene(ui)).elements[0]?.label).toBe('X');
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

  test('the words of a filled Element are washed over the fill, and under their ink', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');
    await stillCaret();

    // The filled oval of `MIXED_SCENE`: its paper is more than half ink, so a
    // wash the whole Element is painted over is a wash nobody can see.
    await doubleClickScene(ui, { x: 120, y: 110 }, MIXED);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('orders');
    await settle(ui);

    // The words' own ink inside the fill, read without the caret beside it. The
    // caret stands taller than the glyphs, so the lowest rows of the ink's own
    // box hold what the wash has to darken between the strokes — alone in the
    // frame before the drag, and washed over in the one after it.
    const before = await shot(ui);
    const ink = before.darkBounds({ x: 520, y: 295, width: 90, height: 45 }, GLYPH) as Rect;
    expect(ink).not.toBeNull();
    const strip: Rect = { x: ink.x + 3, y: ink.y + ink.height - 5, width: ink.width - 6, height: 4 };

    // A drag across the words selects every one of them.
    await browser.mouse.move(ink.x - 4, ink.y + ink.height / 2);
    await browser.mouse.down();
    await browser.mouse.move(ink.x + ink.width + 20, ink.y + ink.height / 2);
    await browser.mouse.up();
    const selected = await shot(ui);

    expect(selected.meanLuminance(strip)).toBeLessThan(before.meanLuminance(strip) - 0.02);
    // Behind the glyphs and not over them: the ink keeps the colour it had.
    const glyphs: Rect = { x: ink.x, y: ink.y, width: ink.width, height: ink.height };
    expect(selected.darkCount(glyphs, INK_ONLY)).toBeGreaterThan(
      before.darkCount(glyphs, INK_ONLY) * 0.9,
    );

    // And the wash belongs to a selection: a letter replaces all of the words.
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
});
