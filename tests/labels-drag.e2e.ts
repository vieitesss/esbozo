/**
 * One of the Label suites, split by what a person sees, not by module: `tests/labels-*.e2e.ts`.
 * Browser seam: a shaft's Label — the words placed on an arrow — dragged along the shaft or off it,
 * and the press that finds the shaft, the head or the words under the pointer.
 */
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  BESIDE,
  CHORD,
  CHORD_SCENE,
  FOLLOW,
  FOLLOW_SCENE,
  HEAD_OVER,
  HEAD_OVER_SCENE,
  LABELLED,
  LABELLED_SCENE,
  OVERLAP,
  OVERLAP_SCENE,
  POINT,
  POINT_SCENE,
  TILTED,
  TILTED_SCENE,
  UNPLACED,
  UNPLACED_SCENE,
  at,
  clickScene,
  doubleClickScene,
  drag,
  dragBy,
  holdWrites,
  openEditor,
  refuseWrite,
  savedFiles,
  savedScene,
  settle,
} from './helpers.ts';
import { BESIDE_SOURCE, DARK } from './labels-shared.ts';
import type { Ui, View } from './helpers.ts';
import { cursorAt } from './cdp.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';

const POINT_SOURCE = JSON.stringify(POINT_SCENE, null, 2);

const LABELLED_SOURCE = JSON.stringify(LABELLED_SCENE, null, 2);
const OVERLAP_SOURCE = JSON.stringify(OVERLAP_SCENE, null, 2);
const TILTED_SOURCE = JSON.stringify(TILTED_SCENE, null, 2);
const UNPLACED_SOURCE = JSON.stringify(UNPLACED_SCENE, null, 2);
const FOLLOW_SOURCE = JSON.stringify(FOLLOW_SCENE, null, 2);
const HEAD_OVER_SOURCE = JSON.stringify(HEAD_OVER_SCENE, null, 2);
const CHORD_SOURCE = JSON.stringify(CHORD_SCENE, null, 2);

/**
 * Where a saved shaft Label draws its words, in page pixels: the `<text>` the
 * save writes for them is where they are, moved from Scene units by the view the
 * page shows. A shaft's Label is drawn about its own middle, so the anchor of
 * the line is the middle of the words, and the page's ink about it is the words
 * a person sees.
 */
interface SavedWords {
  /** The middle of the words, on the page. */
  x: number;
  /** The row the words sit on, on the page. */
  baseline: number;
  /** The words themselves, as the save wrote them. */
  text: string;
}

async function savedWords(ui: Ui, name: string, view: View): Promise<SavedWords> {
  const svg = (await savedFiles(ui))[name];
  if (svg === undefined) {
    throw new Error(`${name} was not saved`);
  }
  // check-rules: markup of a written SVG file, not the page
  const found = /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*text-anchor="([a-z]+)"[^>]*>([^<]*)<\/text>/.exec(svg);
  if (found === null) {
    throw new Error(`${name} draws no words`);
  }
  const [x, y, anchor, text] = found.slice(1) as [string, string, string, string];
  if (anchor !== 'middle') {
    throw new Error(`${name} draws its words from "${anchor}", not about their middle`);
  }
  return {
    x: Number(x) * view.zoom + view.panX,
    baseline: Number(y) * view.zoom + view.panY,
    text,
  };
}

/**
 * The gap the words cut when their middle is on their own shaft, in the Scene's
 * own units: their ink runs from 274 to 325 across the shaft's row, 199 to 200,
 * and the gap reaches five and a half units past that either way — the hang the
 * words' box keeps for a glyph tail, and half the stroke that ends in it.
 * `inside` is two units in from the gap's left end, and clear of the glyphs
 * beside it; `left` and `right` are the same row beyond the gap, where the shaft
 * has to be drawn still.
 */
const ON_THE_LINE: Record<'inside' | 'left' | 'right', Rect> = {
  inside: { x: 271, y: 198, width: 2, height: 5 },
  left: { x: 263, y: 198, width: 3, height: 5 },
  right: { x: 334, y: 198, width: 3, height: 5 },
};

/**
 * The words' own ink on the page, in the Scene's units: the window the gap
 * leaves them, clear of the shaft's own runs either side of it.
 */
const ON_THE_LINE_WORDS: Rect = { x: 271, y: 186, width: 57, height: 26 };

/**
 * A strip two units in from the end of that gap, in the Scene's units: the shaft
 * is drawn over it while the words say `moving`, and it is gap once they say
 * `moving on`, whose ink reaches four units nearer the middle of the shaft.
 */
const GROWN: Rect = { x: 259, y: 198, width: 2, height: 4 };

/** A box drawn in the Scene's units, as the page it is shown on draws it. */
function onPage(box: Rect, view: View): Rect {
  return {
    x: box.x * view.zoom + view.panX,
    y: box.y * view.zoom + view.panY,
    width: box.width * view.zoom,
    height: box.height * view.zoom,
  };
}

/**
 * The view the saved Scene opens in, once its words are on its shaft: the page
 * fits the drawing it is given, and a drawing shorter than `LABELLED`'s — the
 * same Scene with the words on their own side — fits a little lower.
 */
const OPENED: View = { zoom: 1, panX: 340, panY: 200 };

/**
 * A line bent through one point, drawn on a box that holds the page still, with
 * its words above the bend. `labelAt.t` is a fraction of the drawn ink, so
 * `t = 0.5` is the bulge the bend draws — 200px above the middle of the chord
 * between the two ends, which is where a chord's own fraction would put it.
 */
