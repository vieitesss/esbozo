/**
 * One of the Label suites, split by what a person sees, not by module: `tests/labels-*.e2e.ts`.
 * Browser seam: where the caret is drawn and where a press puts it, in words that read either way,
 * and how Up, Home and End walk the lines the words are drawn on rather than the field's rows.
 */
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  EMPTY,
  WORDS,
  clickScene,
  doubleClickScene,
  openEditor,
  savedScene,
  settle,
} from './helpers.ts';
import { CARET, DARK, GLYPH, INK_ONLY, INSIDE, SCENE_SOURCE, WORDS_SOURCE } from './labels-shared.ts';
import type { View } from './helpers.ts';
import { insertText, stillCaret } from './cdp.ts';
import { shot } from './pixels.ts';
import type { Rect, Shot } from './pixels.ts';

/** An empty page: the only ink on it is the words a test types. */
const BARE_SOURCE = JSON.stringify(
  { version: 1, title: 'Bare', defaults: { roughness: 1 }, elements: [] },
  null,
  2,
);

/** A right-aligned Text with a blank middle line: the row Up walks into. */
const ALIGNED_SOURCE = JSON.stringify(
  {
    version: 1,
    title: 'Aligned',
    defaults: { roughness: 1 },
    elements: [
      { id: 'words', type: 'text', x: 300, y: 40, content: 'alpha\n\nbeta', textAlign: 'right' },
    ],
  },
  null,
  2,
);

/** A word with no ascender: the rows its ink leaves bare hold the caret and nothing else. */
const NO_ASCENDER = 'ace';

/** A single letter: enough words to have ink, and no more. */
const ONE_LETTER = 'w';

/**
 * A two-line shaft Label the Scene places itself: `t: 0.8` along a shaft that
 * runs right to left puts its middle at Scene (180, 239), well left of where
 * Layout first placed it. The lines are at Scene y 210 and 239, so the second
 * one, `second line`, is pressed at Scene (180, 253).
 */
const PLACED_SHAFT_SOURCE = JSON.stringify(
  {
    version: 1,
    title: 'Placed shaft',
    defaults: { roughness: 1 },
    elements: [
      {
        id: 'shaft',
        type: 'arrow',
        points: [
          { x: 500, y: 300 },
          { x: 100, y: 300 },
        ],
        heads: { start: 'none', end: 'arrow' },
        label: 'first line\nsecond line',
        labelAt: { t: 0.8, offset: 61 },
      },
    ],
  },
  null,
  2,
);

/** The view `PLACED_SHAFT_SOURCE` lands in: the page fitted with an 80px margin, 1:1. */
const PLACED_SHAFT: View = { zoom: 1, panX: 340, panY: 145 };

/** Words that read right to left, in a font Kalam has no glyphs for. */
const RTL_WORDS = 'שלום עולם';

/** A line that mixes both directions: the Hebrew run in the middle is drawn the other way round. */
const MIXED_WORDS = 'abc אבג xyz';

/** Where an empty Scene's first Text lands, and the room its words take there. */
const TYPED: Rect = { x: 500, y: 320, width: 260, height: 90 };

/** The same words at six times the Zoom, which keeps them where they were. */
const TYPED_ZOOMED: Rect = { x: 300, y: 100, width: 600, height: 500 };

/** A Scene point, and the page one it is drawn at in an empty Scene. */
type Spot = { x: number; y: number };

/** A gap narrower than this is the room between two letters, not between two words. */
const LETTER_GAP = 4;

/**
 * The words a line of ink is made of, left to right: the runs of its glyphs,
 * with the narrow gaps between letters closed and the wider spaces between
 * words kept. It answers where each word is drawn, whatever it says and
 * whichever way it reads.
 */
function wordRuns(view: Shot, line: Rect, threshold: number): Rect[] {
  const words: Rect[] = [];
  let open: Rect | null = null;
  for (let x = Math.floor(line.x); x < line.x + line.width; x += 1) {
    const written = view.darkCount({ x, y: line.y, width: 1, height: line.height }, threshold) > 0;
    if (!written) {
      continue;
    }
    if (open !== null && x - (open.x + open.width) < LETTER_GAP) {
      open.width = x - open.x + 1;
      continue;
    }
    open = { x, y: line.y, width: 1, height: line.height };
    words.push(open);
  }
  return words;
}

