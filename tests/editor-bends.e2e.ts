/**
 * Seam 2: a bend point, the handle the editor shows on it, the drag that moves
 * it, and the small dot halfway along each segment of a selected shaft that a
 * press pulls a new bend point out of.
 *
 * Same rules as the editor suites: the input is a person's — a click on the
 * shaft, a press on the handle or the dot, the keys — and the assertion is the
 * Scene the editor saves, or the pixels it paints. A bend is stored as a point of
 * its arrow or line, so the saved `points` say whether the point moved, what its
 * `corner` still is and whether the ends kept their Snaps, without reading the
 * editor's state.
 *
 * The editor writes on its own clock, so a test reads the folder once the write
 * has landed there: `pointsIn` is what the file holds, and `expectPoints` polls
 * it until the editor has caught up. Reading the status alone would pass on the
 * `saved` an earlier step left.
 *
 * No test here uses the model, so `pnpm e2e` still passes with no key set.
 */
import { describe, test } from '@e2e-dev/web';
import { afterAll, expect } from 'e2e';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  allowWrites,
  at,
  clickScene,
  doubleClickScene,
  drag,
  holdWrites,
  openEditor,
  refuseWrite,
  savedFiles,
  savedScene,
  settle,
} from './helpers.ts';
import type { Point, SavedScene, Ui, View } from './helpers.ts';
import { zoomReadout } from './editor-shared.ts';
import { command, palette } from './editor-shared.ts';
import { shot } from './pixels.ts';
import type { Rect, Shot } from './pixels.ts';
import { removeTempFolders } from '../test/temp.ts';

// One folder of fixtures per test, made and removed by the same helper every
// suite uses.
afterAll(removeTempFolders);

/**
 * A free arrow through one bend, the bend written `sharp`: roughness 0, so the
 * page it draws is the numbers below.
 */
