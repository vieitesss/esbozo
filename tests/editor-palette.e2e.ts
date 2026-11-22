/**
 * One of the editor suites, split by the area of the editor it drives:
 * `tests/editor-*.e2e.ts`.
 *
 * Seam 2: the command palette — every action with the key that runs it, the
 * rows a query keeps, the focus a palette hands back, and the actions it runs.
 * Driven by `Q`, `⌘K`, the arrows and Enter, and asserted on the Scene.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { clickScene, settle, openEditor, savedScene } from './helpers.ts';
import type { Ui } from './helpers.ts';
import { shot } from './pixels.ts';
import { SCENE_SOURCE, GRID, CORNER, command, palette } from './editor-shared.ts';

test('Q opens the palette on every action, each with the key that does it', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await palette(ui);

  // A tool, a Scene-wide action and an Arrange action are all reachable here,
  // and the row says which key picks it: the rail, the menu and the palette are
  // one list of actions. A tool names the digit its place on the rail gives it,
  // and Delete names the Backspace and Delete beside its letter.
  await expect(command(ui, 'Select · V · 1')).toBeVisible();
  await expect(command(ui, 'Toggle Grid · G')).toBeVisible();
  await expect(command(ui, 'Zoom to fit · ⌘0')).toBeVisible();
  await expect(command(ui, 'Redo · ⇧⌘Z')).toBeVisible();
  await expect(command(ui, 'Copy · ⌘C')).toBeVisible();
  await expect(command(ui, 'Open folder…')).toBeVisible();
  await expect(command(ui, 'Arrange: left')).toBeVisible();
  await expect(command(ui, 'Export PNG (dark)')).toBeVisible();

  // Nothing is selected, so the actions that need one say they cannot run.
  await expect(command(ui, 'Delete · X · ⌫ · Del')).toBeDisabled();
  await expect(command(ui, 'Delete · X · ⌫ · Del')).toContainText('select an Element first');

  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
});

test('⌘K opens the palette, and a query keeps the rows whose name holds its words', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await browser.keyboard.press('Meta+k');
  await expect(screen.getByRole('dialog', 'Commands')).toBeVisible();

  // Words in any order, in any case: the two Exports survive, the tools do not.
  await browser.keyboard.type('PNG DARK');
  await expect(command(ui, 'Export PNG (dark)')).toBeVisible();
  await expect(command(ui, 'Export PNG (light)')).toBeHidden();
  await expect(command(ui, 'Select · V')).toBeHidden();

  // A query nothing answers leaves the list empty rather than every row back.
  await browser.keyboard.type('zzz');
  await expect(command(ui, 'Export PNG (dark)')).toBeHidden();
});

test('the palette runs a Scene-wide action and the page action by name', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The Grid, by name: the dots go with it, the Scene is untouched.
  const withGrid = (await shot(ui)).darkCount(GRID, 0.9);
  await palette(ui);
  await browser.keyboard.type('grid');
  await browser.keyboard.press('Enter');
  await settle(ui);
  expect((await shot(ui)).darkCount(GRID, 0.9)).toBeLessThan(withGrid - 100);

  // Light and dark belong to the page, so the action asks the page to switch.
  await palette(ui);
  await browser.keyboard.type('theme');
  await browser.keyboard.press('Enter');
  await expect
    .poll(async () => (await shot(ui)).meanLuminance(CORNER))
    .toBeLessThan(0.4);
  await expect(screen.getByRole('button', 'Light')).toBeVisible();
});

test('Enter runs the row it landed on, and the Scene carries the change', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await clickScene(ui, { x: 100, y: 80 });
  expect((await savedScene(ui)).elements.length).toBe(2);

  await palette(ui);
  await browser.keyboard.type('duplicate');
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();

  // The duplicate landed where a C would have put it, and the palette is gone.
  const scene = await savedScene(ui);
  expect(scene.elements.map((element) => element.type)).toEqual([
    'rectangle',
    'rectangle',
    'rectangle',
  ]);
  expect(scene.elements[2]?.id).not.toBe(scene.elements[0]?.id);
});

test('the arrows step over an action that cannot run, and Escape leaves the Scene alone', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // Nothing has been undone yet, so Undo is listed and greyed with its reason.
  await palette(ui);
  await browser.keyboard.type('undo');
  await expect(command(ui, 'Undo · ⌘Z')).toBeDisabled();
  await expect(command(ui, 'Undo · ⌘Z')).toContainText('nothing to undo');
  await browser.keyboard.press('Enter');
  // Enter ran nothing, so the palette is still open and the Scene untouched.
  await expect(screen.getByRole('dialog', 'Commands')).toBeVisible();

  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  const scene = await savedScene(ui);
  expect(scene.elements.length).toBe(2);
});

test('the palette stays shut while a Text is being typed', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await browser.keyboard.press('t');
  await clickScene(ui, { x: 100, y: 200 });
  // `q` would open the palette on the canvas; in the words it is a letter.
  await screen.getByRole('textbox', { name: 'Text' }).pressSequentially('qk');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  await screen.getByRole('textbox', { name: 'Text' }).press('Escape');

  const scene = await savedScene(ui);
  expect(scene.elements.at(-1)?.content).toBe('qk');
});

/** The middle of a row, so a pointer press can land on it where it is drawn. */
async function rowCentre(ui: Ui, name: string): Promise<{ x: number; y: number }> {
  return ui.browser.evaluate((wanted: string) => {
    const row = [...document.querySelectorAll('[role="option"]')].find(
      (node) => node.getAttribute('aria-label') === wanted,
    );
    if (row === undefined) {
      throw new Error(`no row called ${wanted}`);
    }
    const box = row.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, name);
}

/** Which of the page's two focus stops holds the focus: the search field or the canvas. */
function focusOf(ui: Ui): Promise<'canvas' | 'search' | 'other'> {
  return ui.browser.evaluate(() => {
    const active = document.activeElement;
    if (active === document.querySelector('.canvas')) {
      return 'canvas';
    }
    return active === document.querySelector('.palette input') ? 'search' : 'other';
  });
}

test('the focus the palette hands back never scrolls the paper', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // Where the paper is on the page: the view has panned the drawing down, and
  // the focus coming back to the canvas must not scroll any of it.
  const paperTop = (): Promise<number> =>
    browser.evaluate(
      () => Math.round(document.querySelector('esbozo-editor .board')!.getBoundingClientRect().top),
    );
  expect(await paperTop()).toBe(0);
  await palette(ui);
  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  await settle(ui);
  expect(await paperTop()).toBe(0);

  // And a click right after it lands on the ink that is drawn there: the first
  // Element's middle, which is a selection and its Style menu.
  await clickScene(ui, { x: 100, y: 80 });
  await expect(screen.getByRole('button', { name: 'Corners: sharp' })).toBeVisible();
});