function bentLabelScene(corners: 'round' | 'sharp'): string {
  return JSON.stringify(
    {
      version: 1,
      title: 'Bent label',
      defaults: { roughness: 0 },
      elements: [
        { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
        {
          id: 'bent',
          type: 'line',
          corners,
          points: [
            { x: 200, y: 400 },
            { x: 400, y: 200 },
            { x: 600, y: 400 },
          ],
          heads: { start: 'none', end: 'none' },
          label: 'bent words',
          labelAt: { t: 0.5, offset: 100 },
        },
      ],
    },
    null,
    2,
  );
}

/** The view a bent Label's page lands in: its 800×560 box fitted 1:1. */
const BENT_LABEL: View = { zoom: 1, panX: 240, panY: 120 };

/**
 * The strip of page a bent Label's words open in: wide enough for the words to
 * be carried across it and be measured whole, and clear of the shaft's own ink,
 * which a hundred pixels below them is the only other thing this page draws.
 */
const BENT_WORDS: Rect = { x: 540, y: 180, width: 300, height: 60 };

/**
 * The strip of page a bent Label's words lie in, read off the row its own save
 * wrote: wide enough for every glyph, and clear of the ink of the shaft they are
 * written about.
 */
function wordsBand(words: SavedWords): Rect {
  return { x: words.x - 60, y: words.baseline - 20, width: 120, height: 26 };
}

/** The middle of a measured box of ink on the page. */
function middleOf(box: Rect): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Drag a bent shaft's Label off the bend it opens above, and hold the release to
 * the three things a person sees: the words under the pointer while the button
 * is down, the place the file keeps for them, and the same words drawn by the
 * page that opens that file again.
 *
 * The words are carried straight down towards the ink, so the place they land on
 * is the bend's own normal: `t` stays the fraction halfway along the drawn ink,
 * and the offset is the 60px left between them and the bulge they sit above.
 * Read against the chord between the two ends — 200px below the bulge — the same
 * release would save an offset near 260, and the words would jump when the file
 * drew them again.
 */
async function carryBentLabel(ui: Ui, corner: 'round' | 'sharp'): Promise<void> {
  const name = `bent-${corner}.json`;
  const svg = `bent-${corner}.svg`;
  await openEditor(ui, { A: { [name]: bentLabelScene(corner) } }, name);

  // The words' own ink where they open, above the bend.
  const start = (await shot(ui)).darkBounds(BENT_WORDS, DARK);
  expect(start).not.toBeNull();
  const held = middleOf(start as Rect);

  // Taken by the middle of that ink and carried 40px down, towards the ink: the
  // words are drawn where the pointer is while the button is still down, so the
  // place is chosen on the page and not only once the release saves it.
  const by = { x: 0, y: 40 };
  const to = { x: held.x + by.x, y: held.y + by.y };
  await drag(ui, held, to, 'left', async () => {
    await settle(ui);
    const carrying = await shot(ui);
    // The words' ink is drawn where the pointer is, and gone from where they were
    // taken, so the place is chosen on the page and not only once the release
    // saves it. Boxes rather than bounds: the shaft's own hold is outlined while
    // the button is down, and its border crosses the region the words sit in.
    expect(carrying.darkCount({ x: to.x - 70, y: to.y - 12, width: 140, height: 24 }, DARK),
      `the words are drawn at the pointer (${to.x}, ${to.y})`,
    ).toBeGreaterThan(20);
    expect(carrying.darkCount({ x: held.x - 70, y: held.y - 12, width: 140, height: 24 }, DARK),
      `the words are gone from where they were taken (${held.x}, ${held.y})`,
    ).toBe(0);
  });

  // The place the file keeps is the ink's own: halfway along the drawn bend, and
  // 60px off it. The shaft itself did not move, so the press took the words and
  // not the line.
  const placed = await savedScene(ui, name);
  const bent = placed.elements.find((element) => element.id === 'bent');
  expect(bent?.labelAt).toEqual({ t: 0.5, offset: 60 });
  expect(bent?.points).toEqual([
    { x: 200, y: 400 },
    { x: 400, y: 200 },
    { x: 600, y: 400 },
  ]);

  // The words the release leaves under the pointer, with the selection's own ink
  // gone first: a gesture that moved the words without the file saying so, or
  // the other way round, is caught here. The region holds no other ink — the
  // shaft is 40px below it, and the page's own frame outside it.
  await ui.browser.keyboard.press('Escape');
  const dropped = (await shot(ui)).darkBounds(
    { x: to.x - 100, y: to.y - 20, width: 200, height: 40 },
    DARK,
  );
  expect(dropped).not.toBeNull();
  const left = middleOf(dropped as Rect);
  expect(left.x, `the words are drawn at the pointer (${to.x}, ${to.y})`).toBeLessThan(to.x + 1.5);
  expect(left.x).toBeGreaterThan(to.x - 1.5);
  expect(left.y).toBeLessThan(to.y + 1.5);
  expect(left.y).toBeGreaterThan(to.y - 1.5);

  // A page that opens the Scene the save wrote draws them where the release left
  // them: the place is the file's own, and not something the drag left on the
  // page it drew.
  const saved = await savedFiles(ui);
  await openEditor(ui, { A: saved }, name);
  const reopened = await savedWords(ui, svg, BENT_LABEL);
  const again = (await shot(ui)).darkBounds(wordsBand(reopened), DARK);
  expect(again).not.toBeNull();
  const kept = middleOf(again as Rect);
  expect(Math.abs(kept.x - left.x)).toBeLessThan(1.5);
  expect(Math.abs(kept.y - left.y)).toBeLessThan(1.5);
}

/**
 * A line whose drawn end runs upright, with its words a hundred pixels left of
 * that end. The side a Label rides faces right a hair inside an upright end and
 * left at the end itself, so a release carried past the end is where the two
 * meet: the place it saves is the end's own, and the words stay on the side the
 * pointer left them.
 */
function uprightEndScene(
  points: ReadonlyArray<{ x: number; y: number }>,
  labelAt: { t: number; offset: number },
): string {
  return JSON.stringify(
    {
      version: 1,
      title: 'Upright end',
      defaults: { roughness: 0 },
      elements: [
        { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
        {
          id: 'bent',
          type: 'line',
          corners: 'round',
          points,
          heads: { start: 'none', end: 'none' },
          label: 'end',
          labelAt,
        },
      ],
    },
    null,
    2,
  );
}

/** The same line with its points the other way, so the upright end is the start. */
const UPRIGHT_ENDS: ReadonlyArray<
  readonly [string, ReadonlyArray<{ x: number; y: number }>, number]
> = [
  ['head', [{ x: 500, y: 100 }, { x: 400, y: 200 }, { x: 400, y: 300 }], 1],
  ['start', [{ x: 400, y: 300 }, { x: 400, y: 200 }, { x: 500, y: 100 }], 0],
];

describe('labels drag', () => {
  test('dragging a shaft Label places it where the pointer leaves it, and the Scene keeps that place', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'labelled.json': LABELLED_SOURCE } }, 'labelled.json');

    // The words' own ink, clear of the shaft below them: what the drag has to
    // carry, and the only ink on the page that can be in this region.
    const words: Rect = { x: 500, y: 280, width: 320, height: 150 };
    const before = await shot(ui);
    const start = before.darkBounds(words, DARK);
    expect(start).not.toBeNull();

    // Taken by their middle, so the drag keeps the hold it took: 120px right is
    // a fifth more of the shaft, and 40px up is 40 more pixels to the side the
    // words already sit on. Both are what the file has to keep.
    const from = at({ x: 300, y: 139 }, LABELLED);
    await browser.mouse.move(from.x, from.y);
    await browser.mouse.down();
    // Half way, with the button still down: the words are already drawn where the
    // pointer is, so the place is chosen on the page and not only once it saves.
    await browser.mouse.move(from.x + 60, from.y - 20);
    await settle(ui);
    const halfway = await shot(ui);
    expect(halfway.darkCount({ x: 660, y: 344, width: 80, height: 24 }, DARK)).toBeGreaterThan(20);
    expect(halfway.darkCount({ x: 660, y: 376, width: 80, height: 14 }, DARK)).toBe(0);
    await browser.mouse.move(from.x + 120, from.y - 40);
    await browser.mouse.up();
    expect((await savedScene(ui, 'labelled.json')).elements[0]?.labelAt).toEqual({
      t: 0.8,
      offset: 101,
    });

    // The ink went where the pointer did, and nowhere else: a gesture that moved
    // the words without the file saying so, or the other way round, is caught.
    await browser.keyboard.press('Escape');
    const carried = await shot(ui);
    const moved = carried.darkBounds(words, DARK);
    expect(moved).not.toBeNull();
    expect(Math.abs((moved as Rect).x - (start as Rect).x - 120)).toBeLessThan(1.5);
    expect(Math.abs((moved as Rect).y - (start as Rect).y + 40)).toBeLessThan(1.5);
  });

  test('a Label dragged along a round bend is saved where the release left it, and a reload keeps it there', async ({
    app,
    browser,
    screen,
  }) => {
    await carryBentLabel({ app, browser, screen }, 'round');
  });

  test('a Label dragged along a sharp bend is saved where the release left it, and a reload keeps it there', async ({
    app,
    browser,
    screen,
  }) => {
    await carryBentLabel({ app, browser, screen }, 'sharp');
  });

  for (const [end, points, t] of UPRIGHT_ENDS) {
    test(`a Label dragged past an upright ${end} keeps the side the ink shows`, async ({
      app,
      browser,
      screen,
    }) => {
      const ui = { app, browser, screen };
      const name = `upright-${end}.json`;
      await openEditor(
        ui,
        { A: { [name]: uprightEndScene(points, { t, offset: 100 }) } },
        name,
      );

      // The words where the Scene puts them, a hundred pixels left of the upright
      // end, measured the way they are measured after the release.
      const opened = (await shot(ui)).darkBounds(
        onPage({ x: 270, y: 280, width: 60, height: 40 }, BENT_LABEL),
        DARK,
      );
      expect(opened).not.toBeNull();
      const was = middleOf(opened as Rect);

      // Taken by their own middle and carried 60 right, 10 past the end: the
      // release clamps onto the end, so the words come back to 40px left of it
      // and level with it — not to the far side of it, which is where a fraction
      // read a hair inside the end signs them.
      const taken = at({ x: 300, y: 300 }, BENT_LABEL);
      const carried = { x: taken.x + 60, y: taken.y + 10 };
      await drag(ui, taken, carried, 'left', async () => {
        await settle(ui);
        const carrying = await shot(ui);
        const near = carrying.darkCount(
          onPage({ x: 340, y: 288, width: 40, height: 24 }, BENT_LABEL),
          DARK,
        );
        const far = carrying.darkCount(
          onPage({ x: 420, y: 288, width: 40, height: 24 }, BENT_LABEL),
          DARK,
        );
        expect(
          near,
          `the words are drawn on the side the pointer left them (far side ink: ${far})`,
        ).toBeGreaterThan(20);
        expect(
          far,
          'the words are not drawn on the far side of the end',
        ).toBe(0);
      });

      // The place the file keeps is the end's own fraction and the 40px between
      // the pointer and the ink beside it.
      const placed = await savedScene(ui, name);
      const bent = placed.elements.find((element) => element.id === 'bent');
      expect(bent?.labelAt).toEqual({ t, offset: 40 });

      // The words the release leaves: the 60px the pointer carried them, with the
      // 10px past the end taken back by the clamp.
      await browser.keyboard.press('Escape');
      const dropped = (await shot(ui)).darkBounds(
        onPage({ x: 330, y: 280, width: 60, height: 40 }, BENT_LABEL),
        DARK,
      );
      expect(dropped).not.toBeNull();
      const left = middleOf(dropped as Rect);
      expect(left.x, 'the words carried 60px right').toBeLessThan(was.x + 61.5);
      expect(left.x).toBeGreaterThan(was.x + 58.5);
      expect(left.y, 'the clamp took back the 10px past the end').toBeLessThan(was.y + 1.5);
      expect(left.y).toBeGreaterThan(was.y - 1.5);

      // A page that opens the Scene the save wrote draws them where the release
      // left them: the side is the file's own.
      const saved = await savedFiles(ui);
      await openEditor(ui, { A: saved }, name);
      const reopened = await savedWords(ui, name.replace(/\.json$/, '.svg'), BENT_LABEL);
      const again = (await shot(ui)).darkBounds(
        { x: reopened.x - 30, y: reopened.baseline - 24, width: 60, height: 40 },
        DARK,
      );      expect(again).not.toBeNull();
      const kept = middleOf(again as Rect);
      expect(Math.abs(kept.x - left.x)).toBeLessThan(1.5);
      expect(Math.abs(kept.y - left.y)).toBeLessThan(1.5);
    });
  }

  test('dragging the shaft itself carries the shaft and leaves the placed words where they are', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'labelled.json': LABELLED_SOURCE } }, 'labelled.json');

    // Pressed on the line itself, well clear of the words: the hand took the
    // shaft, and both of its ends come with it.
    await dragBy(ui, { x: 150, y: 200 }, 60, 40, LABELLED);
    const scene = await savedScene(ui, 'labelled.json');
    expect(scene.elements[0]?.points).toEqual([
      { x: 160, y: 240 },
      { x: 560, y: 240 },
    ]);
    // The place on the shaft is the words' own, so they ride it: the Label was
    // not dragged and its fraction of the shaft did not change.
    expect(scene.elements[0]?.labelAt).toEqual({ t: 0.5, offset: 61 });
  });

  test('a Label dragged onto the shaft is cut out of it, and the page shows through the gap', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'labelled.json': LABELLED_SOURCE } }, 'labelled.json');
    const before = await shot(ui);

    // 61px down puts the words' middle on the shaft: `offset: 0`. The gap they
    // cut takes the shaft out of their own row, and leaves the page through the
    // strip of it that no glyph reaches.
    const inside = onPage(ON_THE_LINE.inside, LABELLED);
    const left = onPage(ON_THE_LINE.left, LABELLED);
    const right = onPage(ON_THE_LINE.right, LABELLED);
    expect(before.darkCount(inside, DARK)).toBeGreaterThan(0);

    // Dragged with the button held, so the page shows the gap before the release
    // saves the place: the words are drawn where the pointer left them, and the
    // shaft under them is already cut for them.
    const from = at({ x: 300, y: 139 }, LABELLED);
    await drag(ui, from, { x: from.x, y: from.y + 61 }, 'left', async () => {
      await settle(ui);
      const carrying = await shot(ui);
      expect(carrying.darkCount(inside, DARK)).toBe(0);
      expect(carrying.darkCount(left, DARK)).toBeGreaterThan(0);
      expect(carrying.darkCount(right, DARK)).toBeGreaterThan(0);
    });
    expect((await savedScene(ui, 'labelled.json')).elements[0]?.labelAt).toEqual({ t: 0.5, offset: 0 });

    // The saved words are the words on the page, drawn about the middle the save
    // wrote, and the page cut the shaft where they lie: nothing of it in the
    // strip of the gap no glyph reaches, its own ink just past the gap either
    // side. The selection's own ink goes before any of it is measured.
    const words = await savedWords(ui, 'labelled.svg', LABELLED);
    expect(words.text).toBe('moving');
    await browser.keyboard.press('Escape');
    const onLine = await shot(ui);
    const wordsInk = onPage(ON_THE_LINE_WORDS, LABELLED);
    expect(onLine.darkCount(inside, DARK)).toBe(0);
    expect(onLine.darkCount(left, DARK)).toBeGreaterThan(0);
    expect(onLine.darkCount(right, DARK)).toBeGreaterThan(0);
    const drawn = onLine.darkBounds(wordsInk, DARK);
    expect(drawn).not.toBeNull();
    expect(onLine.darkCount(wordsInk, DARK)).toBeGreaterThan(50);
    expect(Math.abs((drawn as Rect).x + (drawn as Rect).width / 2 - words.x)).toBeLessThan(2);
    expect((drawn as Rect).y).toBeLessThan(words.baseline);

    // A page that opens the Scene the save wrote draws the same gap: the cut is
    // the Scene's own, and not something the drag left on the page it drew. It
    // fits the Scene it opens, so the view this one lands in is its own.
    const saved = await savedFiles(ui);
    await openEditor(ui, { A: saved }, 'labelled.json');
    const reopened = await shot(ui);
    expect(reopened.darkCount(onPage(ON_THE_LINE.inside, OPENED), DARK)).toBe(0);
    expect(reopened.darkCount(onPage(ON_THE_LINE.left, OPENED), DARK)).toBeGreaterThan(0);
    expect(reopened.darkCount(onPage(ON_THE_LINE.right, OPENED), DARK)).toBeGreaterThan(0);

    // One more word, typed onto the row the words already lie on: the gap follows
    // them as they grow, before the Escape that saves the wider words. The strip
    // two units in from where their gap ended held the shaft's own ink while the
    // words were `moving`; with `moving on` it is gap, bare of everything.
    expect(reopened.darkCount(onPage(GROWN, OPENED), DARK)).toBeGreaterThan(0);
    await doubleClickScene(ui, { x: 300, y: 200 }, OPENED);
    const typing = screen.getByRole('textbox', { name: 'Label' });
    await expect(typing).toHaveValue('moving');
    await typing.pressSequentially(' on');
    await settle(ui);
    expect((await shot(ui)).darkCount(onPage(GROWN, OPENED), DARK)).toBe(0);
    await typing.press('Escape');
    expect((await savedScene(ui, 'labelled.json')).elements[0]?.label).toBe('moving on');

    // Pressing the words where they now lie takes them again, and not the shaft
    // under them: the line's own points are the ones it always had.
    await dragBy(ui, { x: 300, y: 200 }, 0, -61, OPENED);
    const placed = await savedScene(ui, 'labelled.json');
    expect(placed.elements[0]?.labelAt).toEqual({ t: 0.5, offset: 61 });
    expect(placed.elements[0]?.points).toEqual([
      { x: 100, y: 200 },
      { x: 500, y: 200 },
    ]);

    // And the shaft is whole again: the gap was where the words were, and they
    // have gone back to the side they sat on.
    await browser.keyboard.press('Escape');
    const after = await shot(ui);
    expect(after.darkCount(onPage(ON_THE_LINE.inside, OPENED), DARK)).toBeGreaterThan(0);
  });

  test('the words of a placed Label ride the shaft a Snapped Element moves', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'follow.json': FOLLOW_SOURCE } }, 'follow.json');

    // The words sit below the shaft, clear of both the box and the line.
    const words: Rect = { x: 600, y: 400, width: 200, height: 70 };
    const before = await shot(ui);
    const start = before.darkBounds(words, DARK);
    expect(start).not.toBeNull();

    // The box is carried 40px along the line it is Snapped to, so the outline the
    // end lands on moves with it: the shaft's start goes 40px on and its middle,
    // where the words are placed, goes half of that.
    await dragBy(ui, { x: 60, y: 300 }, 40, 0, FOLLOW);
    const scene = await savedScene(ui, 'follow.json');
    expect(scene.elements[0]?.x).toBe(70);
    expect(scene.elements[1]?.labelAt).toEqual({ t: 0.5, offset: -39 });
    expect(scene.elements[1]?.points).toEqual([
      { x: 100, y: 300, snap: 'box' },
      { x: 500, y: 300 },
    ]);

    await browser.keyboard.press('Escape');
    const after = await shot(ui);
    const moved = after.darkBounds(words, DARK);
    expect(moved).not.toBeNull();
    expect(Math.abs((moved as Rect).x - (start as Rect).x - 20)).toBeLessThan(1.5);
    expect(Math.abs((moved as Rect).y - (start as Rect).y)).toBeLessThan(1.5);
  });

  test('double-clicking a placed shaft Label types its words where they are', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'labelled.json': LABELLED_SOURCE } }, 'labelled.json');

    const words: Rect = { x: 560, y: 366, width: 180, height: 30 };
    const before = await shot(ui);
    const placed = before.darkCentre(words, DARK);
    expect(placed.count).toBeGreaterThan(50);

    await doubleClickScene(ui, { x: 300, y: 139 }, LABELLED);
    const label = screen.getByRole('textbox', { name: 'Label' });
    await expect(label).toHaveValue('moving');
    await label.pressSequentially(' on');
    const typing = await shot(ui);
    await label.press('Escape');

    const scene = await savedScene(ui, 'labelled.json');
    expect(scene.elements[0]?.label).toBe('moving on');
    // The words are edited where they are placed, not where Layout first put
    // them: the ink of the session is on the placed line — a hair above the
    // glyphs is the caret, and a line that moved would be worth 29 — and the
    // place Layout would have used, 42px lower, holds nothing at all.
    const written = typing.darkCentre({ x: 560, y: 366, width: 180, height: 30 }, DARK);
    expect(written.count).toBeGreaterThan(50);
    expect(Math.abs(written.y - placed.y)).toBeLessThan(2);
    expect(typing.darkCount({ x: 560, y: 400, width: 180, height: 30 }, DARK)).toBe(0);
    expect(scene.elements[0]?.labelAt).toEqual({ t: 0.5, offset: 61 });
  });

  test('undo takes a placed Label back to where it was, and redo puts it back', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'unplaced.json': UNPLACED_SOURCE } }, 'unplaced.json');

    const words: Rect = { x: 520, y: 340, width: 280, height: 70 };
    const before = await shot(ui);
    const start = before.darkBounds(words, DARK);
    expect(start).not.toBeNull();

    // The first placement: a Label the Scene never placed, taken where Layout put
    // it and carried 100px along the shaft and 30px to its side.
    await dragBy(ui, { x: 300, y: 182 }, 100, -30, UNPLACED);
    const placed = await savedScene(ui, 'unplaced.json');
    expect(placed.elements[0]?.labelAt?.t).toBe(0.75);

    // One undo takes the whole drag back: the Label is one the Scene never
    // placed, and no `labelAt` is left behind.
    await browser.keyboard.press('ControlOrMeta+z');
    const undone = await savedScene(ui, 'unplaced.json');
    expect(Object.hasOwn(undone.elements[0] ?? {}, 'labelAt')).toBe(false);
    // The selection's own ink is no part of the Scene: it goes before the page
    // is read, so the pixels that are compared are the words' alone.
    await browser.keyboard.press('Escape');
    const back = (await shot(ui)).darkBounds(words, DARK);
    expect(back).not.toBeNull();
    expect(Math.abs((back as Rect).x - (start as Rect).x)).toBeLessThan(1.5);
    expect(Math.abs((back as Rect).y - (start as Rect).y)).toBeLessThan(1.5);

    // Redo puts the same place back, and the ink with it.
    await browser.keyboard.press('ControlOrMeta+Shift+z');
    const again = await savedScene(ui, 'unplaced.json');
    expect(again.elements[0]?.labelAt).toEqual(placed.elements[0]?.labelAt);
    await browser.keyboard.press('Escape');
    const carried = (await shot(ui)).darkBounds(words, DARK);
    expect(carried).not.toBeNull();
    expect(Math.abs((carried as Rect).x - (start as Rect).x - 100)).toBeLessThan(1.5);
    expect(Math.abs((carried as Rect).y - (start as Rect).y + 30)).toBeLessThan(1.5);
  });

  test('a press where a higher shaft crosses a Label takes the shaft, not the words beneath it', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'overlap.json': OVERLAP_SOURCE } }, 'overlap.json');

    // The two arrows cross on the middle of the lower one's words: the upright
    // shaft's ink is drawn there, over the words it passes.
    await dragBy(ui, { x: 250, y: 240 }, 60, 0, OVERLAP);
    const scene = await savedScene(ui, 'overlap.json');
    // The higher shaft went with the press, both ends of it.
    expect(scene.elements[1]?.points).toEqual([
      { x: 310, y: 200 },
      { x: 310, y: 400 },
    ]);
    // The words under it kept their place, and the shaft they belong to kept its own.
    expect(scene.elements[0]?.labelAt).toEqual({ t: 0.5, offset: 60 });
    expect(scene.elements[0]?.points).toEqual([
      { x: 100, y: 300 },
      { x: 400, y: 300 },
    ]);
  });

  test('a press on the head a higher arrow draws through a Label takes that arrow, not the words', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'head.json': HEAD_OVER_SOURCE } }, 'head.json');

    // The heavier arrow arrives from below and its head is drawn through the
    // narrower one's words. Pressed 7px off that arrow's shaft, on the ink of the
    // head alone: nothing of the chord between its two ends reaches there.
    await dragBy(ui, { x: 243, y: 252.5 }, 40, 0, HEAD_OVER);
    const scene = await savedScene(ui, 'head.json');
    // The arrow whose head was pressed came with it, both of its ends.
    expect(scene.elements[1]?.points).toEqual([
      { x: 290, y: 340 },
      { x: 290, y: 235 },
    ]);
    // The words under the head kept their place, and the shaft they belong to its own.
    expect(scene.elements[0]?.labelAt).toEqual({ t: 0.5, offset: 60 });
    expect(scene.elements[0]?.points).toEqual([
      { x: 100, y: 300 },
      { x: 400, y: 300 },
    ]);
  });

  test('a press on a rear Label under the empty chord of a bent shaft takes the words', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'chord.json': CHORD_SOURCE } }, 'chord.json');

    // The bent line's ends lie either side of the words and its one bend is 150px
    // above them: the chord between the ends runs through the words' middle, and
    // the ink the page draws is nowhere near it.
    await dragBy(ui, { x: 300, y: 300 }, 60, 0, CHORD);
    const scene = await savedScene(ui, 'chord.json');
    // The words went with the press, 60px along the shaft they belong to.
    expect(scene.elements[0]?.labelAt).toEqual({ t: 0.65, offset: 40 });
    // The bent line kept every point it draws through, the bend between its ends included.
    expect(scene.elements[1]?.points).toEqual([
      { x: 100, y: 300 },
      { x: 300, y: 150 },
      { x: 500, y: 300 },
    ]);
  });

  test('dragging a bent shaft carries every point it draws through, not just its ends', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'chord.json': CHORD_SOURCE } }, 'chord.json');

    // Pressed on the ink at the bend, 150px clear of the words below it.
    await dragBy(ui, { x: 300, y: 150 }, 40, 20, CHORD);
    const scene = await savedScene(ui, 'chord.json');
    // The bend came with the move: a straight line between the ends would have
    // dropped it, and the Scene would keep a shape the press never took.
    expect(scene.elements[1]?.points).toEqual([
      { x: 140, y: 320 },
      { x: 340, y: 170 },
      { x: 540, y: 320 },
    ]);
    // The words keep the place on their own shaft that they had.
    expect(scene.elements[0]?.labelAt).toEqual({ t: 0.5, offset: 40 });
  });

  test('a selected shaft offers the grab on its words, and nowhere the words are not', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'labelled.json': LABELLED_SOURCE } }, 'labelled.json');

    // A press on the shaft selects it: from then on its words are something a
    // press can carry, and the pointer over them says so.
    await clickScene(ui, { x: 150, y: 200 }, [], LABELLED);
    const words = at({ x: 300, y: 139 }, LABELLED);
    await browser.mouse.move(words.x, words.y);
    expect(await cursorAt(words)).toBe('grab');

    // A pixel off them, inside the dashed mark that says where they are, a press
    // would grab nothing: the mark says where, and the words are what is taken.
    const beside = at({ x: 300, y: 124 }, LABELLED);
    await browser.mouse.move(beside.x, beside.y);
    expect(await cursorAt(beside)).not.toBe('grab');

    // A drag from where the grab showed carries the words: 20px further to the
    // side they already sit on, with the fraction along their shaft unchanged.
    await browser.mouse.move(words.x, words.y);
    await browser.mouse.down();
    await browser.mouse.move(words.x, words.y - 20);
    await browser.mouse.up();
    expect((await savedScene(ui, 'labelled.json')).elements[0]?.labelAt).toEqual({
      t: 0.5,
      offset: 81,
    });
  });

  test("a wheel zoom under a held Label does not turn two pixels into a drag", async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'labelled.json': LABELLED_SOURCE } }, 'labelled.json');
    const before = await savedFiles(ui);

    // The words taken by their middle, and then the wheel zooms the page under
    // the pointer without moving it: the press the zoom drops would have paired
    // with a click, and the slop the words answer to is the press's own either way.
    const from = at({ x: 300, y: 139 }, LABELLED);
    await browser.mouse.move(from.x, from.y);
    await browser.mouse.down();
    await browser.mouse.wheel(0, -240);
    await browser.mouse.move(from.x + 2, from.y);
    await browser.mouse.up();
    await settle(ui);

    // Two pixels is inside the click's own slop: the words never left their place,
    // so the release has nothing to save.
    expect(await savedFiles(ui)).toEqual(before);
  });

  test('a Label dragged after the shaft moved and reshaped keeps to the side the page draws', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'tilted.json': TILTED_SOURCE } }, 'tilted.json');

    // A move carries the fraction of a pixel the pointer gave it, and a reshape
    // rounds only the end it takes: the ends are a fifth of a pixel apart, and
    // the page rounds both, so it draws the shaft straight up with the words
    // left of it.
    await dragBy(ui, { x: 200, y: 320 }, 30.4, 0, TILTED);
    await dragBy(ui, { x: 230, y: 120 }, 0, -20, TILTED);
    expect((await savedScene(ui, 'tilted.json')).elements[0]?.points).toEqual([
      { x: 230, y: 100 },
      { x: 230, y: 420 },
    ]);

    // The words the save writes, read off the `<text>` it draws them as: they
    // are drawn about their own middle, sixty pixels to the side of the upright
    // shaft at page 710. The selection's own outline is no part of either.
    const placed = await savedWords(ui, 'tilted.svg', TILTED);
    expect(placed.text).toBe('tilted');
    expect(Math.abs(placed.x - 650)).toBeLessThan(1.5);

    // Taken by their middle, so the hold the press took is no part of the move.
    await dragBy(ui, { x: 170, y: 260 }, -20, 0, TILTED);

    // Twenty pixels further from the shaft, and not across it: the side is the
    // one the ink showed, so the offset grows where the words went.
    const scene = await savedScene(ui, 'tilted.json');
    expect(scene.elements[0]?.labelAt).toEqual({ t: 0.5, offset: 80 });
    // The place the Label was put is the only change: the drag writes no
    // endpoints of its own.
    expect(scene.elements[0]?.points).toEqual([
      { x: 230, y: 100 },
      { x: 230, y: 420 },
    ]);

    const carried = await savedWords(ui, 'tilted.svg', TILTED);
    expect(Math.abs(carried.x - placed.x + 20)).toBeLessThan(1.5);

    // Nothing of the words went to the other side of the shaft: the page between
    // them and the upright at page 710 holds no ink at all. The selection's own
    // ink goes first, so what is read is the Scene's.
    await browser.keyboard.press('Escape');
    const after = await shot(ui);
    expect(after.darkCount({ x: 660, y: 378, width: 44, height: 18 }, DARK)).toBe(0);

    // And the ink is where the save wrote the words: the words did not stay
    // behind on the side they were taken from.
    const drawn = after.darkBounds({ x: carried.x - 40, y: 372, width: 80, height: 30 }, DARK);
    expect(drawn).not.toBeNull();
    expect(Math.abs((drawn as Rect).x + (drawn as Rect).width / 2 - carried.x)).toBeLessThan(6);
  });

  test('a selected shaft marks its Label as something a press can carry, and only while it is selected', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'labelled.json': LABELLED_SOURCE } }, 'labelled.json');

    // The rule the words are marked with runs under the box they paint, clear of
    // the glyphs above it and of the shaft below: the only ink that can be in
    // this band is a mark on the words themselves.
    const under: Rect = { x: 610, y: 392, width: 60, height: 3 };
    expect((await shot(ui)).darkCount(under, DARK)).toBe(0);

    // A press on the shaft selects it, and the selection says the words can be
    // taken on their own.
    await clickScene(ui, { x: 150, y: 200 }, [], LABELLED);
    await settle(ui);
    expect((await shot(ui)).darkCount(under, DARK)).toBeGreaterThan(10);

    // It belongs to the selection: with the selection gone, so is the mark.
    await browser.keyboard.press('Escape');
    expect((await shot(ui)).darkCount(under, DARK)).toBe(0);
  });

  test("a nudge inside the click's own slop moves no Label, and the click still pairs", async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'labelled.json': LABELLED_SOURCE } }, 'labelled.json');
    const before = await savedFiles(ui);

    // A press on the words that carries the pointer two pixels: too little to be
    // a drag, and little enough that the press is still a click.
    const from = at({ x: 300, y: 139 }, LABELLED);
    await browser.mouse.move(from.x, from.y);
    await browser.mouse.down();
    await browser.mouse.move(from.x + 2, from.y);
    await browser.mouse.up();

    // The next press in the same place pairs with it, and opens the words.
    await browser.mouse.move(from.x, from.y);
    await browser.mouse.down();
    await browser.mouse.up();
    const label = screen.getByRole('textbox', { name: 'Label' });
    await expect(label).toHaveValue('moving');
    await label.press('Escape');

    // Nothing was placed: a press that never left the click's own slop is no drag,
    // so the words are the Scene's own and the file is the file.
    await settle(ui);
    expect(await savedFiles(ui)).toEqual(before);
  });

  test('Escape drops a Label drag in flight instead of saving it on the release', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'labelled.json': LABELLED_SOURCE } }, 'labelled.json');
    const before = await savedFiles(ui);

    const from = at({ x: 300, y: 139 }, LABELLED);
    await browser.mouse.move(from.x, from.y);
    await browser.mouse.down();
    await browser.mouse.move(from.x + 60, from.y - 20);
    await settle(ui);
    // Room the words reach only while they are where the pointer took them: the
    // Scene's own place is behind them, and the selection's edges are outside.
    const dragged: Rect = { x: 676, y: 360, width: 60, height: 30 };
    expect((await shot(ui)).darkCount(dragged, DARK)).toBeGreaterThan(20);

    // Escape is the person saying no: the words go back to the place the Scene
    // holds, and the release that follows settles nothing.
    await browser.keyboard.press('Escape');
    await browser.mouse.up();
    await settle(ui);
    expect((await shot(ui)).darkCount(dragged, DARK)).toBe(0);
    expect(await savedFiles(ui)).toEqual(before);
  });

  test('a page that may no longer write drops the Label drag it was carrying', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'labelled.json': LABELLED_SOURCE } }, 'labelled.json');

    // An earlier edit's write is held at the disk, so its answer — a refusal —
    // can arrive while the words are in the air.
    await holdWrites(ui, 'labelled.json');
    await clickScene(ui, { x: 150, y: 200 }, [], LABELLED);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect(screen.getByRole('status')).toHaveText('saving…');

    // The words, ten pixels on with the shaft and taken from their middle.
    const from = at({ x: 310, y: 139 }, LABELLED);
    await browser.mouse.move(from.x, from.y);
    await browser.mouse.down();
    await browser.mouse.move(from.x + 60, from.y);
    await settle(ui);
    const dragged: Rect = { x: 690, y: 362, width: 50, height: 28 };
    expect((await shot(ui)).darkCount(dragged, DARK)).toBeGreaterThan(20);

    // The folder refuses the write it was holding: the page may only read now, so
    // the drag it was carrying goes, with the preview it painted.
    await refuseWrite(ui, 'this folder is served read-only');
    await expect(screen.getByText('read-only')).toBeVisible();
    await browser.mouse.up();
    const after = await shot(ui);
    expect(after.darkCount(dragged, DARK)).toBe(0);
    // The words are back where the Scene holds them, ten pixels on with the shaft.
    expect(after.darkCount({ x: 620, y: 362, width: 55, height: 28 }, DARK)).toBeGreaterThan(20);
    // Nothing of the drag reached the file, and neither did the edit it refused.
    expect((await savedFiles(ui))['labelled.json']).toBe(LABELLED_SOURCE);
  });

  test('a Label dragged on a shaft with no length keeps the fraction along it', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'point.json': POINT_SOURCE } }, 'point.json');

    // Up and away from the point, so the distance to its side grows: there is no
    // direction to move along, and the fraction the Scene wrote stays as it was
    // rather than being erased by a shaft that has nothing to travel.
    await dragBy(ui, { x: 300, y: 140 }, 0, -20, POINT);
    const scene = await savedScene(ui, 'point.json');
    expect(scene.elements[0]?.labelAt).toEqual({ t: 0.5, offset: 80 });
  });

  test('a Label dragged past the end of its shaft stops at the end, and stays to its side', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'labelled.json': LABELLED_SOURCE } }, 'labelled.json');

    // The words are taken by their middle and carried far past the arrow's own
    // end: what a drag can write stops at the end of the shaft it rides, and the
    // distance to the side is the pointer's alone.
    await dragBy(ui, { x: 300, y: 139 }, 500, 0, LABELLED);
    const scene = await savedScene(ui, 'labelled.json');
    expect(scene.elements[0]?.labelAt).toEqual({ t: 1, offset: 61 });
  });

  test('a Label dragged left of an upright shaft keeps the side the ink shows, and the distance', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'beside.json': BESIDE_SOURCE } }, 'beside.json');

    // The words sit left of the upright shaft, where Layout puts them. Thirty
    // pixels further left is thirty more to that side: a positive offset is the
    // side the ink is on, and the fraction along the shaft is its middle.
    await dragBy(ui, { x: 287, y: 220 }, -30, 0, BESIDE);
    const scene = await savedScene(ui, 'beside.json');
    expect(scene.elements[0]?.labelAt).toEqual({ t: 0.5, offset: 43 });

    // The ink went with the words: all of it left of the shaft it belongs to.
    await browser.keyboard.press('Escape');
    const after = await shot(ui);
    expect(after.darkCount({ x: 560, y: 380, width: 80, height: 40 }, DARK)).toBeGreaterThan(20);
    expect(after.darkCount({ x: 660, y: 380, width: 80, height: 40 }, DARK)).toBe(0);
  });

  test('a press where a placed Label no longer sits finds bare paper, and moves nothing', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await openEditor(ui, { A: { 'labelled.json': LABELLED_SOURCE } }, 'labelled.json');
    const before = await savedFiles(ui);

    // The place Layout would put the words — a little above the shaft — is not
    // where they are: the Scene put them 61 pixels to the side, and a press on
    // bare paper sweeps a box and takes nothing.
    await dragBy(ui, { x: 300, y: 170 }, 40, 0, LABELLED);
    await settle(ui);
    expect(await savedFiles(ui)).toEqual(before);
  });
});
