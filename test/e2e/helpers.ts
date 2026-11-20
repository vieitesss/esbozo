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

export interface SavedScene {
  version: number;
  title: string;
  elements: Array<{ id: string; x: number; y: number; width: number; height: number }>;
}

export async function viewOf(page: Page): Promise<View> {
  const transform = (await page.locator('.viewport').getAttribute('transform')) ?? '';
  const match = /translate\((-?[\d.]+) (-?[\d.]+)\) scale\((-?[\d.]+)\)/.exec(transform);
  if (match === null) {
    throw new Error(`unexpected viewport transform ${JSON.stringify(transform)}`);
  }
  return { panX: Number(match[1]), panY: Number(match[2]), zoom: Number(match[3]) };
}

/** Scene coordinates to the point on the page the pointer has to reach. */
export async function screenPoint(page: Page, point: Point): Promise<Point> {
  const view = await viewOf(page);
  return { x: point.x * view.zoom + view.panX, y: point.y * view.zoom + view.panY };
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
export async function clickScene(page: Page, point: Point, modifiers: Array<'Shift'> = []): Promise<void> {
  const screen = await screenPoint(page, point);
  for (const modifier of modifiers) {
    await page.keyboard.down(modifier);
  }
  await page.mouse.click(screen.x, screen.y);
  for (const modifier of modifiers) {
    await page.keyboard.up(modifier);
  }
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
