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
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { cliRender, dragBy, MIXED, MIXED_SCENE, SCENE, clickScene, settle } from './helpers.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';
import { startServe, tempFolder } from '../test/cli.ts';

const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
const MIXED_SOURCE = JSON.stringify(MIXED_SCENE, null, 2);

/**
 * Two Elements with the same ids in two Scenes: `ink` is solid, `paper` is the
 * paper's own colour, and which of them is drawn last is what shows in between.
 */
const INK_BOX = {
  id: 'ink',
  type: 'rectangle',
  x: 40,
  y: 40,
  width: 160,
  height: 100,
  fill: { kind: 'solid', grey: 6 },
};
const PAPER_BOX = {
  id: 'paper',
  type: 'rectangle',
  x: 100,
  y: 60,
  width: 160,
  height: 100,
  fill: { kind: 'solid', grey: 0 },
};
/** `ink` under `paper`: the overlap is the paper colour the top box paints. */
const STACK_SCENE = {
  version: 1,
  title: 'Stack',
  defaults: { roughness: 1 },
  elements: [INK_BOX, PAPER_BOX],
};
/** The same ids the other way round, and `ink` moved, so both drawings change. */
const RESTACK_SCENE = {
  version: 1,
  title: 'Restack',
  defaults: { roughness: 1 },
  elements: [PAPER_BOX, { ...INK_BOX, x: 60 }],
};
const STACK_SOURCE = JSON.stringify(STACK_SCENE, null, 2);
const RESTACK_SOURCE = JSON.stringify(RESTACK_SCENE, null, 2);

/**
 * Where both boxes cover the page, in both Scenes: the top one's fill is what
 * shows there.
 */
const OVERLAP: Rect = { x: 610, y: 380, width: 60, height: 40 };

/** The middle of `b`, the one solid grey box in `SCENE`. */
const GREY_BOX: Rect = { x: 700, y: 390, width: 40, height: 40 };
/** Bare paper beside the Scene's Elements. */
const PAPER: Rect = { x: 900, y: 550, width: 40, height: 40 };

interface SavedScene {
  readonly elements: Array<{ id: string; x?: number }>;
}

function elementX(scene: SavedScene, id: string): number | undefined {
  return scene.elements.find((element) => element.id === id)?.x;
}

/** A fresh folder that holds exactly the files it is given. */
async function folderWith(files: Record<string, string>): Promise<string> {
  const folder = await tempFolder('esbozo-served-');
  for (const [name, text] of Object.entries(files)) {
    await writeFile(join(folder, name), text, 'utf8');
  }
  return folder;
}

