/**
 * Seam 2: a bend point, the handle the editor shows on it and the drag that
 * moves it.
 *
 * Same rules as the editor suites: the input is a person's — a click on the
 * shaft, a press on the handle, the keys — and the assertion is the Scene the
 * editor saves, or the pixels it paints. A bend is stored as a point of its
 * arrow or line, so the saved `points` say whether the point moved, what its
 * `corner` still is and whether the ends kept their Snaps, without reading the
 * editor's state.
 *
 * The editor writes on its own clock, so a test reads the folder once the write
 * has landed there: `pointsIn` is what the file holds, and `expectPoints` polls
 * it until the editor has caught up. Reading the status alone would pass on the
 * `saved` an earlier step left.
 *
 * No test here uses the model, so `pnpm e2e` still passes with no key set.
 */
import { describe, test } from '@e2e-dev/web';
import { afterAll, expect } from 'e2e';
import { at, clickScene, drag, openEditor, savedFiles } from './helpers.ts';
import type { SavedScene, Ui, View } from './helpers.ts';
import { removeTempFolders } from '../test/temp.ts';

// One folder of fixtures per test, made and removed by the same helper every
// suite uses.
afterAll(removeTempFolders);

/**
 * A free arrow through one bend, the bend written `sharp`: roughness 0, so the
 * page it draws is the numbers below.
 */
const SHARP_SCENE = {
  version: 1,
  title: 'Sharp bend',
  defaults: { roughness: 0 },
  elements: [
    {
      id: 'bent',
      type: 'arrow',
      points: [
        { x: 50, y: 50 },
        { x: 300, y: 250, corner: 'sharp' },
        { x: 550, y: 50 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const SHARP_SOURCE = JSON.stringify(SHARP_SCENE, null, 2);

/** The view `SHARP_SCENE` lands in: its page fitted 1:1 into a 1280×800 window. */
const SHARP: View = { zoom: 1, panX: 340, panY: 251 };

/** On the arrow's first run, on no Element: where a press selects it. */
const SHARP_ON = { x: 175, y: 150 };

/** Where the sharp bend is stored, and so where its handle sits on the page. */
const SHARP_BEND = { x: 300, y: 250 };

/** The Scene files the `bends.json` fixture folder holds, by the name a person opens. */
const SCENES = {
  A: {
    'bends.json': SHARP_SOURCE,
  },
};

/** One point of a shaft as the editor saved it: every field a bend may carry. */
interface SavedPoint {
  x: number;
  y: number;
  snap?: string;
  corner?: string;
}

/** Open one of the bend fixtures. */
async function open(ui: Ui, name = 'bends.json'): Promise<void> {
  await openEditor(ui, SCENES, name);
}

/** The bytes of a saved Scene as the stub folder holds them, or undefined while there are none. */
async function savedSource(ui: Ui, name = 'bends.json'): Promise<string | undefined> {
  return (await savedFiles(ui))[name];
}

/** The whole `points` of the bent shaft in a saved Scene file, or null before it writes one. */
function pointsIn(source: string | undefined): SavedPoint[] | null {
  if (source === undefined) {
    return null;
  }
  const scene = JSON.parse(source) as SavedScene;
  return (scene.elements.find((element) => element.id === 'bent')?.points ??
    []) as unknown as SavedPoint[];
}

/** Wait for the editor's own write to land, then assert the shaft's whole `points`. */
async function expectPoints(
  ui: Ui,
  expected: SavedPoint[],
  name = 'bends.json',
): Promise<void> {
  await expect.poll(async () => pointsIn(await savedSource(ui, name))).toEqual(expected);
  expect(pointsIn(await savedSource(ui, name))).toEqual(expected);
}

describe('a bend point handle', () => {
  test('a sharp bend of an arrow drags to a new place, at zoom one', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, SHARP_ON, [], SHARP);
    await drag(ui, at(SHARP_BEND, SHARP), at({ x: 340, y: 270 }, SHARP));

    await expectPoints(ui, [
      { x: 50, y: 50 },
      { x: 340, y: 270, corner: 'sharp' },
      { x: 550, y: 50 },
    ]);
  });
});
