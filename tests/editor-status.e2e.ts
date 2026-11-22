/**
 * Seam 2: the status line and the mode pill — the Scene and the view a person
 * reads back, the panning word and the hand it names, and the Shortcuts sheet
 * behind `?`. Asserted on what the page shows and on the Scene a pan leaves
 * alone.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  allowWrites,
  clickScene,
  drag,
  settle,
  holdWrites,
  openEditor,
  refuseWrite,
  savedFiles,
} from './helpers.ts';
import type { Ui } from './helpers.ts';
import { blurPage, livePage } from './cdp.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';
import { SCENE_SOURCE, THREE_SOURCE } from './editor-shared.ts';

/** The bottom-centre band around the mode pill at 1366 × 768. */
const MODE_PILL_BAND: Rect = { x: 601, y: 690, width: 164, height: 70 };

test('the status line keeps the Scene top left, the view bottom left and no mode pill', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await ui.browser.setViewport({ width: 1366, height: 768 });
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await expect(ui.screen.getByRole('status')).toHaveText('saved');

  // Everything the line says is still there, found the way a person finds it.
  for (const drawn of [
    ui.screen.getByRole('button', /Open folder/),
    ui.screen.getByText('A / scene.json'),
    ui.screen.getByRole('status'),
    ui.screen.getByRole('button', 'Grid'),
    ui.screen.getByRole('button', 'rough artist'),
    ui.screen.getByText(/^\d+%$/),
  ]) {
    await expect(drawn).toBeVisible();
  }

  // What the Scene is goes in the top left corner — the folder, its name and what
  // became of it, three lines of them, where only bare paper was — and what the
  // view is doing stays in the bottom left, one line of Grid, roughness and zoom.
  const TOP_LEFT: Rect = { x: 0, y: 0, width: 360, height: 96 };
  const BOTTOM_LEFT: Rect = { x: 0, y: 690, width: 360, height: 70 };
  const page = await shot(ui);
  expect(page.bands(TOP_LEFT, 0.7)).toBe(3);
  expect(page.bands(BOTTOM_LEFT, 0.6)).toBe(1);

  // Nothing transient is being named, so the bottom centre is bare paper.
  const pill = ui.screen.getByText('read-only');
  await expect(pill).toBeHidden();
  expect((await shot(ui)).darkCount(MODE_PILL_BAND, 0.6)).toBe(0);
});

test('a held Space names the pan in the mode pill, and the release puts it away', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await ui.browser.setViewport({ width: 1366, height: 768 });
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await expect(ui.screen.getByRole('status')).toHaveText('saved');

  const pill = ui.screen.getByText('Panning');
  await expect(pill).toBeHidden();

  // The key alone holds the page in the hand: the pill says so before the
  // pointer has moved anywhere, and the band that was bare paper carries ink.
  await ui.browser.keyboard.down('Space');
  await expect(pill).toBeVisible();
  expect((await shot(ui)).darkCount(MODE_PILL_BAND, 0.6)).toBeGreaterThan(0);

  // The pan the key carries keeps the word it gave.
  await drag(ui, { x: 640, y: 400 }, { x: 700, y: 440 });
  await expect(pill).toBeVisible();

  // The key comes up: the word goes with the pan, and the band is bare again.
  await ui.browser.keyboard.up('Space');
  await expect(pill).toBeHidden();
  expect((await shot(ui)).darkCount(MODE_PILL_BAND, 0.6)).toBe(0);
});

test('a middle drag names the pan in the mode pill while the button is down', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await ui.browser.setViewport({ width: 1366, height: 768 });
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await expect(ui.screen.getByRole('status')).toHaveText('saved');

  // The bottom centre, where a mode would be named: the 164 pixels around it.
  const BOTTOM_MIDDLE: Rect = { x: 601, y: 690, width: 164, height: 70 };
  const pill = ui.screen.getByText('Panning');
  await expect(pill).toBeHidden();

  // A middle press on the paper pans it: the word is the drag's while the button
  // is down, and the pointer carrying the page does not take it away.
  const mouse = livePage().mouse;
  await mouse.move(300, 650);
  await mouse.down({ button: 'middle' });
  await expect(pill).toBeVisible();
  await mouse.move(320, 680);
  await expect(pill).toBeVisible();

  // The button coming up puts the word away with the pan it named.
  await mouse.up({ button: 'middle' });
  await expect(pill).toBeHidden();
  expect((await shot(ui)).darkCount(BOTTOM_MIDDLE, 0.6)).toBe(0);
});