const SHARP_SCENE = {
  version: 1,
  title: 'Sharp bend',
  defaults: { roughness: 0 },
  elements: [
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 50, y: 50 },
        { x: 300, y: 250, corner: 'sharp' },
        { x: 550, y: 50 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const SHARP_SOURCE = JSON.stringify(SHARP_SCENE, null, 2);

/** The view `SHARP_SCENE` lands in: its page fitted 1:1 into a 1280×800 window. */
const SHARP: View = { zoom: 1, panX: 340, panY: 251 };

/** On the arrow's first run, on no Element: where a press selects it. */
const SHARP_ON = { x: 175, y: 150 };

/** Where the sharp bend is stored, and so where its handle sits on the page. */
const SHARP_BEND = { x: 300, y: 250 };

/** The points of `SHARP_SCENE` as the file holds them, and where a drag carries the bend. */
const SHARP_POINTS: SavedPoint[] = [
  { x: 50, y: 50 },
  { x: 300, y: 250, corner: 'sharp' },
  { x: 550, y: 50 },
];
const DRAGGED_POINTS: SavedPoint[] = [
  { x: 50, y: 50 },
  { x: 340, y: 270, corner: 'sharp' },
  { x: 550, y: 50 },
];

/** The part of the page the arrow, its selection and its bend handle paint in. */
const SHARP_AREA: Rect = { x: 480, y: 380, width: 260, height: 240 };

/**
 * A free arrow through two points, on a box that holds the page still, and the
 * same as a line: a shaft whose one dot sits halfway along the ink it draws, so
 * where that is is the points' own arithmetic and nothing else.
 */
const FLAT_SCENE = {
  version: 1,
  title: 'Flat',
  defaults: { roughness: 0 },
  elements: [
    { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 200, y: 300 },
        { x: 600, y: 300 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const FLAT_SOURCE = JSON.stringify(FLAT_SCENE, null, 2);

/** The same two points as a line, so the dot is the shaft's and never its head. */
const PLAIN_SCENE = {
  ...FLAT_SCENE,
  title: 'Plain',
  elements: [
    FLAT_SCENE.elements[0],
    { ...FLAT_SCENE.elements[1], type: 'line' },
  ],
};
const PLAIN_SOURCE = JSON.stringify(PLAIN_SCENE, null, 2);

/** The view `FLAT_SCENE` and `PLAIN_SCENE` land in: their 800×560 box fitted 1:1. */
const FLAT: View = { zoom: 1, panX: 240, panY: 120 };

/** Halfway along the flat shaft's only segment, on its ink: where its dot sits. */
const FLAT_DOT = { x: 400, y: 300 };

/**
 * The view one zoom-in step leaves, as `LINE_ZOOMED` is: `Meta+=` zooms around
 * the middle of the page, so the dot at Scene (400,300) stays on the ink it is
 * halfway along and the page under it spreads.
 */
const FLAT_ZOOMED: View = { zoom: 1.2, panX: 160, panY: 64 };

/**
 * An arrow through one `sharp` corner, on a box that holds the page still. The
 * corner's fillet takes 7px off each leg — the issue's 6–8px softening — so the
 * first leg's ink runs from (101,300) to (393,300) and its dot sits halfway
 * along at (247,300), and the last leg's ink runs from (400,307) to (400,501)
 * with its dot at (400,404).
 */
const BENT_SCENE = {
  version: 1,
  title: 'One corner',
  defaults: { roughness: 0 },
  elements: [
    { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 101, y: 300 },
        { x: 400, y: 300, corner: 'sharp' },
        { x: 400, y: 501 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const BENT_SOURCE = JSON.stringify(BENT_SCENE, null, 2);

/** `BENT_SCENE` with words on the arrow, placed beside its drawn middle. */
const BENT_WORDS_SCENE = {
  ...BENT_SCENE,
  title: 'One corner, words',
  elements: [
    BENT_SCENE.elements[0],
    { ...BENT_SCENE.elements[1], label: 'bend words' },
  ],
};
const BENT_WORDS_SOURCE = JSON.stringify(BENT_WORDS_SCENE, null, 2);

/** The view both bent Scenes land in: their 800×560 box fitted 1:1. */
const BENT: View = { zoom: 1, panX: 240, panY: 120 };

/** Halfway along the first leg of the bent shaft, and along its last leg. */
const FIRST_DOT = { x: 247, y: 300 };
const LAST_DOT = { x: 400, y: 404 };

/**
 * The flat arrow with its words placed on its own middle: the words paint over
 * the dot that is halfway along it, so a press there is a press on the words.
 */
const WORDS_SCENE = {
  ...FLAT_SCENE,
  title: 'Words',
  elements: [
    FLAT_SCENE.elements[0],
    { ...FLAT_SCENE.elements[1], label: 'words', labelAt: { t: 0.5, offset: 0 } },
  ],
};
const WORDS_SOURCE = JSON.stringify(WORDS_SCENE, null, 2);

/**
 * A line drawn as one smooth run through four points, mirrored about x = 400: the
 * middle leg's ink is a curve whose halves are each other's mirror, so the place
 * halfway along it is the place it crosses x = 400 — well above its chord's own
 * middle at (400,200), which is bare paper.
 */
const ARCH_SCENE = {
  version: 1,
  title: 'Arch',
  defaults: { roughness: 0 },
  elements: [
    { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
    {
      id: 'bent',
      type: 'line',
      corners: 'round',
      points: [
        { x: 300, y: 300 },
        { x: 350, y: 200 },
        { x: 450, y: 200 },
        { x: 500, y: 300 },
      ],
    },
  ],
};
const ARCH_SOURCE = JSON.stringify(ARCH_SCENE, null, 2);

/** The view `ARCH_SCENE` lands in: its 800×560 box fitted 1:1. */
const ARCH: View = { zoom: 1, panX: 240, panY: 120 };

/**
 * The column of the page that holds the arch's middle leg and nothing else: the
 * ink it crosses at x = 400 is the place halfway along that leg.
 */
const ARCH_COLUMN: Rect = { x: 639, y: 280, width: 2, height: 60 };

/** The arch's middle leg chord middle: bare paper, and never where its dot is. */
const ARCH_CHORD: Rect = { x: 638, y: 318, width: 4, height: 4 };

/**
 * An arrow with both ends Snapped, one to each box: the drawn shaft runs from box
 * `a`'s edge to box `b`'s, so its dot is on that ink rather than on the chord
 * between the two stored points.
 */
const SNAPPED_DOT_SCENE = {
  version: 1,
  title: 'Snapped dot',
  defaults: { roughness: 0 },
  elements: [
    { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
    { id: 'a', type: 'rectangle', x: 100, y: 100, width: 100, height: 100 },
    { id: 'b', type: 'rectangle', x: 500, y: 300, width: 200, height: 200 },
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 150, y: 150, snap: 'a' },
        { x: 600, y: 400, snap: 'b' },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const SNAPPED_DOT_SOURCE = JSON.stringify(SNAPPED_DOT_SCENE, null, 2);

/** The view `SNAPPED_DOT_SCENE` lands in: its 800×560 box fitted 1:1. */
const SNAPPED_DOT: View = { zoom: 1, panX: 240, panY: 120 };

/**
 * Halfway along the drawn shaft: box `a`'s edge at (200, 177.8) to box `b`'s at
 * (500, 344.4), so the ink's own middle is 20px off the stored points' middle.
 */
const SNAPPED_MIDDLE = { x: 350, y: 261.111 };

/**
 * A bare diagonal line, sized so the view fits it 1:1 about its middle: its dot
 * is the only mark on the page that is neither the ink nor a handle.
 */
const TILTED_SCENE = {
  version: 1,
  title: 'Tilted',
  defaults: { roughness: 0 },
  elements: [
    {
      id: 'bent',
      type: 'line',
      points: [
        { x: 200, y: 200 },
        { x: 600, y: 400 },
      ],
    },
  ],
};
const TILTED_SOURCE = JSON.stringify(TILTED_SCENE, null, 2);

/** The view `TILTED_SCENE` lands in: its ink fitted 1:1 about its own middle. */
const TILTED: View = { zoom: 1, panX: 240, panY: 100 };

/** The view one zoom-in step leaves there: the same middle, spread by 1.2. */
const TILTED_ZOOMED: View = { zoom: 1.2, panX: 160, panY: 40 };

/** Halfway along the tilted line: the dot's own place, in Scene pixels. */
const TILTED_DOT = { x: 400, y: 300 };

/**
 * The unit direction across the tilted line, so a pixel probe reads a mark's
 * width rather than the ink it sits on: the line runs along (2, 1).
 */
const ACROSS = { x: -1 / Math.sqrt(5), y: 2 / Math.sqrt(5) };

/**
 * A shaft whose middle leg is so short that the dot halfway along it would sit
 * on the corner handles either side of it: the long legs keep their dots, and
 * that one is left off rather than drawn where a press could never take it.
 */
const SHORT_SCENE = {
  version: 1,
  title: 'Short leg',
  defaults: { roughness: 0 },
  elements: [
    { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 100, y: 300 },
        { x: 400, y: 300, corner: 'sharp' },
        { x: 400, y: 312, corner: 'sharp' },
        { x: 400, y: 520 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const SHORT_SOURCE = JSON.stringify(SHORT_SCENE, null, 2);

/** The view `SHORT_SCENE` lands in: its 800×560 box fitted 1:1. */
const SHORT: View = { zoom: 1, panX: 240, panY: 120 };

/** Two pixels above the dot halfway along the short shaft's first leg. */
const FIRST_LEG_INK: Rect = { x: 487, y: 417, width: 1, height: 1 };

/**
 * Two pixels right of where the short middle leg's dot would be: inside the dot
 * a press would pull a bend out of, and clear of the corner handles either side.
 */
const SHORT_LEG_INK: Rect = { x: 642, y: 426, width: 1, height: 1 };

/**
 * The band of the page that holds the flat shaft, its marks and its dot, and
 * nothing else: the rail, the note and the rest of the page's chrome are outside
 * it, so the ink measured here is the shaft's own.
 */
const FLAT_BAND: Rect = { x: 300, y: 400, width: 600, height: 40 };

/** Where a shaft's middle is on the page now, read from the ink the page paints. */
function shaftMiddle(painted: Shot): Point {
  // Only the shaft's own ink is that dark: the handles, the dashed box about
  // them and the dot are lighter, so the line the marks are all measured from is
  // the line this reads, whichever of them the page is painting.
  const bounds = painted.darkBounds(FLAT_BAND, 0.2);
  if (bounds === null) {
    throw new Error('the page paints no shaft to measure');
  }
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/** The pixel two above a shaft's middle: its dot's ink when it is drawn, and paper when it is not. */
function dotInkAt(middle: Point): Rect {
  return { x: Math.round(middle.x), y: Math.round(middle.y) - 2, width: 1, height: 1 };
}

/**
 * An arrow with one `sharp` bend and one `round` bend, on a box that holds the
 * page still: the box is what the view fits, so where each handle sits is the
 * box's own arithmetic and no bent ink moves it.
 */
const SHAPES_SCENE = {
  version: 1,
  title: 'Two bends',
  defaults: { roughness: 0 },
  elements: [
    { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 150, y: 300 },
        { x: 300, y: 180, corner: 'sharp' },
        { x: 500, y: 180, corner: 'round' },
        { x: 650, y: 300 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const SHAPES_SOURCE = JSON.stringify(SHAPES_SCENE, null, 2);

/** The view `SHAPES_SCENE` lands in: its 800×560 box fitted 1:1. */
const SHAPES: View = { zoom: 1, panX: 240, panY: 120 };

/** On the arrow's first run, on no box edge: where a press selects the arrow. */
const SHAPES_ON = { x: 225, y: 240 };

/** Where the arrow's two bends are stored, and so where their handles sit. */
const SHARP_MARK = { x: 300, y: 180 };
const ROUND_MARK = { x: 500, y: 180 };

/**
 * One pixel of the page, at an offset from a bend's handle: what a square puts
 * ink on and a circle leaves alone, and the other way round. The offsets are the
 * inks the two shapes paint at an eight-pixel handle, read as pixels and never
 * as markup.
 */
function pixelAt(handle: Point, dx: number, dy: number): Rect {
  return { x: handle.x + dx, y: handle.y + dy, width: 1, height: 1 };
}

/**
 * The fill inside a handle: the pixels around its middle, clear of the stroke
 * that runs around an eight-pixel mark. What a selected point paints there is
 * the selection's colour, and an unselected one the paper.
 */
function handleFill(handle: Point): Rect {
  return { x: handle.x - 1, y: handle.y - 1, width: 2, height: 2 };
}

/**
 * A line through one bend, on a box that holds the page still: the Element's
 * own corner is `round` and the point writes none, so the bend it draws is the
 * Element's and a drag has to keep that.
 */
const LINE_SCENE = {
  version: 1,
  title: 'Round bend',
  defaults: { roughness: 0 },
  elements: [
    { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
    {
      id: 'bent',
      type: 'line',
      corners: 'round',
      points: [
        { x: 150, y: 300 },
        { x: 350, y: 180 },
        { x: 600, y: 300 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const LINE_SOURCE = JSON.stringify(LINE_SCENE, null, 2);

/** The view `LINE_SCENE` lands in: its 800×560 box fitted 1:1. */
const LINE: View = { zoom: 1, panX: 240, panY: 120 };

/** The line's bend, stored on its ink: a press there selects the line. */
const LINE_BEND = { x: 350, y: 180 };

/**
 * The view one zoom-in step leaves: `Meta+=` zooms by 1.2 around the middle of
 * the 1280×800 page, so Scene (400,280) stays at the middle and everything else
 * spreads from it.
 */
const LINE_ZOOMED: View = { zoom: 1.2, panX: 160, panY: 64 };

/**
 * An arrow with both ends Snapped to a box each, and two bends between them, on
 * a box that holds the page still: the drags below read which end kept its Snap
 * and which bend stayed where it was.
 */
const SNAPPED_SCENE = {
  version: 1,
  title: 'Snapped bends',
  defaults: { roughness: 0 },
  elements: [
    { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
    { id: 'a', type: 'rectangle', x: 100, y: 100, width: 100, height: 100 },
    { id: 'b', type: 'rectangle', x: 600, y: 300, width: 100, height: 100 },
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 150, y: 150, snap: 'a' },
        { x: 350, y: 200, corner: 'sharp' },
        { x: 550, y: 300, corner: 'round' },
        { x: 650, y: 350, snap: 'b' },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const SNAPPED_SOURCE = JSON.stringify(SNAPPED_SCENE, null, 2);

/** The view `SNAPPED_SCENE` lands in: its 800×560 box fitted 1:1. */
const SNAPPED: View = { zoom: 1, panX: 240, panY: 120 };

/** On the arrow's first run, past box `a` and clear of box `b`: where a press selects it. */
const SNAPPED_ON = { x: 275, y: 181 };

/** The sharp bend between the two Snapped ends, where its handle sits on the page. */
const SNAPPED_BEND = { x: 350, y: 200 };

/**
 * An arrow with words on its first leg, on a box that holds the page still: the
 * words are ink a double-click would open, and they stand clear of the bend
 * handle the presses below take.
 */
const ON_BEND_SCENE = {
  version: 1,
  title: 'Words on a bend',
  defaults: { roughness: 0 },
  elements: [
    { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 200, y: 400 },
        { x: 400, y: 300, corner: 'sharp' },
        { x: 600, y: 400 },
      ],
      heads: { start: 'none', end: 'none' },
      label: 'bend words',
      labelAt: { t: 0.3, offset: 0 },
    },
  ],
};
const ON_BEND_SOURCE = JSON.stringify(ON_BEND_SCENE, null, 2);

/** On the arrow's first leg, before the words: where a press selects it. */
const ON_BEND_ON = { x: 240, y: 380 };

/** The bend whose handle the pair takes, clear of the words. */
const ON_BEND_BEND = { x: 400, y: 300 };

/**
 * An arrow whose two bends stand six pixels apart, on a box that holds the page
 * still: the handle drawn first answers a press at its own place, and the point
 * that takes its index stands four pixels away, where a click after the pair
 * still lands on a handle.
 */
const NEAR_SCENE = {
  version: 1,
  title: 'Two near bends',
  defaults: { roughness: 0 },
  elements: [
    { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 200, y: 300 },
        { x: 400, y: 300, corner: 'sharp' },
        { x: 406, y: 300, corner: 'sharp' },
        { x: 600, y: 300 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const NEAR_SOURCE = JSON.stringify(NEAR_SCENE, null, 2);

/** On the shaft's ink, clear of both handles: where a press selects it. */
const NEAR_ON = { x: 250, y: 300 };

/** The place of the bend the pair takes: the handle of the point before the last. */
const NEAR_FIRST = { x: 400, y: 300 };

/** Four pixels from it, on the handle of the bend that took its index. */
const NEAR_NEXT = { x: 404, y: 300 };

/**
 * An arrow that leaves a box and comes back to it through one bend: the Scene
 * has such a loop, and its two-point self-loop is the one it does not.
 */
const LOOP_SCENE = {
  version: 1,
  title: 'A loop',
  defaults: { roughness: 0 },
  elements: [
    { id: 'page', type: 'rectangle', x: 0, y: 0, width: 800, height: 560 },
    { id: 'a', type: 'rectangle', x: 300, y: 400, width: 200, height: 100 },
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 400, y: 450, snap: 'a' },
        { x: 400, y: 200, corner: 'sharp' },
        { x: 450, y: 450, snap: 'a' },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const LOOP_SOURCE = JSON.stringify(LOOP_SCENE, null, 2);

/** On the arrow's left leg, above box `a`: where a press selects it. */
const LOOP_ON = { x: 375, y: 300 };

/** The bend between the two Snapped ends, where its handle sits. */
const LOOP_BEND = { x: 400, y: 200 };

/** The points of `LOOP_SCENE` as the file holds them, and as it must still hold them. */
const LOOP_POINTS: SavedPoint[] = [
  { x: 400, y: 450, snap: 'a' },
  { x: 400, y: 200, corner: 'sharp' },
  { x: 450, y: 450, snap: 'a' },
];

/**
 * The Scene files the `bends.json` fixture folder holds, by the name a person opens.
 * `A` is the folder every helper in this suite reads back.
 */
const SCENES = {
  A: {
    'bends.json': SHARP_SOURCE,
    'line.json': LINE_SOURCE,
    'snapped.json': SNAPPED_SOURCE,
    'shapes.json': SHAPES_SOURCE,
    'flat.json': FLAT_SOURCE,
    'plain.json': PLAIN_SOURCE,
    'bent.json': BENT_SOURCE,
    'bent-words.json': BENT_WORDS_SOURCE,
    'words.json': WORDS_SOURCE,
    'arch.json': ARCH_SOURCE,
    'snap-dot.json': SNAPPED_DOT_SOURCE,
    'tilted.json': TILTED_SOURCE,
    'short.json': SHORT_SOURCE,
    'on-bend.json': ON_BEND_SOURCE,
    'near.json': NEAR_SOURCE,
    'loop.json': LOOP_SOURCE,
  },
};

/** One point of a shaft as the editor saved it: every field a bend may carry. */
interface SavedPoint {
  x: number;
  y: number;
  snap?: string;
  corner?: string;
}

/** Open one of the bend fixtures. */
async function open(ui: Ui, name = 'bends.json'): Promise<void> {
  await openEditor(ui, SCENES, name);
}

/** The bytes of a saved Scene as the stub folder holds them, or undefined while there are none. */
async function savedSource(ui: Ui, name = 'bends.json'): Promise<string | undefined> {
  return (await savedFiles(ui))[name];
}

/** The whole `points` of the bent shaft in a saved Scene file, or null before it writes one. */
function pointsIn(source: string | undefined): SavedPoint[] | null {
  if (source === undefined) {
    return null;
  }
  const scene = JSON.parse(source) as SavedScene;
  return (scene.elements.find((element) => element.id === 'bent')?.points ??
    []) as unknown as SavedPoint[];
}

/** Wait for the editor's own write to land, then assert the shaft's whole `points`. */
async function expectPoints(
  ui: Ui,
  expected: SavedPoint[],
  name = 'bends.json',
): Promise<void> {
  await expect.poll(async () => pointsIn(await savedSource(ui, name))).toEqual(expected);
  expect(pointsIn(await savedSource(ui, name))).toEqual(expected);
}

describe('a segment dot', () => {
  test('a two-point line gains a point halfway along it, at zoom one', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'plain.json');

    await clickScene(ui, FLAT_DOT, [], FLAT);
    await drag(ui, at(FLAT_DOT, FLAT), at({ x: 400, y: 260 }, FLAT));

    await expectPoints(
      ui,
      [
        { x: 200, y: 300 },
        { x: 400, y: 260 },
        { x: 600, y: 300 },
      ],
      'plain.json',
    );
  });

  test('a two-point arrow gains a point at another zoom', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'flat.json');

    await clickScene(ui, FLAT_DOT, [], FLAT);
    await browser.keyboard.press('Meta+=');
    await expect(zoomReadout(ui)).toHaveText('120%');

    // The dot rides the ink, not the view: halfway along the shaft is still
    // halfway along it at 120%, which is where the drag finds it.
    await drag(ui, at(FLAT_DOT, FLAT_ZOOMED), at({ x: 400, y: 260 }, FLAT_ZOOMED));

    await expectPoints(
      ui,
      [
        { x: 200, y: 300 },
        { x: 400, y: 260 },
        { x: 600, y: 300 },
      ],
      'flat.json',
    );
  });

  test('a two-point line gains a point at another zoom', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'plain.json');

    await clickScene(ui, FLAT_DOT, [], FLAT);
    await browser.keyboard.press('Meta+=');
    await expect(zoomReadout(ui)).toHaveText('120%');

    await drag(ui, at(FLAT_DOT, FLAT_ZOOMED), at({ x: 400, y: 260 }, FLAT_ZOOMED));

    await expectPoints(
      ui,
      [
        { x: 200, y: 300 },
        { x: 400, y: 260 },
        { x: 600, y: 300 },
      ],
      'plain.json',
    );
  });

  test('the first segment of a bent shaft inserts at the first index', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent.json');

    await clickScene(ui, { x: 150, y: 300 }, [], BENT);
    await drag(ui, at(FIRST_DOT, BENT), at({ x: 287, y: 320 }, BENT));

    // The new point is the second one, between the end and the corner, and the
    // corner keeps the `sharp` it was stored with.
    await expectPoints(
      ui,
      [
        { x: 101, y: 300 },
        { x: 287, y: 320 },
        { x: 400, y: 300, corner: 'sharp' },
        { x: 400, y: 501 },
      ],
      'bent.json',
    );
  });

  test('the last segment of a bent shaft inserts at the last index', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent.json');

    await clickScene(ui, { x: 400, y: 450 }, [], BENT);
    await drag(ui, at(LAST_DOT, BENT), at({ x: 360, y: 384 }, BENT));

    // The new point is the third one, between the corner and the end: the last
    // segment, not the one before the corner.
    await expectPoints(
      ui,
      [
        { x: 101, y: 300 },
        { x: 400, y: 300, corner: 'sharp' },
        { x: 360, y: 384 },
        { x: 400, y: 501 },
      ],
      'bent.json',
    );
  });

  test('the dot of a curved segment sits on the curve, not on the chord', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'arch.json');

    // The curve's own ink is what says where halfway along it is: the column it
    // crosses at x = 400 holds the middle of the middle leg and nothing else.
    const ink = (await shot(ui)).darkBounds(ARCH_COLUMN, 0.6);
    expect(ink).not.toBeNull();
    const mid = (ink as Rect).y + (ink as Rect).height / 2;
    const on = { x: 400, y: mid - ARCH.panY };

    // The chord's middle is bare paper: a dot there would be a dot on nothing.
    expect((await shot(ui)).darkCount(ARCH_CHORD, 0.7)).toBe(0);

    await clickScene(ui, on, [], ARCH);
    await drag(ui, at(on, ARCH), at({ x: 400, y: on.y + 30 }, ARCH));

    // Pulled out at the ink's own middle, which is 19px above the chord's.
    await expectPoints(
      ui,
      [
        { x: 300, y: 300 },
        { x: 350, y: 200 },
        { x: 400, y: 219 },
        { x: 450, y: 200 },
        { x: 500, y: 300 },
      ],
      'arch.json',
    );
    // And the place the drag pressed is the ink the column measured, so the dot
    // went where the curve runs and not where the chord would put it.
    expect(Math.abs(mid + 30 - 219 - ARCH.panY)).toBeLessThanOrEqual(1);
  });

  test('dragging a dot keeps both Snaps of the shaft it was pulled out of', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snap-dot.json');

    await clickScene(ui, SNAPPED_MIDDLE, [], SNAPPED_DOT);
    await drag(ui, at(SNAPPED_MIDDLE, SNAPPED_DOT), at({ x: 350, y: 231.111 }, SNAPPED_DOT));

    await expectPoints(
      ui,
      [
        { x: 150, y: 150, snap: 'a' },
        { x: 350, y: 231 },
        { x: 600, y: 400, snap: 'b' },
      ],
      'snap-dot.json',
    );
  });

  test('a point pulled out of a dot over a box gets no Snap', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snap-dot.json');

    await clickScene(ui, SNAPPED_MIDDLE, [], SNAPPED_DOT);
    // Into the middle of box `b`: an end dropped there attaches, and a point
    // pulled out of a shaft's ink is a bend and only a bend.
    await drag(ui, at(SNAPPED_MIDDLE, SNAPPED_DOT), at({ x: 580, y: 380 }, SNAPPED_DOT));

    await expectPoints(
      ui,
      [
        { x: 150, y: 150, snap: 'a' },
        { x: 580, y: 380 },
        { x: 600, y: 400, snap: 'b' },
      ],
      'snap-dot.json',
    );
  });

  test('a click on a dot inserts nothing, and the dot still pulls a point out', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'flat.json');

    await clickScene(ui, FLAT_DOT, [], FLAT);
    // Long enough that the second press is a click of its own, never the second
    // half of a double-click: the dot is a click on the shaft and nothing else.
    await sleep(600);
    await clickScene(ui, FLAT_DOT, [], FLAT);
    await settle(ui);

    // No point, and no step of its own: a click that carried nothing is not a
    // Scene, so both points are still the ones the file held.
    expect(pointsIn(await savedSource(ui, 'flat.json'))).toEqual([
      { x: 200, y: 300 },
      { x: 600, y: 300 },
    ]);

    // And the click took nothing away: the same dot still pulls a point out.
    await drag(ui, at(FLAT_DOT, FLAT), at({ x: 400, y: 260 }, FLAT));
    await expectPoints(
      ui,
      [
        { x: 200, y: 300 },
        { x: 400, y: 260 },
        { x: 600, y: 300 },
      ],
      'flat.json',
    );
  });

  test('a double-click at a dot opens the words, from unselected', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent-words.json');

    // The first click selects the shaft and its dot appears under the pointer
    // with the next frame; the second click presses that dot, which is still a
    // click on the shaft there, so the words the first click found open. Two
    // frames are what the dot needs and all this waits: the two clicks are still
    // one double-click by the editor's own clock, with none of its half second
    // spent on a fixed gap that a loaded machine could stretch.
    await clickScene(ui, FIRST_DOT, [], BENT);
    await settle(ui);
    await clickScene(ui, FIRST_DOT, [], BENT);

    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('bend words');
    // Nothing was pulled out of the shaft on the way.
    expect(pointsIn(await savedSource(ui, 'bent-words.json'))).toEqual([
      { x: 101, y: 300 },
      { x: 400, y: 300, corner: 'sharp' },
      { x: 400, y: 501 },
    ]);
  });

  test('a double-click whose second press comes before the dot is painted opens the words', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent-words.json');

    // The two clicks the browser sends back to back: the first selects the
    // shaft, and the frame that paints its dot has not come when the second
    // lands, so the second press is the ink the dot is drawn over — still a
    // click on the shaft there, so the words the first click found open.
    await doubleClickScene(ui, FIRST_DOT, BENT);

    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('bend words');
    // Nothing was pulled out of the shaft on the way.
    expect(pointsIn(await savedSource(ui, 'bent-words.json'))).toEqual([
      { x: 101, y: 300 },
      { x: 400, y: 300, corner: 'sharp' },
      { x: 400, y: 501 },
    ]);
  });

  test('a double-click at a dot opens the words, from selected', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'bent-words.json');

    await clickScene(ui, { x: 150, y: 300 }, [], BENT);
    await sleep(600);
    await doubleClickScene(ui, FIRST_DOT, BENT);

    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('bend words');
    expect(pointsIn(await savedSource(ui, 'bent-words.json'))).toEqual([
      { x: 101, y: 300 },
      { x: 400, y: 300, corner: 'sharp' },
      { x: 400, y: 501 },
    ]);
  });

  test('words painted over a dot drag the Label, not the point', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'words.json');

    await clickScene(ui, { x: 250, y: 300 }, [], FLAT);
    // The words stand on the shaft's own middle, over the dot: the words win the
    // press, as the cue drawn after the handles says they do.
    await drag(ui, at({ x: 400, y: 300 }, FLAT), at({ x: 450, y: 300 }, FLAT));

    const scene = await savedScene(ui, 'words.json');
    const shaft = scene.elements.find((element) => element.id === 'bent');
    expect(shaft?.points).toEqual([
      { x: 200, y: 300 },
      { x: 600, y: 300 },
    ]);
    expect(shaft?.labelAt?.t).toBe(0.625);
  });

  test('Escape mid-drag drops the new point and leaves the file as it was', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'flat.json');

    await clickScene(ui, FLAT_DOT, [], FLAT);
    const from = at(FLAT_DOT, FLAT);
    await drag(ui, from, { x: from.x, y: from.y - 40 }, 'left', async () => {
      await browser.keyboard.press('Escape');
    });
    await settle(ui);

    // Half a drag is not a Scene: the point it was pulling out is dropped, and
    // the selection it started from is kept.
    expect(pointsIn(await savedSource(ui, 'flat.json'))).toEqual([
      { x: 200, y: 300 },
      { x: 600, y: 300 },
    ]);
    await expect(screen.getByRole('dialog', 'Style')).toBeVisible();
  });

  test('one undo takes the pulled-out point back, and redo returns it', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'flat.json');

    await clickScene(ui, FLAT_DOT, [], FLAT);
    await drag(ui, at(FLAT_DOT, FLAT), at({ x: 400, y: 260 }, FLAT));
    await expectPoints(
      ui,
      [
        { x: 200, y: 300 },
        { x: 400, y: 260 },
        { x: 600, y: 300 },
      ],
      'flat.json',
    );

    await browser.keyboard.press('Meta+z');
    await expectPoints(
      ui,
      [
        { x: 200, y: 300 },
        { x: 600, y: 300 },
      ],
      'flat.json',
    );

    await browser.keyboard.press('Shift+Meta+z');
    await expectPoints(
      ui,
      [
        { x: 200, y: 300 },
        { x: 400, y: 260 },
        { x: 600, y: 300 },
      ],
      'flat.json',
    );
  });

  test('a dot is ink drawn on the shaft, and a smaller mark than a handle', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'tilted.json');
    // The Grid's own dots are ink too: the page holds nothing but the shaft and
    // the marks its selection paints, so a pixel beside its ink is a mark or paper.
    await browser.keyboard.press('g');

    const centre = at(TILTED_DOT, TILTED);
    const probe = (away: number): Rect => ({
      x: centre.x + ACROSS.x * away,
      y: centre.y + ACROSS.y * away,
      width: 1,
      height: 1,
    });

    // Nothing but the ink is painted beside the line yet.
    expect((await shot(ui)).darkCount(probe(2), 0.85)).toBe(0);
    await clickScene(ui, TILTED_DOT, [], TILTED);

    const selected = await shot(ui);
    // Halfway along the line, 2px off its ink, the dot is painted; 4px off it
    // there is paper, which an eight-pixel handle's corner would not leave.
    expect(selected.darkCount(probe(2), 0.85)).toBe(1);
    expect(selected.darkCount(probe(4), 0.85)).toBe(0);
    const handle = at({ x: 200, y: 200 }, TILTED);
    expect(selected.darkCount(pixelAt(handle, 4, -4), 0.6)).toBeGreaterThan(0);
  });

  test('a dot keeps its screen size at another zoom', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'tilted.json');
    await browser.keyboard.press('g');

    await clickScene(ui, TILTED_DOT, [], TILTED);
    await browser.keyboard.press('Meta+=');
    await expect(zoomReadout(ui)).toHaveText('120%');

    // The page spreads; the mark halfway along the line does not: it is still a
    // small disc about the ink, not a disc drawn twice as wide.
    const centre = at(TILTED_DOT, TILTED_ZOOMED);
    const probe = (away: number): Rect => ({
      x: centre.x + ACROSS.x * away,
      y: centre.y + ACROSS.y * away,
      width: 1,
      height: 1,
    });
    const zoomed = await shot(ui);
    expect(zoomed.darkCount(probe(2), 0.85)).toBe(1);
    expect(zoomed.darkCount(probe(4), 0.85)).toBe(0);
  });
  test('a dot that would land on a handle is left off', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'short.json');
    await browser.keyboard.press('g');

    await clickScene(ui, { x: 200, y: 300 }, [], SHORT);
    const selected = await shot(ui);

    // The long legs pull bends out of their middles, and the short one, whose dot
    // would sit on the corner handles either side, carries no mark at all: a
    // press there is the corner's, not a bend the shaft does not have.
    expect(selected.darkCount(FIRST_LEG_INK, 0.85)).toBe(1);
    expect(selected.darkCount(SHORT_LEG_INK, 0.85)).toBe(0);
  });
  test('a press where a dot was left off moves the shaft instead of adding a point', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'short.json');

    await clickScene(ui, { x: 200, y: 300 }, [], SHORT);
    // The press lands on the place the short leg's dot would hold, where the
    // page paints no dot at all: nothing there is a mark a press could pull a
    // bend out of, so the press is the one the shaft's own ink takes — a move,
    // with no point added and no point taken away. The place is six pixels from
    // the corner handles either side of it, so neither square is under it.
    await drag(ui, at({ x: 400, y: 306 }, SHORT), at({ x: 440, y: 336 }, SHORT));

    await expectPoints(
      ui,
      [
        { x: 140, y: 330 },
        { x: 440, y: 330, corner: 'sharp' },
        { x: 440, y: 342, corner: 'sharp' },
        { x: 440, y: 550 },
      ],
      'short.json',
    );
  });
});

