/**
 * One of the Label suites, split by what a person sees, not by module: `tests/labels-*.e2e.ts`.
 * Seam 2: how the words are drawn — the fill they let show between them, the Align and
 * Size the Style menu gives them, and the box they grow into and are trimmed out of as
 * they are typed.
 */
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  BESIDE,
  BLANK_SCENE,
  ROOM,
  SPACED_SCENE,
  WORDS,
  at,
  clickScene,
  doubleClickScene,
  drag,
  openEditor,
  savedFiles,
  savedScene,
  settle,
} from './helpers.ts';
import {
  BESIDE_SOURCE,
  DARK,
  GLYPH,
  LONG_WORD,
  ROOM_SOURCE,
  SCENE_SOURCE,
  WORDS_SOURCE,
} from './labels-shared.ts';
import type { Ui, View } from './helpers.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';

const SPACED_SOURCE = JSON.stringify(SPACED_SCENE, null, 2);

const BLANK_SOURCE = JSON.stringify(BLANK_SCENE, null, 2);

/**
 * A filled box the size of the page, so anything drawn on it sits on grey fill
 * rather than on bare paper: a patch of paper where the fill belongs shows at
 * once, instead of hiding in the sheet it was cut from.
 */
const UNDER_SOURCE = JSON.stringify(
  {
    version: 1,
    title: 'Under',
    defaults: { roughness: 1 },
    elements: [
      {
        id: 'under',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 300,
        height: 200,
        fill: { kind: 'solid', grey: 4 },
      },
    ],
  },
  null,
  2,
);

/** The view `UNDER_SOURCE` lands in: its box fitted 1:1, so Scene (250, 200) is the middle. */
const UNDER: View = { zoom: 1, panX: 390, panY: 200 };

/**
 * Where an arrow drawn across that box at Scene y 220 would place its empty
 * Label, and a patch of the same grey fill away from it: one grey reads the same
 * in both places while nothing is drawn over either.
 */
const UNDER_LABEL: Rect = { x: 645, y: 388, width: 10, height: 27 };
const UNDER_FILL: Rect = { x: 700, y: 388, width: 10, height: 27 };

/**
 * The same patch either side of the caret an empty Label draws, inside the box
 * its words will take and clear of the caret's own ink.
 */
const UNDER_CARET: Rect = { x: 646, y: 388, width: 2, height: 27 };
const UNDER_CARET_BESIDE: Rect = { x: 652, y: 388, width: 2, height: 27 };

/**
 * The shaft's own row across the box, a little taller than the stroke, so the
 * whole of it is counted wherever the whole of it is drawn. The grey the box is
 * filled with sits close to paper's own line, so what the row is counted with is
 * the ink of the stroke and not the wash under it.
 */
const SHAFT_ROW: Rect = { x: 560, y: 419, width: 180, height: 4 };

/**
 * The space between the first two words, inside the box their own ink covers and
 * clear of every glyph beside it: bare fill there, where paper used to be.
 */
const BETWEEN_WORDS: Rect = { x: 628, y: 392, width: 4, height: 15 };

/** An arrow whose Label is two lines of different lengths, so an alignment shows. */
const ALIGNED_SHAFT_SOURCE = JSON.stringify(
  {
    version: 1,
    title: 'Aligned shaft',
    defaults: { roughness: 1 },
    elements: [
      {
        id: 'shaft',
        type: 'arrow',
        points: [
          { x: 100, y: 240 },
          { x: 500, y: 240 },
        ],
        label: 'a wider line\ntiny',
      },
    ],
  },
  null,
  2,
);

/**
 * The view `ALIGNED_SHAFT_SOURCE` lands in: the shaft fitted with the words above
 * it, so the middle of the shaft, Scene (300, 240), is page (640, 431).
 */
const ALIGNED_SHAFT: View = { zoom: 1, panX: 340, panY: 191 };

/**
 * Room on the page for the Label at any alignment and size: above the shaft's
 * own ink, and left of the head that ends it.
 */
const SHAFT_LABEL_ROOM: Rect = { x: 400, y: 250, width: 400, height: 176 };

/**
 * The ink of each of the two lines of a shaft's Label, read from the page above
 * the shaft and split where the two line boxes meet.
 */
async function labelLines(ui: Ui): Promise<[Rect, Rect]> {
  const drawn = await shot(ui);
  const all = drawn.darkBounds(SHAFT_LABEL_ROOM, DARK);
  expect(all).not.toBeNull();
  const words = all as Rect;
  const split = words.y + words.height / 2;
  const top = drawn.darkBounds({ ...SHAFT_LABEL_ROOM, height: split - SHAFT_LABEL_ROOM.y }, DARK);
  const bottom = drawn.darkBounds(
    { ...SHAFT_LABEL_ROOM, y: split, height: SHAFT_LABEL_ROOM.y + SHAFT_LABEL_ROOM.height - split },
    DARK,
  );
  expect(top).not.toBeNull();
  expect(bottom).not.toBeNull();
  return [top as Rect, bottom as Rect];
}

