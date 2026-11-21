/**
 * Seam 2: the editor's visible outcomes, judged by the model.
 *
 * `tests/editor.e2e.ts` proves the same outcomes exactly, from the Scene the
 * editor saves and from its pixels. These tests prove what a person would look
 * at and answer in words: a Scene that will not parse being reported, the dots
 * of the Grid, light and dark, the resize handles around a selection, and a
 * panned canvas. Nothing here reads the DOM or the editor's state, beyond the
 * buttons a person clicks.
 *
 * These tests need the model on every run: `agent.assert` and `agent.waitFor`
 * judge the live screen each time, by design. So this file is not part of
 * `pnpm e2e`, which passes with no key set and makes no model calls; run it
 * with `pnpm e2e:agent`. The page is driven the way a person drives it, by
 * role and by key, so `agent` is only ever asked to judge.
 *
 * A judgement about what the screen presents asks for `vision: 'only'`, the
 * screenshot without the tree, so the model cannot answer from markup it cannot
 * see. A judgement about words on the screen keeps the tree.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  BROKEN_SCENE,
  EDGE,
  EDGE_1366,
  EDGE_SCENE,
  MIXED,
  MIXED_SCENE,
  OVERFLOW,
  OVERFLOW_SCENE,
  SCENE,
  SNAP,
  SNAP_SCENE,
  SNAPPED,
  SNAPPED_SCENE,
  WIDE_1366,
  WIDE_SCENE,
  at,
  clickScene,
  doubleClickScene,
  drag,
  dragBy,
  openEditor,
  savedFiles,
} from './helpers.ts';

const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);

/** Empty canvas, clear of the two fixture rectangles and of the rail. */
const PAPER = { x: 420, y: 40 };
const MIXED_SOURCE = JSON.stringify(MIXED_SCENE, null, 2);
const BROKEN_SOURCE = JSON.stringify(BROKEN_SCENE, null, 2);
const EDGE_SOURCE = JSON.stringify(EDGE_SCENE, null, 2);
const WIDE_SOURCE = JSON.stringify(WIDE_SCENE, null, 2);
const SNAP_SOURCE = JSON.stringify(SNAP_SCENE, null, 2);
const SNAPPED_SOURCE = JSON.stringify(SNAPPED_SCENE, null, 2);
const OVERFLOW_SOURCE = JSON.stringify(OVERFLOW_SCENE, null, 2);

/** A Label long enough that the box it is typed into has to grow for it. */
const LONG_LABEL = 'words that wrap and grow';

test('a Scene that will not parse is reported, naming the box-a width problem', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'broken.json': BROKEN_SOURCE } }, 'broken.json');

  await ui.agent.assert(
    'a message on the page says that box-a is wrong: its width must be at least 1 pixel',
    { vision: true },
  );
});

test('the dot Grid is there, a person turns it off, and the canvas goes plain', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  const before = (await savedFiles(ui))['scene.json'];

  await ui.agent.assert('the empty paper beside the Elements is covered in a regular pattern of small dots', {
    vision: 'only',
  });

  await ui.screen.getByRole('button', 'Grid').click();

  await ui.agent.assert('the empty paper beside the Elements is plain, with no dots on it', { vision: 'only' });

  // A view change, so the Scene on disk is untouched, byte for byte.
  expect((await savedFiles(ui))['scene.json']).toBe(before);
});

test('the page follows the system into dark and its own switch back to light', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await ui.agent.assert('the page is painted light: the paper is near white and the ink is dark', {
    vision: 'only',
  });

  // The system turns dark after the page loaded: the page follows.
  await ui.browser.emulateMedia({ colorScheme: 'dark' });
  await ui.agent.waitFor('the page is painted dark: the paper is near black and the ink is light', {
    vision: 'only',
  });

  // The page's own switch brings it back.
  await ui.screen.getByRole('button', 'Light').click();
  await ui.agent.waitFor('the page is painted light: the paper is near white and the ink is dark', {
    vision: 'only',
  });
});

test('a page that starts in system dark paints dark and offers the light switch', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await ui.browser.emulateMedia({ colorScheme: 'dark' });
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await ui.agent.assert('the page is painted dark: the paper is near black and the ink is light', {
    vision: 'only',
  });
  // Words on the screen, so the tree is the right evidence here.
  await ui.agent.assert('a button offers to switch to the light theme', { vision: false });

  await ui.screen.getByRole('button', 'Light').click();
  await ui.agent.waitFor('the page is painted light: the paper is near white and the ink is dark', {
    vision: 'only',
  });
});

test('a selected box shows resize handles and a selected line of text shows only its outline', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');

  await clickScene(ui, { x: 120, y: 110 }, [], MIXED);
  await ui.agent.assert(
    'the ellipse is selected: a dashed box hugs it and small square handles sit on the corners and edge middles of that box',
    { vision: 'only' },
  );

  await clickScene(ui, { x: 277, y: 110 }, [], MIXED);
  await ui.agent.assert(
    'the word "hi" is selected: a dashed box hugs it and there are no small square resize handles on it',
    { vision: 'only' },
  );
});

