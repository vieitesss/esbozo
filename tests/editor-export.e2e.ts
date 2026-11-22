/**
 * One of the editor suites, split by the area of the editor it drives:
 * `tests/editor-*.e2e.ts`.
 *
 * Seam 2: exporting a Scene — the PNG the page downloads against the one
 * `ez png` draws for the same Scene, and the name a Scene too big for one
 * canvas is given. Asserted on the downloaded bytes and the command named.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  BIG_SCENE,
  TEXT_SCENE,
  WIDE_WALL_SCENE,
  XL_WORDS_SCENE,
  cliPng,
  clickScene,
  exported,
  settle,
  openEditor,
  runAsWritten,
  savedFiles,
  savedScene,
} from './helpers.ts';
import type { Ui } from './helpers.ts';
import { decodePng, difference } from './pixels.ts';
import { SCENE_SOURCE, MIXED_SOURCE, command, palette } from './editor-shared.ts';

const TEXT_SOURCE = JSON.stringify(TEXT_SCENE, null, 2);
const BIG_SOURCE = JSON.stringify(BIG_SCENE, null, 2);
const XL_SOURCE = JSON.stringify(XL_WORDS_SCENE, null, 2);
const WIDE_WALL_SOURCE = JSON.stringify(WIDE_WALL_SCENE, null, 2);

// ---------------------------------------------------------------- PNG export

/** Export the open Scene from the palette, and read what the browser downloaded. */
async function exportFromPalette(ui: Ui, name: string): Promise<{ name: string; png: Buffer }> {
  await palette(ui);
  return exported(ui, () => command(ui, name).click());
}

/** A drawing that must not be an empty sheet: its ink covers a real share of its page. */
function inkShare(png: Buffer): number {
  const image = decodePng(png);
  let inked = 0;
  for (let at = 0; at < image.width * image.height; at += 1) {
    const luminance =
      (0.2126 * (image.data[at * image.channels] ?? 0) +
        0.7152 * (image.data[at * image.channels + 1] ?? 0) +
        0.0722 * (image.data[at * image.channels + 2] ?? 0)) /
      255;
    if (luminance < 0.5) {
      inked += 1;
    }
  }
  return inked / (image.width * image.height);
}

test('Export PNG (light) downloads the image `ez png` gives for the same Scene', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  // A Scene with words in it: the SVG the browser rasterises has to carry the
  // page's font, or the PNG would be the same drawing in another typeface.
  await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');

  const file = await exportFromPalette(ui, 'Export PNG (light)');
  expect(file.name).toBe('scene.light.png');

  const cli = await cliPng(await savedScene(ui), 'light');
  expect({ width: decodePng(file.png).width, height: decodePng(file.png).height }).toEqual({
    width: decodePng(cli).width,
    height: decodePng(cli).height,
  });
  const apart = difference(decodePng(file.png), decodePng(cli));
  // Two rasterisers antialias the same paths differently; the drawings agree.
  expect(apart.meanDelta).toBeLessThan(1);
  expect(apart.movedShare).toBeLessThan(0.01);
  expect(inkShare(file.png)).toBeGreaterThan(0.02);
});

test('Export PNG (dark) draws the paper and ink the page shows, as `ez png --theme dark`', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await clickScene(ui, { x: 100, y: 80 });
  // The page is dark, and the dark PNG is the drawing that page shows.
  await screen.getByRole('button', 'Dark').click();
  await settle(ui);

  const dark = await exportFromPalette(ui, 'Export PNG (dark)');
  expect(dark.name).toBe('scene.dark.png');
  const cli = await cliPng(await savedScene(ui), 'dark');
  const apart = difference(decodePng(dark.png), decodePng(cli));
  expect(apart.meanDelta).toBeLessThan(1);
  expect(apart.movedShare).toBeLessThan(0.01);

  // A dark page draws light ink on dark paper: the two exports are not one PNG.
  const light = await exportFromPalette(ui, 'Export PNG (light)');
  expect(decodePng(light.png).data).not.toEqual(decodePng(dark.png).data);
});

test('a dense page of words exports as `ez png` draws it, in light and dark', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': TEXT_SOURCE } }, 'scene.json');
  const scene = await savedScene(ui);
  // Words at every size and anchor, so this is a text comparison, not a stroke one.
  expect((await cliPng(scene, 'dark')).length).toBeGreaterThan(0);

  for (const theme of ['light', 'dark'] as const) {
    const file = await exportFromPalette(ui, `Export PNG (${theme})`);
    const cli = await cliPng(await savedScene(ui), theme);
    expect({ width: decodePng(file.png).width, height: decodePng(file.png).height }).toEqual({
      width: decodePng(cli).width,
      height: decodePng(cli).height,
    });
    const apart = difference(decodePng(file.png), decodePng(cli));
    // The browser draws the glyph outlines the font carries, so the two
    // rasterisers agree on the words, not just on the strokes around them.
    expect(apart.meanDelta, `${theme} mean delta ${apart.meanDelta}`).toBeLessThan(1);
    expect(apart.movedShare, `${theme} moved share ${apart.movedShare}`).toBeLessThan(0.01);
    expect(inkShare(file.png)).toBeGreaterThan(0.02);
  }
});

