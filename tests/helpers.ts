/**
 * Helpers for the editor's browser tests.
 *
 * Everything goes through the page a person uses: the same buttons, the same
 * pointer and the same keys, plus the stubbed folder handle from
 * `fake-file-system.js`. Assertions are made on the files the editor saves, and
 * on the pixels it paints, never on the editor's own state.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect } from 'e2e';
import type { App, Screen } from 'e2e';
import type { Browser } from '@e2e-dev/web';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The fixtures every helper drives: the page, its pointer, and its files. */
export interface Ui {
  readonly app: App;
  readonly browser: Browser;
  readonly screen: Screen;
}

/** A point on the page, or in the Scene's own coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** Pan and zoom, as the fixed fixtures below are laid out on the page. */
export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

/** Two boxes, one of them styled, so the Scene has order and a fill. */
export const SCENE = {
  version: 1,
  title: 'Two boxes',
  defaults: { roughness: 1 },
  elements: [
    { id: 'a', type: 'rectangle', x: 40, y: 40, width: 120, height: 80 },
    {
      id: 'b',
      type: 'rectangle',
      x: 200,
      y: 60,
      width: 100,
      height: 100,
      tone: 'muted',
      fill: { kind: 'solid', grey: 4 },
      stroke: { width: 'bold', style: 'dashed' },
    },
  ],
};

/**
 * Every Element type the Scene allows, laid out so the fixture below maps to
 * fixed page points: move, resize and box-select are aimed through `MIXED`.
 */
export const MIXED_SCENE = {
  version: 1,
  title: 'Mixed',
  defaults: { roughness: 1 },
  elements: [
    { id: 'oval', type: 'ellipse', x: 60, y: 60, width: 120, height: 100, fill: { kind: 'solid', grey: 4 } },
    { id: 'word', type: 'text', x: 260, y: 90, content: 'hi', fontSize: 'XL' },
    {
      id: 'shaft',
      type: 'arrow',
      points: [
        { x: 60, y: 230 },
        { x: 340, y: 330 },
      ],
      heads: { start: 'none', end: 'arrow' },
    },
  ],
};

/**
 * The view `SCENE` lands in: the page fitted with an 80px margin into the
 * 1280×800 viewport, which is 1:1 for these Elements. A test aims at Scene
 * points through it and never reads the editor's transform.
 */
export const VIEW: View = { zoom: 1, panX: 470, panY: 300 };

/** The view `MIXED_SCENE` lands in, worked out the same way. */
export const MIXED: View = { zoom: 1, panX: 440, panY: 205 };

/**
 * The view an empty Scene lands in: its 320×240 page is fitted 1:1 and centred,
 * so the middle of the view is Scene (160, 120) and the right edge is x = 800.
 */
export const EMPTY: View = { zoom: 1, panX: 480, panY: 280 };

/** The view `POSTER_SCENE` lands in, worked out the same way. */
export const POSTER: View = { zoom: 1, panX: 320, panY: 155 };

/** A Scene point, as the pointer has to reach it on the page. */
export function at(point: Point, view: View = VIEW): Point {
  return { x: point.x * view.zoom + view.panX, y: point.y * view.zoom + view.panY };
}

/**
 * A thick horizontal line, and a diagonal arrow whose bounding box holds a
 * rectangle: the shapes whose boxes lie about where their ink is.
 */
export const CROSSED_SCENE = {
  version: 1,
  title: 'Crossed',
  defaults: { roughness: 1 },
  elements: [
    { id: 'sheet', type: 'rectangle', x: 40, y: 40, width: 120, height: 80 },
    {
      id: 'slant',
      type: 'arrow',
      points: [
        { x: 40, y: 40 },
        { x: 240, y: 160 },
      ],
      heads: { start: 'none', end: 'arrow' },
    },
    {
      id: 'rule',
      type: 'line',
      points: [
        { x: 60, y: 200 },
        { x: 320, y: 200 },
      ],
      heads: { start: 'none', end: 'none' },
      stroke: { width: 'extra' },
    },
  ],
};

