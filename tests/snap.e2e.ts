/**
 * Seam 2: Snap, the arrow or line end attached to an Element.
 *
 * Same rules as the editor suites (`tests/editor-*.e2e.ts`): the input is a
 * person's — the rail, the
 * pointer, the keys, the Alt held down during a drag — and the assertion is the
 * Scene the editor saves. A Snap is stored per end, so the saved `points` are
 * where attaching, freeing and following an Element is visible without reading
 * the editor's state or a path number.
 *
 * No test here uses the model, so `pnpm e2e` still passes with no key set; the
 * one outcome pixels have to show — the target highlighted under a dragged end
 * — is judged in `tests/visual.e2e.ts`.
 */
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  CROSSING,
  CROSSING_SCENE,
  HYPHEN_SCENE,
  MIXED,
  MIXED_SCENE,
  SNAP,
  SNAP_SCENE,
  SNAPPED,
  SNAPPED_SCENE,
  at,
  cliCheckBytes,
  clickScene,
  drag,
  dragBy,
  openEditor,
  savedFiles,
  savedScene,
  settle,
} from './helpers.ts';
import type { Point, SavedScene, Ui, View } from './helpers.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';

const SNAP_SOURCE = JSON.stringify(SNAP_SCENE, null, 2);
const SNAPPED_SOURCE = JSON.stringify(SNAPPED_SCENE, null, 2);
const HYPHEN_SOURCE = JSON.stringify(HYPHEN_SCENE, null, 2);
const CROSSING_SOURCE = JSON.stringify(CROSSING_SCENE, null, 2);

/**
 * A bent arrow between two boxes: three points, both ends Snapped and the bend
 * between them written `sharp`. Roughness 0, so the ends it draws at are the
 * ones the numbers below say: `a`'s outline puts the start at (100,90), `b`'s
 * the end at (500,90), and the bend sits at (300,250) whichever way it is read.
 */
const BENT_SCENE = {
  version: 1,
  title: 'Bent',
  defaults: { roughness: 0 },
  elements: [
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 },
    { id: 'b', type: 'rectangle', x: 500, y: 0, width: 100, height: 100 },
    {
      id: 'c',
      type: 'arrow',
      points: [
        { x: 50, y: 50, snap: 'a' },
        { x: 300, y: 250, corner: 'sharp' },
        { x: 550, y: 50, snap: 'b' },
      ],
      heads: { start: 'none', end: 'arrow' },
    },
  ],
};
const BENT_SOURCE = JSON.stringify(BENT_SCENE, null, 2);

/** The view `BENT_SCENE` lands in, worked out the same way as `VIEW`. */
const BENT: View = { zoom: 1, panX: 340, panY: 275 };

/** Where `c` starts: the point of `a`'s outline its first point is drawn on. */
const BENT_START = { x: 100, y: 90 };

/** Where `c` finishes: the point of `b`'s outline its last point is drawn on. */
const BENT_END = { x: 500, y: 90 };

/** A point on `c`'s first run, on no box: where a press on the shaft lands. */
const BENT_ON = { x: 200, y: 170 };

/**
 * A loop: an arrow that leaves an ellipse and comes back to it, both ends
 * Snapped to the same Element, which only a shaft of three points can do. The
 * ends spread either side of the one bend, on the circle the ellipse draws.
 */
const LOOP_SCENE = {
  version: 1,
  title: 'Loop',
  defaults: { roughness: 0 },
  elements: [
    { id: 'oval', type: 'ellipse', x: 300, y: 40, width: 120, height: 120 },
    {
      id: 'back',
      type: 'arrow',
      points: [
        { x: 360, y: 140, snap: 'oval' },
        { x: 360, y: 320, corner: 'sharp' },
        { x: 360, y: 60, snap: 'oval' },
      ],
      heads: { start: 'none', end: 'arrow' },
    },
  ],
};
const LOOP_SOURCE = JSON.stringify(LOOP_SCENE, null, 2);

/** The view `LOOP_SCENE` lands in, worked out the same way as `VIEW`. */
const LOOP: View = { zoom: 1, panX: 280, panY: 220 };

/** Where the loop's second end draws: one of the two outline points it spreads to. */
const LOOP_END = { x: 402, y: 142 };

/** A point on the loop's reach down to the bend, on no Element: where a press selects it. */
const LOOP_ON = { x: 339, y: 231 };

