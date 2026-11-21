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
 * These tests need the model on every run: only an `agent.act` step can replay
 * from `.e2e/cache/`, while `agent.assert` and `agent.waitFor` judge the live
 * screen each time, by design. So this file is not part of `pnpm e2e`, which
 * passes with no key set and makes no model calls; run it with
 * `pnpm e2e:agent`. The one `agent.act` step here is replayed from the
 * committed cache, so only its judgements cost calls.
 *
 * A judgement about what the screen presents asks for `vision: 'only'`, the
 * screenshot without the tree, so the model cannot answer from markup it cannot
 * see. A judgement about words on the screen keeps the tree.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  BROKEN_SCENE,
  MIXED,
  MIXED_SCENE,
  SCENE,
  at,
  clickScene,
  drag,
  openEditor,
  savedFiles,
} from './helpers.ts';

const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);

/** Empty canvas, clear of the two fixture rectangles and of the rail. */
const PAPER = { x: 420, y: 40 };
const MIXED_SOURCE = JSON.stringify(MIXED_SCENE, null, 2);
const BROKEN_SOURCE = JSON.stringify(BROKEN_SCENE, null, 2);

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

  await ui.agent.assert('the empty paper beside the drawings is covered in a regular pattern of small dots', {
    vision: 'only',
  });

  await ui.agent.act('turn the Grid off with the Grid button in the status bar');

  await ui.agent.assert('the empty paper beside the drawings is plain, with no dots on it', { vision: 'only' });

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
    'the words "draw me" sit on the empty paper where they were typed, in a handwritten style, with no box or form around them',
    { vision: 'only' },
  );

  await screen.getByRole('textbox', { name: 'Text' }).press('Escape');
  await ui.agent.assert(
    'the words "draw me" are still on the empty paper, in the same hand, and there is no cursor or input field beside them',
    { vision: 'only' },
  );
});
