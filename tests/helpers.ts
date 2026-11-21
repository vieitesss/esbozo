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
  fill?: { kind: string; grey: number };
  stroke?: { width: string; style: string };
  tone?: string;
}

export interface SavedScene {
  version: number;
  title: string;
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

/** Wait for the next two paints, so a screenshot reads the frame a change made. */
export async function settle(ui: Ui): Promise<void> {
  await ui.browser.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      }),
  );
}