/**
 * A bent arrow on its own, its ends free: the shaft a copy is made of without
 * the Snap a fragment cannot carry. Its own corners are `round` while the bend
 * is written `sharp`, so the corner that survives a copy is the point's own and
 * not the Element's.
 */
const BENT_FREE_SCENE = {
  version: 1,
  title: 'Bent free',
  defaults: { roughness: 0 },
  elements: [
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 },
    {
      id: 'c',
      type: 'arrow',
      corners: 'round',
      points: [
        { x: 50, y: 50 },
        { x: 300, y: 250, corner: 'sharp' },
        { x: 550, y: 50 },
      ],
      heads: { start: 'none', end: 'arrow' },
    },
  ],
};
const BENT_FREE_SOURCE = JSON.stringify(BENT_FREE_SCENE, null, 2);

/** The view `BENT_FREE_SCENE` lands in, worked out the same way as `VIEW`. */
const BENT_FREE: View = { zoom: 1, panX: 365, panY: 275 };

/** A point on the free arrow's first run, on no box: where a press selects it. */
const BENT_FREE_ON = { x: 175, y: 150 };

/**
 * The saved Scene, and `ez check`'s word that the file it was saved as parses:
 * a Snap naming a target that is not in the Scene, or a `corner` on an end, is
 * a Scene the editor can write and cannot read back.
 */
async function savedAndChecked(ui: Ui, name: string): Promise<SavedScene> {
  const scene = await savedScene(ui, name);
  const checked = await cliCheckBytes((await savedFiles(ui))[name] ?? '');
  expect(checked.code, checked.reported).toBe(0);
  return scene;
}

/** The Scene files the `snap.json` fixture folder holds, by the name a person opens. */
const SCENES = {
  A: {
    'snap.json': SNAP_SOURCE,
    'snapped.json': SNAPPED_SOURCE,
    'hyphen.json': HYPHEN_SOURCE,
    'crossing.json': CROSSING_SOURCE,
    'bent.json': BENT_SOURCE,
    'bentfree.json': BENT_FREE_SOURCE,
    'loop.json': LOOP_SOURCE,
  },
};

/** A spot on the empty canvas, clear of the box and of the line. */
const PAPER = { x: 60, y: 200 };

/** Inside `post`, and a little off its middle so the drop is not a stored centre. */
const IN_POST = { x: 360, y: 100 };

/** The free end of `tie`, where its end handle is. */
const TIE_END = { x: 300, y: 80 };

/**
 * A patch of `post`'s face, on the page, clear of its own stroke, of the
 * selection and of anything else painted there: the highlight's wash covers it.
 */
const POST_FACE: Rect = { x: 730, y: 380, width: 80, height: 40 };

/** A spot inside the second box of `snapped.json`, level with `link`'s end. */
const IN_TO = { x: 330, y: 80 };

/**
 * A drag that holds Alt over the moves and lets it go with the pointer still on
 * the drop, then releases: the release, not the last move, decides the attach.
 */
async function dragThenLetGoOfAlt(ui: Ui, from: Point, to: Point): Promise<void> {
  await ui.browser.mouse.move(from.x, from.y);
  await ui.browser.keyboard.down('Alt');
  await ui.browser.mouse.down();
  for (let step = 1; step <= 5; step += 1) {
    const share = step / 5;
    await ui.browser.mouse.move(from.x + (to.x - from.x) * share, from.y + (to.y - from.y) * share);
  }
  await ui.browser.keyboard.up('Alt');
  await ui.browser.mouse.up();
}

/** Open the Snap fixture: the box `post`, and the free line `tie`. */
async function open(ui: Ui, name = 'snap.json'): Promise<void> {
  await openEditor(ui, SCENES, name);
}

/** A point within a tolerance of where a drawn path reaches: whole-pixel ink. */
function reaches(point: Point, expected: Point, tolerance = 0.5): boolean {
  return Math.abs(point.x - expected.x) <= tolerance && Math.abs(point.y - expected.y) <= tolerance;
}

