/**
 * Seam 3: the dot a lone Shaft shows halfway along a segment, and the one rule
 * that leaves it off where it would land on a handle.
 *
 * The clearance is a distance on the page — a handle's eight pixels and a dot's
 * six, so their middles keep seven apart — and the rule is about the pixels a
 * person sees, never about Scene units. The view below is a fit's, and at it the
 * two ways of asking are one ulp apart: the Scene distance is exactly twenty and
 * `seven / zoom` is 20.000000000000004, so a dot at the cutoff goes missing. No
 * page is driven into that tie on purpose, which is why this seam pins it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';
import type { ArrowOrLineElement } from '../src/scene.ts';
import type { View } from '../src/editor/geometry.ts';

const { parseScene, drawnGeometry, bendDots } = await loadProjectModules();

/** A flat line through two points, so its one segment's dot is exactly halfway. */
const FLAT_SCENE = {
  version: 1,
  elements: [
    { id: 'flat', type: 'line', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] },
  ],
};

/** How far a dot's middle stays from a handle's, in the page's own pixels: `DOT_CLEARANCE`. */
const CLEARANCE = 7;

/**
 * A view a fit can leave, where the two marks land exactly seven pixels apart:
 * the ends at x 633 and 647, the dot at 640.
 */
const VIEW: View = { zoom: 0.3499999999999999, panX: 633, panY: 80 };

/** The fixture's line, and the geometry the Renderer draws for it. */
function flat(): { line: ArrowOrLineElement; drawn: ReturnType<typeof drawnGeometry> } {
  const result = parseScene(JSON.stringify(FLAT_SCENE));
  assert.ok(result.ok);
  const element = result.scene.elements[0];
  if (element === undefined || (element.type !== 'line' && element.type !== 'arrow')) {
    throw new Error('the fixture holds no arrow or line');
  }
  return { line: element, drawn: drawnGeometry(element, new Map()) };
}

test('a dot exactly the clearance from a handle is drawn', () => {
  const { drawn } = flat();
  // Seven pixels apart is clear of the handle, and the page's own pixels are what
  // the rule reads: the Scene distance behind them is 20 and `seven / zoom` is
  // 20.000000000000004, so a rule comparing Scene distances loses the dot.
  const dots = bendDots(drawn, { writable: true, view: VIEW, clearance: CLEARANCE });

  assert.deepEqual(dots.map((dot) => dot.index), [1]);
});

test('a dot closer to a handle than the clearance is left off', () => {
  const { drawn } = flat();
  // The same ten Scene pixels either side of the dot, at a zoom that draws them
  // six apart: closer than a handle and a dot may stand, so there is no mark.
  const view: View = { ...VIEW, zoom: 0.3 };
  const dots = bendDots(drawn, { writable: true, view, clearance: CLEARANCE });

  assert.deepEqual(dots, []);
});
