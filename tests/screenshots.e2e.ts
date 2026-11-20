/**
 * The two screenshots the ticket asks for: the editor in light and in dark.
 *
 * Skipped unless `ESBOZO_SHOTS` names a folder, so a normal run stays hermetic
 * and writes nothing into the project. Run it with:
 *   ESBOZO_SHOTS=/path/to/6-shots pnpm e2e:shots
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from '@e2e-dev/web';
import { POSTER, POSTER_SCENE, clickScene, openEditor, settle } from './helpers.ts';

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

    await ui.screen.getByRole('button', 'Dark').click();
    await settle(ui);
    await copyFile(await ui.app.screenshot('editor-dark'), join(folder, 'editor-dark.png'));
  },
);