/** The view `CROSSED_SCENE` lands in, worked out the same way as `VIEW`. */
export const CROSSED: View = { zoom: 1, panX: 460, panY: 280 };

/**
 * An arrow Snapped at both ends, so its drawn shaft follows its targets whoever
 * moves: its own stored ends cannot change where it appears.
 */
export const SNAPPED_SCENE = {
  version: 1,
  title: 'Snapped',
  defaults: { roughness: 1 },
  elements: [
    { id: 'from', type: 'rectangle', x: 40, y: 40, width: 120, height: 80 },
    { id: 'to', type: 'rectangle', x: 300, y: 40, width: 120, height: 80 },
    {
      id: 'link',
      type: 'arrow',
      points: [
        { x: 160, y: 80, snap: 'from' },
        { x: 300, y: 80, snap: 'to' },
      ],
      heads: { start: 'none', end: 'arrow' },
    },
  ],
};

/** The view `SNAPPED_SCENE` lands in, worked out the same way as `VIEW`. */
export const SNAPPED: View = { zoom: 1, panX: 410, panY: 320 };

/**
 * A box whose Label does not fit it, so the words reach above and below the
 * outline: the ink bounds and the outline are two different rectangles, and
 * only the outline may move a resize handle.
 */
export const OVERFLOW_SCENE = {
  version: 1,
  title: 'Overflow',
  defaults: { roughness: 1 },
  elements: [
    { id: 'box', type: 'rectangle', x: 40, y: 40, width: 100, height: 40, label: 'words that wrap' },
  ],
};

/** The view `OVERFLOW_SCENE` lands in, worked out the same way as `VIEW`. */
export const OVERFLOW: View = { zoom: 1, panX: 550, panY: 340 };

/**
 * Three boxes whose pinned outer centres leave no room to walk forward: the
 * leading box is wider than the whole span, so its middle sits right of the
 * tail's. Spacing their middles evenly would run the row backwards, so Spread
 * has to leave them where they are.
 */
export const PINNED_SCENE = {
  version: 1,
  title: 'Pinned',
  defaults: { roughness: 1 },
  elements: [
    { id: 'lead', type: 'rectangle', x: 0, y: 40, width: 200, height: 40 },
    { id: 'mid', type: 'rectangle', x: 35, y: 40, width: 10, height: 60 },
    { id: 'tail', type: 'rectangle', x: 70, y: 40, width: 10, height: 60 },
  ],
};

/** The view `PINNED_SCENE` lands in at 1280×800, worked out the same way as `VIEW`. */
export const PINNED: View = { zoom: 1, panX: 540, panY: 330 };

/**
 * Three boxes whose even gaps would be negative, with the outer two of
 * different widths: the old gap formula left this row as it was, and the centre
 * rule moves the middle one 5 units towards the leading box.
 */
export const UNEVEN_SCENE = {
  version: 1,
  title: 'Uneven',
  defaults: { roughness: 1 },
  elements: [
    { id: 'lead', type: 'rectangle', x: 0, y: 40, width: 40, height: 60 },
    { id: 'broad', type: 'rectangle', x: 30, y: 40, width: 70, height: 20 },
    { id: 'tail', type: 'rectangle', x: 90, y: 40, width: 20, height: 60 },
  ],
};

/** The view `UNEVEN_SCENE` lands in at 1280×800, worked out the same way as `VIEW`. */
export const UNEVEN: View = { zoom: 1, panX: 585, panY: 330 };

/**
 * Three boxes and a line Snapped at one end: Spread evens the boxes and leaves
 * the line's stored ends alone, because its end follows an Element.
 */