/** Every path's drawn points, in document order: where each move, line and curve ends. */
function drawnPaths(svg: string): Point[][] {
  // check-rules: markup of a written SVG file, not the page
  return [...svg.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].map((match) => {
    const points: Point[] = [];
    for (const [, command = '', args = ''] of (match[1] ?? '').matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
      const numbers = (args.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      if (command === 'A') {
        points.push({ x: numbers[5] ?? 0, y: numbers[6] ?? 0 });
        continue;
      }
      if (command !== 'M' && command !== 'L' && command !== 'C') {
        continue;
      }
      const last = numbers.length - 2;
      points.push({ x: numbers[last] ?? 0, y: numbers[last + 1] ?? 0 });
    }
    return points;
  });
}

/** Select the line `tie` by its shaft and drag its end onto `post`. */
async function tieToPost(ui: Ui): Promise<void> {
  await clickScene(ui, { x: 180, y: 80 }, [], SNAP);
  await drag(ui, at(TIE_END, SNAP), at({ x: 330, y: 100 }, SNAP));
}

describe('an end drawn onto an Element', () => {
  test('an arrow drawn onto a box saves that end attached to it', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await browser.keyboard.press('a');
    await drag(ui, at(PAPER, SNAP), at(IN_POST, SNAP));

    const scene = await savedScene(ui, 'snap.json');
    expect(scene.elements.map((element) => element.type)).toEqual(['rectangle', 'line', 'arrow']);
    expect(scene.elements[2]?.points).toEqual([
      { x: PAPER.x, y: PAPER.y },
      { x: IN_POST.x, y: IN_POST.y, snap: 'post' },
    ]);
  });

  test('Alt held over the drop leaves the end free', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await browser.keyboard.press('a');
    await browser.keyboard.down('Alt');
    await drag(ui, at(PAPER, SNAP), at(IN_POST, SNAP));
    await browser.keyboard.up('Alt');

    const scene = await savedScene(ui, 'snap.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: PAPER.x, y: PAPER.y },
      { x: IN_POST.x, y: IN_POST.y },
    ]);
  });

  test('Alt let go over the drop attaches, even with no move after it', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await browser.keyboard.press('a');
    await dragThenLetGoOfAlt(ui, at(PAPER, SNAP), at(IN_POST, SNAP));

    const scene = await savedScene(ui, 'snap.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: PAPER.x, y: PAPER.y },
      { x: IN_POST.x, y: IN_POST.y, snap: 'post' },
    ]);
  });

  test('a drawn arrow is one change: the note names its Snap at once', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await browser.keyboard.press('a');
    await drag(ui, at(PAPER, SNAP), at(IN_POST, SNAP));

    // The draw settled through the one change hook, so the note the new arrow
    // is selected under already knows what its end is attached to.
    await expect(screen.getByRole('button', { name: 'Detach: end' })).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Detach: start' })).toBeHidden();

    // And one undo takes the whole draw back.
    await browser.keyboard.press('Meta+z');
    const scene = await savedScene(ui, 'snap.json');
    expect(scene.elements.map((element) => element.id)).toEqual(['post', 'tie']);
  });
});

