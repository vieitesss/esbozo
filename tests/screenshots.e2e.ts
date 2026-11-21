/**
 * The screenshots the ticket asks for: the editor in light and in dark, plus
 * the command palette over the paper.
 *
 * Skipped unless `ESBOZO_SHOTS` names a folder, so a normal run stays hermetic
 * and writes nothing into the project. Run it with:
 *   ESBOZO_SHOTS=/path/to/6-shots pnpm e2e:shots
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from '@e2e-dev/web';
import { stillCaret } from './cdp.ts';
import {
  BESIDE,
  BESIDE_SCENE,
  POSTER,
  POSTER_SCENE,
  clickScene,
  doubleClickScene,
  openEditor,
  settle,
} from './helpers.ts';

const shots = process.env['ESBOZO_SHOTS'];

// Skipped unless a folder is named, so a normal run writes nothing.
test.skipIf(shots === undefined || shots === '')(
  'the editor in light and dark',
  async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    const folders = { A: { 'scene.json': JSON.stringify(POSTER_SCENE, null, 2) } };
    await openEditor(ui, folders, 'scene.json');
    await ui.browser.evaluate(() => document.fonts.ready.then(() => true));
    // A selection, so the handles and the dashed box are in the picture.
    await clickScene(ui, { x: 170, y: 215 }, [], POSTER);
    await settle(ui);
    const folder = shots ?? 'shots';
    await mkdir(folder, { recursive: true });

    await copyFile(await ui.app.screenshot('editor-light'), join(folder, 'editor-light.png'));

    // The palette, as Q leaves it: every action by name, with its key.
    await ui.browser.keyboard.press('q');
    await settle(ui);
    await copyFile(await ui.app.screenshot('palette-light'), join(folder, 'palette-light.png'));
    await ui.browser.keyboard.press('Escape');

    await ui.screen.getByRole('button', 'Dark').click();
    await settle(ui);
    await copyFile(await ui.app.screenshot('editor-dark'), join(folder, 'editor-dark.png'));

    // And a Label being typed: the box grows for the words as they arrive, the
    // page draws them where they will save, and the caret stands in them. Its
    // blink is held still, so the picture shows the caret the page really draws.
    await ui.screen.getByRole('button', { name: 'Light' }).click();
    await stillCaret();
    await doubleClickScene(ui, { x: 340, y: 390 }, POSTER);
    await ui.screen
      .getByRole('textbox', { name: 'Label' })
      .pressSequentially('a Label typed in place grows its box');
    await settle(ui);
    await copyFile(
      await ui.app.screenshot('editor-label-editing'),
      join(folder, 'editor-label-editing.png'),
    );

    // And an arrow's Label, which hangs to its own side of the shaft: the words
    // are drawn where they will save, and the caret is among them.
    await openEditor(
      ui,
      { A: { 'beside.json': JSON.stringify(BESIDE_SCENE, null, 2) } },
      'beside.json',
    );
    await ui.browser.evaluate(() => document.fonts.ready.then(() => true));
    await doubleClickScene(ui, { x: 287, y: 220 }, BESIDE);
    await ui.screen.getByRole('textbox', { name: 'Label' }).fill('upward');
    await settle(ui);
    await copyFile(
      await ui.app.screenshot('editor-arrow-label-editing'),
      join(folder, 'editor-arrow-label-editing.png'),
    );
  },
);

// The status corners on a wide page and on a phone, with the Shortcuts sheet
// open and shut.
test.skipIf(shots === undefined || shots === '')('the shortcuts sheet, wide and narrow', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  const folder = shots ?? 'shots';
  await mkdir(folder, { recursive: true });
  const folders = { A: { 'scene.json': JSON.stringify(POSTER_SCENE, null, 2) } };

  for (const [name, width, height] of [
    ['1366x768', 1366, 768],
    ['390x780', 390, 780],
  ] as const) {
    await browser.setViewport({ width, height });
    await openEditor(ui, folders, 'scene.json');
    await browser.evaluate(() => document.fonts.ready.then(() => true));
    await settle(ui);
    await copyFile(
      await ui.app.screenshot(`shortcuts-${name}-closed`),
      join(folder, `shortcuts-${name}-closed.png`),
    );

    await screen.getByRole('button', 'Shortcuts').click();
    await settle(ui);
    await copyFile(
      await ui.app.screenshot(`shortcuts-${name}-open`),
      join(folder, `shortcuts-${name}-open.png`),
    );
  }
});