test('the digits pick the tools by their place on the rail', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The palette says `Ellipse · E · 3`, and `3` is the key that picks it: the
  // digits and the rail read one list.
  await browser.keyboard.press('3');
  await expect(screen.getByRole('button', 'Ellipse')).toHaveAttribute('aria-pressed', 'true');
  await browser.keyboard.press('v');
  await expect(screen.getByRole('button', 'Select')).toHaveAttribute('aria-pressed', 'true');
});

test('Order is offered, disabled, until something is selected', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // Not an empty command: a row that needs a selection says what it waits for,
  // and Enter on it does nothing at all.
  await palette(ui);
  await browser.keyboard.type('order');
  await expect(command(ui, 'Order: front')).toBeDisabled();
  await expect(command(ui, 'Order: front')).toContainText('select an Element first');
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('dialog', 'Commands')).toBeVisible();
  await browser.keyboard.press('Escape');

  const before = (await savedScene(ui)).elements.map((element) => element.id);
  await clickScene(ui, { x: 100, y: 80 });
  await palette(ui);
  await browser.keyboard.type('front');
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  const after = (await savedScene(ui)).elements.map((element) => element.id);
  expect(after).toEqual([...before].reverse());
});

test('shutting the palette puts the focus back on the canvas', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // Escape closes it and the keys belong to the page again: `g` is the Grid,
  // not a letter the search field would have swallowed.
  await palette(ui);
  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  await expect.poll(async () => focusOf(ui)).toBe('canvas');
  const withGrid = (await shot(ui)).darkCount(GRID, 0.9);
  await browser.keyboard.press('g');
  await settle(ui);
  expect((await shot(ui)).darkCount(GRID, 0.9)).toBeLessThan(withGrid - 100);

  // Running a row closes the palette the same way, with the change made.
  await palette(ui);
  await browser.keyboard.type('grid');
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  await expect.poll(async () => focusOf(ui)).toBe('canvas');
  await expect.poll(async () => (await shot(ui)).darkCount(GRID, 0.9)).toBeGreaterThan(withGrid - 100);

  // A row that cannot run keeps the palette open and the caret in the search
  // field, so the person can keep typing instead of hunting for it.
  await palette(ui);
  await browser.keyboard.type('delete');
  // A person can press a greyed row; the press is what has to leave the
  // palette open and the caret where it was.
  const disabled = await rowCentre(ui, 'Delete · X · ⌫ · Del');
  await browser.mouse.move(disabled.x, disabled.y);
  await browser.mouse.down();
  await browser.mouse.up();
  await expect(screen.getByRole('dialog', 'Commands')).toBeVisible();
  await expect.poll(async () => focusOf(ui)).toBe('search');
  await browser.keyboard.type('zzz');
  await expect(command(ui, 'Delete · X · ⌫ · Del')).toBeHidden();
  expect((await savedScene(ui)).elements.length).toBe(2);
});