test('a save the folder refuses keeps the pan in the hand it was taken with', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await ui.browser.setViewport({ width: 1366, height: 768 });
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await expect(ui.screen.getByRole('status')).toHaveText('saved');

  const pill = ui.screen.getByText('Panning');
  const readOnly = ui.screen.getByText('read-only');
  await expect(pill).toBeHidden();
  await expect(readOnly).toBeHidden();

  // An edit asks the folder to write, and the folder's answer waits for this
  // test: the page does not know yet whether it may write.
  await holdWrites(ui, 'scene.json');
  await clickScene(ui, { x: 100, y: 80 });
  await browser.keyboard.press('Shift+ArrowRight');
  const mouse = livePage().mouse;
  await mouse.move(300, 650);
  await mouse.down({ button: 'middle' });
  await mouse.move(320, 680);
  await expect(pill).toBeVisible();

  // The folder answers `403` while the button is still down: the page may only
  // read from now on. A pan is a view, not an edit, so it keeps the hand it was
  // taken with, and the word it was naming.
  await refuseWrite(ui, 'this folder is served read-only');
  await expect(readOnly).toBeHidden();
  await expect(pill).toBeVisible();

  // The button comes up: the pan ends with it, and the page says what it may do.
  await mouse.up({ button: 'middle' });
  await expect(pill).toBeHidden();
  await expect(readOnly).toBeVisible();
  await allowWrites(ui);
});

test('a window blur while Space is held takes the pill with the pan', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await ui.browser.setViewport({ width: 1366, height: 768 });
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  const pill = ui.screen.getByText('Panning');
  await ui.browser.keyboard.down('Space');
  await expect(pill).toBeVisible();

  // The focus really leaves the page while the key is still held: the window
  // takes it for another one of its own, so no release ever comes here, and the
  // page lets the pan go rather than keep the word for a hold it no longer has.
  await blurPage();
  await expect(pill).toBeHidden();
  expect((await shot(ui)).darkCount(MODE_PILL_BAND, 0.6)).toBe(0);
  await browser.keyboard.up('Space');
});

test('another Scene takes the pan word with the Scene it named', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await ui.browser.setViewport({ width: 1366, height: 768 });
  await openEditor(
    ui,
    { A: { 'scene.json': SCENE_SOURCE, 'other.json': THREE_SOURCE } },
    'scene.json',
  );

  const pill = ui.screen.getByText('Panning');
  await ui.browser.keyboard.down('Space');
  await expect(pill).toBeVisible();

  // Another Scene comes into the page while the key is still held: the pan was
  // the one the page held before, and neither it nor its word survives the
  // switch.
  await ui.screen.getByRole('button', /Open folder/).click();
  await ui.screen.getByRole('button', 'other.json').click();
  await expect(pill).toBeHidden();
  await ui.browser.keyboard.up('Space');
});

/**
 * The page this file's own host tests own: it holds the element and keeps its
 * own hands on it, so handing it back — and naming another Scene to it — is the
 * host's doing and no test reads where the page put it.
 */
const CONTROLLED_HOST = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>html, body { height: 100%; margin: 0 } esbozo-editor { display: block; height: 100vh }</style>
<link rel="stylesheet" href="editor.css" />
</head>
<body>
<div class="slot"><esbozo-editor></esbozo-editor></div>
<script type="module">
  const slot = document.querySelector('.slot');
  const editor = slot.querySelector('esbozo-editor');
  window.editor = editor;
  // The host takes the element out of the page and puts it back where it had it.
  window.unplug = () => {
    editor.remove();
    slot.append(editor);
  };
