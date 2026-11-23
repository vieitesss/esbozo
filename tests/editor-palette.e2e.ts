/**
 * Seam 2: the command palette — every action with the key that runs it, the
 * rows a query keeps, the focus a palette hands back, and the actions it runs.
 * Driven by `Q`, `⌘K`, the arrows and Enter, and asserted on the Scene.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  clickScene,
  drag,
  settle,
  openEditor,
  savedFiles,
  savedScene,
  holdWrites,
  refuseWrite,
  allowWrites,
} from './helpers.ts';
import type { Ui } from './helpers.ts';
import { shot } from './pixels.ts';
import { SCENE_SOURCE, GRID, CORNER, command, focusOn, palette, zoomReadout } from './editor-shared.ts';

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

/**
 * The first Element's ink, where the page draws it once the host page below has
 * given the editor a box and the drawing was fitted to it, and again once the
 * middle drag below has carried it by (−20, −60): the second Element sits past
 * this box to the right, and is never measured. It starts below the tool rail,
 * which rides at the top edge of the editor's own box.
 */
const FIRST = { x: 460, y: 490, width: 180, height: 300 };

/**
 * A page that has the editor in its own flow, a screen down, with its own words
 * below: the window holds most of the editor and cuts its last 80 pixels off,
 * which is what gives a focus somewhere to scroll *to*. Only a host page can: a
 * drawing panned inside the editor is clipped by the element and scrolls
 * nothing, and the served page fills the window and locks the page's scrolling.
 */
async function hostPage(ui: Ui): Promise<void> {
  await ui.browser.evaluate(() => {
    const style = document.createElement('style');
    style.textContent =
      'html, body { height: auto; overflow: visible } esbozo-editor { position: relative; height: 480px }';
    document.head.append(style);
    const ahead = document.createElement('div');
    ahead.style.height = '700px';
    document.body.prepend(ahead);
    return true;
  });
  // The drawing is fitted to the box the host gave the editor, so the ink sits
  // in the part of it the window shows.
  await ui.browser.keyboard.press('Meta+0');
  await settle(ui);
  await ui.browser.evaluate(() => {
    window.scrollTo(0, 300);
    return true;
  });
  await expect.poll(() => ui.browser.evaluate(() => window.scrollY)).toBe(300);
}

/**
 * The paper the focus comes back to does not move: every pixel of the first
 * Element's ink is where the pointer left it, and a press there still picks
 * that Element. The page around the editor is scrolled, so a focus that scrolls
 * the canvas into view would drag the whole paper out from under the pointer.
 */
test('the focus the palette hands back leaves the paper where the pointer left it', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  await hostPage(ui);
  const ink = async () => (await shot(ui)).darkBounds(FIRST, 0.6);
  const centred = await ink();
  if (centred === null) {
    throw new Error('the paper shows no ink');
  }

  await drag(ui, { x: 900, y: 700 }, { x: 880, y: 640 }, 'middle');
  await settle(ui);
  const before = await ink();
  if (before === null) {
    throw new Error('the panned paper shows no ink');
  }
  // The drag carried the paper by the pointer's own (−20, −60): a pan that moved
  // nothing would leave the rest of this test with nothing to check.
  expect(before.x).toBeLessThan(centred.x - 10);
  expect(before.y).toBeLessThan(centred.y - 50);

  await palette(ui);
  await settle(ui);
  // The scroll the page is at once the palette has the caret: the focus it
  // hands back on the way out is what may move it.
  const scrolled = await browser.evaluate(() => window.scrollY);

  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  await settle(ui);

  // The page is where it was, and so is the paper: the focus came back to the
  // canvas without the window scrolling it into view.
  expect(await browser.evaluate(() => window.scrollY)).toBe(scrolled);
  expect(await ink()).toEqual(before);

  // And a click right after it lands on the ink that is drawn there: the first
  // Element's middle, which is a selection and its Style menu.
  await browser.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await browser.mouse.down();
  await browser.mouse.up();
  await expect(screen.getByRole('button', { name: 'Corners: sharp' })).toBeVisible();
});

test('a press outside the palette shuts it and hands the focus back to the canvas', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The palette covers the page with the felt around its field and list, and a
  // press on that felt is a press on nothing: it shuts the note, and the field
  // lets go of the caret with it. What the press aims at takes the focus, so
  // here that is the page rather than the canvas.
  await palette(ui);
  await expect.poll(async () => focusOn(ui)).toBe('search');
  await browser.mouse.move(100, 700);
  await browser.mouse.down();
  await browser.mouse.up();
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  await expect.poll(async () => focusOn(ui)).not.toBe('search');

  // The keys are the page's again, as they are after an Escape: `g` is the Grid
  // and not a letter the search field would have swallowed.
  const withGrid = (await shot(ui)).darkCount(GRID, 0.9);
  await browser.keyboard.press('g');
  await settle(ui);
  expect((await shot(ui)).darkCount(GRID, 0.9)).toBeLessThan(withGrid - 100);
});