describe('moving an end that already exists', () => {
  test('dragging an end handle onto a box attaches that end', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await tieToPost(ui);

    const scene = await savedScene(ui, 'snap.json');
    expect(scene.elements[1]?.points).toEqual([
      { x: 60, y: 80 },
      { x: 330, y: 100, snap: 'post' },
    ]);
  });

  test('dragging an attached end off its box frees it where it was dropped', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');

    // `link` is attached at both ends; its end handle sits where it draws, on
    // the right-hand box's outline.
    await clickScene(ui, { x: 230, y: 80 }, [], SNAPPED);
    await drag(ui, at({ x: 300, y: 80 }, SNAPPED), at({ x: 280, y: 140 }, SNAPPED));

    const scene = await savedScene(ui, 'snapped.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 160, y: 80, snap: 'from' },
      { x: 280, y: 140 },
    ]);
  });

  test('Alt-clicking an attached end handle changes nothing', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');
    await clickScene(ui, { x: 230, y: 80 }, [], SNAPPED);
    await expect(screen.getByRole('button', { name: 'Detach: end' })).toBeVisible();

    // A press and release that moved nothing is a click, not a drag: it must
    // not free the end, however Alt is held.
    const handle = at({ x: 300, y: 80 }, SNAPPED);
    await browser.keyboard.down('Alt');
    await browser.mouse.move(handle.x, handle.y);
    await browser.mouse.down();
    await browser.mouse.up();
    await browser.keyboard.up('Alt');

    await expect(screen.getByRole('button', { name: 'Detach: end' })).toBeVisible();
    const scene = await savedScene(ui, 'snapped.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 160, y: 80, snap: 'from' },
      { x: 300, y: 80, snap: 'to' },
    ]);
  });

  test('a handle grabbed off centre picks its target by the pointer', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await clickScene(ui, { x: 180, y: 80 }, [], SNAP);

    // The drop is inside `post`, but this grab is 2 px to the right of the end,
    // so the endpoint the drag carries lands at (299,100): a pixel outside the
    // box. The pointer at (301,100) is inside it, and the pointer decides.
    await drag(ui, at({ x: 302, y: 80 }, SNAP), at({ x: 301, y: 100 }, SNAP));

    const scene = await savedScene(ui, 'snap.json');
    expect(scene.elements[1]?.points).toEqual([
      { x: 60, y: 80 },
      { x: 299, y: 100, snap: 'post' },
    ]);
  });

  test('a drag that comes back to its start still settles, and Alt frees the end', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');
    await clickScene(ui, { x: 230, y: 80 }, [], SNAPPED);

    // Away onto the paper and back again: the release moved nothing, but the
    // gesture did, so it is a drag and Alt at the release frees the end.
    const handle = at({ x: 300, y: 80 }, SNAPPED);
    const away = at({ x: 260, y: 140 }, SNAPPED);
    await browser.mouse.move(handle.x, handle.y);
    await browser.mouse.down();
    await browser.mouse.move(away.x, away.y);
    await browser.mouse.move(handle.x, handle.y);
    await browser.keyboard.down('Alt');
    await browser.mouse.up();
    await browser.keyboard.up('Alt');

    const scene = await savedScene(ui, 'snapped.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 160, y: 80, snap: 'from' },
      { x: 300, y: 80 },
    ]);
  });

  test('a release that changes nothing still clears the highlight', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');
    await clickScene(ui, { x: 230, y: 80 }, [], SNAPPED);
    const rest = (await shot(ui)).meanLuminance(POST_FACE);

    // The end is dragged over the box it is already attached to and back to
    // where it was: the Scene the release settles is the Scene it started with.
    const [from, over] = [at({ x: 300, y: 80 }, SNAPPED), at(IN_TO, SNAPPED)];
    await browser.mouse.move(from.x, from.y);
    await browser.mouse.down();
    await browser.mouse.move(over.x, over.y);
    await expect
      .poll(async () => (await shot(ui)).meanLuminance(POST_FACE))
      .toBeLessThan(rest - 0.02);
    await browser.mouse.move(from.x, from.y);
    await browser.mouse.up();

    // The box is its own colour again, and nothing was written.
    await expect
      .poll(async () => (await shot(ui)).meanLuminance(POST_FACE))
      .toBeGreaterThan(rest - 0.005);
    const scene = await savedScene(ui, 'snapped.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 160, y: 80, snap: 'from' },
      { x: 300, y: 80, snap: 'to' },
    ]);
  });

  test('the menu names what each end is attached to, and Detach frees it as one step', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');

    await clickScene(ui, { x: 230, y: 80 }, [], SNAPPED);
    await expect(screen.getByRole('button', { name: 'Detach: start' })).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Detach: end' })).toBeVisible();

    await screen.getByRole('button', { name: 'Detach: start' }).click();

    const scene = await savedScene(ui, 'snapped.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 160, y: 80 },
      { x: 300, y: 80, snap: 'to' },
    ]);

    // One undo takes the detach back, and nothing else with it.
    await browser.keyboard.press('Meta+z');
    const undone = await savedScene(ui, 'snapped.json');
    expect(undone.elements[2]?.points).toEqual([
      { x: 160, y: 80, snap: 'from' },
      { x: 300, y: 80, snap: 'to' },
    ]);
  });
});

