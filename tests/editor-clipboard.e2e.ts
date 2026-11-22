/**
 * Seam 2: copy, cut and paste — a page that has no clipboard API, the browser's
 * own clipboard keys, and a cut whose paste must not land in another Scene.
 * Asserted on the Scene the editor saves and the words the status line shows.
 */
import { test } from '@e2e-dev/web';
import { afterAll, expect } from 'e2e';
import {
  SNAPPED,
  SNAPPED_SCENE,
  THREE,
  clickScene,
  cliCheckBytes,
  dragBy,
  holdClipboardWrites,
  openEditor,
  releaseClipboardWrite,
  savedFiles,
  savedScene,
} from './helpers.ts';
import type { SavedScene, Ui } from './helpers.ts';
import { SCENE_SOURCE, THREE_SOURCE, command, palette } from './editor-shared.ts';
import { removeTempFolders } from '../test/temp.ts';

// `ez check` reads a saved Scene out of a temporary folder, as it does in every
// suite that asks the CLI about a file this page wrote.
afterAll(removeTempFolders);

/** `SNAPPED_SCENE` as the file a person opens: an arrow Snapped to two boxes. */
const SNAPPED_SOURCE = JSON.stringify(SNAPPED_SCENE, null, 2);

/** A point on that arrow's shaft, on no box: where a press selects it alone. */
const SNAPPED_ON = { x: 230, y: 80 };

/** Every shaft's whole `points`, in the order the Scene lists them. */
function pointsOf(scene: SavedScene): unknown[] {
  return scene.elements.flatMap((element) =>
    element.points === undefined ? [] : [element.points],
  );
}

/**
 * The saved Scene, and `ez check`'s word that the file it was saved as parses:
 * a Snap naming a target the Scene does not carry is a Scene the editor can
 * write and cannot read back.
 */
async function savedAndChecked(ui: Ui): Promise<SavedScene> {
  const scene = await savedScene(ui);
  const checked = await cliCheckBytes((await savedFiles(ui))['scene.json'] ?? '');
  expect(checked.code, checked.reported).toBe(0);
  return scene;
}

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
  await browser.keyboard.press('ControlOrMeta+a');
  await browser.keyboard.type('paste');
  await expect(command(ui, 'Paste · ⌘V')).toBeDisabled();
  await expect(command(ui, 'Paste · ⌘V')).toContainText('use ⌘C / ⌘V');
  await browser.keyboard.press('Escape');

  // The keys are the browser's own clipboard events, so they still work.
  await browser.keyboard.press('ControlOrMeta+x');
  await expect.poll(async () => (await savedScene(ui)).elements.length).toBe(1);
  await browser.keyboard.press('ControlOrMeta+v');
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

test('Duplicate copies a Snapped arrow alone as a free arrow, keeping its points', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SNAPPED_SOURCE } }, 'scene.json');

  // The arrow alone: both of its targets stay out of the selection, so a copy
  // of it is a free-standing arrow, as a copy pasted by hand already is.
  await clickScene(ui, SNAPPED_ON, [], SNAPPED);
  await browser.keyboard.press('Meta+d');

  const scene = await savedAndChecked(ui);
  expect(scene.elements.map((element) => element.id)).toEqual(['from', 'to', 'link', 'arrow-1']);
  expect(pointsOf(scene)).toEqual([
    [
      { x: 160, y: 80, snap: 'from' },
      { x: 300, y: 80, snap: 'to' },
    ],
    [
      { x: 176, y: 96 },
      { x: 316, y: 96 },
    ],
  ]);

  // One undo takes the copy away, and the ends stay attached to their targets.
  await browser.keyboard.press('Meta+z');
  await expect.poll(async () => (await savedScene(ui)).elements.length).toBe(3);
  expect(pointsOf(await savedAndChecked(ui))).toEqual([
    [
      { x: 160, y: 80, snap: 'from' },
      { x: 300, y: 80, snap: 'to' },
    ],
  ]);
});