/** Where every line of ink ends, read from a PNG of a page of words. */
function inkLines(png: Buffer): { width: number; right: number[] } {
  const image = decodePng(png);
  const paper = [0, 1, 2].map((channel) => image.data[channel] ?? 0);
  const inked = (x: number, y: number): boolean => {
    const at = (y * image.width + x) * image.channels;
    return [0, 1, 2].some((channel) => Math.abs((image.data[at + channel] ?? 0) - paper[channel]!) > 64);
  };
  const right: number[] = [];
  let lastRow = -2;
  for (let y = 0; y < image.height; y += 1) {
    let edge = -1;
    for (let x = 0; x < image.width; x += 1) {
      if (inked(x, y)) {
        edge = x;
      }
    }
    if (edge < 0) {
      continue;
    }
    // A line is a band of inked rows: the next inked row continues it.
    if (y === lastRow + 1 && right.length > 0) {
      right[right.length - 1] = Math.max(right[right.length - 1]!, edge);
    } else {
      right.push(edge);
    }
    lastRow = y;
  }
  return { width: image.width, right };
}

test('five XL lines of one sentence export as `ez png` draws them, in light and dark', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  // The reviewer's page: five XL lines of the same words, which the browser
  // drew as the word `Kalam` alone because the path it was given held a NaN.
  await openEditor(ui, { A: { 'scene.json': XL_SOURCE } }, 'scene.json');

  for (const theme of ['light', 'dark'] as const) {
    const file = await exportFromPalette(ui, `Export PNG (${theme})`);
    const cli = await cliPng(await savedScene(ui), theme);
    expect({ width: decodePng(file.png).width, height: decodePng(file.png).height }).toEqual({
      width: decodePng(cli).width,
      height: decodePng(cli).height,
    });
    const apart = difference(decodePng(file.png), decodePng(cli));
    expect(apart.meanDelta, `${theme} mean delta ${apart.meanDelta}`).toBeLessThan(1);
    expect(apart.movedShare, `${theme} moved share ${apart.movedShare}`).toBeLessThan(0.01);

    // Every one of the five lines keeps its words: five bands of ink, each
    // reaching the end of the line the font measured.
    const lines = inkLines(file.png);
    expect(lines.right.length, `${theme} lines`).toBe(5);
    for (const edge of lines.right) {
      expect(edge, `${theme} line ends at ${edge} of ${lines.width}`).toBeGreaterThan(
        lines.width * 0.9,
      );
    }
  }
});

test('a page wider than 32,767 units exports at one pixel per unit', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  // 33,170×142: past the 32,767 a canvas may be a side, and inside the limit
  // the browser really draws at, so this page is the browser's to export.
  await openEditor(ui, { A: { 'wide.json': WIDE_WALL_SOURCE } }, 'wide.json');

  const file = await exportFromPalette(ui, 'Export PNG (light)');

  expect(file.name).toBe('wide.light.png');
  expect({ width: decodePng(file.png).width, height: decodePng(file.png).height }).toEqual({
    width: 33170,
    height: 142,
  });
  // The wall is drawn, not an empty sheet: its outline is ink across the page.
  expect(inkShare(file.png)).toBeGreaterThan(0.02);
});

test('a Scene too big for a canvas names the CLI command that draws it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'poster.json': BIG_SOURCE } }, 'poster.json');

  // The row stays enabled: the page's size is only known once it is drawn.
  await palette(ui);
  await browser.keyboard.type('export png dark');
  await expect(command(ui, 'Export PNG (dark)')).not.toBeDisabled();
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();

  // The status line says how big the page is and what draws it at 1:1 instead.
  const status = screen.getByRole('status');
  await expect(status).toContainText('70170×142');
  await expect(status).toContainText('ez png poster.json --theme dark');

  // The attempt changed nothing: the Scene on disk is the one that was opened.
  const files = await savedFiles(ui);
  expect(JSON.parse(files['poster.json'] ?? '{}').elements.length).toBe(1);
});

test('a Scene whose name holds a space is named so the command runs as written', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'big poster.json': BIG_SOURCE } }, 'big poster.json');

  await palette(ui);
  await browser.keyboard.type('export png dark');
  await browser.keyboard.press('Enter');
  const status = screen.getByRole('status');
  await expect(status).toContainText('70170×142');
  // A name with a space in it is quoted, so the shell hands the CLI one path.
  await expect(status).toContainText("ez png 'big poster.json' --theme dark");

  // The command as written draws the page: copied out of the status line, it
  // reads the Scene that is on disk and writes the PNG beside it.
  const command = /`([^`]+)`/.exec((await status.textContent()) ?? '')?.[1] ?? '';
  expect(command).toBe("ez png 'big poster.json' --theme dark");
  const written = await runAsWritten(command, await savedFiles(ui));
  expect(written.code).toBe(0);
  const png = decodePng(await readFile(join(written.folder, 'big poster.dark.png')));
  expect({ width: png.width, height: png.height }).toEqual({ width: 70170, height: 142 });
});