describe('an attached end follows its Element', () => {
  test('a Snapped end follows its box when the box moves, and lands on its outline', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await tieToPost(ui);

    // The box moves; the line's own ends are not rewritten, because where they
    // draw is the Element's business.
    await dragBy(ui, IN_POST, 60, 0, SNAP);
    const moved = await savedScene(ui, 'snap.json');
    expect(moved.elements[0]?.x).toBe(360);
    expect(moved.elements[1]?.points).toEqual([
      { x: 60, y: 80 },
      { x: 330, y: 100, snap: 'post' },
    ]);

    // Freed, the end is stored where it drew: the moved box's left edge, level
    // with the other end, which is the outline point the Renderer uses.
    await clickScene(ui, { x: 100, y: 80 }, [], SNAP);
    await screen.getByRole('button', { name: 'Detach: end' }).click();
    const freed = await savedScene(ui, 'snap.json');
    expect(freed.elements[1]?.points).toEqual([
      { x: 60, y: 80 },
      { x: 360, y: 80 },
    ]);
  });

  test('the end follows the box under the pointer, before the release', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');

    // The press selects `from`, and the moves carry it down and right. The
    // release has not happened: this is the frame a person is looking at.
    const centre = at({ x: 100, y: 80 }, SNAPPED);
    const landing = at({ x: 160, y: 200 }, SNAPPED);
    await browser.mouse.move(centre.x, centre.y);
    await browser.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await browser.mouse.move(
        centre.x + ((landing.x - centre.x) * step) / 6,
        centre.y + ((landing.y - centre.y) * step) / 6,
      );
    }
    await settle(ui);

    // `link` still runs out of `from` and into `to`. With the box at 100,160 the
    // shaft leaves the box's right edge at about (220,164) and reaches `to` at
    // (300,116), so its middle is at (260,140) — the page's (670,460) — and the
    // shaft's old place, level with the box's stored end, is bare paper.
    const drawn = await shot(ui);
    expect(drawn.darkCount({ x: 655, y: 448, width: 30, height: 22 }, 0.6)).toBeGreaterThan(0);
    expect(drawn.darkCount({ x: 610, y: 392, width: 20, height: 16 }, 0.6)).toBe(0);

    // The release writes the box where it landed, and the ends it carries are
    // still the ones the Scene stored: the drawing followed, the Scene did not.
    await browser.mouse.up();
    const scene = await savedScene(ui, 'snapped.json');
    expect({ x: scene.elements[0]?.x, y: scene.elements[0]?.y }).toEqual({ x: 100, y: 160 });
    expect(scene.elements[2]?.points).toEqual([
      { x: 160, y: 80, snap: 'from' },
      { x: 300, y: 80, snap: 'to' },
    ]);
  });

  test('a Snapped end follows its box when the box is resized', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await tieToPost(ui);

    // The box's west handle drags its outline in by 40: the end rides the edge.
    await clickScene(ui, IN_POST, [], SNAP);
    await dragBy(ui, TIE_END, 40, 0, SNAP);
    const resized = await savedScene(ui, 'snap.json');
    expect({ x: resized.elements[0]?.x, width: resized.elements[0]?.width }).toEqual({
      x: 340,
      width: 80,
    });

    await clickScene(ui, { x: 100, y: 80 }, [], SNAP);
    await screen.getByRole('button', { name: 'Detach: end' }).click();
    const freed = await savedScene(ui, 'snap.json');
    expect(freed.elements[1]?.points).toEqual([
      { x: 60, y: 80 },
      { x: 340, y: 80 },
    ]);
  });

  test('deleting a target freezes the end where it drew, then drops the Snap', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await tieToPost(ui);

    // The box moves right; the attached end rides its left edge, at x 360.
    await dragBy(ui, IN_POST, 60, 0, SNAP);

    // Deleting the box leaves the end where the eye last saw it, not at the
    // place it was stored when it attached.
    await browser.keyboard.press('Delete');
    const scene = await savedScene(ui, 'snap.json');
    expect(scene.elements.map((element) => element.id)).toEqual(['tie']);
    expect(scene.elements[0]?.points).toEqual([
      { x: 60, y: 80 },
      { x: 360, y: 80 },
    ]);
  });
});

describe('the note follows the Scene', () => {
  test('undo puts a freed end\'s Detach button back', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');

    await clickScene(ui, { x: 230, y: 80 }, [], SNAPPED);
    await screen.getByRole('button', { name: 'Detach: start' }).click();
    await expect(screen.getByRole('button', { name: 'Detach: start' })).toBeHidden();

    // The history took the Snap back, so the note has to say what the Scene says.
    await browser.keyboard.press('Meta+z');
    await expect(screen.getByRole('button', { name: 'Detach: start' })).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Detach: end' })).toBeVisible();
  });

  test('detaching an end attached to an Element named `-` updates the rows', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'hyphen.json');

    await clickScene(ui, { x: 230, y: 80 }, [], SNAPPED);
    await expect(screen.getByRole('button', { name: 'Detach: start' })).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Detach: end' })).toBeVisible();

    // An id is a name, `-` included: freeing that end is a different note.
    await screen.getByRole('button', { name: 'Detach: start' }).click();
    await expect(screen.getByRole('button', { name: 'Detach: start' })).toBeHidden();
    await expect(screen.getByRole('button', { name: 'Detach: end' })).toBeVisible();

    const scene = await savedScene(ui, 'hyphen.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 160, y: 80 },
      { x: 300, y: 80, snap: 'to' },
    ]);
  });
});

