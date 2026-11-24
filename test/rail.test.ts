/**
 * The Rail exception to rule 4: `rail.ts` owns the Rail's dock maths and
 * pointer state machine with supplied measurements, so Node tests can prove
 * them directly.
 *
 * Proves the three pointer/placement rules that otherwise only a browser drag
 * reaches: the click owed after a called-off press, the click swallowed after
 * a committed drag, and a placement that waits while a press holds the strip.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';
import type { Box } from '../src/editor/geometry.ts';
import type { RailSide } from '../src/editor/rail.ts';

const { Rail, emptyScene, createLayout, parseFontFile, KALAM } = await loadProjectModules();

const LAYOUT = createLayout(parseFontFile(KALAM));
const OUTLINE = { width: 246, height: 63, overhang: 7 };
const VIEWPORT = { width: 1280, height: 800 };
const STILL = { zoom: 1, panX: 0, panY: 0 };

function makeRail(initialChrome: Box[] = []) {
  let chrome = initialChrome;
  const tools: string[] = [];
  const refused: number[] = [];
  const hangs: { x: number; y: number; side: RailSide }[] = [];
  const written: RailSide[] = [];

  const rail = new Rail({
    scene: () => emptyScene(),
    view: () => STILL,
    layout: () => LAYOUT,
    size: () => VIEWPORT,
    statusChrome: () => chrome,
    outline: () => OUTLINE,
    setTool: (tool) => tools.push(tool),
    refusePointer: (pointerId) => refused.push(pointerId),
    readSide: () => 'top',
    writeSide: (side) => written.push(side),
    onDrawArt: () => true,
    onHang: (placed, side) => hangs.push({ x: placed.dock.x, y: placed.dock.y, side }),
  });

  return {
    rail,
    tools,
    refused,
    hangs,
    written,
    setChrome(next: Box[]) {
      chrome = next;
    },
  };
}

test('a called-off press owes the rail one click from that pointer, and spares keys and other pointers', () => {
  const { rail, tools, refused } = makeRail();
  rail.place();

  rail.press(1, { x: 640, y: 28 });
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
  rail.press(1, { x: 640, y: 28 });
  assert.equal(rail.escape(), true);
  rail.press(1, { x: 640, y: 28 });
  rail.release(1, { x: 640, y: 28 });
  rail.click('line', 1, 1);
  assert.deepEqual(tools, ['rectangle', 'ellipse', 'arrow', 'line']);
});

test('a committed drag swallows its trailing click and docks the rail', () => {
  const { rail, tools, written } = makeRail();
  rail.place();

  // Drag from top down past the bottom of the frame (frame is 160..1120 × 100..700).
  rail.press(1, { x: 640, y: 28 });
  rail.move(1, { x: 640, y: 760 });
  rail.release(1, { x: 640, y: 760 });

  assert.equal(rail.side(), 'bottom');
  assert.deepEqual(written, ['bottom']);

  // The trailing click from the release is swallowed and picks no tool.
  rail.click('rectangle', 1, 1);
  assert.deepEqual(tools, []);

  // The next plain press+release+click picks its tool.
  rail.press(1, { x: 640, y: 730 });
  rail.release(1, { x: 640, y: 730 });
  rail.click('rectangle', 1, 1);
  assert.deepEqual(tools, ['rectangle']);
});

test('a status-corner resize waits while a press holds the rail, and settles when the press ends', () => {
  const { rail, hangs, setChrome } = makeRail();
  rail.drawArt();
  rail.place();
  assert.equal(hangs.length, 1);
  const initialY = hangs[0]!.y;

  // Hold the rail with a press, then grow a status corner over its top dock.
  rail.press(1, { x: 640, y: initialY + 10 });
  setChrome([{ x: 500, y: 0, width: 300, height: 80 }]);
  rail.boxResize();

  // While the press holds the strip, it must not move out from under the pointer.
  assert.equal(hangs.length, 1);

  // Releasing as a click runs the waiting placement, moving the rail clear of the corner.
  rail.release(1, { x: 640, y: initialY + 10 });
  assert.equal(hangs.length, 2);
  assert.ok(hangs[1]!.y > initialY, `expected rail to move below status corner, got ${hangs[1]!.y}`);
});
