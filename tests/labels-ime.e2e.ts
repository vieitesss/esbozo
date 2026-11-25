/**
 * One of the Label suites, split by what a person sees, not by module: `tests/labels-*.e2e.ts`.
 * Browser seam: an input method's preedit and its commit. Chromium composes the words through
 * `tests/cdp.ts`, because no dispatched event is a real composition.
 */
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  clickScene,
  doubleClickScene,
  drag,
  dragBy,
  openEditor,
  savedFiles,
  savedScene,
} from './helpers.ts';
import { CARET, DARK, INSIDE, SCENE_SOURCE } from './labels-shared.ts';
import { imeCommit, imeCompose, livePage, stillCaret } from './cdp.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';

describe('labels ime', () => {
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

  test('a drag of the rail moves it and finishes the words, as any outside press does', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    const before = await savedFiles(ui);

    // Where the strip hangs, read before the words open: focusing a tile finishes
    // a composition the moment one starts. By default the strip lies across the
    // top edge.
    await screen.getByRole('navigation', { name: 'Tools' }).getByRole('button', 'Select').focus();
    const band: Rect = { x: 300, y: 0, width: 680, height: 200 };
    await expect
      .poll(async () => (await shot(ui)).darkBounds(band, 0.6) !== null, { timeout: 5000 })
      .toBe(true);
    const strip = (await shot(ui)).darkBounds(band, 0.6)!;
    const grip = { x: strip.x + strip.width / 2, y: strip.y + 31 };

    // A press on the strip takes the focus off the field as any outside press
    // does, and the drag carries the rail into the left space: it stands where
    // dropped and picks no tool.
    await doubleClickScene(ui, { x: 100, y: 80 });
    await imeCompose('にほん');
    await drag(ui, grip, { x: 300, y: 400 });

    // The preedit never became words: the session ended on the press, before the
    // composition could confirm it, and nothing on disk changed.
    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveCount(0);
    expect(await savedFiles(ui)).toEqual(before);

    // The press was the rail's and not the paper's: the place it landed on is
    // kept for the next start, which only a move of the rail writes.
    const saved = JSON.parse((await browser.evaluate(() => localStorage.getItem('esbozo.rail'))) ?? 'null');
    expect(saved).toMatchObject({ orientation: 'standing' });
    expect(typeof saved.x).toBe('number');
    expect(typeof saved.y).toBe('number');
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

  test("an input method's preedit is underlined where it is typed, not at the value's start", async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    await stillCaret();

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('prefix old');
    // The composition takes over the last word, so it begins part way into the
    // value: a run read from the value's first offset would underline the
    // letters before it instead of the words being composed.
    for (let step = 0; step < 3; step += 1) {
      await label.press('Shift+ArrowLeft');
    }

    // The caret's own column, in the strip above the glyphs where it stands
    // alone: the preedit's rule has to start where the caret was.
    const before = await shot(ui);
    const caret = before.darkBounds({ x: INSIDE.x, y: 367, width: INSIDE.width, height: 3 }, CARET);
    expect(caret).not.toBeNull();

    await imeCompose('abc');

    const rule = (await shot(ui)).darkBounds(
      { x: INSIDE.x, y: 392, width: INSIDE.width, height: 3 },
      DARK,
    );
    expect(rule).not.toBeNull();
    expect(Math.abs((rule as Rect).x - (caret as Rect).x)).toBeLessThan(3);
    expect((rule as Rect).width).toBeGreaterThan(8);

    await imeCommit();
    await label.press('Escape');
    expect((await savedScene(ui)).elements[0]?.label).toBe('prefix abc');
  });
});
