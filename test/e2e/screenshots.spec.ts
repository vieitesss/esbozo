/**
 * The two screenshots the ticket asks for: the editor in light and in dark.
 *
 * Skipped unless `ESBOZO_SHOTS` names a folder, so the suite stays hermetic.
 * Run it with:
 *   ESBOZO_SHOTS=/path/to/6-shots pnpm exec playwright test screenshots
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { POSTER_SCENE, clickScene, openEditor } from './helpers.js';

const shots = process.env['ESBOZO_SHOTS'];

test.skip(shots === undefined || shots === '', 'set ESBOZO_SHOTS to write the screenshots');

test('the editor in light and dark', async ({ page }) => {
  const folders = { A: { 'scene.json': JSON.stringify(POSTER_SCENE, null, 2) } };
  await openEditor(page, folders, 'scene.json');
  await page.evaluate(() => document.fonts.ready);
  // A selection, so the handles and the dashed box are in the picture.
  await clickScene(page, { x: 170, y: 215 });
  await page.waitForTimeout(150);
  const folder = shots ?? 'shots';
  await mkdir(folder, { recursive: true });

  await page.screenshot({ path: join(folder, 'editor-light.png') });

  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(folder, 'editor-dark.png') });
});
