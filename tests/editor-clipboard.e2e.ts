/**
 * Seam 2: copy, cut, paste and duplicate — a page that has no clipboard API,
 * the browser's own clipboard keys, a cut whose paste must not land in another
 * Scene, and a duplicate, which is a copy pasted in place. Asserted on the
 * Scene the editor saves and the words the status line shows.
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
import type { SavedScene, Ui, View } from './helpers.ts';
import { SCENE_SOURCE, THREE_SOURCE, command, palette } from './editor-shared.ts';
import { removeTempFolders } from '../test/temp.ts';

// `ez check` reads a saved Scene out of a temporary folder, as it does in every
// suite that asks the CLI about a file this page wrote.
afterAll(removeTempFolders);

/** `SNAPPED_SCENE` as the file a person opens: an arrow Snapped to two boxes. */
const SNAPPED_SOURCE = JSON.stringify(SNAPPED_SCENE, null, 2);

/** A point on that arrow's shaft, on no box: where a press selects it alone. */
const SNAPPED_ON = { x: 230, y: 80 };

/**
 * A bent arrow between two boxes: three points, both ends Snapped and the bend
 * between them written `sharp`. Roughness 0, so the ends it draws at are the
 * ones the numbers say: `a`'s outline puts the start at (100,90), `b`'s the end
 * at (500,90), and the bend sits at (300,250) whichever way it is read.
 */
const BENT_SCENE = {
  version: 1,
  title: 'Bent',
  defaults: { roughness: 0 },
  elements: [
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 },
    { id: 'b', type: 'rectangle', x: 500, y: 0, width: 100, height: 100 },
    {
      id: 'c',
      type: 'arrow',
      points: [
        { x: 50, y: 50, snap: 'a' },
        { x: 300, y: 250, corner: 'sharp' },
        { x: 550, y: 50, snap: 'b' },
      ],
      heads: { start: 'none', end: 'arrow' },
    },
  ],
};
const BENT_SOURCE = JSON.stringify(BENT_SCENE, null, 2);

/** The view `BENT_SCENE` lands in, worked out the same way as `VIEW`. */
const BENT: View = { zoom: 1, panX: 340, panY: 275 };

/** A point on `c`'s first run, on no box: where a press selects the arrow. */
const BENT_ON = { x: 200, y: 170 };

/** Inside `a`, clear of the arrow's ink: where a shift-press adds the box. */
const IN_A = { x: 50, y: 50 };

/** Inside `b`, clear of the arrow's ink: where the other box joins the selection. */
const IN_B = { x: 550, y: 50 };

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
async function savedAndChecked(ui: Ui, name = 'scene.json'): Promise<SavedScene> {
  const scene = await savedScene(ui, name);
  const checked = await cliCheckBytes((await savedFiles(ui))[name] ?? '');
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

test('Duplicate follows the Snap to a target it copies and drops the one it does not', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'bent.json': BENT_SOURCE } }, 'bent.json');

  // The bent arrow and one of its two targets: the Snap to the box that is
  // copied follows its copy, and the Snap to the box left behind is dropped.
  await clickScene(ui, BENT_ON, [], BENT);
  await clickScene(ui, IN_A, ['Shift'], BENT);
  await browser.keyboard.press('Meta+d');

  const scene = await savedAndChecked(ui, 'bent.json');
  expect(scene.elements.map((element) => element.id)).toEqual([
    'a',
    'b',
    'c',
    'rectangle-1',
    'arrow-1',
  ]);
  expect(pointsOf(scene)).toEqual([
    [
      { x: 50, y: 50, snap: 'a' },
      { x: 300, y: 250, corner: 'sharp' },
      { x: 550, y: 50, snap: 'b' },
    ],
    [
      { x: 66, y: 66, snap: 'rectangle-1' },
      { x: 316, y: 266, corner: 'sharp' },
      { x: 566, y: 66 },
    ],
  ]);

  // One undo takes the bent copy and the box it followed away together.
  await browser.keyboard.press('Meta+z');
  await expect.poll(async () => (await savedScene(ui, 'bent.json')).elements.length).toBe(3);
  expect(pointsOf(await savedAndChecked(ui, 'bent.json'))).toEqual([
    [
      { x: 50, y: 50, snap: 'a' },
      { x: 300, y: 250, corner: 'sharp' },
      { x: 550, y: 50, snap: 'b' },
    ],
  ]);
});

test('Duplicate keeps both Snaps when it copies both targets', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'bent.json': BENT_SOURCE } }, 'bent.json');

  // The whole Scene: both of the bent arrow's targets are copied with it, so
  // both ends stay attached, to the copies they now belong to.
  await clickScene(ui, BENT_ON, [], BENT);
  await clickScene(ui, IN_A, ['Shift'], BENT);
  await clickScene(ui, IN_B, ['Shift'], BENT);
  await browser.keyboard.press('Meta+d');

  const scene = await savedAndChecked(ui, 'bent.json');
  expect(scene.elements.map((element) => element.id)).toEqual([
    'a',
    'b',
    'c',
    'rectangle-1',
    'rectangle-2',
    'arrow-1',
  ]);
  expect(pointsOf(scene)).toEqual([
    [
      { x: 50, y: 50, snap: 'a' },
      { x: 300, y: 250, corner: 'sharp' },
      { x: 550, y: 50, snap: 'b' },
    ],
    [
      { x: 66, y: 66, snap: 'rectangle-1' },
      { x: 316, y: 266, corner: 'sharp' },
      { x: 566, y: 66, snap: 'rectangle-2' },
    ],
  ]);

  // One undo takes the whole duplicate back.
  await browser.keyboard.press('Meta+z');
  await expect.poll(async () => (await savedScene(ui, 'bent.json')).elements.length).toBe(3);
  expect(pointsOf(await savedAndChecked(ui, 'bent.json'))).toEqual([
    [
      { x: 50, y: 50, snap: 'a' },
      { x: 300, y: 250, corner: 'sharp' },
      { x: 550, y: 50, snap: 'b' },
    ],
  ]);
});