test('holding Space and dragging pans the view', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  const before = (await savedFiles(ui))['scene.json'];

  await ui.agent.assert(
    'two hand-drawn rectangles sit side by side around the middle of the canvas, the right-hand one filled with a solid grey tone',
    { vision: 'only' },
  );

  await ui.browser.keyboard.down('Space');
  await drag(ui, { x: 640, y: 400 }, { x: 940, y: 650 });
  await ui.browser.keyboard.up('Space');

  await ui.agent.assert(
    'the two rectangles now sit below the window’s horizontal middle, and the left edge of the left-hand one is right of the window’s vertical middle',
    { vision: 'only' },
  );

  // Panning is a view change, so the Scene on disk is untouched.
  expect((await savedFiles(ui))['scene.json']).toBe(before);
});

test('a tool comes into hand on the rail, and the pencil draws a box that lands selected', async ({
  agent,
  app,
  browser,
  screen,
}) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // Rectangle is picked with the left hand; the rail has to say so.
  await browser.keyboard.press('r');
  await ui.agent.assert(
    'on the left tool rail, the Rectangle button is the one filled dark, and the Select button is not',
    { vision: 'only' },
  );

  await drag(ui, at(PAPER), at({ x: PAPER.x + 120, y: PAPER.y + 100 }));
  await ui.agent.assert(
    'a new hand-drawn rectangle sits to the right of the two drawn side by side, hugged by a thin dashed selection box',
    { vision: 'only' },
  );

  // A duplicate is visible ink: a copy of what was just drawn, offset off it.
  await browser.keyboard.press('c');
  await ui.agent.assert('four hand-drawn rectangles are on the paper, two overlapping', {
    vision: 'only',
  });
});

test('a new Text is typed in place, in the hand it draws in, and stays as words on the paper', async ({
  agent,
  app,
  browser,
  screen,
}) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await browser.keyboard.press('t');
  await clickScene(ui, { x: 420, y: 300 });
  await screen.getByRole('textbox', { name: 'Text' }).pressSequentially('draw me');

  await ui.agent.assert(
    'the words "draw me" sit on the empty paper where they were typed, in a handwritten style as the drawing writes them, and a small plain box holding the same words as they are typed sits a little below them',
    { vision: 'only' },
  );

  await screen.getByRole('textbox', { name: 'Text' }).press('Escape');
  await ui.agent.assert(
    'the words "draw me" are still on the empty paper in the same hand, and there is no cursor or text field beside them',
    { vision: 'only' },
  );
});

test('the Style menu is a note taped to the right edge, and it leaves the selection in view', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'edge.json': EDGE_SOURCE } }, 'edge.json');

  // The right-hand box, which the note would cover if the view did not pan.
  await clickScene(ui, { x: 760, y: 80 }, [], EDGE);

  await ui.agent.assert(
    'a pale paper note held by a strip of tape at its top sits against the right edge of the window, tipped a fraction of a degree the way a taped note hangs; inside it are short rows of small buttons in a hand-written style; the selected rectangle is fully visible in the canvas beside the note and no part of it is hidden behind the note',
    { vision: 'only' },
  );

  await ui.screen.getByRole('button', { name: 'Rough: cartoonist' }).click();
  await ui.screen.getByRole('button', { name: 'Fill: solid' }).click();
  await ui.screen.getByRole('button', { name: 'Grey: grey 6' }).click();

  await ui.agent.assert(
    'the selected rectangle is filled flat solid near-black ink, with no hatch lines inside it, and its outline is a wandering hand-drawn line rather than a ruler-straight one',
    { vision: 'only' },
  );
});

test('a Label that does not fit its Element is outlined in red, as ez check reports it', async ({
  agent,
  app,
  browser,
  screen,
}) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'overflow.json': OVERFLOW_SOURCE } }, 'overflow.json');

  // The same edit `tests/labels.e2e.ts` makes, so both tests judge the bytes the
  // editor saved: the box shrunk by its east handle until its words no longer
  // fit, the words spilling out above and below it, and a red outline saying so.
  await clickScene(ui, { x: 60, y: 60 }, [], OVERFLOW);
  await dragBy(ui, { x: 140, y: 60 }, -40, 0, OVERFLOW);
  await ui.agent.assert(
    'a small hand-drawn rectangle holds words that spill out above and below it, and a red outline frames those words',
    { vision: 'only' },
  );
});

test('the Style menu fits a 1366×768 window beside the selection', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await ui.browser.setViewport({ width: 1366, height: 768 });
  await openEditor(ui, { A: { 'edge.json': EDGE_SOURCE } }, 'edge.json');

  await clickScene(ui, { x: 80, y: 70 }, [], EDGE_1366);

  await ui.agent.assert(
    'a pale paper note held by a strip of tape sits against the right edge of the window, and its whole outline is inside the window: there is painted page above it, below it and to its left, and no edge of the note is cut off by the window',
    { vision: 'only' },
  );
});