test('Zoom in, Zoom out and Reset zoom run from the palette', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  const zoomLabel = screen.getByText(/^\d+%$/);
  await expect(zoomLabel).toHaveText('100%');

  await palette(ui);
  await browser.keyboard.type('zoom');
  await expect(command(ui, 'Zoom in · ⌘+')).toBeVisible();
  await browser.keyboard.press('Meta+a');
  await browser.keyboard.type('zoom in');
  await browser.keyboard.press('Enter');
  await expect(zoomLabel).toHaveText('120%');

  await palette(ui);
  await browser.keyboard.type('zoom out');
  await browser.keyboard.press('Enter');
  await expect(zoomLabel).toHaveText('100%');

  // The keys the rows name answer on the canvas too: one list of actions.
  await browser.keyboard.press('Meta+=');
  await expect(zoomLabel).toHaveText('120%');
  await browser.keyboard.press('Meta+-');
  await expect(zoomLabel).toHaveText('100%');
  await browser.keyboard.press('Meta+=');
  await expect(zoomLabel).toHaveText('120%');
  await browser.keyboard.press('Meta+0');
  await expect(zoomLabel).toHaveText('100%');

  // And the palette puts the view back to one pixel per unit.
  await browser.keyboard.press('Meta+=');
  await expect(zoomLabel).toHaveText('120%');
  await palette(ui);
  await browser.keyboard.type('reset');
  await browser.keyboard.press('Enter');
  await expect(zoomLabel).toHaveText('100%');
});

test('Open folder is offered only where the page can open one', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The stubbed directory picker is there, as it is in Chrome over a secure
  // origin, so the page can open a folder and the row says so by running.
  await palette(ui);
  await browser.keyboard.type('open folder');
  await expect(command(ui, 'Open folder…')).not.toBeDisabled();
  await browser.keyboard.press('Escape');

  // A page served as plain files over HTTP has no directory picker at all.
  await browser.evaluate(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    return true;
  });

  await palette(ui);
  await browser.keyboard.type('open folder');
  await expect(command(ui, 'Open folder…')).toBeDisabled();
  await expect(command(ui, 'Open folder…')).toContainText('this page cannot open a folder');

  // A greyed row is not a command: Enter runs nothing, the palette stays open
  // and the status line is not handed an error about an API the page never had.
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('dialog', 'Commands')).toBeVisible();
  await expect(screen.getByRole('status')).not.toContainText('File System Access');
});
