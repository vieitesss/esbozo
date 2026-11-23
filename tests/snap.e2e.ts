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
import { afterAll, expect } from 'e2e';
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
import { control } from './editor-shared.ts';
import { shot } from './pixels.ts';
import type { Rect, Shot } from './pixels.ts';
import { removeTempFolders } from '../test/temp.ts';

// `ez check` reads a saved Scene out of a temporary folder, as it does in every
// suite that asks the CLI about a file this page wrote.
afterAll(removeTempFolders);

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

/**
 * `BENT_SCENE` beside a straight line Snapped at one end to a third box: one
 * drag can hold both shafts, so each follows its own rule for a Snapped end.
 */
const MIXED_SNAPPED_SCENE = {
  ...BENT_SCENE,
  title: 'Mixed snapped',
  elements: [
    ...BENT_SCENE.elements,
    { id: 'e', type: 'rectangle', x: 0, y: 350, width: 100, height: 100 },
    {
      id: 'd',
      type: 'line',
      points: [
        { x: 150, y: 400, snap: 'e' },
        { x: 450, y: 400 },
      ],
    },
  ],
};
const MIXED_SNAPPED_SOURCE = JSON.stringify(MIXED_SNAPPED_SCENE, null, 2);

/** The view `MIXED_SNAPPED_SCENE` lands in, worked out the same way as `VIEW`. */
const MIXED_SNAPPED: View = { zoom: 1, panX: 340, panY: 175 };

/**
 * The Review's shaft, its target painted over it: an arrow Snapped to a box
 * that covers the leg it reaches its end on, so a move can carry the bend
 * inside the target's outline. The fill is paper-light and opaque, so any ink
 * the box covers is ink nobody sees.
 */
const INSIDE_SCENE = {
  version: 1,
  title: 'Bend inside',
  defaults: { roughness: 0 },
  elements: [
    {
      id: 'arrow',
      type: 'arrow',
      points: [
        { x: -300, y: 50 },
        { x: -150, y: 50, corner: 'sharp' },
        { x: 0, y: 50, snap: 'box' },
      ],
    },
    {
      id: 'box',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fill: { kind: 'solid', grey: 1 },
    },
  ],
};
const INSIDE_SOURCE = JSON.stringify(INSIDE_SCENE, null, 2);

/** The view `INSIDE_SCENE` lands in, worked out the same way as `VIEW`. */
const INSIDE: View = { zoom: 1, panX: 740, panY: 350 };

/** A point on the shaft's first leg, clear of the dots halfway along both legs. */
const INSIDE_ON = { x: -200, y: 50 };

/** A spot on the paper, clear of the box and of the shaft: where a press deselects. */
const INSIDE_PAPER = { x: -250, y: 20 };

/**
 * The paper beside the box's near edge, level with the shaft: a head drawn on
 * that edge fills it with its wings, and a shaft running past it puts nothing
 * there but its own stroke.
 */
const INSIDE_HEAD: Rect = { x: 724, y: 392, width: 7, height: 16 };

/** The view `BENT_SCENE` lands in, worked out the same way as `VIEW`. */
const BENT: View = { zoom: 1, panX: 340, panY: 275 };

/** Where `c` starts: the point of `a`'s outline its first point is drawn on. */
const BENT_START = { x: 100, y: 90 };

/** Where `c` finishes: the point of `b`'s outline its last point is drawn on. */
const BENT_END = { x: 500, y: 90 };

/** Inside `a`, level with the shaft's start: where a press selects the box alone. */
const IN_A = { x: 50, y: 50 };

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

/**
 * An arrow whose end carries an Anchor, a quarter of the way up `post`'s left
 * edge as a fraction of the box: the Renderer draws the end there, so the shaft
 * slopes up where an end with no Anchor would run level into (300,80).
 */
const PINNED_SCENE = {
  version: 1,
  title: 'Pinned',
  defaults: { roughness: 0 },
  elements: [
    { id: 'post', type: 'rectangle', x: 300, y: 40, width: 120, height: 80 },
    {
      id: 'pinned',
      type: 'arrow',
      points: [
        { x: 60, y: 80 },
        { x: 300, y: 80, snap: 'post', anchor: { x: 0, y: 0.75 } },
      ],
      heads: { start: 'none', end: 'arrow' },
    },
  ],
};
const PINNED_SOURCE = JSON.stringify(PINNED_SCENE, null, 2);

/**
 * The same box and a line whose end writes `"snap": false`: a free end that
 * remembers it carries no Snap, which no gesture can add to a free end and no
 * edit may quietly drop.
 */