test('a host that keeps the press inside its element still lets the palette hear it', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // A page that embeds the editor may keep a press from leaving its own element:
  // the note the press is outside is still the editor's to shut, so the stack
  // has to hear the press where it is, not only where the page ends.
  await browser.evaluate(() => {
    document
      .querySelector('esbozo-editor')!
      .addEventListener('pointerdown', (event) => event.stopPropagation());
    return true;
  });
  await palette(ui);
  await expect(screen.getByRole('dialog', 'Commands')).toBeVisible();

  await browser.mouse.move(100, 700);
  await browser.mouse.down();
  await browser.mouse.up();
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
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
  await expect.poll(async () => focusOn(ui)).toBe('canvas');
  const withGrid = (await shot(ui)).darkCount(GRID, 0.9);
  await browser.keyboard.press('g');
  await settle(ui);
  expect((await shot(ui)).darkCount(GRID, 0.9)).toBeLessThan(withGrid - 100);

  // Running a row closes the palette the same way, with the change made.
  await palette(ui);
  await browser.keyboard.type('grid');
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();
  await expect.poll(async () => focusOn(ui)).toBe('canvas');
  await expect.poll(async () => (await shot(ui)).darkCount(GRID, 0.9)).toBeGreaterThan(withGrid - 100);

  // A row that cannot run keeps the palette open and the caret in the search
  // field, so the person can keep typing instead of hunting for it.
  await palette(ui);
  await browser.keyboard.type('delete');
  // A person can press a greyed row, so the press names a point of the row
  // rather than taking the platform's actionability checks: what it leaves
  // behind is the palette, open, and the caret in the search field.
  await command(ui, 'Delete · X · ⌫ · Del').click({ position: { x: 2, y: 2 } });
  await expect(screen.getByRole('dialog', 'Commands')).toBeVisible();
  await expect.poll(async () => focusOn(ui)).toBe('search');
  await browser.keyboard.type('zzz');
  await expect(command(ui, 'Delete · X · ⌫ · Del')).toBeHidden();
  expect((await savedScene(ui)).elements.length).toBe(2);
});

test('Zoom in, Zoom out and Reset zoom run from the palette', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  const zoomLabel = zoomReadout(ui);
  await expect(zoomLabel).toHaveText('100%');

  await palette(ui);
  await browser.keyboard.type('zoom');
  await expect(command(ui, 'Zoom in · ⌘+')).toBeVisible();
  await browser.keyboard.press('ControlOrMeta+a');
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

/** A diagram larger than the frame's minimum, with room around it on every side. */
const BIG_SOURCE = JSON.stringify(
  {
    version: 1,
    title: 'Big',
    defaults: { roughness: 0 },
    elements: [
      { id: 'big', type: 'rectangle', x: 40, y: 40, width: 1000, height: 700, fill: { kind: 'solid', grey: 6 } },
    ],
  },
  null,
  2,
);

test('the four Tool rail rows name their dock, carry no key, and move a read-only Scene', async ({
  app,
  browser,
  screen,
}) => {
  const ui = { app, browser, screen };
  await browser.setViewport({ width: 3440, height: 1440 });
  await openEditor(ui, { A: { 'big.json': BIG_SOURCE } }, 'big.json');
  await settle(ui);

  // One row per dock, offered with the others: the name is the whole row, so no
  // key follows it and the row says nothing about a shortcut to learn (D8).
  await palette(ui);
  await browser.keyboard.type('tool rail');
  for (const side of ['top', 'bottom', 'left', 'right']) {
    await expect(command(ui, `Tool rail: ${side}`)).toBeVisible();
    await expect(command(ui, `Tool rail: ${side}`)).not.toBeDisabled();
  }
  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog', 'Commands')).toBeHidden();

  // A page that may only read: a drawn box asks the folder to write, and the
  // folder answers `403`, so the editor says so from then on.
  await holdWrites(ui, 'big.json');
  await browser.keyboard.press('r');
  await drag(ui, { x: 200, y: 200 }, { x: 260, y: 260 });
  await refuseWrite(ui, 'this folder is served read-only');
  await allowWrites(ui);
  await expect(screen.getByText('read-only')).toBeVisible();
  await settle(ui);
  const files = await savedFiles(ui);

  // The row still runs, because a dock is the page's chrome and not an edit
  // (D9): the rail stands to the right of the diagram's own box.
  await palette(ui);
  await browser.keyboard.type('tool rail right');
  await expect(command(ui, 'Tool rail: right')).not.toBeDisabled();
  await browser.keyboard.press('Enter');
  await expect(screen.getByRole('dialog', { name: 'Commands' })).toBeHidden();
  await settle(ui);
  await screen.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Select' }).focus();
  await expect
    .poll(
      () =>
        ui.browser.evaluate(() => {
          const strip = document.querySelector('esbozo-editor nav[aria-label="Tools"]');
          return strip === null ? 0 : Number(getComputedStyle(strip).opacity);
        }),
      { timeout: 5000 },
    )
    .toBe(1);
  const strip = (await shot(ui)).darkBounds({ x: 2232, y: 380, width: 400, height: 680 }, 0.6);
  if (strip === null) {
    throw new Error('no rail ink right of the diagram');
  }
  expect(strip.height, 'the right dock stands the strip up').toBeGreaterThan(strip.width * 2);

  // A move in a read-only Scene writes nothing at all.
  expect(await savedFiles(ui), 'a move writes nothing').toEqual(files);
});