describe('a dot on a page that may only read', () => {
  test('a selected shaft loses its dots when write access ends', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'flat.json');
    // The Grid's own dots are ink too: with the Grid off, a pixel two above the
    // shaft's middle is its dot's ink or paper.
    await browser.keyboard.press('g');

    await clickScene(ui, FLAT_DOT, [], FLAT);
    // The mark is painted two pixels above the ink it is halfway along.
    const writable = await shot(ui);
    expect(writable.darkCount(dotInkAt(shaftMiddle(writable)), 0.85)).toBe(1);

    // An edit asks the folder to write, and the folder answers `403`: this page
    // may only read from now on.
    await holdWrites(ui, 'flat.json');
    await browser.keyboard.press('Shift+ArrowRight');
    await refuseWrite(ui, 'this folder is served read-only');
    await expect(screen.getByText('read-only')).toBeVisible();

    // No pointer moved and no tool is in hand: the page said what it may now do,
    // and what it may do is not pull a bend out of a selected shaft.
    await settle(ui);
    const readOnly = await shot(ui);
    expect(readOnly.darkCount(dotInkAt(shaftMiddle(readOnly)), 0.85)).toBe(0);
    await allowWrites(ui);
  });

  test('a read-only page draws no dot on a shaft a press selects', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'flat.json');
    await browser.keyboard.press('g');

    // An edit asks the folder to write, and the folder answers `403`: this page
    // may only read from now on.
    await clickScene(ui, FLAT_DOT, [], FLAT);
    await holdWrites(ui, 'flat.json');
    await browser.keyboard.press('Shift+ArrowRight');
    await refuseWrite(ui, 'this folder is served read-only');
    await expect(screen.getByText('read-only')).toBeVisible();

    // Nothing is in hand, and a press selects the shaft as it always did — a
    // page that may only read is an editor — but the shaft it selected carries
    // no mark a press could not take.
    await clickScene(ui, { x: 850, y: 500 }, [], FLAT);
    await clickScene(ui, { x: 450, y: 300 }, [], FLAT);
    await settle(ui);
    const selected = await shot(ui);
    expect(selected.darkCount(dotInkAt(shaftMiddle(selected)), 0.85)).toBe(0);
    await expect(screen.getByRole('dialog', 'Style')).toBeVisible();
  });
});

