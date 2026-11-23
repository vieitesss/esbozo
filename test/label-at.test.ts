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
import type { ArrowOrLineElement } from '../src/scene.ts';
import type { ShaftPath, ShaftPiece } from '../src/geometry.ts';
import { loadProjectModules } from './modules.ts';
import type { Corner, Point } from '../src/scene.ts';

/** The points one Scene of this suite writes, and the corner a middle one turns by. */
type Written = readonly [Point, Point, ...Point[]];

/** A shaft as a Scene writes it, resolved the way the Renderer resolves it. */
function pathOf(points: Written, corners: Corner): ShaftPath {
  return shaftPath(points, corners, undefined, undefined);
}

/**
 * Where one piece of a drawn shaft is at its own parameter, worked out from the
 * points the piece draws by: the cubic definition, independent of the search.
 */
function onPiece(piece: ShaftPiece, u: number): Point {
  if (piece.kind === 'straight') {
    return {
      x: piece.from.x + (piece.to.x - piece.from.x) * u,
      y: piece.from.y + (piece.to.y - piece.from.y) * u,
    };
  }
  const v = 1 - u;
  const weights = [v ** 3, 3 * v * v * u, 3 * v * u * u, u ** 3];
  const corners = [piece.from, piece.control1, piece.control2, piece.to];
  return {
    x: corners.reduce((sum, corner, index) => sum + corner.x * weights[index]!, 0),
    y: corners.reduce((sum, corner, index) => sum + corner.y * weights[index]!, 0),
  };
}

/**
 * The three paths a Labelled arrow or line draws through, each with the offsets
 * a drag can land on off it: a sharp corner's fillet turns tighter than a hand
 * ever drags beside it, so its own offsets stay inside the radius it bends by,
 * where the nearest place on the ink is the place the drawing put the words.
 */
const PATHS: ReadonlyArray<readonly [string, ShaftPath, readonly number[]]> = [
  ['a straight run', pathOf([{ x: 0, y: 0 }, { x: 200, y: 0 }], 'round'), [0, 12, -30]],
  [
    'a sharp corner',
    pathOf(
      [{ x: 0, y: 0 }, { x: 150, y: 100, corner: 'sharp' }, { x: 300, y: 0 }],
      'sharp',
    ),
    [0, 4, -4],
  ],
  [
    'a round curve',
    pathOf(
      [{ x: 0, y: 0 }, { x: 150, y: 100, corner: 'round' }, { x: 300, y: 0 }],
      'round',
    ),
    [0, 12, -30],
  ],
];

/** Fractions of the drawn shaft a drag can land on. */
const FRACTIONS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];

