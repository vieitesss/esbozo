/**
 * Seam 2: the editor served by `ez serve`, over a real folder.
 *
 * The page is opened from a server this test starts, so there is no stubbed
 * file system anywhere: the Scenes are real files, and every assertion reads
 * them from disk. The static-page suite (`editor.e2e.ts`) keeps its own static
 * server, because its folder picker is the File System Access API, which needs a
 * handle the page itself supplies.
 *
 * No test here uses the model, so `pnpm e2e` passes with no key set.
 */
import { mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { cliRender, MIXED, MIXED_SCENE, SCENE, clickScene } from './helpers.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';
import { startServe } from '../test/cli.ts';

const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
const MIXED_SOURCE = JSON.stringify(MIXED_SCENE, null, 2);

/** The middle of `b`, the one solid grey box in `SCENE`. */
const GREY_BOX: Rect = { x: 700, y: 390, width: 40, height: 40 };
/** Bare paper beside the drawings. */
const PAPER: Rect = { x: 900, y: 550, width: 40, height: 40 };

interface SavedScene {
  readonly elements: Array<{ id: string; x?: number }>;
}

function elementX(scene: SavedScene, id: string): number | undefined {
  return scene.elements.find((element) => element.id === id)?.x;
}

/** A fresh folder that holds exactly the files it is given. */
async function folderWith(files: Record<string, string>): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'esbozo-served-')));
  for (const [name, text] of Object.entries(files)) {
    await writeFile(join(folder, name), text, 'utf8');
  }
  return folder;
}

test('the served editor lists, opens and autosaves Scenes, saving Scene and SVG together', async ({ app, browser, screen }) => {
  const folder = await folderWith({ 'one.json': SCENE_SOURCE, 'two.json': MIXED_SOURCE });
  const server = await startServe(folder);
  try {
    await app.open(`${server.url}/editor.html`);

    // No folder picker: the first Scene in the folder opens by itself.
    await expect(screen.getByRole('status')).toHaveText('saved');
    const opened = await shot({ app, browser, screen });
    expect(opened.meanLuminance(GREY_BOX)).toBeLessThan(opened.meanLuminance(PAPER) - 0.2);

    // The note lists what the server's folder holds.
    await screen.getByRole('button', 'Scenes').click();
    await expect(screen.getByRole('button', 'one.json')).toBeVisible();
    await expect(screen.getByRole('button', 'two.json')).toBeVisible();

    // Opening another Scene and nudging it autosaves both files on disk.
    await screen.getByRole('button', 'two.json').click();
    await expect(screen.getByRole('status')).toHaveText('saved');
    await clickScene({ app, browser, screen }, { x: 120, y: 110 }, [], MIXED);
    await browser.keyboard.press('Shift+ArrowRight');

    // The server writes the Scene before the SVG, so each file is waited for.
    const savedScene = async (): Promise<SavedScene> =>
      JSON.parse(await readFile(join(folder, 'two.json'), 'utf8')) as SavedScene;
    await expect.poll(async () => elementX(await savedScene(), 'oval')).toBe(70);
    const expectedSvg = await cliRender(await savedScene());
    await expect.poll(() => readFile(join(folder, 'two.svg'), 'utf8')).toBe(expectedSvg);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // A new Scene is created through the same API: both files appear.
    await screen.getByRole('button', 'Scenes').click();
    await screen.getByLabel('New Scene name').fill('fresh.json');
    await screen.getByRole('button', 'New').click();
    await expect
      .poll(async () => (await readdir(folder)).sort())
      .toEqual(['fresh.json', 'fresh.svg', 'one.json', 'two.json', 'two.svg']);
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect(await readFile(join(folder, 'fresh.svg'), 'utf8')).toMatch(/<title[^>]*>fresh<\/title>/);

    // The Scene that was never edited is still the bytes it started as.
    expect(await readFile(join(folder, 'one.json'), 'utf8')).toBe(SCENE_SOURCE);
  } finally {
    await server.stop();
  }
});

test('the page shows a failing folder request in its status line', async ({ app, browser, screen }) => {
  // A server that is there but cannot list the folder is not a static page: the
  // page says so, and it does not pretend it has a folder to offer.
  await browser.route('**/api/scenes', (route) =>
    route.fulfill({ status: 500, body: JSON.stringify({ error: 'the folder is unreadable' }) }),
  );
  try {
    await app.open('/editor.html');
    await expect(screen.getByRole('status')).toContainText('the folder is unreadable');
    await expect(screen.getByRole('button', /Open folder/)).toBeVisible();
  } finally {
    await browser.unrouteAll();
  }
});

test('a folder served read-only says so and refuses every save', async ({ app, browser, screen }) => {
  const folder = await folderWith({ 'scene.json': SCENE_SOURCE });
  const server = await startServe(folder, ['--read-only']);
  try {
    await app.open(`${server.url}/editor.html`);

    // The page says the folder is read-only, and the Scene still opens.
    await expect(screen.getByText('read-only')).toBeVisible();
    const opened = await shot({ app, browser, screen });
    expect(opened.meanLuminance(GREY_BOX)).toBeLessThan(opened.meanLuminance(PAPER) - 0.2);

    // An edit changes the canvas and writes nothing.
    await clickScene({ app, browser, screen }, { x: 100, y: 80 });
    await browser.keyboard.press('Shift+ArrowRight');
    await browser.keyboard.press('Shift+ArrowRight');

    expect(await readFile(join(folder, 'scene.json'), 'utf8')).toBe(SCENE_SOURCE);
    expect((await readdir(folder)).sort()).toEqual(['scene.json']);
    await expect(screen.getByText('read-only')).toBeVisible();
  } finally {
    await server.stop();
  }
});