describe('a bend point handle', () => {
  test('a sharp bend of an arrow drags to a new place, at zoom one', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, SHARP_ON, [], SHARP);
    await drag(ui, at(SHARP_BEND, SHARP), at({ x: 340, y: 270 }, SHARP));

    await expectPoints(ui, [
      { x: 50, y: 50 },
      { x: 340, y: 270, corner: 'sharp' },
      { x: 550, y: 50 },
    ]);
  });

  test('a round bend of a line drags at another zoom, keeping the Element its corner', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'line.json');

    await clickScene(ui, LINE_BEND, [], LINE);
    await browser.keyboard.press('Meta+=');
    await expect(zoomReadout(ui)).toHaveText('120%');

    const from = at(LINE_BEND, LINE_ZOOMED);
    await drag(ui, from, { x: from.x + 60, y: from.y - 24 });

    await expectPoints(
      ui,
      [
        { x: 150, y: 300 },
        { x: 400, y: 160 },
        { x: 600, y: 300 },
      ],
      'line.json',
    );
    const scene = await savedScene(ui, 'line.json');
    expect(scene.elements.find((element) => element.id === 'bent')?.corners).toBe('round');
  });

  test('dragging a bend keeps both Snaps and the other bend', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');

    await clickScene(ui, SNAPPED_ON, [], SNAPPED);
    await drag(ui, at(SNAPPED_BEND, SNAPPED), at({ x: 390, y: 220 }, SNAPPED));

    await expectPoints(
      ui,
      [
        { x: 150, y: 150, snap: 'a' },
        { x: 390, y: 220, corner: 'sharp' },
        { x: 550, y: 300, corner: 'round' },
        { x: 650, y: 350, snap: 'b' },
      ],
      'snapped.json',
    );
  });

  test('dropping a bend over a box does not Snap it', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');

    await clickScene(ui, SNAPPED_ON, [], SNAPPED);
    // From the sharp bend into the middle of box `a`: an end there would attach,
    // and a bend dropped there is a bend and only a bend.
    await drag(ui, at(SNAPPED_BEND, SNAPPED), at({ x: 120, y: 120 }, SNAPPED));

    await expectPoints(
      ui,
      [
        { x: 150, y: 150, snap: 'a' },
        { x: 120, y: 120, corner: 'sharp' },
        { x: 550, y: 300, corner: 'round' },
        { x: 650, y: 350, snap: 'b' },
      ],
      'snapped.json',
    );
  });

  test('a click on a bend handle writes nothing, and one undo takes the whole drag back', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, SHARP_ON, [], SHARP);
    const handle = at(SHARP_BEND, SHARP);
    await drag(ui, handle, at({ x: 340, y: 270 }, SHARP));
    await expectPoints(ui, DRAGGED_POINTS);
    const dragged = await savedSource(ui);

    // A press and release on the handle is a click on it: no write, no step.
    await clickScene(ui, { x: 340, y: 270 }, [], SHARP);
    await settle(ui);
    expect(await savedSource(ui)).toBe(dragged);
    // The first undo takes the drag back, so the click recorded no step of its
    // own: a history it had written would be the one undone here instead.
    await browser.keyboard.press('Meta+z');
    await expectPoints(ui, SHARP_POINTS);
    // And the drag is one step forward again.
    await browser.keyboard.press('Shift+Meta+z');
    await expectPoints(ui, DRAGGED_POINTS);
  });

  test('Escape mid-drag leaves the file, the history and the shaft as they were', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, SHARP_ON, [], SHARP);
    await drag(ui, at(SHARP_BEND, SHARP), at({ x: 340, y: 270 }, SHARP));
    await expectPoints(ui, DRAGGED_POINTS);
    const dragged = await savedSource(ui);
    const before = (await shot(ui)).darkBounds(SHARP_AREA, 0.6);

    // Half a drag is not a Scene: Escape drops the preview, and the release
    // that follows it settles nothing.
    const from = at({ x: 340, y: 270 }, SHARP);
    await drag(ui, from, { x: from.x + 40, y: from.y + 20 }, 'left', async () => {
      await browser.keyboard.press('Escape');
    });
    await settle(ui);

    expect(await savedSource(ui)).toBe(dragged);
    expect((await shot(ui)).darkBounds(SHARP_AREA, 0.6)).toEqual(before);
    // The selection is kept, and so is the single step the drag earned: the
    // first undo still takes that drag back, not a second one.
    await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();
    await browser.keyboard.press('Meta+z');
    await expectPoints(ui, SHARP_POINTS);
  });

  test('a sharp bend is marked by a square', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'shapes.json');
    await clickScene(ui, SHAPES_ON, [], SHAPES);

    // A square's corner reaches past where a circle of the same eight pixels
    // stops, so ink there is the square and only the square.
    const corner = pixelAt(at(SHARP_MARK, SHAPES), 4, -4);
    expect((await shot(ui)).darkCount(corner, 0.6)).toBeGreaterThan(0);
  });

  test('a round bend is marked by a circle', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'shapes.json');
    await clickScene(ui, SHAPES_ON, [], SHAPES);
    const painted = await shot(ui);

    // The circle's stroke crosses the diagonal inside the square's corner: ink
    // there is the circle's, and a square of the same size is bare fill.
    const stroke = pixelAt(at(ROUND_MARK, SHAPES), 3, -3);
    expect(painted.darkCount(stroke, 0.6)).toBeGreaterThan(0);
    const corner = pixelAt(at(ROUND_MARK, SHAPES), 4, -4);
    expect(painted.darkCount(corner, 0.6)).toBe(0);
  });
});