for (const [label, path, offsets] of PATHS) {
  test(`labelAtFor reads back the place shaftLabelAnchor draws on ${label}`, () => {
    for (const t of FRACTIONS) {
      for (const offset of offsets) {
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

/**
 * Shafts whose drawn end turns upright: the last of the ink faces straight down
 * — straight up where the points run the other way — so the side a Label rides
 * faces one way a hair inside the end and the other way at the end itself. A
 * release past the end lands on the end's own fraction, which is the side the
 * drawing uses.
 */
const ENDS: ReadonlyArray<
  readonly [string, Written, Point, ReturnType<typeof labelAtFor>]
> = [
  ['a curved head', [{ x: 400, y: 100 }, { x: 300, y: 200 }, { x: 300, y: 300 }], { x: 260, y: 310 }, { t: 1, offset: 40 }],
  ['a reversed curved start', [{ x: 300, y: 300 }, { x: 300, y: 200 }, { x: 400, y: 100 }], { x: 260, y: 310 }, { t: 0, offset: 40 }],
];

for (const [label, points, anchor, expected] of ENDS) {
  test(`a drag past ${label} keeps the side the drawn ink shows`, () => {
    const path = pathOf(points, 'round');
    const read = labelAtFor(path, anchor);
    assert.deepEqual(read, expected);
    // And the place it saves draws the words where the end's own side puts them,
    // not mirrored onto the other side of it.
    const drawn = shaftLabelAnchor(path, read);
    assert.ok(Math.abs(drawn.x - 260) < 0.5, `${label}: drawn at x ${drawn.x}`);
    assert.ok(Math.abs(drawn.y - 300) < 0.5, `${label}: drawn at y ${drawn.y}`);
  });
}

test('a drag onto a curve that doubles back lands on the nearer of its lobes', () => {
  // One ordinary round bend whose ink comes near the same point twice, about
  // 0.011px apart: the sampled place nearest on the coarse sweep is next to the
  // farther of the two.
  const path = pathOf(
    [{ x: -4000, y: -5000 }, { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 5000, y: -5400 }],
    'round',
  );
  const anchor = { x: 500.5669458, y: -980 };
  const away = (point: Point) => Math.hypot(point.x - anchor.x, point.y - anchor.y);
  // The nearest ink there is, read the slow way: every piece walked in fine steps
  // with the smallest distance kept, and no bracket nor narrowing to hide a lobe.
  let nearest = Number.POSITIVE_INFINITY;
  for (const piece of path.pieces) {
    for (let step = 0; step <= 20_000; step += 1) {
      nearest = Math.min(nearest, away(onPiece(piece, step / 20_000)));
    }
  }
  const drawn = away(shaftLabelAnchor(path, { t: labelAtFor(path, anchor).t, offset: 0 }));
  assert.ok(
    drawn < nearest + 0.005,
    `the drag saved the place ${drawn} from the anchor, nearest ink ${nearest}`,
  );
});

test('a drag on a straight two-point shaft saves the fraction its projection always did', () => {
  // The exact place is 7/32 of the way along, and a Scene keeps four decimals of
  // it: 0.2188, the bytes this drag wrote before shafts bent.
  const path = pathOf([{ x: 0, y: 0 }, { x: 16, y: 16 }], 'round');
  const read = labelAtFor(path, { x: 0, y: 7 });
  assert.equal(read.t, 0.2188);
  assert.ok(Math.abs(read.offset + Math.sqrt(24.5)) < 1e-2, `offset ${read.offset}`);
});

test('a straight two-point drag saves the labelAt bytes it always wrote', async () => {
  // Base f2c54ad wrote these exact bytes for both drags, and a shaft that can
  // bend must not change what a straight one writes. Both pointer points put
  // the words an exact half pixel off the line, where measuring the offset from
  // the rounded place can land the save on the other side of the tie.
  const cases = [
    {
      points: [{ x: 0, y: 0 }, { x: 160, y: 120 }],
      anchor: { x: 0, y: 6.875 },
      saved: { t: 0.0206, offset: -5 },
    },
    {
      points: [{ x: 0, y: 0 }, { x: 16, y: 16 }],
      anchor: { x: 0, y: 7 },
      saved: { t: 0.2188, offset: -5 },
    },
  ];
  const modules = await loadProjectModules();
  for (const { points, anchor, saved } of cases) {
    const opening = modules.parseScene(
      JSON.stringify({
        version: 1,
        elements: [{ id: 'line', type: 'line', corners: 'round', points, label: 'Words' }],
      }),
    );
    assert.ok(opening.ok, 'the straight shaft Scene parses');
    const elt = opening.scene.elements[0] as ArrowOrLineElement;
    const path = shaftPath(elt.points, elt.corners, undefined, undefined);
    const read = labelAtFor(path, anchor);
    // What the file holds: the Scene the save writes, read back as the editor
    // reads it, so the place this drag saves is the place a person reopens.
    const written = modules.serialiseScene({
      ...opening.scene,
      elements: [{ ...elt, labelAt: read }],
    });
    const reopened = modules.parseScene(written);
    assert.ok(reopened.ok, 'the saved Scene parses');
    const place = (reopened.scene.elements[0] as ArrowOrLineElement).labelAt;
    assert.deepEqual(place, saved);
  }
});
