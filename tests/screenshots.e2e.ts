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
    // page draws them where they will save, and the small field sits below.
    await ui.screen.getByRole('button', 'Light').click();
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
    // are drawn where they will save, and the field sits below the arrow.
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
