/**
 * Seam 1: the two halves of a shaft Label's place.
 *
 * `shaftLabelAnchor` is where the drawing puts a shaft's words, and `labelAtFor`
 * is what the editor's drag reads back from the place the pointer let them go.
 * One has to be the other's inverse, or a drag on a bent shaft leaves the words
 * somewhere the drawing never puts them. The three paths a Scene can write are
 * here — a straight run, a shaft through a sharp corner and a round curve — and
 * the answer is read by the same rule for all of them. Nothing here imports a
 * private helper: both functions are what the Renderer and the editor call.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labelAtFor, shaftLabelAnchor, shaftPath } from '../src/geometry.ts';
import type { ShaftPath } from '../src/geometry.ts';
import type { Corner, Point } from '../src/scene.ts';

/** The points one Scene of this suite writes, and the corner a middle one turns by. */
type Written = readonly [Point, Point, ...Point[]];

/** A shaft as a Scene writes it, resolved the way the Renderer resolves it. */
function pathOf(points: Written, corners: Corner): ShaftPath {
  return shaftPath(points, corners, undefined, undefined);
}

/** The three paths a Labelled arrow or line draws through. */
const PATHS: ReadonlyArray<readonly [string, ShaftPath]> = [
  ['a straight run', pathOf([{ x: 0, y: 0 }, { x: 200, y: 0 }], 'round')],
  [
    'a sharp corner',
    pathOf(
      [{ x: 0, y: 0 }, { x: 150, y: 100, corner: 'sharp' }, { x: 300, y: 0 }],
      'sharp',
    ),
  ],
  [
    'a round curve',
    pathOf(
      [{ x: 0, y: 0 }, { x: 150, y: 100, corner: 'round' }, { x: 300, y: 0 }],
      'round',
    ),
  ],
];

/** Fractions of the drawn shaft and offsets off it a drag can land on. */
const FRACTIONS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
const OFFSETS = [0, 12, -30];

for (const [label, path] of PATHS) {
  test(`labelAtFor reads back the place shaftLabelAnchor draws on ${label}`, () => {
    for (const t of FRACTIONS) {
      for (const offset of OFFSETS) {
        const anchor = shaftLabelAnchor(path, { t, offset });
        const back = labelAtFor(path, anchor);
        assert.ok(
          Math.abs(back.t - t) < 1e-3,
          `${label}: t ${t} at offset ${offset} read back as ${back.t}`,
        );
        assert.ok(
          Math.abs(back.offset - offset) < 1e-2,
          `${label}: offset ${offset} at t ${t} read back as ${back.offset}`,
        );
      }
    }
  });
}
