/**
 * Module seam: the Rail exception to rule 4: `rail.ts` owns the Rail's floating
 * placement and pointer state machine with supplied measurements, so Node tests
 * can prove them directly.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';
import type { Box } from '../src/editor/geometry.ts';
import type { PlacedRail, RailOrientation, RailOutlines, RailPlace } from '../src/editor/rail.ts';

const { Rail } = await loadProjectModules();

const OUTLINES: RailOutlines = {
  lying: { width: 246, height: 63, overhang: 7 },
  standing: { width: 60, height: 255, overhang: 7 },
};
const VIEWPORT = { width: 1280, height: 800 };

function makeRail(
  options: {
    chrome?: Box[];
    initial?: RailPlace;
    size?: { width: number; height: number };
  } = {},
) {
  let chrome = options.chrome ?? [];
  let size = options.size ?? VIEWPORT;
  const tools: string[] = [];
  const refused: number[] = [];
  const placements: PlacedRail[] = [];
  const orientations: RailOrientation[] = [];
  const written: { x: number; y: number; orientation: RailOrientation }[] = [];

  const rail = new Rail({
    size: () => size,
    statusChrome: () => chrome,
    outlines: () => OUTLINES,
    setTool: (tool) => tools.push(tool),
    refusePointer: (pointerId) => refused.push(pointerId),
    readPlace: () => options.initial ?? { kind: 'edge', side: 'top' },
    writePlace: (place) => written.push(place),
    onOrientation: (orientation) => orientations.push(orientation),
    onDrawArt: () => true,
    onPlace: (placed) => placements.push(placed),
  });

  return {
    rail,
    tools,
    refused,
    placements,
    orientations,
    written,
    setChrome(next: Box[]) {
      chrome = next;
    },
    setSize(next: { width: number; height: number }) {
      size = next;
    },
  };
}

test('a called-off press owes the rail one click from that pointer, and spares keys and other pointers', () => {
  const { rail, tools, refused } = makeRail();
  rail.place();

  rail.press(1, { x: 640, y: 40 });
  assert.equal(rail.holding(), true);
  assert.equal(rail.escape(), true);
  assert.equal(rail.holding(), false);
  assert.deepEqual(refused, [1]);

  // A keyboard click (detail 0) after the cancel still picks its tool, and leaves
  // pointer 1's debt unpaid.
  rail.click('rectangle', 1, 0);
  assert.deepEqual(tools, ['rectangle']);

  // Another pointer's click still picks its tool, and leaves pointer 1's debt unpaid.
  rail.click('ellipse', 2, 1);
  assert.deepEqual(tools, ['rectangle', 'ellipse']);

  // The owed click from pointer 1's release is swallowed and pays the debt.
  rail.click('diamond', 1, 1);
  assert.deepEqual(tools, ['rectangle', 'ellipse']);

  // A subsequent click from pointer 1 picks normally.
  rail.click('arrow', 1, 1);
  assert.deepEqual(tools, ['rectangle', 'ellipse', 'arrow']);

  // A fresh press by the same pointer also pays an unpaid debt before its release.
  rail.press(1, { x: 640, y: 40 });
  assert.equal(rail.escape(), true);
  rail.press(1, { x: 640, y: 40 });
  rail.release(1, { x: 640, y: 40 });
  rail.click('line', 1, 1);
  assert.deepEqual(tools, ['rectangle', 'ellipse', 'arrow', 'line']);
});

test('a committed drag swallows its trailing click and writes fractions and orientation', () => {
  const { rail, tools, written } = makeRail();
  rail.place();

  // Press at the strip's centre (640, 47.5) and drag to the bottom space (640, 700).
  rail.press(1, { x: 640, y: 47.5 });
  rail.move(1, { x: 640, y: 700 });
  rail.release(1, { x: 640, y: 700 });

  assert.equal(rail.orientation(), 'lying');
  assert.equal(written.length, 1);
  assert.equal(written[0]!.orientation, 'lying');
  assert.ok(Math.abs(written[0]!.x - 640 / 1280) < 1e-6);
  assert.ok(Math.abs(written[0]!.y - 700 / 800) < 1e-6);

  // The trailing click from the release is swallowed and picks no tool.
  rail.click('rectangle', 1, 1);
  assert.deepEqual(tools, []);

  // The next plain press+release+click picks its tool.
  rail.press(1, { x: 640, y: 700 });
  rail.release(1, { x: 640, y: 700 });
  rail.click('rectangle', 1, 1);
  assert.deepEqual(tools, ['rectangle']);
});

test('a status-corner resize waits while a press holds the rail, and settles when the press ends', () => {
  const { rail, placements, setChrome } = makeRail();
  rail.drawArt();
  rail.place();
  assert.equal(placements.length, 1);
  const initialY = placements[0]!.y;

  // Hold the rail with a press, then grow a status corner over its top place.
  rail.press(1, { x: 640, y: initialY + 10 });
  setChrome([{ x: 500, y: 0, width: 300, height: 80 }]);
  rail.boxResize();

  // While the press holds the strip, it must not move out from under the pointer.
  assert.equal(placements.length, 1);

  // Releasing as a click runs the waiting placement, moving the rail clear of the corner.
  rail.release(1, { x: 640, y: initialY + 10 });
  assert.equal(placements.length, 2);
  assert.ok(placements[1]!.y > initialY, `expected rail to move below status corner, got ${placements[1]!.y}`);
});

test('live drag follows the pointer every move past click slop', () => {
  const { rail, placements } = makeRail();
  rail.place();
  const start = placements.at(-1)!;

  // Grab the strip's centre and drag in the top space.
  rail.press(1, start.centre);
  rail.move(1, { x: 500, y: 120 });
  const first = placements.at(-1)!;
  assert.deepEqual(first.centre, { x: 500, y: 120 });
  assert.equal(first.orientation, 'lying');

  rail.move(1, { x: 760, y: 180 });
  const second = placements.at(-1)!;
  assert.deepEqual(second.centre, { x: 760, y: 180 });
  assert.equal(second.orientation, 'lying');

  // Escape calls off the drag and restores the pre-drag position.
  assert.equal(rail.escape(), true);
  assert.deepEqual(placements.at(-1)!.centre, start.centre);
});

test('turning across a diagonal keeps the grab point at its fraction along the strip', () => {
  const { rail, placements } = makeRail();
  rail.place();
  const start = placements.at(-1)!;
  const lyingWidth = OUTLINES.lying.width - OUTLINES.lying.overhang * 2;
  const standingHeight = OUTLINES.standing.height - OUTLINES.standing.overhang * 2;

  // Grab 20% along the lying strip from its left edge.
  const fraction = 0.2;
  const grab = { x: start.x + fraction * lyingWidth, y: start.centre.y };
  rail.press(1, grab);

  // Drag into the right standing space (well past the diagonal).
  const target = { x: 1100, y: 400 };
  rail.move(1, target);
  const turned = placements.at(-1)!;
  assert.equal(turned.orientation, 'standing');

  // The grab point on the standing strip (20% down from its top edge) stays under the pointer.
  const grabOnStanding = turned.y + fraction * standingHeight;
  assert.ok(
    Math.abs(grabOnStanding - target.y) < 1e-6,
    `expected grab point ${grabOnStanding} to stay at pointer y ${target.y}`,
  );
});

test('the 16px hold band prevents orientation flicker near a diagonal', () => {
  const { rail, placements } = makeRail();
  rail.place();
  const start = placements.at(-1)!;

  rail.press(1, start.centre);
  // In a 1280×800 editor, the diagonal from (0,0) to (1280,800) passes through (320, 200).
  // (310, 200) is in the left (standing) space, ~5.3px perpendicular from the diagonal — inside the 16px hold band.
  rail.move(1, { x: 310, y: 200 });
  assert.equal(placements.at(-1)!.orientation, 'lying');

  // Moving well past the diagonal (> 16px) flips to standing.
  rail.move(1, { x: 200, y: 400 });
  assert.equal(placements.at(-1)!.orientation, 'standing');
});

test('starting from an old saved side word places the rail at that edge middle', () => {
  const { rail, placements } = makeRail({ initial: { kind: 'edge', side: 'left' } });
  rail.place();
  const placed = placements.at(-1)!;
  assert.equal(placed.orientation, 'standing');
  assert.deepEqual(placed.centre, { x: 16 + OUTLINES.standing.width / 2, y: 400 });
});

test('palette edge command puts the rail at each edge middle and stores fractions and orientation', () => {
  const { rail, placements, written } = makeRail();
  rail.place();

  rail.placeAtEdge('bottom');
  assert.equal(placements.at(-1)!.orientation, 'lying');
  assert.deepEqual(placements.at(-1)!.centre, { x: 640, y: 800 - 16 - OUTLINES.lying.height / 2 });
  assert.equal(written.at(-1)!.orientation, 'lying');

  rail.placeAtEdge('right');
  assert.equal(placements.at(-1)!.orientation, 'standing');
  assert.deepEqual(placements.at(-1)!.centre, { x: 1280 - 16 - OUTLINES.standing.width / 2, y: 400 });
  assert.equal(written.at(-1)!.orientation, 'standing');

  rail.placeAtEdge('left');
  assert.equal(placements.at(-1)!.orientation, 'standing');
  assert.deepEqual(placements.at(-1)!.centre, { x: 16 + OUTLINES.standing.width / 2, y: 400 });

  rail.placeAtEdge('top');
  assert.equal(placements.at(-1)!.orientation, 'lying');
  assert.deepEqual(placements.at(-1)!.centre, { x: 640, y: 16 + OUTLINES.lying.height / 2 });
});

test('resize keeps centre fractions and orientation, clamping inside the new editor box', () => {
  const { rail, placements, setSize } = makeRail({
    initial: { kind: 'at', x: 0.25, y: 0.2, orientation: 'lying' },
  });
  rail.place();
  assert.deepEqual(placements.at(-1)!.centre, { x: 320, y: 160 });

  setSize({ width: 800, height: 600 });
  rail.resize();
  assert.equal(placements.at(-1)!.orientation, 'lying');
  assert.deepEqual(placements.at(-1)!.centre, { x: 200, y: 120 });
});

test('Scene switch, forget, and repeated place calls leave the rail at its screen position', () => {
  const { rail, placements } = makeRail({
    initial: { kind: 'at', x: 0.75, y: 0.25, orientation: 'lying' },
  });
  rail.place();
  const initial = placements.at(-1)!;
  assert.deepEqual(initial.centre, { x: 960, y: 200 });

  // Opening another Scene or fitting the view calls place() / forget(); the strip stays put.
  rail.forget();
  rail.place();
  assert.equal(placements.length, 1);
  assert.deepEqual(placements[0]!.centre, { x: 960, y: 200 });
});