/**
 * Two clicks on one bend handle remove that point: the editor's own
 * double-click, so the point dies under the second click of a pair and under no
 * other press. What is left is the shaft the pair aimed at, whole points and
 * all, and the Scene's own rule that a two-point shaft cannot loop back to one
 * Element is what a removal may not write.
 */
describe('a double-click on a bend handle', () => {
  test('removes a sharp bend and saves the two points around it', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, SHARP_ON, [], SHARP);
    await settle(ui);
    await doubleClickScene(ui, SHARP_BEND, SHARP);

    await expectPoints(ui, [
      { x: 50, y: 50 },
      { x: 550, y: 50 },
    ]);
  });

  test('removes a middle bend and keeps the one after it', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'shapes.json');

    await clickScene(ui, SHAPES_ON, [], SHAPES);
    await settle(ui);
    await doubleClickScene(ui, SHARP_MARK, SHAPES);

    // The round bend's place, its corner and the ends either side of it are the
    // Scene's own: only the point pressed is gone.
    await expectPoints(
      ui,
      [
        { x: 150, y: 300 },
        { x: 500, y: 180, corner: 'round' },
        { x: 650, y: 300 },
      ],
      'shapes.json',
    );
  });

  test('removes the last bend and keeps both Snaps and the one before it', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');

    await clickScene(ui, SNAPPED_ON, [], SNAPPED);
    await settle(ui);
    await doubleClickScene(ui, { x: 550, y: 300 }, SNAPPED);

    await expectPoints(
      ui,
      [
        { x: 150, y: 150, snap: 'a' },
        { x: 350, y: 200, corner: 'sharp' },
        { x: 650, y: 350, snap: 'b' },
      ],
      'snapped.json',
    );
  });

  test('removes a round bend of a line at another zoom, leaving two points', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'line.json');

    await clickScene(ui, LINE_BEND, [], LINE);
    await browser.keyboard.press('Meta+=');
    await expect(zoomReadout(ui)).toHaveText('120%');
    // The readout is the page's own text, and the handles are a frame behind
    // it: the frame that paints them at 120% is the one the pair must land on.
    await settle(ui);

    await doubleClickScene(ui, LINE_BEND, LINE_ZOOMED);

    await expectPoints(
      ui,
      [
        { x: 150, y: 300 },
        { x: 600, y: 300 },
      ],
      'line.json',
    );
  });

  test('a removal that would leave a two-point loop writes nothing', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'loop.json');

    await clickScene(ui, LOOP_ON, [], SHAPES);
    await settle(ui);
    const before = await savedSource(ui, 'loop.json');
    await doubleClickScene(ui, LOOP_BEND, SHAPES);
    await settle(ui);

    // Both ends of the two points left would Snap to box `a`, and the Scene has
    // no such arrow: the file is the one the pair found, bytes and all.
    expect(await savedSource(ui, 'loop.json')).toBe(before);
    await expectPoints(ui, LOOP_POINTS, 'loop.json');
  });

  test('a double-click that starts on an unselected shaft deletes nothing', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    // No handle is painted on an unselected shaft, so the first press takes the
    // ink and only selects the arrow; the frame that paints the handle the
    // selection earned has come when the second press lands on it.
    const before = await savedSource(ui);
    await clickScene(ui, SHARP_BEND, [], SHARP);
    await settle(ui);
    await clickScene(ui, SHARP_BEND, [], SHARP);
    await settle(ui);

    expect(await savedSource(ui)).toBe(before);
    await expectPoints(ui, SHARP_POINTS);
    // The two presses are not a pair, so the arrow's words never open on them.
    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveCount(0);
  });

  test('a click on the shaft and a quick double-click on the handle removes the point', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    // The selection click lands where the bend is, on the ink of a shaft that
    // paints no handle yet; the frame after it paints the handle, and the pair
    // follows inside the same half second. The click took no handle, so it
    // pairs with nothing and opens nothing: the pair after it is two presses on
    // the one handle.
    await clickScene(ui, SHARP_BEND, [], SHARP);
    await settle(ui);
    await doubleClickScene(ui, SHARP_BEND, SHARP);

    await expectPoints(ui, [
      { x: 50, y: 50 },
      { x: 550, y: 50 },
    ]);
    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveCount(0);
  });

  test('a click on the handle deletes nothing', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, SHARP_ON, [], SHARP);
    await settle(ui);
    const before = await savedSource(ui);
    await clickScene(ui, SHARP_BEND, [], SHARP);
    await settle(ui);

    expect(await savedSource(ui)).toBe(before);
    await expectPoints(ui, SHARP_POINTS);
  });

  test('two slow clicks delete nothing', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, SHARP_ON, [], SHARP);
    await settle(ui);
    const before = await savedSource(ui);
    // A wait that outlasts the editor's own half second: the two presses are a
    // click and a click, and the point they land on stays.
    await clickScene(ui, SHARP_BEND, [], SHARP);
    await sleep(600);
    await clickScene(ui, SHARP_BEND, [], SHARP);
    await settle(ui);

    expect(await savedSource(ui)).toBe(before);
    await expectPoints(ui, SHARP_POINTS);
  });

  test('two Shift clicks delete nothing', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, SHARP_ON, [], SHARP);
    await settle(ui);
    const before = await savedSource(ui);
    // A Shift press is about the selection, never half of a double-click: the
    // key is held across both, so the presses are one pair by place and clock.
    await browser.keyboard.down('Shift');
    await clickScene(ui, SHARP_BEND, [], SHARP);
    await clickScene(ui, SHARP_BEND, [], SHARP);
    await browser.keyboard.up('Shift');
    await settle(ui);

    expect(await savedSource(ui)).toBe(before);
    await expectPoints(ui, SHARP_POINTS);
  });

  test('a drag of the handle and the click after it delete nothing', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, SHARP_ON, [], SHARP);
    await settle(ui);
    await drag(ui, at(SHARP_BEND, SHARP), at({ x: 340, y: 270 }, SHARP));
    await expectPoints(ui, DRAGGED_POINTS);

    // A press that carried the pointer is a drag, and the click that follows it
    // starts a sequence of its own: the handle is not pressed twice.
    await clickScene(ui, { x: 340, y: 270 }, [], SHARP);
    await settle(ui);

    await expectPoints(ui, DRAGGED_POINTS);
  });

  test('the arrow’s words never open on the pair that removes a point', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'on-bend.json');

    await clickScene(ui, ON_BEND_ON, [], SHAPES);
    await settle(ui);
    // The note is docked beside the selection, and the arrow the pair edits
    // carries words of its own.
    await expect(screen.getByRole('dialog', 'Style')).toBeVisible();
    await doubleClickScene(ui, ON_BEND_BEND, SHAPES);

    await expectPoints(
      ui,
      [
        { x: 200, y: 400 },
        { x: 600, y: 400 },
      ],
      'on-bend.json',
    );
    // The pair is the point's: the arrow's words are not what was clicked.
    await expect(screen.getByRole('textbox', { name: 'Label' })).toHaveCount(0);
  });

  test('a third quick click takes no second point', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui, 'near.json');

    await clickScene(ui, NEAR_ON, [], SHAPES);
    await settle(ui);
    await doubleClickScene(ui, NEAR_FIRST, SHAPES);
    // The frame the pair's own write asks for paints the handle of the bend
    // that took the removed point's index, four pixels from where the pointer
    // is: the click that lands on it is still the pair's own half second, and
    // the pair is over, so it is the first click of a new one and takes nothing.
    await settle(ui);
    await clickScene(ui, NEAR_NEXT, [], SHAPES);

    await expectPoints(
      ui,
      [
        { x: 200, y: 300 },
        { x: 406, y: 300, corner: 'sharp' },
        { x: 600, y: 300 },
      ],
      'near.json',
    );
  });

  test('a page that may only read deletes nothing', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await clickScene(ui, SHARP_ON, [], SHARP);
    await settle(ui);

    // An edit asks the folder to write, and the folder answers `403`: this page
    // may only read from now on. The arrow is in hand the ten pixels the Shift
    // nudge carried it, though no byte of that move ever landed.
    await holdWrites(ui, 'bends.json');
    await browser.keyboard.press('Shift+ArrowRight');
    await refuseWrite(ui, 'this folder is served read-only');
    await expect(screen.getByText('read-only')).toBeVisible();
    const bend = { x: SHARP_BEND.x + 10, y: SHARP_BEND.y };

    const before = await savedSource(ui);
    await doubleClickScene(ui, bend, SHARP);
    await settle(ui);

    expect(await savedSource(ui)).toBe(before);
    await expectPoints(ui, SHARP_POINTS);
    // The point the pair pressed is still there to press: the square its handle
    // paints on the corner is the one a page that may only read still draws.
    const corner = pixelAt(at(bend, SHARP), 4, -4);
    expect((await shot(ui)).darkCount(corner, 0.6)).toBeGreaterThan(0);
    await allowWrites(ui);
  });

  test('one undo returns the point whole, and redo removes it again', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, SHARP_ON, [], SHARP);
    await settle(ui);
    await doubleClickScene(ui, SHARP_BEND, SHARP);
    await expectPoints(ui, [
      { x: 50, y: 50 },
      { x: 550, y: 50 },
    ]);

    // One step, so one undo is the whole point back, `corner` and all.
    await browser.keyboard.press('Meta+z');
    await expectPoints(ui, SHARP_POINTS);
    await browser.keyboard.press('Shift+Meta+z');
    await expectPoints(ui, [
      { x: 50, y: 50 },
      { x: 550, y: 50 },
    ]);
  });
});