export const LACED_SCENE = {
  version: 1,
  title: 'Laced',
  defaults: { roughness: 1 },
  elements: [
    { id: 'frame', type: 'rectangle', x: 40, y: 40, width: 60, height: 60 },
    { id: 'post', type: 'rectangle', x: 180, y: 40, width: 60, height: 60 },
    { id: 'beam', type: 'rectangle', x: 420, y: 40, width: 60, height: 60 },
    {
      id: 'tie',
      type: 'line',
      points: [
        { x: 100, y: 70, snap: 'frame' },
        { x: 180, y: 70 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};

/** The view `LACED_SCENE` lands in at 1280×800, worked out the same way as `VIEW`. */
export const LACED: View = { zoom: 1, panX: 380, panY: 330 };

/**
 * Three rectangles at uneven spacing, for Arrange: layer order, alignment and
 * each axis's distribution move a different one of them, so a test can tell
 * the actions apart from the saved geometry.
 */
export const THREE_SCENE = {
  version: 1,
  title: 'Three',
  defaults: { roughness: 1 },
  elements: [
    { id: 'p', type: 'rectangle', x: 40, y: 40, width: 100, height: 60 },
    { id: 'q', type: 'rectangle', x: 160, y: 200, width: 80, height: 40 },
    { id: 'r', type: 'rectangle', x: 400, y: 100, width: 60, height: 60 },
  ],
};

/** The view `THREE_SCENE` lands in, worked out the same way as `VIEW`. */
export const THREE: View = { zoom: 1, panX: 390, panY: 260 };

/**
 * A box near the middle and one against the right edge: selecting the right-hand
 * one would put it under the docked Style menu unless the view pans clear of it.
 */
export const EDGE_SCENE = {
  version: 1,
  title: 'Edge',
  defaults: { roughness: 1 },
  elements: [
    { id: 'near', type: 'rectangle', x: 40, y: 40, width: 80, height: 60 },
    { id: 'far', type: 'rectangle', x: 700, y: 40, width: 120, height: 80 },
  ],
};

/** The view `EDGE_SCENE` lands in at 1280×800, worked out the same way as `VIEW`. */
export const EDGE: View = { zoom: 1, panX: 210, panY: 320 };

/** The view `EDGE_SCENE` lands in at 1366×768, for the window the note must fit. */
export const EDGE_1366: View = { zoom: 1, panX: 253, panY: 304 };

/**
 * Three boxes where the middle one is wider than the gap it has to sit in, so
 * even gaps between their edges would run backwards. Spread keeps the two
 * outermost and spaces the centres of all three evenly instead: the leading
 * box keeps 0, the tail keeps 60 and the middle's centre lands on 35.
 */
export const SPREAD_SCENE = {
  version: 1,
  title: 'Spread',
  defaults: { roughness: 1 },
  elements: [
    { id: 'lead', type: 'rectangle', x: 0, y: 40, width: 10, height: 60 },
    { id: 'wide', type: 'rectangle', x: 20, y: 40, width: 100, height: 20 },
    { id: 'tail', type: 'rectangle', x: 60, y: 40, width: 10, height: 60 },
  ],
};

/** The view `SPREAD_SCENE` lands in at 1280×800, worked out the same way as `VIEW`. */
export const SPREAD: View = { zoom: 1, panX: 580, panY: 330 };

/**
 * Mixed types for Arrange: a Text, two rectangles and a free arrow. The arrow
 * has no Snapped end, so it takes part; the Text is measured, so its width is
 * the one number a test cannot derive from the saved coordinates alone.
 */
export const ARRANGE_SCENE = {
  version: 1,
  title: 'Arrange',
  defaults: { roughness: 1 },
  elements: [
    { id: 'words', type: 'text', x: 40, y: 40, content: 'hi', fontSize: 'M' },
    { id: 'row-a', type: 'rectangle', x: 200, y: 40, width: 100, height: 60 },
    { id: 'row-b', type: 'rectangle', x: 320, y: 40, width: 100, height: 60 },
    {
      id: 'tail',
      type: 'arrow',
      points: [
        { x: 420, y: 70 },
        { x: 560, y: 70 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};

/** The view `ARRANGE_SCENE` lands in at 1280×800, worked out the same way as `VIEW`. */
export const ARRANGE: View = { zoom: 1, panX: 340, panY: 330 };

/**
 * A line Snapped at one end and one Snapped at both: their ends follow their
 * targets, so Arrange must leave them alone and offer nothing it cannot do.
 */
export const TETHER_SCENE = {
  version: 1,
  title: 'Tether',
  defaults: { roughness: 1 },
  elements: [
    { id: 'frame', type: 'rectangle', x: 60, y: 40, width: 100, height: 60 },
    { id: 'post', type: 'rectangle', x: 260, y: 40, width: 100, height: 60 },
    {
      id: 'tether',
      type: 'line',
      points: [
        { x: 260, y: 70, snap: 'post' },
        { x: 420, y: 70 },
      ],
      heads: { start: 'none', end: 'none' },
    },
    {
      id: 'weft',
      type: 'line',
      points: [
        { x: 160, y: 70, snap: 'frame' },
        { x: 260, y: 70, snap: 'post' },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};

/** The view `TETHER_SCENE` lands in at 1280×800, worked out the same way as `VIEW`. */
export const TETHER: View = { zoom: 1, panX: 400, panY: 330 };

/**
 * One bar wider than the room left of the docked note at 1366×768: no pan can
 * clear the note, so the view zooms out just far enough to show it beside.
 */
export const WIDE_SCENE = {
  version: 1,
  title: 'Wide',
  defaults: { roughness: 1 },
  elements: [
    { id: 'bar', type: 'rectangle', x: 40, y: 40, width: 1120, height: 90, fill: { kind: 'solid', grey: 6 } },
  ],
};

/** The view `WIDE_SCENE` lands in at 1366×768, worked out the same way as `VIEW`. */
export const WIDE_1366: View = { zoom: 1, panX: 83, panY: 299 };

/**
 * One rectangle 15,000 units wide: too wide for the room the docked note leaves
 * at any zoom a person may reach by hand, so fitting it beside the note has to
 * go below the manual floor.
 */
export const LONG_SCENE = {
  version: 1,
  title: 'Long',
  defaults: { roughness: 1 },
  elements: [
    {
      id: 'long',
      type: 'rectangle',
      x: 40,
      y: 40,
      width: 15000,
      height: 400,
      fill: { kind: 'solid', grey: 6 },
    },
  ],
};

/** The view `LONG_SCENE` lands in at 1366×768: the page fitted at the manual floor. */
export const LONG_1366: View = { zoom: 0.1, panX: -71, panY: 360 };

/**
 * An unlabelled vertical arrow that the note docks over. Its selection box has
 * no width at all, so the clearance needs a footprint to see it. The `guide` box
 * is there only to push the page right, so the shaft lands under the note.
 */
export const SHAFT_SCENE = {
  version: 1,
  title: 'Shaft',
  defaults: { roughness: 1 },
  elements: [
    { id: 'guide', type: 'rectangle', x: 40, y: 40, width: 40, height: 260 },
    {
      id: 'shaft',
      type: 'arrow',
      points: [
        { x: 1080, y: 60 },
        { x: 1080, y: 300 },
      ],
      heads: { start: 'none', end: 'arrow' },
      stroke: { width: 'extra' },
    },
  ],
};

/** The view `SHAFT_SCENE` lands in at 1280×800, worked out the same way as `VIEW`. */
export const SHAFT: View = { zoom: 1, panX: 80, panY: 230 };

/** A Scene the validator rejects: `box-a` has no width. */
export const BROKEN_SCENE = {
  version: 1,
  elements: [{ id: 'box-a', type: 'rectangle', x: 10, y: 10, width: 0, height: 40 }],
};

/** A Scene worth looking at, for the light and dark screenshots. */
export const POSTER_SCENE = {
  version: 1,
  title: 'esbozo',
  defaults: { roughness: 1, stroke: { width: 'bold', style: 'solid' } },
  elements: [
    { id: 'note', type: 'rectangle', x: 40, y: 40, width: 380, height: 60, fill: { kind: 'none' }, stroke: { width: 'thin' } },
    { id: 'web', type: 'rectangle', x: 60, y: 150, width: 220, height: 130, fill: { kind: 'hachure', grey: 2 } },
    { id: 'agent', type: 'rectangle', x: 380, y: 150, width: 220, height: 130, fill: { kind: 'solid', grey: 4 }, tone: 'muted' },
    { id: 'scene', type: 'rectangle', x: 220, y: 330, width: 240, height: 120, fill: { kind: 'hachure', grey: 4 } },
    { id: 'ink', type: 'rectangle', x: 60, y: 330, width: 120, height: 120, fill: { kind: 'solid', grey: 6 }, stroke: { width: 'extra' } },
    { id: 'pencil', type: 'rectangle', x: 500, y: 330, width: 100, height: 120, fill: { kind: 'none' }, stroke: { width: 'bold', style: 'dashed' } }
  ],
};

/**
 * A page of words: dense, small, at every anchor and in both tones, so a PNG
 * drawn with another font — or with a font pair that is not hinted the same —
 * shows in every glyph rather than in the antialiasing of a stroke.
 */
export const TEXT_SCENE = {
  version: 1,
  title: 'Words',
  defaults: { roughness: 1 },
  elements: [
    {
      id: 'para',
      type: 'text',
      x: 40,
      y: 40,
      content: 'the quick brown fox\njumps over the lazy dog\nat half past nine',
      fontSize: 'S',
      textAlign: 'left',
    },
    {
      id: 'head',
      type: 'text',
      x: 260,
      y: 40,
      content: 'Editing a Scene\nwrites the bytes',
      fontSize: 'M',
      textAlign: 'center',
    },
    {
      id: 'tail',
      type: 'text',
      x: 560,
      y: 40,
      content: 'right aligned words',
      fontSize: 'L',
      textAlign: 'right',
      tone: 'muted',
    },
    {
      id: 'box',
      type: 'rectangle',
      x: 40,
      y: 200,
      width: 300,
      height: 150,
      label: 'a label that wraps inside the box and keeps going until it is full',
    },
    {
      id: 'oval',
      type: 'ellipse',
      x: 380,
      y: 200,
      width: 240,
      height: 150,
      tone: 'muted',
      label: 'elliptical words wrap in a square of the sides',
    },
    {
      id: 'shaft',
      type: 'arrow',
      points: [
        { x: 40, y: 420 },
        { x: 620, y: 500 },
      ],
      heads: { start: 'none', end: 'arrow' },
      label: 'a shaft label sits beside the line it belongs to',
    },
  ],
};

/**
 * A wall 70,138 units wide: the page the Renderer lays out is 70,170×142, far
 * larger than a canvas can hold at one pixel per unit, so it can only be drawn
 * by the CLI.
 */
export const BIG_SCENE = {
  version: 1,
  title: 'Poster',
  defaults: { roughness: 1 },
  elements: [
    {
      id: 'wall',
      type: 'rectangle',
      x: 40,
      y: 40,
      width: 70138,
      height: 110,
      fill: { kind: 'solid', grey: 2 },
    },
  ],
};

/** Stub folders: a folder name mapped to its `name → text` files. */
export interface Folders {
  [folder: string]: Record<string, string>;
}

/** The folder every test that does not name one seeds and reads. */
export const FOLDER = 'A';

interface Stub {
  __esbozoFolders: Folders;
  __esbozoPicks: string[];
  __esbozoGate?: ((name: string) => Promise<void>) | null;
  __esbozoGates?: Array<() => void>;
}

/** Hold every write to `name` open, so a test can see the disk stay busy. */
export async function holdWrites(ui: Ui, name: string): Promise<void> {
  await ui.browser.evaluate((fileName) => {
    const window_ = window as unknown as Stub;
    window_.__esbozoGates = [];
    window_.__esbozoGate = (written) =>
      written === fileName
        ? new Promise<void>((resolve) => window_.__esbozoGates!.push(resolve))
        : Promise.resolve();
    return true;
  }, name);
}

/** Let the write that is waiting on the gate land. */
export async function releaseWrite(ui: Ui): Promise<void> {
  await expect
    .poll(() => ui.browser.evaluate(() => (window as unknown as Stub).__esbozoGates?.length ?? 0))
    .toBeGreaterThan(0);
  await ui.browser.evaluate(() => {
    (window as unknown as Stub).__esbozoGates!.shift()!();
    return true;
  });
}

/** Stop holding writes: everything the editor writes lands at once. */
export async function allowWrites(ui: Ui): Promise<void> {
  await ui.browser.evaluate(() => {
    (window as unknown as Stub).__esbozoGate = null;
    return true;
  });
}

/** Open the built page with the stubbed folders ready to be picked. */
async function openPage(ui: Ui, folders: Folders, picks: string[]): Promise<void> {
  await ui.browser.addInitScript({ path: 'tests/fake-file-system.js' });
  await ui.app.open('/editor.html');
  await ui.browser.evaluate(
    (stub: Stub) => {
      const window_ = window as unknown as Stub;
      window_.__esbozoFolders = stub.__esbozoFolders;
      window_.__esbozoPicks = stub.__esbozoPicks;
      return true;
    },
    { __esbozoFolders: folders, __esbozoPicks: picks },
  );
}

/** The folder the next Open folder click asks for; the last one repeats. */
export async function browseFolder(ui: Ui, folder: string): Promise<void> {
  await ui.browser.evaluate((name) => {
    (window as unknown as Stub).__esbozoPicks = [name];
    return true;
  }, folder);
  await ui.screen.getByRole('button', /Open folder/).click();
}

/** Open the built page, pick a folder and open a Scene from the note. */
export async function openEditor(
  ui: Ui,
  folders: Folders,
  sceneName: string,
  picks: string[] = Object.keys(folders),
): Promise<void> {
  await openPage(ui, folders, picks);
  await ui.screen.getByRole('button', /Open folder/).click();
  await ui.screen.getByRole('button', sceneName).click();
}

/** Open a Scene name that is not in the folder yet: a new, empty Scene. */
export async function openNewScene(
  ui: Ui,
  folders: Folders,
  name: string,
  picks: string[] = Object.keys(folders),
): Promise<void> {
  await openPage(ui, folders, picks);
  await ui.screen.getByRole('button', /Open folder/).click();
  await ui.screen.getByLabel('New Scene name').fill(name);
  await ui.screen.getByRole('button', 'New').click();
}

/** The files a stubbed folder holds, as text. */
export async function savedFiles(ui: Ui, folder = FOLDER): Promise<Record<string, string>> {
  return ui.browser.evaluate(
    (name) => ({
      ...((window as unknown as { __esbozoFolders: Folders }).__esbozoFolders[name] ?? {}),
    }),
    folder,
  );
}

/** The saved Scene, parsed, once the editor says it saved. */
export async function savedScene(ui: Ui, name = 'scene.json', folder = FOLDER): Promise<SavedScene> {
  await expect(ui.screen.getByRole('status')).toHaveText('saved');
  const files = await savedFiles(ui, folder);
  const source = files[name];
  if (source === undefined) {
    throw new Error(`${name} was not saved, only ${Object.keys(files).join(', ')}`);
  }
  return JSON.parse(source) as SavedScene;
}

export interface SavedElement {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  content?: string;
  points?: Array<{ x: number; y: number; snap?: string }>;
  roughness?: number;
  stroke?: { width: string; style: string };
  fill?: { kind: string; grey: number };
  tone?: string;
  corners?: string;
  fontSize?: string;
  textAlign?: string;
  heads?: { start: string; end: string };
}

export interface SavedScene {
  version: number;
  title: string;
  defaults?: { roughness?: number };
  elements: SavedElement[];
}

/** How many pointer moves a drag takes between the press and the release. */
const DRAG_MOVES = 5;

/** A press, a few moves and a release, which is what a drag looks like. */
export async function drag(ui: Ui, from: Point, to: Point): Promise<void> {
  await ui.browser.mouse.move(from.x, from.y);
  await ui.browser.mouse.down();
  for (let step = 1; step <= DRAG_MOVES; step += 1) {
    const share = step / DRAG_MOVES;
    await ui.browser.mouse.move(from.x + (to.x - from.x) * share, from.y + (to.y - from.y) * share);
  }
  await ui.browser.mouse.up();
}

/** Click a Scene point. */
export async function clickScene(
  ui: Ui,
  point: Point,
  modifiers: Array<'Shift'> = [],
  view: View = VIEW,
): Promise<void> {
  const screen = at(point, view);
  for (const modifier of modifiers) {
    await ui.browser.keyboard.down(modifier);
  }
  await ui.browser.mouse.move(screen.x, screen.y);
  await ui.browser.mouse.down();
  await ui.browser.mouse.up();
  for (const modifier of modifiers) {
    await ui.browser.keyboard.up(modifier);
  }
}

/** Drag from a Scene point by a page-pixel offset. */
export async function dragBy(
  ui: Ui,
  from: Point,
  dx: number,
  dy: number,
  view: View = VIEW,
): Promise<void> {
  const screen = at(from, view);
  await drag(ui, screen, { x: screen.x + dx, y: screen.y + dy });
}

/**
 * `ez render` on the Scene the editor saved, in a temp folder: the editor's SVG
 * has to be the CLI's SVG, byte for byte, or the browser is not drawing with the
 * same Renderer.
 */
export async function cliRender(scene: unknown): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'esbozo-e2e-'));
  await writeFile(join(folder, 'scene.json'), JSON.stringify(scene, null, 2), 'utf8');
  await run(process.execPath, [CLI, 'render', 'scene.json'], { cwd: folder });
  return readFile(join(folder, 'scene.svg'), 'utf8');
}

/** The editor saved both files, and the SVG is the CLI's own output. */
export async function expectSvgMatchesCli(ui: Ui, name = 'scene.json', folder = FOLDER): Promise<void> {
  await expect(ui.screen.getByRole('status')).toHaveText('saved');
  const files = await savedFiles(ui, folder);
  const svgName = name.replace(/\.json$/i, '.svg');
  const saved = files[svgName];
  expect(saved, `${svgName} was saved`).toBeTruthy();
  const scene = JSON.parse(files[name] ?? '{}');
  expect(saved).toBe(await cliRender(scene));
}

/** The stylesheet and the font the page draws with: what the CLI needs to draw the same Scene. */
const PAGE_CSS = fileURLToPath(new URL('../dist/editor.css', import.meta.url));
const PAGE_FONT = fileURLToPath(new URL('../dist/fonts/Kalam-Regular.ttf', import.meta.url));

/**
 * `ez png` on the Scene the editor saved, in a temp folder, drawn with the
 * page's own stylesheet and font: the browser's exported PNG has to be this
 * PNG, so the two are compared pixel for pixel.
 */
export async function cliPng(scene: unknown, theme: 'light' | 'dark'): Promise<Buffer> {
  const folder = await mkdtemp(join(tmpdir(), 'esbozo-e2e-'));
  await writeFile(join(folder, 'scene.json'), JSON.stringify(scene, null, 2), 'utf8');
  await run(process.execPath, [
    CLI,
    'png',
    'scene.json',
    '--theme',
    theme,
    '--css',
    PAGE_CSS,
    '--font',
    PAGE_FONT,
  ], { cwd: folder });
  return readFile(join(folder, `scene.${theme}.png`));
}

/** A file a download left behind, by the name the browser gave it. */
export interface Downloaded {
  readonly name: string;
  readonly png: Buffer;
}

/** Run a trigger that exports a PNG, and read the file the browser downloaded. */
export async function exported(
  ui: Ui,
  trigger: () => Promise<void>,
): Promise<Downloaded> {
  const download = await ui.browser.waitForDownload(trigger);
  return {
    name: download.suggestedFilename,
    png: await readFile(download.absolutePath),
  };
}

/** Wait for the next two paints, so a screenshot reads the frame a change made. */
export async function settle(ui: Ui): Promise<void> {
  await ui.browser.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      }),
  );
}