const LOOSE_SCENE = {
  version: 1,
  title: 'Loose',
  defaults: { roughness: 0 },
  elements: [
    { id: 'post', type: 'rectangle', x: 300, y: 40, width: 120, height: 80 },
    {
      id: 'loose',
      type: 'line',
      points: [
        { x: 60, y: 80 },
        { x: 320, y: 80, snap: false },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const LOOSE_SOURCE = JSON.stringify(LOOSE_SCENE, null, 2);

/** The view both of those Scenes land in: `post`'s bounds, at 1:1. */
const PINNED: View = { zoom: 1, panX: 400, panY: 320 };

/** Inside `post`, off its middle: where a press selects the box alone. */
const IN_PINNED_BOX = { x: 360, y: 100 };

/** A spot on the box's face, clear of its stroke: where the box is pressed to move it. */
const PINNED_FACE = { x: 360, y: 80 };

/** The Scene files the `snap.json` fixture folder holds, by the name a person opens. */
const SCENES = {
  A: {
    'snap.json': SNAP_SOURCE,
    'snapped.json': SNAPPED_SOURCE,
    'hyphen.json': HYPHEN_SOURCE,
    'crossing.json': CROSSING_SOURCE,
    'bent.json': BENT_SOURCE,
    'mixed.json': MIXED_SNAPPED_SOURCE,
    'inside.json': INSIDE_SOURCE,
    'bentfree.json': BENT_FREE_SOURCE,
    'loop.json': LOOP_SOURCE,
    'pinned.json': PINNED_SOURCE,
    'loose.json': LOOSE_SOURCE,
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

/** Whether a triangle of drawn corners covers a point, its own edges included. */
function insideTriangle(triangle: readonly Point[], point: Point): boolean {
  const [a, b, c] = triangle as [Point, Point, Point];
  if (a === undefined || b === undefined || c === undefined) {
    return false;
  }
  const sides = [
    (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x),
    (c.x - b.x) * (point.y - b.y) - (c.y - b.y) * (point.x - b.x),
    (a.x - c.x) * (point.y - c.y) - (a.y - c.y) * (point.x - c.x),
  ];
  return sides.every((side) => side >= -0.001) || sides.every((side) => side <= 0.001);
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

  test('Detach pressed while that end is dragged away writes nothing', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');
    await clickScene(ui, { x: 230, y: 80 }, [], SNAPPED);

    // The end is dragged out onto empty paper, so the preview already holds the
    // end free while the pointer is still down. Enter on the focused Detach
    // button is the note's own button, not the drag's keys, and the Escape that
    // follows drops the drag: nothing was detached, so nothing is written.
    const handle = at({ x: 300, y: 80 }, SNAPPED);
    const away = at({ x: 260, y: 140 }, SNAPPED);
    await browser.mouse.move(handle.x, handle.y);
    await browser.mouse.down();
    await browser.mouse.move(away.x, away.y);
    await screen.getByRole('button', { name: 'Detach: end' }).focus();
    await browser.keyboard.press('Enter');
    await browser.keyboard.press('Escape');
    await browser.mouse.up();

    // The drag is gone, the end is still attached, and the note still says so.
    const scene = await savedScene(ui, 'snapped.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 160, y: 80, snap: 'from' },
      { x: 300, y: 80, snap: 'to' },
    ]);
    await expect(screen.getByRole('button', { name: 'Detach: end' })).toBeVisible();
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
    // right edge, along y=50, with the head pointing left into the post. The
    // head is the last ink of the arrow, so the shaft stops behind it and the
    // head's tip is the ink that reaches that edge. A collapsed shaft would put
    // both ends on one point, and a shaft that ran backwards would end on the
    // post's top edge instead.
    const svg = (await savedFiles(ui))['crossing.svg'] ?? '';
    const paths = drawnPaths(svg);
    const head = paths.find(
      (points) => points.length === 3 && reaches(points[0]!, { x: 60, y: 50 }),
    );
    expect(head, 'the head’s tip reaches the post at (60,50)').toBeTruthy();
    const shaft = paths.find(
      (points) => points.length > 0 && reaches(points[0]!, { x: 100, y: 50 }),
    );
    expect(shaft, 'a shaft starts on the bar at (100,50)').toBeTruthy();
    const end = shaft?.[shaft.length - 1];
    // The cut ends the shaft under the head that covers it: behind the tip and
    // inside the triangle, so no ink of it shows beside the head.
    expect(
      end !== undefined && insideTriangle(head ?? [], end),
      `the shaft ends under its head at ${end?.x},${end?.y}`,
    ).toBe(true);
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

  test('moving the shaft keeps both ends attached and carries the bend', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent.json');
    await clickScene(ui, BENT_ON, [], BENT);
    // The shaft itself, clear of the dot halfway along its first run: a press on
    // that dot pulls a new bend point out instead of moving the shaft.
    await dragBy(ui, { x: 150, y: 130 }, 0, -40, BENT);

    const scene = await savedAndChecked(ui, 'bent.json');
    // A shaft with a bend point between its ends keeps both Snaps: the drag moves
    // every point it stores, and both ends still follow the boxes they are on.
    expect(scene.elements[2]?.points).toEqual([
      { x: 50, y: 10, snap: 'a' },
      { x: 300, y: 210, corner: 'sharp' },
      { x: 550, y: 10, snap: 'b' },
    ]);

    // So it draws on both outlines where it now lands, rather than where the
    // drag left its stored ends: the start on `a`'s right edge, aimed at the
    // moved bend, and the head's tip on `b`'s left edge. A freed end would keep
    // the shaft's start at its stored (50,10), inside the box and off its edge.
    const paths = drawnPaths((await savedFiles(ui))['bent.svg'] ?? '');
    const start = paths.find((points) => {
      const first = points[0];
      return first !== undefined && reaches(first, { x: 100, y: 82 }, 1);
    });
    expect(start, 'the dragged start still leaves a’s right edge at (100,82)').toBeTruthy();
    const tip = paths.find((points) => {
      const first = points[0];
      return first !== undefined && points.length === 3 && reaches(first, { x: 500, y: 82 }, 1);
    });
    expect(tip, 'the head’s tip still lands on b’s left edge at (500,82)').toBeTruthy();

    // One gesture is one step: a single undo puts the Snaps and the bend back,
    // and one redo carries them again.
    await browser.keyboard.press('Meta+z');
    const undone = await savedScene(ui, 'bent.json');
    expect(undone.elements[2]?.points).toEqual([
      { x: 50, y: 50, snap: 'a' },
      { x: 300, y: 250, corner: 'sharp' },
      { x: 550, y: 50, snap: 'b' },
    ]);
    await browser.keyboard.press('Shift+Meta+z');
    const again = await savedScene(ui, 'bent.json');
    expect(again.elements[2]?.points).toEqual([
      { x: 50, y: 10, snap: 'a' },
      { x: 300, y: 210, corner: 'sharp' },
      { x: 550, y: 10, snap: 'b' },
    ]);
  });

  test('a nudge moves the bend and keeps both ends attached', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent.json');
    await clickScene(ui, BENT_ON, [], BENT);
    await browser.keyboard.press('Shift+ArrowRight');

    const scene = await savedAndChecked(ui, 'bent.json');
    // The keyboard follows the drag's rule for a bent shaft: a step moves every
    // point, and both Snaps stay where they were.
    expect(scene.elements[2]?.points).toEqual([
      { x: 60, y: 50, snap: 'a' },
      { x: 310, y: 250, corner: 'sharp' },
      { x: 560, y: 50, snap: 'b' },
    ]);
  });

  test('a straight shaft still frees both ends and moves them', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');

    // The control: two points have no bend to carry the Snaps with, so the drag
    // lets both ends go where they draw first and moves them from there.
    await dragBy(ui, { x: 230, y: 80 }, 10, 20, SNAPPED);

    const scene = await savedAndChecked(ui, 'snapped.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 170, y: 100 },
      { x: 310, y: 100 },
    ]);
  });

  test('moving a box with its bent shaft keeps both ends attached', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent.json');

    // `a` and `c` move together: the box and the shaft it carries at one end.
    await clickScene(ui, IN_A, [], BENT);
    await clickScene(ui, BENT_ON, ['Shift'], BENT);
    await dragBy(ui, { x: 150, y: 130 }, 0, 60, BENT);

    const scene = await savedAndChecked(ui, 'bent.json');
    expect(scene.elements[0]).toMatchObject({ id: 'a', x: 0, y: 60 });
    // Both ends stay attached: the shaft moves with the box under its start, and
    // `b` is not selected, so its end is re-aimed at the bend from where it is.
    expect(scene.elements[2]?.points).toEqual([
      { x: 50, y: 110, snap: 'a' },
      { x: 300, y: 310, corner: 'sharp' },
      { x: 550, y: 110, snap: 'b' },
    ]);

    // The start draws on `a` where `a` now is, not where it was: the moved box's
    // right edge at (100,150). A start freed where it drew would keep that point
    // and lose the Snap, so the arrow would not follow `a` again.
    const paths = drawnPaths((await savedFiles(ui))['bent.svg'] ?? '');
    const start = paths.find((points) => {
      const first = points[0];
      return first !== undefined && reaches(first, { x: 100, y: 150 }, 1);
    });
    expect(start, 'the start still leaves a’s right edge, beside a’s new place').toBeTruthy();
  });

  test('a shaft Snapped at one end carries it and moves its free end', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent.json');
    await clickScene(ui, BENT_ON, [], BENT);
    // One Snap left: the start still follows `a`, and the freed end is a point of
    // the shaft like the bend between them.
    await screen.getByRole('button', { name: 'Detach: end' }).click();
    await dragBy(ui, { x: 150, y: 130 }, 0, 60, BENT);

    const scene = await savedAndChecked(ui, 'bent.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 50, y: 110, snap: 'a' },
      { x: 300, y: 310, corner: 'sharp' },
      { x: 500, y: 150 },
    ]);
  });

  test('a three-point loop carries both Snaps when its shaft moves', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'loop.json');
    // Down the loop's long leg, clear of the dots halfway along either of them: a
    // press on a dot pulls a new bend point out instead of moving the shaft.
    await clickScene(ui, { x: 350, y: 280 }, [], LOOP);
    await dragBy(ui, { x: 350, y: 280 }, -40, 0, LOOP);

    // Both ends Snap to one Element, and the bend between them is what moves: the
    // loop keeps leaving and returning to the oval, from where the drag put it.
    const scene = await savedAndChecked(ui, 'loop.json');
    expect(scene.elements[1]?.points).toEqual([
      { x: 320, y: 140, snap: 'oval' },
      { x: 320, y: 320, corner: 'sharp' },
      { x: 320, y: 60, snap: 'oval' },
    ]);
  });

  test('a drag of a bent shaft and a straight one gives each its own rule', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'mixed.json');

    // One gesture, both shafts: `c` has a bend to carry its Snaps with, and `d`
    // has two points, so it lets its one Snap go where it drew first. A box sweeps
    // up both shafts and nothing else.
    await drag(
      ui,
      at({ x: 620, y: 470 }, MIXED_SNAPPED),
      at({ x: 20, y: 10 }, MIXED_SNAPPED),
    );
    await dragBy(ui, { x: 150, y: 130 }, 0, -20, MIXED_SNAPPED);

    const scene = await savedAndChecked(ui, 'mixed.json');
    expect(scene.elements[2]?.points).toEqual([
      { x: 50, y: 30, snap: 'a' },
      { x: 300, y: 230, corner: 'sharp' },
      { x: 550, y: 30, snap: 'b' },
    ]);
    expect(scene.elements[4]?.points).toEqual([
      { x: 100, y: 380 },
      { x: 450, y: 380 },
    ]);
  });

  test('a move that carries a bend inside its target keeps the head on the near edge', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'inside.json');
    await clickScene(ui, INSIDE_ON, [], INSIDE);
    // The Review's drag: 225px along the shaft, which leaves the bend at
    // (75,50), inside the box the end Snaps to.
    await dragBy(ui, INSIDE_ON, 225, 0, INSIDE);

    const scene = await savedAndChecked(ui, 'inside.json');
    expect(scene.elements[0]?.points).toEqual([
      { x: -75, y: 50 },
      { x: 75, y: 50, corner: 'sharp' },
      { x: 225, y: 50, snap: 'box' },
    ]);

    // The Snap is kept, so the end draws where the shaft reaches the box from
    // outside: the near edge at (0,50), with the head pointing into the target
    // and its wings on the paper beside the fill.
    const paths = drawnPaths((await savedFiles(ui))['inside.svg'] ?? '');
    const head = paths.find(
      (points) => points.length === 3 && points.some((point) => reaches(point, { x: 0, y: 50 })),
    );
    expect(head, 'a head sits on the box’s near edge, not on its far one').toBeTruthy();
    const wings = (head ?? []).filter((point) => !reaches(point, { x: 0, y: 50 }));
    expect(
      wings.every((point) => point.x < 0),
      `its wings sit on the paper beside the fill, got ${JSON.stringify(wings)}`,
    ).toBe(true);

    // And that ink is on the page: the box's near edge is fully painted, so a
    // head under it would leave nothing there but the shaft's own stroke.
    await clickScene(ui, INSIDE_PAPER, [], INSIDE);
    await settle(ui);
    const painted = (await shot(ui)).darkBounds(INSIDE_HEAD, 0.6);
    expect(
      painted?.height ?? 0,
      `the head’s wings are painted beside the box, got ${JSON.stringify(painted)}`,
    ).toBeGreaterThan(6);
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