/**
 * A press on a bend handle picks the point it holds: the handle fills with the
 * selection's colour, keeps its shape and its size, and the shaft it is a point
 * of stays selected. The point is one press's, so a pan or a zoom keeps it and
 * the next press lets it go; a drag the person cancels, and a press on a dot,
 * pick nothing at all.
 */
describe('a selected bend point', () => {
  test('a click on a sharp bend fills its square, and the arrow keeps the selection', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'shapes.json');
    await clickScene(ui, SHAPES_ON, [], SHAPES);
    await settle(ui);

    const mark = at(SHARP_MARK, SHAPES);
    // Unselected, the handle is the paper inside its own stroke.
    expect((await shot(ui)).meanLuminance(handleFill(mark))).toBeGreaterThan(0.85);
    await clickScene(ui, SHARP_MARK, [], SHAPES);
    await settle(ui);

    // Selected, the same square is filled with the selection's blue: the light
    // theme's `--sel` is 0.35 on this page, its paper 0.97 and its ink 0.10.
    const painted = await shot(ui);
    expect(painted.meanLuminance(handleFill(mark))).toBeGreaterThan(0.2);
    expect(painted.meanLuminance(handleFill(mark))).toBeLessThan(0.5);
    // A square still: its corner reaches where a circle of eight pixels cannot.
    expect(painted.darkCount(pixelAt(mark, 4, -4), 0.6)).toBeGreaterThan(0);
    await expect(screen.getByRole('dialog', 'Style')).toBeVisible();
  });

  test('a drag of a round bend selects the point where it lands, at another zoom', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'line.json');

    await clickScene(ui, LINE_BEND, [], LINE);
    await browser.keyboard.press('Meta+=');
    await expect(zoomReadout(ui)).toHaveText('120%');
    await settle(ui);

    await drag(ui, at(LINE_BEND, LINE_ZOOMED), at({ x: 390, y: 220 }, LINE_ZOOMED));
    await expectPoints(
      ui,
      [
        { x: 150, y: 300 },
        { x: 390, y: 220 },
        { x: 600, y: 300 },
      ],
      'line.json',
    );

    // The point the release left is the one the press picked, at a zoom the
    // handle keeps its eight pixels through.
    const mark = at({ x: 390, y: 220 }, LINE_ZOOMED);
    const painted = await shot(ui);
    expect(painted.meanLuminance(handleFill(mark))).toBeGreaterThan(0.2);
    expect(painted.meanLuminance(handleFill(mark))).toBeLessThan(0.5);
    // A circle still: its stroke crosses the diagonal and its corner is bare.
    expect(painted.darkCount(pixelAt(mark, 3, -3), 0.6)).toBeGreaterThan(0);
    expect(painted.darkCount(pixelAt(mark, 4, -4), 0.6)).toBe(0);
    await expect(screen.getByRole('dialog', 'Style')).toBeVisible();
  });

  test('a press on another handle moves the one point the selection holds', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'shapes.json');
    await clickScene(ui, SHAPES_ON, [], SHAPES);
    await settle(ui);
    await clickScene(ui, SHARP_MARK, [], SHAPES);
    await settle(ui);
    await clickScene(ui, ROUND_MARK, [], SHAPES);
    await settle(ui);

    const painted = await shot(ui);
    expect(painted.meanLuminance(handleFill(at(ROUND_MARK, SHAPES)))).toBeLessThan(0.5);
    // The point before it is the paper again: one point, never two.
    expect(painted.meanLuminance(handleFill(at(SHARP_MARK, SHAPES)))).toBeGreaterThan(0.85);
  });

  test('a round bend is filled in the dark theme too, and marked by a circle', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'line.json');
    // The page's own switch, which the served page starts on light.
    await screen.getByRole('button', { name: 'Dark' }).click();
    await clickScene(ui, LINE_BEND, [], LINE);
    await browser.keyboard.press('Meta+=');
    await expect(zoomReadout(ui)).toHaveText('120%');
    await settle(ui);

    const mark = at(LINE_BEND, LINE_ZOOMED);
    // The dark theme's paper is 0.09, and the handle is drawn on it.
    expect((await shot(ui)).meanLuminance(handleFill(mark))).toBeLessThan(0.3);
    await clickScene(ui, LINE_BEND, [], LINE_ZOOMED);
    await settle(ui);

    // `--sel` is 0.67 in the dark theme: the fill is the selection's, not the
    // ink's 0.90 or the paper's 0.09. The corner stays bare, so it is a circle.
    const painted = await shot(ui);
    expect(painted.meanLuminance(handleFill(mark))).toBeGreaterThan(0.5);
    expect(painted.meanLuminance(handleFill(mark))).toBeLessThan(0.8);
    expect(painted.meanLuminance(pixelAt(mark, 4, -4))).toBeLessThan(0.3);
  });

  test('a press on a dot picks no point, and the key behind it deletes the shaft', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    // The first press selects the arrow, and the frame after it paints a dot on
    // the segment the press did not land on.
    const dot = { x: 425, y: 150 };
    await clickScene(ui, SHARP_ON, [], SHARP);
    await settle(ui);
    const before = await savedSource(ui);
    await clickScene(ui, dot, [], SHARP);
    await settle(ui);
    expect(await savedSource(ui)).toBe(before);

    // A press on a dot pulls a point out of the ink or does nothing: it picks no
    // point, so the key goes on to the arrow and the whole shaft goes.
    await browser.keyboard.press('Backspace');
    await settle(ui);

    expect(await savedSource(ui)).toContain('"elements": []');
    await expectPoints(ui, []);
  });

  test('a cancelled drag picks no point, and the key behind it deletes the shaft', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await clickScene(ui, SHARP_ON, [], SHARP);
    await settle(ui);
    const before = await savedSource(ui);

    const from = at(SHARP_BEND, SHARP);
    await drag(ui, from, { x: from.x + 40, y: from.y + 20 }, 'left', async () => {
      await browser.keyboard.press('Escape');
    });
    await settle(ui);
    expect(await savedSource(ui)).toBe(before);

    // Half a drag is not a press: it picked nothing, so the key takes the shaft.
    await browser.keyboard.press('Backspace');
    await settle(ui);
    await expectPoints(ui, []);
  });
});