test('a selection too wide to pan clear of the note is zoomed out to fit beside it', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await ui.browser.setViewport({ width: 1366, height: 768 });
  await openEditor(ui, { A: { 'wide.json': WIDE_SOURCE } }, 'wide.json');

  // A bar wider than everything left of the note: panning cannot clear it.
  await clickScene(ui, { x: 200, y: 80 }, [], WIDE_1366);

  await ui.agent.assert(
    'one wide dark filled bar lies across the canvas and its right end stops clear of the pale paper note at the right edge: no part of the bar is hidden behind the note, and the bar is whole rather than cut off by the left side of the window',
    { vision: 'only' },
  );
});

test('the palette is a note over the paper: a search field, action names and their keys', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await browser.keyboard.press('q');
  await ui.agent.assert(
    'a search field sits over the Scene with a list of action names below it, each name with a keyboard shortcut at its right',
    { vision: 'only' },
  );

  // Nothing is selected, so Delete cannot run: it is listed, greyed, with a reason.
  await browser.keyboard.type('delete');
  await ui.agent.assert(
    'the list shows one greyed-out row named Delete, with a short reason beside it saying what it is waiting for',
    { vision: 'only' },
  );
});

test('the box under a dragged arrow end is marked as the Element it will attach to', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'snap.json': SNAP_SOURCE } }, 'snap.json');

  // An arrow is being dragged from the empty paper onto the box, and the
  // pointer is still down: the box says it is the one the end will land on.
  await browser.keyboard.press('a');
  const from = at({ x: 60, y: 200 }, SNAP);
  const to = at({ x: 360, y: 100 }, SNAP);
  await browser.mouse.move(from.x, from.y);
  await browser.mouse.down();
  await browser.mouse.move(to.x, to.y);

  await ui.agent.assert(
    'the rectangle on the right is marked out from the paper around it by a coloured outline and a faint wash of the same colour inside it, and a line being dragged runs from the empty paper on the left to that rectangle’s edge',
    { vision: 'only' },
  );

  await browser.mouse.up();
});

test('the note says what each end of an arrow is attached to, and says nothing of the sort for a mixed selection', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'snapped.json': SNAPPED_SOURCE } }, 'snapped.json');

  // The arrow alone: an attached end and the button that frees it, per end.
  await clickScene(ui, { x: 230, y: 80 }, [], SNAPPED);
  await ui.agent.assert(
    'inside the note at the right edge, one row says the arrow’s start is attached to the box named `from` and another says its end is attached to the box named `to`, and each of those two rows has a small button that would detach it',
    { vision: false },
  );

  // A box and the arrow together: one end per Element, so the Snap rows go.
  await clickScene(ui, { x: 100, y: 80 }, [], SNAPPED);
  await clickScene(ui, { x: 230, y: 80 }, ['Shift'], SNAPPED);
  await ui.agent.assert(
    'the note speaks for two Elements and nowhere says that an end is attached to anything: there is no detach button in it, and no row naming a start or an end',
    { vision: false },
  );
});
test('a Label that does not fit its Element is outlined in red, as ez check reports it', async ({
  agent,
  app,
  browser,
  screen,
}) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'overflow.json': OVERFLOW_SOURCE } }, 'overflow.json');

  // The words spill out of the box and a red outline says so; `ez check` exits 6
  // on the same Scene, in `tests/labels.e2e.ts`.
  await ui.agent.assert(
    'a small hand-drawn rectangle holds words that spill out above and below it, and a red outline frames those words',
    { vision: 'only' },
  );
});

test('a box grows for the Label typed into it, and the words wrap inside its outline', async ({
  agent,
  app,
  browser,
  screen,
}) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await doubleClickScene(ui, { x: 100, y: 80 });
  const label = screen.getByRole('textbox', { name: 'Label' });
  await label.pressSequentially(LONG_LABEL);

  // A caret blinks, and a screenshot catches it in either half of the blink, so
  // it is not judged here: what a person sees is that the box grew for the words
  // as they were typed, and that they sit inside it, wrapped, with nothing drawn
  // around them that the Scene would not draw.
  await ui.agent.assert(
    'the left-hand hand-drawn rectangle has grown taller and holds the words written inside it as three wrapped lines, every word inside the outline, and a small plain box holding the same words as they are typed sits a little below the rectangle',
    { vision: 'only' },
  );

  await label.press('Escape');
  await ui.agent.assert(
    'the same three lines of words are still inside the left-hand rectangle, every line within its outline. The Element is still selected, so a thin dashed selection box with small square handles sits just outside the rectangle',
    { vision: 'only' },
  );
});