describe('labels caret', () => {
  test('the caret is drawn in the ink the Elements are, not the selection’s colour', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'bare.json': BARE_SOURCE } }, 'bare.json');
    // Bare paper: no Grid dot is dark enough to be mistaken for a drawn line.
    await browser.keyboard.press('g');
    await stillCaret();

    await browser.keyboard.press('t');
    await clickScene(ui, { x: 100, y: 80 }, [], EMPTY);
    const field = screen.getByRole('textbox', { name: 'Text' });
    await field.pressSequentially(ONE_LETTER);
    await field.press('Home');
    await settle(ui);

    // The letter's own ink is the drawing's ink. The caret stands taller than
    // it — `w` has no ascender — so the rows at the top of the ink are the
    // caret's alone, and there the pixels are the ink itself rather than a wash
    // of the selection's colour.
    const drawn = await shot(ui);
    const ink = drawn.darkBounds(TYPED, CARET);
    expect(ink).not.toBeNull();
    const above = { x: TYPED.x, y: (ink as Rect).y + 1, width: TYPED.width, height: 4 };
    expect(drawn.darkBounds(above, CARET)).not.toBeNull();
    expect(drawn.darkCount(above, INK_ONLY)).toBeGreaterThan(0);
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

  test('a character the Scene refuses is typed without moving the caret it was typed at', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    await stillCaret();

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially(NO_ASCENDER);
    // Back to the gap after the first letter, where the refused character goes.
    await label.press('ArrowLeft');
    await label.press('ArrowLeft');
    await settle(ui);

    /** Where the caret stands, read from the column of it above the letters' ink. */
    const caretX = async (): Promise<number> => {
      const drawn = await shot(ui);
      const ink = drawn.darkBounds(INSIDE, GLYPH);
      expect(ink).not.toBeNull();
      // The rows above the letters are the caret's alone — none of these
      // letters has an ascender — so the column read there is the caret's.
      const caret = drawn.darkBounds(
        { x: INSIDE.x, y: (ink as Rect).y + 1, width: INSIDE.width, height: 4 },
        CARET,
      );
      expect(caret).not.toBeNull();
      return (caret as Rect).x + (caret as Rect).width / 2;
    };

    const before = await caretX();
    // U+0001 is a character the Scene cannot hold: the page goes on drawing
    // the same letters, and the caret must go on standing where it was typed.
    await insertText('\u0001');
    await settle(ui);
    const after = await caretX();
    expect(Math.abs(after - before)).toBeLessThan(1);

    // The character is in the field all the same — a backspace takes it and the
    // words are the ones that were there — and the words save as they were.
    await label.press('Backspace');
    await label.press('Escape');
    expect((await savedScene(ui)).elements[0]?.label).toBe(NO_ASCENDER);
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

  test('a Text placed a half pixel off keeps its caret on the pixel the Scene rounds to', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'bare.json': BARE_SOURCE } }, 'bare.json');
    // Bare paper: no Grid dot can be mistaken for the caret's own pixels.
    await browser.keyboard.press('g');
    await stillCaret();

    /** The ink of the words and the caret, as the one thing drawn on the page. */
    const glyphs = async (room: Rect): Promise<Rect> => {
      const bounds = (await shot(ui)).darkBounds(room, DARK);
      expect(bounds).not.toBeNull();
      return bounds as Rect;
    };

    /**
     * Where the caret stands, six times over: a Zoom in about the words
     * themselves, so the page keeps them under the pointer while half a Scene
     * pixel becomes a visible one. The caret stands taller than the `w` beside
     * it, so the rows at the top of the ink hold its own column and nothing
     * else, whatever the colour both are drawn in.
     */
    const caretColumn = async (at: Spot): Promise<number> => {
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
      const caret = (await shot(ui)).darkBounds(
        { x: drawn.x - 20, y: drawn.y + 1, width: drawn.width + 40, height: 6 },
        CARET,
      );
      expect(caret).not.toBeNull();

      await field.press('Escape');
      // The words are nobody's until the release: one Text lands, and goes.
      expect((await savedScene(ui, 'bare.json')).elements.length).toBe(1);
      await browser.keyboard.press('Delete');
      // Back to the view the next Text is placed in, about the same point.
      await browser.mouse.wheel(0, 1200);
      await expect(screen.getByText(/^\d+%$/)).toHaveText('100%');
      return (caret as Rect).x + (caret as Rect).width / 2;
    };

    const halfPixel = await caretColumn({ x: 100.5, y: 80.5 });
    const wholePixel = await caretColumn({ x: 100, y: 80 });

    // The Scene rounds a Text placed off a whole pixel, and the page draws that
    // Text: the caret has to stand on it at either anchor, not a Scene pixel
    // beside it — and a Scene pixel is six of them at this Zoom.
    expect(Math.abs(halfPixel - wholePixel)).toBeLessThan(1.5);
  });

  test('right-to-left words keep their caret, and a press, at the end they are drawn to', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'words.json': WORDS_SOURCE } }, 'words.json');
    // Bare paper: no Grid dot can be mistaken for the caret's own pixels.
    await browser.keyboard.press('g');
    await stillCaret();

    await doubleClickScene(ui, { x: 100, y: 80 }, WORDS);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.fill(RTL_WORDS);

    // Where the drawing put the words, inside a box with room to spare: the
    // fallback font's ink, whose width no measurement of Kalam's own knows.
    const ink = (await shot(ui)).darkBounds({ x: 560, y: 380, width: 165, height: 60 }, DARK);
    expect(ink).not.toBeNull();
    const words = ink as Rect;

    // The caret follows the last letter, and a run that reads right to left
    // ends at its left edge: the strip above the ink is where a caret taller
    // than the words is alone, so its own column can be read.
    const caret = (await shot(ui)).darkBounds(
      { x: 560, y: words.y + 1, width: 165, height: 3 },
      CARET,
    );
    expect(caret).not.toBeNull();
    expect(Math.abs((caret as Rect).x - words.x)).toBeLessThan(4);

    // A press where the words end, and a letter typed there, goes after them.
    await browser.mouse.move(words.x + 2, words.y + words.height / 2);
    await browser.mouse.down();
    await browser.mouse.up();
    await label.pressSequentially('X');
    await label.press('Escape');

    expect((await savedScene(ui, 'words.json')).elements[0]?.label).toBe(`${RTL_WORDS}X`);
  });

  test('a run that reads the other way is selected and pressed by the box its glyphs make', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    // Bare paper right of both boxes: the only ink there is the words this test
    // places, and no Grid dot is dark enough to be mistaken for their wash.
    await browser.keyboard.press('g');

    await browser.keyboard.press('t');
    await clickScene(ui, { x: 420, y: 300 });
    const text = screen.getByRole('textbox', { name: 'Text' });
    await text.fill(MIXED_WORDS);
    await text.press('Escape');
    // A press on the paper clears the selection, so the runs of ink are the
    // line's own: no caret, and no box around a selected Element, is in them.
    await clickScene(ui, { x: 30, y: 400 });

    const plain = await shot(ui);
    const line = plain.darkBounds({ x: 860, y: 585, width: 240, height: 60 }, DARK) as Rect;
    const words = wordRuns(plain, line, DARK);
    expect(words).toHaveLength(3);
    const [latin, hebrew, tail] = words as [Rect, Rect, Rect];
    expect(latin.x + latin.width).toBeLessThan(hebrew.x);
    expect(hebrew.x + hebrew.width).toBeLessThan(tail.x);

    // The words open where they are drawn, and a drag across the Hebrew run
    // takes it. A highlight read from two logical endpoints of a run drawn the
    // other way round is the width of one glyph, or none at all.
    await doubleClickScene(ui, { x: hebrew.x + hebrew.width / 2 - 470, y: 310 });
    const y = hebrew.y + hebrew.height / 2;
    await browser.mouse.move(hebrew.x + 1, y);
    await browser.mouse.down();
    await browser.mouse.move(hebrew.x + hebrew.width - 1, y);
    await browser.mouse.up();

    // The wash is read from the strip under the glyphs' own ink, in the bottom
    // few pixels of the line: the highlight covers the whole line box, so a
    // box that holds the run and one that holds two of its letters differ there
    // without a glyph covering the difference.
    const wash = (await shot(ui)).darkBounds(
      { x: hebrew.x - 6, y: hebrew.y + hebrew.height + 1, width: hebrew.width + 12, height: 3 },
      0.9,
    );
    expect(wash).not.toBeNull();
    expect(Math.abs((wash as Rect).x - hebrew.x)).toBeLessThan(6);
    expect((wash as Rect).width).toBeGreaterThan(hebrew.width - 2);
    expect((wash as Rect).width).toBeLessThan(line.width / 2);

    // The left end of the run is the offset after its last letter, so a letter
    // typed there goes after the Hebrew word and not inside it.
    await browser.mouse.move(hebrew.x + 1, y);
    await browser.mouse.down();
    await browser.mouse.up();
    await text.pressSequentially('X');
    await text.press('Escape');

    const typed = (await savedScene(ui)).elements.find((element) => element.type === 'text');
    expect(typed?.content).toBe('abc אבגX xyz');
  });

  test('a caret walked back through the words moves alone, and keeps the boxes around them', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
    await stillCaret();

    await doubleClickScene(ui, { x: 100, y: 80 });
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.pressSequentially('orders and');

    /** The caret's own column, in the strip above the glyphs where it stands alone. */
    const caretColumn = async (): Promise<number> => {
      const words = (await shot(ui)).darkBounds(INSIDE, DARK);
      expect(words).not.toBeNull();
      const caret = (await shot(ui)).darkBounds(
        { x: INSIDE.x, y: (words as Rect).y + 1, width: INSIDE.width, height: 3 },
        CARET,
      );
      expect(caret).not.toBeNull();
      return (caret as Rect).x;
    };

    const before = await shot(ui);
    const ink = before.darkBounds(INSIDE, GLYPH);
    expect(ink).not.toBeNull();
    // The words' first letters, clear of the end the caret stands at: a caret
    // covers the ink it touches, so the two ends of the line are not the ink's.
    const start: Rect = { x: (ink as Rect).x, y: (ink as Rect).y, width: 24, height: (ink as Rect).height };
    const caretBefore = await caretColumn();
    for (let step = 0; step < 3; step += 1) {
      await label.press('ArrowLeft');
    }

    // A frame a caret moved on is a frame of its own: the caret walks left, and
    // the glyphs and the boxes the frame before drew are still the same ones.
    const after = await shot(ui);
    expect(await caretColumn()).toBeLessThan(caretBefore - 4);
    expect(after.darkBounds(start, GLYPH)).toEqual(before.darkBounds(start, GLYPH));
    const around = { x: 500, y: 330, width: 60, height: 14 };
    expect(after.darkCount(around, DARK)).toBe(before.darkCount(around, DARK));
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

  test('Up into a blank line of right-aligned words stands the caret where that line anchors', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'scene.json': ALIGNED_SOURCE } }, 'scene.json');
    await stillCaret();

    // The words are the only ink on the page, and the view is the editor's own
    // fit of them, so where they are is read from the pixels rather than from a
    // fixture's view: the middle of their ink is the blank line between them.
    const ink = (await shot(ui)).darkBounds({ x: 400, y: 250, width: 480, height: 300 }, DARK) as Rect;
    expect(ink).not.toBeNull();
    await screen.doubleTapAt({ x: ink.x + ink.width - 6, y: ink.y + ink.height / 2 });

    // Up takes the blank line the words were written with, at the column the
    // caret is in. A blank line draws no glyph, so it has one place to stand in:
    // the edge its own alignment anchors on, here the right edge of every line.
    await browser.keyboard.press('ArrowUp');
    // Inside the ink's own bounds: the box drawn around the selected Element
    // stands five pixels outside them, and it is dark too.
    const caret = (await shot(ui)).darkBounds(
      { x: ink.x - 2, y: ink.y + ink.height / 2 - 4, width: ink.width + 4, height: 8 },
      CARET,
    );
    expect(caret).not.toBeNull();
    expect(Math.abs((caret as Rect).x - (ink.x + ink.width))).toBeLessThan(4);

    // And a letter typed there lands on that line, not on either word's.
    await browser.keyboard.type('X');
    await browser.keyboard.press('Escape');
    expect((await savedScene(ui)).elements[0]?.content).toBe('alpha\nX\nbeta');
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

  test('End on a placed two-line Label stands at the end of its second line', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'shaft.json': PLACED_SHAFT_SOURCE } }, 'shaft.json');

    // A press on the second line, then End: the caret ends where that line does,
    // and the letter typed there lands on it. What a Line draws is where the
    // glyphs went; the offsets beside them are offsets into the words, so
    // translating the words for `labelAt` must not move them too.
    await doubleClickScene(ui, { x: 180, y: 253 }, PLACED_SHAFT);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await label.press('End');
    await label.pressSequentially('X');
    await label.press('Escape');

    expect((await savedScene(ui, 'shaft.json')).elements[0]?.label).toBe(
      'first line\nsecond lineX',
    );
  });
});
