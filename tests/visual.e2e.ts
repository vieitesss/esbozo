/**
 * Seam 2: the editor's visible outcomes, judged by the model.
 *
 * `tests/editor.e2e.ts` proves the same outcomes exactly, from the Scene the
 * editor saves and from its pixels. These tests prove what a person would look
 * at and answer in words: the dots of the Grid, light and dark, the resize
 * handles around a selection, and a panned canvas. Nothing here reads the DOM
 * or the editor's state.
 *
 * They need the model: `agent.assert` judges the live screen on every run, so
 * this file is not part of `pnpm e2e`, which passes with no key set. Run it
 * with `pnpm e2e:agent`. The one `agent.act` step is replayed from
 * `.e2e/cache/`, which is committed, so only its judgement costs a call.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  MIXED,
  MIXED_SCENE,
  SCENE,
  clickScene,
  drag,
  openEditor,
  savedFiles,
} from './helpers.ts';

const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
const MIXED_SOURCE = JSON.stringify(MIXED_SCENE, null, 2);

test('the dot Grid is there, a person turns it off, and the canvas goes plain', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  const before = (await savedFiles(ui))['scene.json'];

  await ui.agent.assert('the empty paper beside the drawings is covered in a regular pattern of small dots', {
    vision: true,
  });

  await ui.agent.act('turn the Grid off with the Grid button in the status bar');

  await ui.agent.assert('the empty paper beside the drawings is plain, with no dots on it', { vision: true });

  // A view change, so the Scene on disk is untouched, byte for byte.
  expect((await savedFiles(ui))['scene.json']).toBe(before);
});

test('the page follows the system into dark and its own switch back to light', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await ui.agent.assert('the page is painted light: the paper is near white and the ink is dark', { vision: true });

  // The system turns dark after the page loaded: the page follows.
  await ui.browser.emulateMedia({ colorScheme: 'dark' });
  await ui.agent.waitFor('the page is painted dark: the paper is near black and the ink is light', {
    vision: true,
  });

  // The page's own switch brings it back.
  await ui.screen.getByRole('button', 'Light').click();
  await ui.agent.waitFor('the page is painted light: the paper is near white and the ink is dark', {
    vision: true,
  });
});

test('a page that starts in system dark paints dark and offers the light switch', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await ui.browser.emulateMedia({ colorScheme: 'dark' });
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  await ui.agent.assert('the page is painted dark: the paper is near black and the ink is light', { vision: true });
  await ui.agent.assert('a button offers to switch to the light theme', { vision: false });

  await ui.screen.getByRole('button', 'Light').click();
  await ui.agent.waitFor('the page is painted light: the paper is near white and the ink is dark', {
    vision: true,
  });
});

test('a selected box shows resize handles and a selected line of text does not', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': MIXED_SOURCE } }, 'scene.json');

  await clickScene(ui, { x: 120, y: 110 }, [], MIXED);
  await ui.agent.assert(
    'the ellipse is selected: a dashed box hugs it and small square handles sit on the corners and edge middles of that box',
    { vision: true },
  );

  await clickScene(ui, { x: 277, y: 110 }, [], MIXED);
  await ui.agent.assert(
    'the word "hi" is selected, with no square resize handles on it',
    { vision: true },
  );
});

test('holding Space and dragging pans the view', async ({ agent, app, browser, screen }) => {
  const ui = { agent, app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');
  const before = (await savedFiles(ui))['scene.json'];

  await ui.agent.assert(
    'two hand-drawn rectangles sit side by side around the middle of the canvas, the right-hand one filled with a solid grey tone',
    { vision: true },
  );

  await ui.browser.keyboard.down('Space');
  await drag(ui, { x: 640, y: 400 }, { x: 940, y: 650 });
  await ui.browser.keyboard.up('Space');

  await ui.agent.assert(
    'both rectangles now sit right of the middle of the window and below its horizontal middle, and the tool rail on the left has not moved',
    { vision: true },
  );

  // Panning is a view change, so the Scene on disk is untouched.
  expect((await savedFiles(ui))['scene.json']).toBe(before);
});