test('a Scene switch stacks by the new Scene, however the old SVGs were reused', async ({
  app,
  browser,
  screen,
}) => {
  const folder = await folderWith({ 'a.json': STACK_SOURCE, 'b.json': RESTACK_SOURCE });
  const server = await startServe(folder);
  try {
    const ui = { app, browser, screen };
    await app.open(`${server.url}/editor.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');
    await settle(ui);

    // `a` draws the ink box first, so the paper box covers it.
    expect((await shot(ui)).meanLuminance(OVERLAP)).toBeGreaterThan(0.85);

    // `b` holds the same two ids the other way round, and both boxes are drawn
    // again: the stacking has to be the new Scene's, not the old one's. The
    // status line says `saved` for any Scene, so the name is what says this one
    // opened, and the frame after it is what the shot reads.
    await screen.getByRole('button', 'Scenes').click();
    await screen.getByRole('button', { name: 'b.json' }).click();
    await expect(screen.getByText(/\/ b\.json$/)).toBeVisible();
    await settle(ui);
    const switched = await shot(ui);
    expect(switched.meanLuminance(OVERLAP)).toBeLessThan(0.2);

    // And back again: the order is the Scene's each time, never the last one's.
    await screen.getByRole('button', 'Scenes').click();
    await screen.getByRole('button', { name: 'a.json' }).click();
    await expect(screen.getByText(/\/ a\.json$/)).toBeVisible();
    await settle(ui);
    expect((await shot(ui)).meanLuminance(OVERLAP)).toBeGreaterThan(0.85);
  } finally {
    await server.stop();
  }
});

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

    // A new Scene is created through the same API: both files appear. The name
    // is typed before the note lists the folder again, and it stays typed.
    await screen.getByRole('button', 'Scenes').click();
    await screen.getByLabel('New Scene name').fill('fresh.json');
    await writeFile(join(folder, 'three.json'), SCENE_SOURCE, 'utf8');
    await screen.getByRole('button', 'Scenes').click();
    await expect(screen.getByRole('button', 'three.json')).toBeVisible();
    await expect(screen.getByLabel('New Scene name')).toHaveValue('fresh.json');

    // A name asked for by name is a Scene there and then: Scene and SVG are
    // written at once, through the same API as any other save.
    await screen.getByRole('button', 'New').click();
    await expect
      .poll(async () => (await readdir(folder)).sort())
      .toEqual(['fresh.json', 'fresh.svg', 'one.json', 'three.json', 'two.json', 'two.svg']);
    await expect(screen.getByRole('status')).toHaveText('saved');
    // check-rules: markup of a written SVG file, not the page
    expect(await readFile(join(folder, 'fresh.svg'), 'utf8')).toMatch(/<title[^>]*>fresh<\/title>/);
    expect(JSON.parse(await readFile(join(folder, 'fresh.json'), 'utf8'))).toMatchObject({
      title: 'fresh',
      elements: [],
    });

    // The Scene that was never edited is still the bytes it started as.
    expect(await readFile(join(folder, 'one.json'), 'utf8')).toBe(SCENE_SOURCE);
  } finally {
    await server.stop();
  }
});

test('a served page offers Open folder even with no directory picker', async ({ app, browser, screen }) => {
  const folder = await folderWith({ 'one.json': SCENE_SOURCE, 'two.json': MIXED_SOURCE });
  const server = await startServe(folder);
  try {
    await app.open(`${server.url}/editor.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // The page cannot ask the browser for a folder here: the server lists the
    // Scenes itself, which is the other way to open one.
    await browser.evaluate(() => {
      delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
      return true;
    });

    await browser.keyboard.press('Meta+k');
    await browser.keyboard.type('open folder');
    await expect(screen.getByRole('option', { name: /Open folder/ })).not.toBeDisabled();
    await browser.keyboard.press('Enter');
    await expect(screen.getByRole('button', 'two.json')).toBeVisible();
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

    // An answer that is not a listing is a failure too, not a folder.
    await browser.unrouteAll();
    await browser.route('**/api/scenes', (route) =>
      route.fulfill({ status: 200, body: '<html>not the save API</html>' }),
    );
    await app.open('/editor.html');
    await expect(screen.getByRole('status')).toContainText('/api/scenes did not answer');

    // Neither is a listing whose fields have the wrong types: a `readOnly` that
    // is text would show a read-only folder as one to save into.
    await browser.unrouteAll();
    await browser.route('**/api/scenes', (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({ folder: 'sketches', readOnly: 'true', scenes: ['scene.json'] }),
      }),
    );
    await app.open('/editor.html');
    await expect(screen.getByRole('status')).toContainText('/api/scenes did not answer');
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

test('a drag saves the SVG the CLI draws for the Scene it saved', async ({ app, browser, screen }) => {
  const folder = await folderWith({ 'two.json': MIXED_SOURCE });
  const server = await startServe(folder);
  try {
    await app.open(`${server.url}/editor.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // One gesture: the press selects the ellipse, the drag moves it.
    await dragBy({ app, browser, screen }, { x: 120, y: 110 }, 40, 30, MIXED);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // The moved Element is where the drag put it, and the SVG beside it is the
    // one `ez render` writes for that Scene — no bytes left over from the frame
    // the gesture was drawn with.
    const saved = JSON.parse(await readFile(join(folder, 'two.json'), 'utf8')) as {
      elements: Array<{ id: string; x?: number; y?: number }>;
    };
    expect(saved.elements.find((element) => element.id === 'oval')).toMatchObject({ x: 100, y: 90 });
    await expect
      .poll(() => readFile(join(folder, 'two.svg'), 'utf8'))
      .toBe(await cliRender(saved));
  } finally {
    await server.stop();
  }
});

test('the page fetches the hand font once', async ({ app, browser, screen }) => {
  const folder = await folderWith({ 'scene.json': SCENE_SOURCE });
  const server = await startServe(folder);
  try {
    await app.open(`${server.url}/editor.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // One file: the metrics that place the words and the face the page draws in
    // are the same fetch. A second request would be the `@font-face` the page
    // no longer declares.
    const fetched = async (): Promise<string[]> =>
      browser.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => name.endsWith('Kalam-Regular.ttf')),
      );
    await expect.poll(async () => (await fetched()).length).toBe(1);
  } finally {
    await server.stop();
  }
});