describe('which Element is under the pointer', () => {
  test('an ellipse is a target inside its outline, not inside its box', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    // `oval` is an ellipse from (60,60) to (180,160): the corner of that box is
    // paper, well outside the curve.
    await openEditor(ui, { A: { 'mixed.json': JSON.stringify(MIXED_SCENE, null, 2) } }, 'mixed.json');

    await browser.keyboard.press('a');
    await drag(ui, at({ x: 300, y: 300 }, MIXED), at({ x: 60, y: 60 }, MIXED));
    const corner = await savedScene(ui, 'mixed.json');
    expect(corner.elements[3]?.points).toEqual([
      { x: 300, y: 300 },
      { x: 60, y: 60 },
    ]);

    // The middle of the ellipse is inside it, so that drop attaches.
    await browser.keyboard.press('a');
    await drag(ui, at({ x: 300, y: 300 }, MIXED), at({ x: 120, y: 110 }, MIXED));
    const inside = await savedScene(ui, 'mixed.json');
    expect(inside.elements[4]?.points).toEqual([
      { x: 300, y: 300 },
      { x: 120, y: 110, snap: 'oval' },
    ]);
  });
});

describe('two targets that cross', () => {
  test('the drawn shaft enters the target, and is not a stub', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'crossing.json');

    // An arrow from the middle of the horizontal bar to the middle of the
    // vertical one: its end snaps to `post`, and its start is free where it drew.
    await browser.keyboard.press('a');
    await drag(ui, at({ x: 20, y: 50 }, CROSSING), at({ x: 50, y: 50 }, CROSSING));

    // The free start handle sits where the start drew; drag it onto `bar`, so
    // both ends are Snapped and the pair is the crossed one.
    await drag(ui, at({ x: 20, y: 50 }, CROSSING), at({ x: 10, y: 50 }, CROSSING));

    const scene = await savedScene(ui, 'crossing.json');
    expect(scene.elements.map((element) => element.type)).toEqual([
      'rectangle',
      'rectangle',
      'arrow',
    ]);
    expect(scene.elements[2]?.points).toEqual([
      { x: 10, y: 50, snap: 'bar' },
      { x: 50, y: 50, snap: 'post' },
    ]);

    // The bars cross, so the two ends cannot follow the line between the
    // centres: the drawing leaves the bar's right edge and stops on the post's
    // right edge, along y=50, with the head pointing left into the post. A
    // collapsed shaft would put both ends on one point, and a shaft that ran
    // backwards would end on the post's top edge instead.
    const svg = (await savedFiles(ui))['crossing.svg'] ?? '';
    const shaft = drawnPaths(svg).find(
      (points) => points.length > 0 && reaches(points[0]!, { x: 100, y: 50 }),
    );
    expect(shaft, 'a shaft starts on the bar at (100,50)').toBeTruthy();
    const end = shaft?.[shaft.length - 1];
    expect(end !== undefined && reaches(end, { x: 60, y: 50 }), `the shaft ends at 60,50`).toBe(
      true,
    );
  });
});

/**
 * A shaft of three points: two ends and one bend between them. The schema, the
 * Renderer and the geometry draw it; every edit the editor makes reads `points`
 * as two, so each of them has to keep the bend it walks past — and the file it
 * saves has to be one the editor can read back.
 */