/**
 * The delete action acts on the point the selection holds before it acts on the
 * Elements: Backspace, Delete, the letter and the palette all remove that one
 * point, as one history step and one write, and the shaft stays selected and in
 * the Scene. A point the Scene cannot remove — the last bend of a self-loop —
 * stays, and nothing is written.
 */
describe('a key on a selected bend point', () => {
  test('Backspace removes the selected sharp point and keeps every other point', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'snapped.json');
    await clickScene(ui, SNAPPED_ON, [], SNAPPED);
    await settle(ui);
    await clickScene(ui, SNAPPED_BEND, [], SNAPPED);
    await settle(ui);

    await browser.keyboard.press('Backspace');
    await expectPoints(
      ui,
      [
        { x: 150, y: 150, snap: 'a' },
        { x: 550, y: 300, corner: 'round' },
        { x: 650, y: 350, snap: 'b' },
      ],
      'snapped.json',
    );
    // The shaft kept the selection: the note is still there to say so.
    await expect(screen.getByRole('dialog', 'Style')).toBeVisible();
  });

  test('Delete removes the selected round point of a line at another zoom', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'line.json');
    await clickScene(ui, LINE_BEND, [], LINE);
    await browser.keyboard.press('Meta+=');
    await expect(zoomReadout(ui)).toHaveText('120%');
    await settle(ui);
    await clickScene(ui, LINE_BEND, [], LINE_ZOOMED);
    await settle(ui);

    await browser.keyboard.press('Delete');
    await expectPoints(
      ui,
      [
        { x: 150, y: 300 },
        { x: 600, y: 300 },
      ],
      'line.json',
    );
    const painted = await shot(ui);
    // No point is held any more, so no handle is filled.
    expect(painted.meanLuminance(handleFill(at(LINE_BEND, LINE_ZOOMED)))).toBeGreaterThan(0.85);
  });

  test('the palette’s Delete removes the point, whatever started it', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await clickScene(ui, SHARP_ON, [], SHARP);
    await settle(ui);
    await clickScene(ui, SHARP_BEND, [], SHARP);
    await settle(ui);

    await palette(ui);
    await browser.keyboard.type('delete');
    await command(ui, 'Delete · X · ⌫ · Del').click();

    await expectPoints(ui, [
      { x: 50, y: 50 },
      { x: 550, y: 50 },
    ]);
  });

  test('the last bend of a self-loop stays, and the arrow with it', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, 'loop.json');
    await clickScene(ui, LOOP_ON, [], SHAPES);
    await settle(ui);
    await clickScene(ui, LOOP_BEND, [], SHAPES);
    await settle(ui);
    const before = await savedSource(ui, 'loop.json');

    await browser.keyboard.press('Backspace');
    await settle(ui);

    // The Scene has no two-point shaft whose ends both Snap to one box, so the
    // removal the key asked for changes nothing and writes nothing.
    expect(await savedSource(ui, 'loop.json')).toBe(before ?? '');
    await expectPoints(ui, LOOP_POINTS, 'loop.json');
  });

  test('a held Backspace removes the point once, and a new press takes the shaft', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await clickScene(ui, SHARP_ON, [], SHARP);
    await settle(ui);
    await clickScene(ui, SHARP_BEND, [], SHARP);
    await settle(ui);

    // The browser's own auto-repeat: the key stays down and sends keydowns the
    // page reads as repeats of one press.
    await browser.keyboard.down('Backspace');
    await browser.keyboard.down('Backspace');
    await browser.keyboard.up('Backspace');
    await expectPoints(ui, [
      { x: 50, y: 50 },
      { x: 550, y: 50 },
    ]);

    // The press that took the point is spent; the next press is the shaft's.
    await browser.keyboard.press('Backspace');
    await expectPoints(ui, []);
  });

  test('one undo returns the point whole, and redo removes it again', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    await clickScene(ui, SHARP_ON, [], SHARP);
    await settle(ui);
    await clickScene(ui, SHARP_BEND, [], SHARP);
    await settle(ui);

    await browser.keyboard.press('Delete');
    await expectPoints(ui, [
      { x: 50, y: 50 },
      { x: 550, y: 50 },
    ]);

    // One step, so one undo is the whole point back, `corner` and all.
    await browser.keyboard.press('Meta+z');
    await expectPoints(ui, SHARP_POINTS);
    await browser.keyboard.press('Shift+Meta+z');
    await expectPoints(ui, [
      { x: 50, y: 50 },
      { x: 550, y: 50 },
    ]);
  });
});
