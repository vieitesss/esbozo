/**
 * Helpers for the editor's browser tests.
 *
 * Everything goes through the page a person uses: the same buttons, the same
 * pointer and the same keys, plus the stubbed folder handle from
 * `fake-file-system.js`. Assertions are made on the files the editor saves, and
 * on the SVG it paints, never on the editor's own state.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

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

/** A Scene point, as the pointer has to reach it on the page. */
export function at(point: Point, view: View = VIEW): Point {
  return { x: point.x * view.zoom + view.panX, y: point.y * view.zoom + view.panY };
}

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
}

/** Open the built page with the stubbed folders ready to be picked. */
async function openPage(page: Page, folders: Folders, picks: string[]): Promise<void> {
  await page.addInitScript({ path: fileURLToPath(new URL('./fake-file-system.js', import.meta.url)) });
  await page.goto('/editor.html');
  await page.evaluate((stub: Stub) => {
    const window_ = window as unknown as Stub;
    window_.__esbozoFolders = stub.__esbozoFolders;
    window_.__esbozoPicks = stub.__esbozoPicks;
  }, { __esbozoFolders: folders, __esbozoPicks: picks });
}

/** The folder the next Open folder click asks for; the last one repeats. */
export async function browseFolder(page: Page, folder: string): Promise<void> {
  await page.evaluate((name) => {
    (window as unknown as Stub).__esbozoPicks = [name];
  }, folder);
  await page.getByRole('button', { name: /Open folder/ }).click();
}

/** Open the built page, pick a folder and open a Scene from the note. */
export async function openEditor(
  page: Page,
  folders: Folders,
  sceneName: string,
  picks: string[] = Object.keys(folders),
): Promise<void> {
  await openPage(page, folders, picks);
  await page.getByRole('button', { name: /Open folder/ }).click();
  await page.getByRole('button', { name: sceneName, exact: true }).click();
}

/** Open a Scene name that is not in the folder yet: a new, empty Scene. */
export async function openNewScene(
  page: Page,
  folders: Folders,
  name: string,
  picks: string[] = Object.keys(folders),
): Promise<void> {
  await openPage(page, folders, picks);
  await page.getByRole('button', { name: /Open folder/ }).click();
  await page.getByLabel('New Scene name').fill(name);
  await page.getByRole('button', { name: 'New', exact: true }).click();
}

/** The files a stubbed folder holds, as text. */
export async function savedFiles(page: Page, folder = FOLDER): Promise<Record<string, string>> {
  return page.evaluate(
    (name) => ({
      ...((window as unknown as { __esbozoFolders: Folders }).__esbozoFolders[name] ?? {}),
    }),
    folder,
  );
}

/** The saved Scene, parsed, once the editor says it saved. */
export async function savedScene(page: Page, name = 'scene.json', folder = FOLDER): Promise<SavedScene> {
  await expect(page.locator('.saved')).toHaveText('saved');
  const files = await savedFiles(page, folder);
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
  points?: Array<{ x: number; y: number }>;
}

export interface SavedScene {
  version: number;
  title: string;
  elements: SavedElement[];
}

/** A press, a few moves and a release, which is what a drag looks like. */
export async function drag(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) / 2, from.y + (to.y - from.y) / 2);
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

/** Click a Scene point. */
export async function clickScene(
  page: Page,
  point: Point,
  modifiers: Array<'Shift'> = [],
  view: View = VIEW,
): Promise<void> {
  const screen = at(point, view);
  for (const modifier of modifiers) {
    await page.keyboard.down(modifier);
  }
  await page.mouse.click(screen.x, screen.y);
  for (const modifier of modifiers) {
    await page.keyboard.up(modifier);
  }
}

/** Drag from a Scene point by a page-pixel offset. */
export async function dragBy(
  page: Page,
  from: Point,
  dx: number,
  dy: number,
  view: View = VIEW,
): Promise<void> {
  const screen = at(from, view);
  await drag(page, screen, { x: screen.x + dx, y: screen.y + dy });
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
export async function expectSvgMatchesCli(page: Page, name = 'scene.json', folder = FOLDER): Promise<void> {
  await expect(page.locator('.saved')).toHaveText('saved');
  const files = await savedFiles(page, folder);
  const svgName = name.replace(/\.json$/i, '.svg');
  const saved = files[svgName];
  expect(saved, `${svgName} was saved`).toBeTruthy();
  const scene = JSON.parse(files[name] ?? '{}');
  expect(saved).toBe(await cliRender(scene));
}