describe('labels draw', () => {
  test("a drawn arrow's Label shows the fill between its words and cuts nothing out of its shaft", async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'under.json': UNDER_SOURCE } }, 'under.json');

    // An arrow drawn straight across the box, with Alt so its ends stay free of
    // the outline: the place its Label will take is grey fill either way.
    await screen.getByRole('button', { name: 'Arrow' }).click();
    await browser.keyboard.down('Alt');
    await drag(ui, at({ x: 160, y: 220 }, UNDER), at({ x: 360, y: 220 }, UNDER));
    await browser.keyboard.up('Alt');
    await settle(ui);
    expect((await savedScene(ui, 'under.json')).elements.length).toBe(2);

    // The arrow carries no words yet, so nothing is placed on the fill: the grey
    // under the place its Label will take reads as the grey anywhere else, and
    // the shaft's own ink runs whole through its middle.
    const empty = await shot(ui);
    const fill = empty.meanLuminance(UNDER_FILL);
    expect(Math.abs(empty.meanLuminance(UNDER_LABEL) - fill)).toBeLessThan(0.02);
    expect(empty.darkCount(SHAFT_ROW, GLYPH)).toBeGreaterThan(400);

    // Opening the Label draws a caret and no words: a blank Label is still no
    // Label, so the fill stays fill either side of the caret standing in it.
    await doubleClickScene(ui, { x: 260, y: 220 }, UNDER);
    const opened = await shot(ui);
    for (const beside of [UNDER_CARET, UNDER_CARET_BESIDE]) {
      expect(Math.abs(opened.meanLuminance(beside) - fill)).toBeLessThan(0.02);
    }

    // Words arrive: they are drawn where they will save, and the fill under them
    // stays fill between them — the grey of it shows through the space between
    // the first two words, as pale as paper there would be dark against it.
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('on the line');
    await settle(ui);

    const written = await shot(ui);
    expect(Math.abs(written.meanLuminance(BETWEEN_WORDS) - fill)).toBeLessThan(0.02);
    expect(written.darkCount(UNDER_LABEL, 0.2)).toBeGreaterThan(0);
    // And the shaft the words are placed above is cut nowhere: a Label above its
    // shaft has no shaft under it to take out, so the whole row is drawn still.
    expect(written.darkCount(SHAFT_ROW, GLYPH)).toBeGreaterThan(400);

    await label.press('Escape');
    const saved = await savedScene(ui, 'under.json');
    expect(saved.elements[1]?.label).toBe('on the line');
  });

  test("an arrow's Label takes Align and Size from the Style menu, and lines up as it is told", async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'shaft.json': ALIGNED_SHAFT_SOURCE } }, 'shaft.json');

    // Nothing is selected, so no cue is drawn around the words: their own ink is
    // all there is to measure. Centred is what an unwritten alignment means.
    const [wide, narrow] = await labelLines(ui);
    expect(Math.abs(wide.x + wide.width / 2 - 640)).toBeLessThan(3);
    expect(Math.abs(narrow.x + narrow.width / 2 - 640)).toBeLessThan(3);

    // A shaft's Label takes an alignment from the Style menu like any other
    // words, and the pick is what the Scene keeps.
    await clickScene(ui, { x: 300, y: 240 }, [], ALIGNED_SHAFT);
    await screen.getByRole('button', { name: 'Align: left' }).click();
    await settle(ui);
    expect((await savedScene(ui, 'shaft.json')).elements[0]?.textAlign).toBe('left');

    // Both lines read from the block's left edge, which is left of the middle.
    await browser.keyboard.press('Escape');
    await settle(ui);
    const [leftWide, leftNarrow] = await labelLines(ui);
    expect(Math.abs(leftWide.x - leftNarrow.x)).toBeLessThan(3);
    expect(leftWide.x).toBeLessThan(620);

    await clickScene(ui, { x: 300, y: 240 }, [], ALIGNED_SHAFT);
    await screen.getByRole('button', { name: 'Align: right' }).click();
    await settle(ui);
    expect((await savedScene(ui, 'shaft.json')).elements[0]?.textAlign).toBe('right');

    await browser.keyboard.press('Escape');
    await settle(ui);
    const [rightWide, rightNarrow] = await labelLines(ui);
    expect(
      Math.abs(rightWide.x + rightWide.width - (rightNarrow.x + rightNarrow.width)),
    ).toBeLessThan(3);
    expect(rightWide.x + rightWide.width).toBeGreaterThan(660);

    // The size is the Label's too: the words draw larger, and the Scene keeps it.
    await clickScene(ui, { x: 300, y: 240 }, [], ALIGNED_SHAFT);
    await screen.getByRole('button', { name: 'Align: centre' }).click();
    await screen.getByRole('button', { name: 'Size: XL' }).click();
    await settle(ui);
    const scaled = await savedScene(ui, 'shaft.json');
    expect({ textAlign: scaled.elements[0]?.textAlign, fontSize: scaled.elements[0]?.fontSize }).toEqual({
      textAlign: 'center',
      fontSize: 'XL',
    });

    await browser.keyboard.press('Escape');
    await settle(ui);
    const [large, small] = await labelLines(ui);
    expect(large.height).toBeGreaterThan(wide.height * 1.4);
    expect(large.width).toBeGreaterThan(wide.width * 1.4);
    expect(Math.abs(large.x + large.width / 2 - 640)).toBeLessThan(4);
    expect(Math.abs(small.x + small.width / 2 - 640)).toBeLessThan(4);
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