describe('an end that carries an Anchor', () => {
  /** The ink of a small patch of page, too dark to be paper. */
  function inked(drawn: Shot, point: Point): number {
    return drawn.darkCount({ x: point.x - 8, y: point.y - 4, width: 16, height: 8 }, 0.6);
  }

  test('the end draws at its Anchor, and stays on it when its box moves', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'pinned.json');

    // A quarter of the way up the box's left edge, measured on the page: the
    // shaft reaches the box at (300,100) and not at the level (300,80).
    const before = await shot(ui);
    expect(inked(before, at({ x: 180, y: 90 }, PINNED))).toBeGreaterThan(0);
    expect(inked(before, at({ x: 180, y: 80 }, PINNED))).toBe(0);

    // The box moves down 40px with the pointer, and the end stays a quarter of
    // the way up its left edge: the same fraction of the box it just left.
    await dragBy(ui, PINNED_FACE, 0, 40, PINNED);

    const scene = await savedAndChecked(ui, 'pinned.json');
    expect({ y: scene.elements[0]?.y }).toEqual({ y: 80 });
    // The stored point is untouched: the Anchor decides where the ink lands.
    expect(scene.elements[1]?.points).toEqual([
      { x: 60, y: 80 },
      { x: 300, y: 80, snap: 'post', anchor: { x: 0, y: 0.75 } },
    ]);

    // The box's left edge now runs y=80..160, so its three-quarter point is
    // (300,140) and the shaft's middle is at (180,110).
    const after = await shot(ui);
    expect(inked(after, at({ x: 180, y: 110 }, PINNED))).toBeGreaterThan(0);
    expect(inked(after, at({ x: 180, y: 90 }, PINNED))).toBe(0);
  });

  test('a Corners pick leaves the Anchor where it is, and changes only the corners', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'pinned.json');
    await clickScene(ui, { x: 180, y: 90 }, [], PINNED);

    // The pick is about how the shaft turns, and a two-point shaft has no bend to
    // turn: every point keeps the very keys it had, the Anchor included, so the
    // ink stays on the place the Anchor names.
    await control(ui, 'Corners: round').click();

    const scene = await savedAndChecked(ui, 'pinned.json');
    expect(scene.elements[1]?.corners).toBe('round');
    expect(scene.elements[1]?.points).toEqual([
      { x: 60, y: 80 },
      { x: 300, y: 80, snap: 'post', anchor: { x: 0, y: 0.75 } },
    ]);
  });

  test('Detach frees the end where its Anchor drew it, and drops the Anchor', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'pinned.json');
    await clickScene(ui, { x: 180, y: 90 }, [], PINNED);
    await screen.getByRole('button', { name: 'Detach: end' }).click();

    const scene = await savedAndChecked(ui, 'pinned.json');
    expect(scene.elements[1]?.points).toEqual([
      { x: 60, y: 80 },
      { x: 300, y: 100 },
    ]);
  });

  test('an end that writes "snap": false stays free through an unrelated edit', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'loose.json');

    await dragBy(ui, IN_PINNED_BOX, 0, 40, PINNED);

    // The box moved under the free end, and the end neither attached itself to
    // it nor forgot the Snap it wrote as false.
    const scene = await savedAndChecked(ui, 'loose.json');
    expect({ y: scene.elements[0]?.y }).toEqual({ y: 80 });
    expect(scene.elements[1]?.points).toEqual([
      { x: 60, y: 80 },
      { x: 320, y: 80, snap: false },
    ]);

    // A copy is moved away from its source and keeps the word: the free end of
    // the copy is still free, and still says so.
    await clickScene(ui, { x: 190, y: 80 }, [], PINNED);
    await browser.keyboard.press('Meta+d');
    const copied = await savedAndChecked(ui, 'loose.json');
    expect(copied.elements.map((element) => element.id)).toEqual(['post', 'loose', 'line-1']);
    expect(copied.elements[2]?.points).toEqual([
      { x: 76, y: 96 },
      { x: 336, y: 96, snap: false },
    ]);
  });
});