</script>
<script type="module" src="editor.js"></script>
</body>
</html>`;

/** What the controlled host page keeps for a test that holds it. */
interface ControlledHost {
  /** The page's own handle on the element it holds. */
  readonly editor: Element;
  /** The page takes the element out of itself and puts it back. */
  readonly unplug: () => void;
}

/** Open the editor on the page this file owns, holding a Scene it can draw. */
async function openControlledHost(ui: Ui): Promise<void> {
  await ui.browser.route('**/editor.html', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: CONTROLLED_HOST }),
  );
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
}

for (const hostChange of ['disconnect', 'reset'] as const) {
  test(`a pan ends on a host ${hostChange}`, async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await openControlledHost(ui);
    const pill = screen.getByText('Panning');
    const mouse = livePage().mouse;

    await browser.keyboard.down('Space');
    await mouse.move(640, 400);
    await mouse.down();
    await expect(pill).toBeVisible();

    await browser.evaluate((change) => {
      const host = window as unknown as ControlledHost;
      if (change === 'disconnect') {
        // The page the pan was taken on hands the element back, and the element
        // comes back with the key still held.
        host.unplug();
      } else {
        host.editor.setAttribute('scene', 'another-scene.json');
      }
      return true;
    }, hostChange);

    // Neither teardown waits for a pointer or Space release to clear the pill.
    await expect(pill).toBeHidden();
    await mouse.up();
    await browser.keyboard.up('Space');
  });
}

test('the ? button opens the Shortcuts sheet, and Escape shuts it', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The keys are the sheet's alone: nothing on the page says them until the
  // sheet is asked for.
  await expect(ui.screen.getByText(/Q commands/)).toHaveCount(0);

  const help = ui.screen.getByRole('button', 'Shortcuts');
  const sheet = ui.screen.getByRole('dialog', 'Shortcuts');
  await expect(help).toHaveAttribute('aria-expanded', 'false');
  await expect(sheet).toBeHidden();

  // A selection first, because opening the sheet is not allowed to change it.
  await clickScene(ui, { x: 100, y: 80 });
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();

  await help.click();
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  await expect(sheet).toBeVisible();
  // Each shortcut has a visible key or gesture.
  for (const key of ['Space', 'wheel', '⌘+ / ⌘−', 'G', 'Q']) {
    await expect(sheet).toContainText(key);
  }

  // The sheet is the topmost thing the page opened: its Escape shuts it, leaves
  // the selection alone, and the next Escape is the page's as it always was.
  await ui.browser.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(help).toHaveAttribute('aria-expanded', 'false');
  await expect(ui.screen.getByRole('dialog', 'Style')).toBeVisible();
});

test('the Shortcuts sheet keeps its left border on the narrowest page', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await ui.browser.setViewport({ width: 320, height: 640 });
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await ui.screen.getByRole('button', 'Shortcuts').click();
  await expect(ui.screen.getByRole('dialog', 'Shortcuts')).toBeVisible();
  await settle(ui);

  // Where the page holds the sheet, so the strip below covers its left edge and
  // the paper beside it, and nothing of the words inside it.
  const box = await ui.browser.evaluate(() => {
    const sheet = document.querySelector('esbozo-editor .shortcuts')?.getBoundingClientRect();
    return { left: sheet?.left ?? 0, top: sheet?.top ?? 0, height: sheet?.height ?? 0 };
  });
  // A sheet that runs off the left of the page has no left edge drawn: the strip
  // is bare there, while a sheet that fits carries its border down its height.
  const edge: Rect = { x: box.left, y: box.top + 8, width: 3, height: box.height - 16 };
  expect((await shot(ui)).darkCount(edge, 0.9)).toBeGreaterThan(box.height / 2);
});

test('a press on the page shuts the Shortcuts sheet and lands where it was aimed', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  const help = ui.screen.getByRole('button', 'Shortcuts');
  const sheet = ui.screen.getByRole('dialog', 'Shortcuts');
  const style = ui.screen.getByRole('dialog', 'Style');

  // Open, shut with the button, open again: the toggle leaves the tool in Select
  // and the Scene where it was, so the press below has nothing to draw with.
  await help.click();
  await expect(sheet).toBeVisible();
  await help.click();
  await expect(sheet).toBeHidden();
  await help.click();
  await expect(sheet).toBeVisible();

  // One Element selected, so a press the sheet shut on and a press it swallowed
  // are told apart: the sheet shuts either way, and only a press that landed
  // also lets the selection go. The press that selected the box shut the sheet,
  // so the sheet is asked for again once the selection is in hand.
  await clickScene(ui, { x: 100, y: 80 });
  await expect(style).toBeVisible();
  await help.click();
  await expect(sheet).toBeVisible();
  await expect(style).toBeVisible();

  await clickScene(ui, { x: 60, y: 300 });
  await expect(sheet).toBeHidden();
  await expect(help).toHaveAttribute('aria-expanded', 'false');
  await expect(style).toBeHidden();

  // The press was bare paper: the box is where the Scene has it, and the nudge a
  // selection would have answered moves nothing and writes nothing.
  await browser.keyboard.press('Shift+ArrowRight');
  await settle(ui);
  expect((await savedFiles(ui))['scene.json']).toBe(SCENE_SOURCE);
});