describe('a bent shaft keeps its bend', () => {
  test('the note names both ends, not the bend between them', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent.json');
    await clickScene(ui, BENT_ON, [], BENT);

    await expect(screen.getByRole('button', { name: 'Detach: start' })).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Detach: end' })).toBeVisible();
  });

  test('moving the shaft frees both ends and keeps the bend', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent.json');
    await clickScene(ui, BENT_ON, [], BENT);
    await dragBy(ui, BENT_ON, 0, -40, BENT);

    const scene = await savedAndChecked(ui, 'bent.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 100, y: 50 },
      { x: 300, y: 210, corner: 'sharp' },
      { x: 500, y: 50 },
    ]);
  });

  test('dragging the start keeps the bend and the end', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent.json');
    await clickScene(ui, BENT_ON, [], BENT);
    await dragBy(ui, BENT_START, -30, 40, BENT);

    const scene = await savedAndChecked(ui, 'bent.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 70, y: 130 },
      { x: 300, y: 250, corner: 'sharp' },
      { x: 550, y: 50, snap: 'b' },
    ]);
  });

  test('dragging the end keeps the bend and the start', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent.json');
    await clickScene(ui, BENT_ON, [], BENT);
    await dragBy(ui, BENT_END, 20, 40, BENT);

    const scene = await savedAndChecked(ui, 'bent.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 50, y: 50, snap: 'a' },
      { x: 300, y: 250, corner: 'sharp' },
      { x: 520, y: 130 },
    ]);
  });

  test('Detach start frees the first point where it draws', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent.json');
    await clickScene(ui, BENT_ON, [], BENT);
    await screen.getByRole('button', { name: 'Detach: start' }).click();

    const scene = await savedAndChecked(ui, 'bent.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 100, y: 90 },
      { x: 300, y: 250, corner: 'sharp' },
      { x: 550, y: 50, snap: 'b' },
    ]);
  });

  test('Detach end frees the last point, not the bend', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent.json');
    await clickScene(ui, BENT_ON, [], BENT);
    await screen.getByRole('button', { name: 'Detach: end' }).click();

    const scene = await savedAndChecked(ui, 'bent.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 50, y: 50, snap: 'a' },
      { x: 300, y: 250, corner: 'sharp' },
      { x: 500, y: 90 },
    ]);
  });

  test('Duplicate copies every point, the bend included', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bentfree.json');
    await clickScene(ui, BENT_FREE_ON, [], BENT_FREE);
    await browser.keyboard.press('Meta+d');

    const scene = await savedAndChecked(ui, 'bentfree.json');
    expect(scene.elements.map((element) => element.id)).toEqual(['a', 'c', 'arrow-1']);
    expect(scene.elements[2]?.points).toEqual([
      { x: 66, y: 66 },
      { x: 316, y: 266, corner: 'sharp' },
      { x: 566, y: 66 },
    ]);
  });

  test('deleting the start\'s target frees that end and keeps the bend', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent.json');
    await clickScene(ui, { x: 40, y: 40 }, [], BENT);
    await browser.keyboard.press('Delete');

    const scene = await savedAndChecked(ui, 'bent.json');
    expect(scene.elements.map((element) => element.id)).toEqual(['b', 'c']);
    expect(scene.elements[1]?.points).toEqual([
      { x: 100, y: 90 },
      { x: 300, y: 250, corner: 'sharp' },
      { x: 550, y: 50, snap: 'b' },
    ]);
  });

  test('deleting the end\'s target frees that end and keeps the bend', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent.json');
    await clickScene(ui, { x: 520, y: 20 }, [], BENT);
    await browser.keyboard.press('Delete');

    const scene = await savedAndChecked(ui, 'bent.json');
    expect(scene.elements.map((element) => element.id)).toEqual(['a', 'c']);
    expect(scene.elements[1]?.points).toEqual([
      { x: 50, y: 50, snap: 'a' },
      { x: 300, y: 250, corner: 'sharp' },
      { x: 500, y: 90 },
    ]);
  });
});

describe('the two ends of a loop', () => {
  test('an end dragged back onto the Element it leaves attaches again', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'loop.json');
    await clickScene(ui, LOOP_ON, [], LOOP);

    // The end is carried a little and dropped inside the ellipse the other end
    // already leaves, which a shaft of three points may do: only a two-point
    // shaft is barred from attaching both ends to one Element.
    await dragBy(ui, LOOP_END, -40, -20, LOOP);

    const scene = await savedAndChecked(ui, 'loop.json');
    expect(scene.elements[1]?.points).toEqual([
      { x: 360, y: 140, snap: 'oval' },
      { x: 360, y: 320, corner: 'sharp' },
      { x: 362, y: 122, snap: 'oval' },
    ]);
  });
});
