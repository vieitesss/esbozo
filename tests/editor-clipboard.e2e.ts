/**
 * Seam 2: copy, cut and paste — a page that has no clipboard API, the browser's
 * own clipboard keys, and a cut whose paste must not land in another Scene.
 * Asserted on the Scene the editor saves and the words the status line shows.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  THREE,
  clickScene,
  dragBy,
  holdClipboardWrites,
  openEditor,
  releaseClipboardWrite,
  savedFiles,
  savedScene,
} from './helpers.ts';
import { SCENE_SOURCE, THREE_SOURCE, command, palette } from './editor-shared.ts';

test('Copy, Cut and Paste say to use the keys where the page has no clipboard', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  // Selected, so the selection is not what the row is waiting for.
  await clickScene(ui, { x: 100, y: 80 });
  // A page served over plain HTTP has no async Clipboard API at all.
  await browser.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    return (navigator as { clipboard?: unknown }).clipboard === undefined;
  });

  await palette(ui);
  await browser.keyboard.type('copy');
  await expect(command(ui, 'Copy · ⌘C')).toBeDisabled();
  await expect(command(ui, 'Copy · ⌘C')).toContainText('use ⌘C / ⌘V');
  await browser.keyboard.press('Meta+a');
  await browser.keyboard.type('paste');
  await expect(command(ui, 'Paste · ⌘V')).toBeDisabled();
  await expect(command(ui, 'Paste · ⌘V')).toContainText('use ⌘C / ⌘V');
  await browser.keyboard.press('Escape');

  // The keys are the browser's own clipboard events, so they still work.
  await browser.keyboard.press('Meta+x');
  await expect.poll(async () => (await savedScene(ui)).elements.length).toBe(1);
  await browser.keyboard.press('Meta+v');
  await expect.poll(async () => (await savedScene(ui)).elements.length).toBe(2);
});

test('a cut deletes the Elements it copied, whatever is selected when it lands', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': THREE_SOURCE } }, 'scene.json');
  await holdClipboardWrites(ui);

  // Cut the first box by name: the copy is in the clipboard, and the delete
  // waits for the clipboard to accept it.
  await clickScene(ui, { x: 90, y: 70 }, [], THREE);
  await palette(ui);
  await browser.keyboard.type('cut');
  await browser.keyboard.press('Enter');

  // While that write is in flight, the selection moves to another box. A cut
  // deletes what it copied, not what happens to be selected when it lands.
  await clickScene(ui, { x: 200, y: 220 }, [], THREE);
  await releaseClipboardWrite(ui);

  await expect.poll(async () => (await savedScene(ui)).elements.map((element) => element.id)).toEqual([
    'q',
    'r',
  ]);
});

test('a cut deletes nothing when the Scene changed before the copy landed', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': THREE_SOURCE } }, 'scene.json');
  await holdClipboardWrites(ui);

  await clickScene(ui, { x: 200, y: 220 }, [], THREE);
  await palette(ui);
  await browser.keyboard.type('cut');
  await browser.keyboard.press('Enter');

  // The page keeps taking edits while the clipboard write runs: this drag moves
  // the third box, so the Scene is not the one the cut copied from.
  await dragBy(ui, { x: 430, y: 130 }, 0, 60, THREE);
  await expect.poll(async () => (await savedFiles(ui))['scene.json']).toContain('"y": 160');
  await releaseClipboardWrite(ui);

  // Nothing is deleted, and the status line says why: the drawing the paste
  // would land in is not the one the copy came from.
  await expect(screen.getByRole('status')).toContainText('the Scene changed');
  const files = await savedFiles(ui);
  expect(JSON.parse(files['scene.json'] ?? '{}').elements.map((element: { id: string }) => element.id)).toEqual([
    'p',
    'q',
    'r',
  ]);
});
