/**
 * Seam 3: the Renderer and Editor geometry the editor calls.
 *
 * `ez` cannot reach these cases: a file's Scene is parsed and canonical before
 * the CLI draws it, and no command picks an Element. The editor holds a Scene
 * in memory, assigns a Label's place with more precision than a file keeps, and
 * presses on what it painted, so this seam drives the bundled modules directly.
 *
 * The modules are loaded through a bundle for the same reason the Scene seam is:
 * that is how the editor loads them, and Rough.js ships imports Node cannot
 * resolve on its own.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';
import type { Outline } from '../src/geometry.ts';
import type { Scene } from '../src/scene.ts';

const {
  parseScene,
  renderScene,
  renderElement,
  pageBounds,
  drawnGeometry,
  elementAt,
  caretLine,
  railFrame,
  clampedDock,
  leftDockEdge,
  nearestDock,
  anchorPoint,
  anchorOf,
  createLayout,
  parseFontFile,
  KALAM,
} = await loadProjectModules();

/** The drawing is measured with the bundled font, as `ez render` measures it. */
const HAND = parseFontFile(KALAM);
const LAYOUT = createLayout(HAND);

test('a page measured in memory is the page the SVG draws', () => {
  // The editor assigns `t` with more precision than a saved Scene keeps. A very
  // long shaft turns a hair of `t` into pixels, so measuring the raw value and
  // drawing the rounded one would fit a page the ink does not fill.
  const scene = parsed({
    version: 1,
    elements: [
      {
        id: 'a',
        type: 'line',
        points: [
          { x: 0, y: 0 },
          { x: 1_000_000, y: 0 },
        ],
        label: 'words',
        labelAt: { t: 0, offset: 200 },
      },
    ],
  });
  const line = scene.elements[0]!;
  if (line.type !== 'line') {
    throw new Error(`expected a line, got ${line.type}`);
  }
  line.labelAt = { t: 0.000049, offset: 200 };

  assert.deepEqual(pageBounds(scene, LAYOUT), viewBoxOf(renderScene(scene, LAYOUT)));
});

test('a Snap target is resolved where it is drawn, so bounds and picking keep the Label side', () => {
  // The editor holds a Scene with more precision than a file keeps: the
  // rectangle's `x` is 79.6 here and 80 once canonical, so its centre is 99.6
  // in memory and 100 where the ink paints it — the shaft's own x. The shaft
  // that is drawn is vertical and its Label sits left of it; the shaft only the
  // stored numbers describe leans 0.4px the other way, and that hair of a tilt
  // alone flips the side the Label is placed on. So the bounds a host selects
  // by and the press a person makes have to resolve the Snap target the ink
  // resolved, whatever map of Elements the caller holds.
  const scene = parsed({
    version: 1,
    elements: [
      { id: 'r', type: 'rectangle', x: 80, y: 100, width: 40, height: 40 },
      {
        id: 'a',
        type: 'line',
        points: [
          { x: 100, y: 0, snap: 'r' },
          { x: 100, y: 400 },
        ],
        label: 'words',
        labelAt: { t: 0.5, offset: 60 },
      },
    ],
  });
  const target = scene.elements[0]!;
  if (target.type !== 'rectangle') {
    throw new Error(`expected a rectangle, got ${target.type}`);
  }
  target.x = 79.6;

  const painted = wordsCentre(renderScene(scene, LAYOUT));
  const line = scene.elements[1]!;
  const held = new Map(scene.elements.map((element) => [element.id, element]));

  assert.ok(inside(drawnGeometry(line, held, LAYOUT).bounds, painted), 'the bounds cover the painted Label');
  assert.equal(pick(scene, painted), 'a', 'a press on the painted Label finds the shaft');
  // The mirrored point is the side the stored tilt alone would pick: 60px right
  // of the shaft, on bare paper.
  const mirrored = { x: 200 - painted.x, y: painted.y };
  assert.equal(pick(scene, mirrored), null, 'and the side the tilt would pick finds nothing');
});

test('a shaft Label is picked where it is painted, not where Layout first put it', () => {
  // The Label is placed 60px above its shaft, well clear of the shaft's ink and
  // of the box Layout puts it in by default: a press on the words finds the
  // shaft there, and a press on the place it no longer sits finds nothing.
  const scene = parsed({
    version: 1,
    elements: [
      {
        id: 'a',
        type: 'line',
        points: [
          { x: 0, y: 100 },
          { x: 400, y: 100 },
        ],
        label: 'words',
        labelAt: { t: 0.5, offset: 60 },
      },
    ],
  });
  const pressed = wordsCentre(renderScene(scene, LAYOUT));

  assert.equal(pick(scene, pressed), 'a', 'the Label is picked where it is painted');
  assert.equal(pick(scene, { x: 200, y: 90 }), null, 'and not where Layout first put it');
});

test('a press on the glyph overhang of a shaft Label finds it, as the ink paints it', () => {
  // Kalam's `j` is the widest hang in the bundled font: its hook reaches left
  // of the advance box Layout measures the words by, and the renderer paints
  // paper under it. The press below lands inside that hook — the font's own
  // outline says so — and left of the box, so picking has to reach as far as
  // the paint does.
  const scene = parsed({
    version: 1,
    elements: [
      {
        id: 'a',
        type: 'line',
        points: [
          { x: 0, y: 100 },
          { x: 400, y: 100 },
        ],
        label: 'j',
        fontSize: 'XL',
        labelAt: { t: 0.5, offset: 60 },
      },
    ],
  });
  const words = wordsOf(renderScene(scene, LAYOUT));
  const font = parseFontFile(KALAM);
  const outline = font.glyphs!.path('j', words.size, words.x, words.baseline, 'middle');
  assert.ok(outline !== null && outline !== '', 'the font draws the hook');
  const hook = leftmostInk(outline!);
  const advanceBoxLeft = words.x - font.metrics.advance('j', words.size) / 2;

  assert.ok(hook.x + 1 < advanceBoxLeft, `the hook hangs left of the advance box: ${hook.x}`);
  assert.equal(
    pick(scene, { x: hook.x + 1, y: hook.y }),
    'a',
    'a press on the painted overhang finds the shaft',
  );
  assert.equal(
    pick(scene, { x: hook.x - 2, y: hook.y }),
    null,
    'a press on bare paper beside it finds nothing',
  );
});

test('a press on the ink an Element paints finds it outside its own box', () => {
  // A rough outline wanders outside the rectangle it was drawn from, so an
  // Element paints a box of ink wider than its own. A press there —
  // outside the box the Element occupies — is the Element's, because picking
  // answers to the ink and not to the box.
  const scene = parsed({
    version: 1,
    elements: [
      {
        id: 'a',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        roughness: 2,
        stroke: { width: 'extra' },
      },
    ],
  });
  const element = scene.elements[0]!;
  const byId = new Map([['a', element]]);
  const box = drawnGeometry(element, byId, LAYOUT).bounds;
  const ink = renderElement(element, byId, LAYOUT).ink;
  const press = { x: ink.x + 1, y: ink.y + ink.height / 2 };

  assert.ok(press.x < box.x, `the ink reaches left of the box: ${ink.x}`);
  assert.equal(pick(scene, press), 'a', 'a press on the ink outside the box finds the Element');
  assert.equal(
    pick(scene, { x: press.x - 20, y: press.y }),
    null,
    'and bare paper beside it finds nothing',
  );
});

test('the caret’s line fits the slot it is drawn in, at every zoom a page offers', () => {
  // A slot is one line of a Label's words on the page, so Zoom is what sizes
  // it: the page's own floor is 10%, and the clearance that keeps a wide
  // selection out from under the note goes below it, to a slot under two
  // pixels. A line laid over such a slot would run its round caps outside it
  // and turn upward, so the line narrows with the slot and stays inside it.
  const ordinary = caretLine({ x: 100, y: 50, width: 0, height: 27 });
  assert.equal(ordinary.stroke, 2, 'a line of words at 100% draws the caret it always did');

  for (const height of [27, 13.5, 4, 2, 1.49, 0.8]) {
    const slot = { x: 100, y: 50, width: 0, height };
    const caret = caretLine(slot);
    const ys = ysOf(caret.path);
    const half = caret.stroke / 2;

    assert.ok(ys[0]! < ys[ys.length - 1]!, `the caret runs down a ${height}-pixel slot`);
    assert.ok(
      Math.min(...ys) - half >= slot.y && Math.max(...ys) + half <= slot.y + height,
      `and its stroke stays inside the slot`,
    );
  }
});

test('the rail frames the diagram, at least 960×600, and hangs the top dock above it', () => {
  // The rail's strip as the sheet draws it: 49 px of box and its two pencil
  // passes 7 px outside it on every side, so the outline is 63 px tall.
  const OUTLINE = { width: 246, height: 63, overhang: 7 };
  const WINDOW = { width: 1280, height: 800 };
  const still = { zoom: 1, panX: 0, panY: 0 };

  /** One rectangle, seen at 1:1 where `view` puts it, so only its box is in play. */
  const oneBox = (x: number, y: number, width: number, height: number): Scene =>
    parsed({
      version: 1,
      defaults: { roughness: 0 },
      elements: [{ id: 'a', type: 'rectangle', x, y, width, height }],
    });

  // An empty Scene frames the editor's middle at the minimum size, so the
  // outline's top is the frame's 100 px down, less the gap and the strip.
  const empty = railFrame(parsed({ version: 1, elements: [] }), still, WINDOW, 'top', OUTLINE, LAYOUT);
  assert.deepEqual(empty.frame, { x: 160, y: 100, width: 960, height: 600 });
  assert.deepEqual(empty.dock, { x: 640, y: 100 - 16 - 63 + 7 });

  // A tiny diagram gets the minimum about its own centre, not the editor's: a
  // 40×40 box at (700, 480) is framed by 960×600 around (720, 500).
  const tiny = railFrame(oneBox(100, 100, 40, 40), { zoom: 1, panX: 600, panY: 380 }, WINDOW, 'top', OUTLINE, LAYOUT);
  assert.deepEqual(tiny.frame, { x: 240, y: 200, width: 960, height: 600 });
  assert.deepEqual(tiny.dock, { x: 720, y: 200 - 16 - 63 + 7 });

  // A diagram already larger than the minimum is its own frame, and the dock is
  // one gap above its top side, centred on it. The window is tall enough to
  // hold the whole of it, so the frame is not cut.
  const large = railFrame(oneBox(140, 370, 1000, 700), still, { width: 1280, height: 1440 }, 'top', OUTLINE, LAYOUT);
  assert.deepEqual(large.frame, { x: 140, y: 370, width: 1000, height: 700 });
  assert.deepEqual(large.dock, { x: 140 + 500, y: 370 - 16 - 63 + 7 });

  // A frame cut by the editor's box: the dock follows the cut's top side.
  const cut = railFrame(oneBox(-400, 140, 1000, 620), still, WINDOW, 'top', OUTLINE, LAYOUT);
  assert.deepEqual(cut.frame, { x: 0, y: 140, width: 600, height: 620 });
  assert.deepEqual(cut.dock, { x: 300, y: 140 - 16 - 63 + 7 });

  // No room above the frame's top side: the rail stops 15 px inside the
  // editor's top edge, over the paper.
  const squeezed = railFrame(oneBox(140, 40, 1000, 700), still, WINDOW, 'top', OUTLINE, LAYOUT);
  assert.deepEqual(squeezed.frame, { x: 140, y: 40, width: 1000, height: 700 });
  assert.equal(squeezed.dock.y, 15);

  // Nothing of a diagram on screen: the frame is the empty Scene's.
  const offscreen = railFrame(oneBox(4000, 4000, 40, 40), still, WINDOW, 'top', OUTLINE, LAYOUT);
  assert.deepEqual(offscreen.frame, empty.frame);

  // A window shorter than the minimum frame: the frame is the editor's own box,
  // which leaves no room above it.
  const short = railFrame(parsed({ version: 1, elements: [] }), still, { width: 1280, height: 300 }, 'top', OUTLINE, LAYOUT);
  assert.deepEqual(short.frame, { x: 160, y: 0, width: 960, height: 300 });
  assert.equal(short.dock.y, 15);
});

test('a dock is left where its outline fits the editor, and pulled inside where it does not', () => {
  // The strip as the sheet draws it: seven 30 px tiles, six 1 px gaps and 8 px of
  // padding either side — 232×49 — with its pencilled outline hanging 7 px
  // outside it on every side.
  const strip = { width: 232, height: 49, overhang: 7 };
  const window = { width: 1280, height: 800 };

  // A dock the editor holds is left exactly where it was measured, even where the
  // 15 px inset would move it: nothing of its outline crosses an edge.
  assert.deepEqual(clampedDock({ x: 640, y: 348 }, strip, window, 'top'), {
    dock: { x: 640, y: 348 },
    stopped: false,
  });

  // 1280×760 measures the frame's dock at 8, its outline at 1: the gap the frame
  // left is kept, not cut to 9 px by a dock pulled down to the inset.
  assert.deepEqual(clampedDock({ x: 640, y: 8 }, strip, { width: 1280, height: 760 }, 'top'), {
    dock: { x: 640, y: 8 },
    stopped: false,
  });

  // A 248 px wide editor holds the 246 px outline centred on its middle, at 124.
  assert.deepEqual(clampedDock({ x: 124, y: 100 }, strip, { width: 248, height: 800 }, 'top'), {
    dock: { x: 124, y: 100 },
    stopped: false,
  });

  // A dock carried outside the box is pulled to the inset, measured to the strip's
  // own box and not its middle or its top: 15 px in from the edge it crossed, as
  // the top-edge fallback does.
  assert.deepEqual(clampedDock({ x: 640, y: -122 }, strip, { width: 1280, height: 500 }, 'top'), {
    dock: { x: 640, y: 15 },
    stopped: true,
  });
  assert.deepEqual(clampedDock({ x: 1200, y: 100 }, strip, window, 'top'), {
    dock: { x: 1280 - 15 - 116, y: 100 },
    stopped: false,
  });
  // Sideways it is pulled to the inset, but a strip laid along the top is stopped
  // by the edge it stands across, not by a side edge.
  assert.deepEqual(clampedDock({ x: 100, y: 100 }, strip, window, 'top'), {
    dock: { x: 15 + 116, y: 100 },
    stopped: false,
  });
  assert.deepEqual(clampedDock({ x: 640, y: 900 }, strip, window, 'top'), {
    dock: { x: 640, y: 800 - 15 - 49 },
    stopped: true,
  });

  // Where the inset would push the outline past the far edge but the outline
  // itself fits, the outline is what fits: a 250 px wide editor holds it centred
  // at 2..248, which 15 px in from either edge does not.
  assert.deepEqual(clampedDock({ x: 130, y: 100 }, strip, { width: 250, height: 800 }, 'top'), {
    dock: { x: 9 + 116, y: 100 },
    stopped: false,
  });

  // An editor smaller than the outline has no place that holds it inside: the low
  // inset wins and the outline is clipped by the far edge, never shrunk to fit.
  assert.deepEqual(clampedDock({ x: 130, y: 100 }, strip, { width: 200, height: 60 }, 'top'), {
    dock: { x: 15 + 116, y: 15 },
    stopped: true,
  });
});

test('the bottom, left and right docks stand outside the frame by the gap, as the top does', () => {
  // The rail's strip as the sheet draws it: 232×49 of box, and its two pencil
  // passes 7 px outside it on every side, so the outline is 246×63. Standing up
  // a side, the same strip is 46 wide and 241 tall, its outline 60×255.
  const OUTLINE = { width: 246, height: 63, overhang: 7 };
  const still = { zoom: 1, panX: 0, panY: 0 };
  const WINDOW = { width: 1280, height: 800 };

  /** One rectangle, seen at 1:1 where `view` puts it. */
  const oneBox = (x: number, y: number, width: number, height: number): Scene =>
    parsed({
      version: 1,
      defaults: { roughness: 0 },
      elements: [{ id: 'a', type: 'rectangle', x, y, width, height }],
    });
  const empty = parsed({ version: 1, elements: [] });

  // A 1000×700 diagram at (1220, 370) in a 3440×1440 window is its own frame,
  // shown 1:1 and cut by nothing: every side has room for the gap.
  const WIDE = { width: 3440, height: 1440 };
  const big = oneBox(1220, 370, 1000, 700);
  assert.deepEqual(railFrame(big, still, WIDE, 'bottom', OUTLINE, LAYOUT).dock, {
    x: 1720,
    y: 1070 + 16 + 7,
  });
  assert.deepEqual(railFrame(big, still, WIDE, 'left', OUTLINE, LAYOUT).dock, {
    x: 1220 - 16 - 246 + 7,
    y: 720,
  });
  assert.deepEqual(railFrame(big, still, WIDE, 'right', OUTLINE, LAYOUT).dock, {
    x: 2220 + 16 + 7,
    y: 720,
  });

  // An empty Scene's frame is the minimum about the editor's middle: 160..1120
  // across and 100..700 down in a 1280×800 window. Below it there is room, so the
  // bottom dock is one gap under the frame; either side of it there is not, so the
  // strip stops 15 px inside the editor's own edge instead (D2).
  assert.deepEqual(railFrame(empty, still, WINDOW, 'bottom', OUTLINE, LAYOUT).dock, {
    x: 640,
    y: 700 + 16 + 7,
  });
  assert.deepEqual(railFrame(empty, still, WINDOW, 'left', OUTLINE, LAYOUT).dock, { x: 15, y: 400 });
  assert.deepEqual(railFrame(empty, still, WINDOW, 'right', OUTLINE, LAYOUT).dock, {
    x: 1280 - 15 - 232,
    y: 400,
  });

  // A window too short for the gap under the frame: the strip stops 15 px inside
  // the bottom edge, its box 49 px tall, which is 676 in a 740 px window.
  assert.deepEqual(railFrame(empty, still, { width: 1280, height: 740 }, 'bottom', OUTLINE, LAYOUT).dock, {
    x: 640,
    y: 740 - 15 - 49,
  });

  // The clamp measures a standing strip by its own box too: a dock the editor
  // holds is left alone, and one carried past an edge is pulled inside the same
  // 15 px, the point it is written as being the strip's left and its middle.
  const standing = { width: 46, height: 241, overhang: 7 };
  assert.deepEqual(clampedDock({ x: 131, y: 400 }, standing, WINDOW, 'left'), {
    dock: { x: 131, y: 400 },
    stopped: false,
  });
  // Carried past the left edge, the strip stops at the inset: that is the one
  // place the note's clearance reads past it. A carry that lands on the very
  // same 15 px with room either side was not stopped by anything.
  assert.deepEqual(clampedDock({ x: -50, y: 400 }, standing, WINDOW, 'left'), {
    dock: { x: 15, y: 400 },
    stopped: true,
  });
  assert.deepEqual(clampedDock({ x: 15, y: 400 }, standing, WINDOW, 'left'), {
    dock: { x: 15, y: 400 },
    stopped: false,
  });
  // A standing strip slides along the edge it is held against, so a dock carried
  // too far down is no stop: the edge it is held against did not move it.
  assert.deepEqual(clampedDock({ x: 131, y: 1000 }, standing, WINDOW, 'right'), {
    dock: { x: 131, y: 800 - 15 - 241 + 241 / 2 },
    stopped: false,
  });
});

test('a left dock is a limit only where the editor stopped it, not where it landed', () => {
  const OUTLINE = { width: 60, height: 255, overhang: 7 };
  const WINDOW = { width: 1280, height: 800 };
  const standing = { width: 46, height: 241, overhang: 7 };
  const still = { zoom: 1, panX: 0, panY: 0 };

  // The frame leaves no room beside it, so the strip is stopped at the editor's
  // left inset (D2): the note has to clear the pencil's far side, 15 + 60 − 7.
  const narrow = { width: 400, height: 800 };
  const framed = railFrame(parsed({ version: 1, elements: [] }), still, narrow, 'left', OUTLINE, LAYOUT);
  assert.deepEqual(framed.dock, { x: 15, y: 400 });
  assert.equal(framed.stopped, true);
  assert.equal(leftDockEdge(framed, OUTLINE, 'left'), 68);

  // A carry or a resize that lands the strip on the very same 15 px with room
  // either side was stopped by nothing, so the editor's own edge is the limit.
  assert.equal(leftDockEdge({ dock: { x: 15, y: 400 }, stopped: false }, OUTLINE, 'left'), null);

  // Any other side is no limit at all, whatever stopped the strip.
  assert.equal(leftDockEdge(framed, OUTLINE, 'right'), null);

  // A rail carried past the edge is stopped there, and one carried inside it is
  // not, though the strip's own near edge is 15 px in both cases.
  assert.equal(leftDockEdge(clampedDock({ x: -50, y: 400 }, standing, WINDOW, 'left'), OUTLINE, 'left'), 68);
  assert.equal(leftDockEdge(clampedDock({ x: 15, y: 400 }, standing, WINDOW, 'left'), OUTLINE, 'left'), null);
});

test('a released rail docks on the frame side the pointer is nearest', () => {
  // An empty Scene's frame in a 1280×800 window: 160..1120 across, 100..700 down.
  const frame = { x: 160, y: 100, width: 960, height: 600 };

  // A release beyond a side is that side's, wherever along it the pointer is.
  assert.equal(nearestDock(frame, { x: 640, y: 40 }), 'top');
  assert.equal(nearestDock(frame, { x: 640, y: 760 }), 'bottom');
  assert.equal(nearestDock(frame, { x: 60, y: 400 }), 'left');
  assert.equal(nearestDock(frame, { x: 1220, y: 400 }), 'right');

  // A release inside the frame docks on the side it is a shorter way from: 50 px
  // under the top side and 140 px in from the left is the top's, which is the
  // side the strip is then a gap above.
  assert.equal(nearestDock(frame, { x: 300, y: 150 }), 'top');
  assert.equal(nearestDock(frame, { x: 200, y: 400 }), 'left');
  assert.equal(nearestDock(frame, { x: 1080, y: 500 }), 'right');
  assert.equal(nearestDock(frame, { x: 700, y: 640 }), 'bottom');

  // Two sides equally far off: the frame's own middle, and a release held out
  // past a corner. The same drag docks in the same place every time.
  assert.equal(nearestDock(frame, { x: 640, y: 400 }), 'top');
  assert.equal(nearestDock(frame, { x: 100, y: 40 }), 'top');
});

/** The y of every point a path names, in the order it names them. */
function ysOf(path: string): number[] {
  const values = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((found) => Number(found[0]));
  return values.filter((_value, index) => index % 2 === 1);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether a point is inside a box. */
function inside(box: Box, point: { x: number; y: number }): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/** The topmost Element a press at `point` finds, its Label's words included. */
function pick(scene: Scene, point: { x: number; y: number }): string | null {
  return elementAt(scene.elements, point, 0, LAYOUT)?.id ?? null;
}

/** Where the words of a Label sit: the middle of the block the drawing put them in. */
function wordsCentre(svg: string): { x: number; y: number } {
  const words = wordsOf(svg);
  return { x: words.x, y: words.baseline - HAND.metrics.inkCentre(words.size) };
}

/** The page an SVG writes, read back from the bytes as the host reads them. */
function viewBoxOf(svg: string): Box {
  const at = svg.indexOf('viewBox="');
  assert.ok(at >= 0, 'the SVG writes a viewBox');
  const from = at + 'viewBox="'.length;
  const [x, y, width, height] = svg
    .slice(from, svg.indexOf('"', from))
    .split(' ')
    .map(Number);
  return { x: x!, y: y!, width: width!, height: height! };
}

/** The words a painted `<text>` tag writes: its anchor point, baseline and size. */
function wordsOf(svg: string): { x: number; baseline: number; size: number } {
  const at = svg.indexOf('<text ');
  assert.ok(at >= 0, 'the Label paints words');
  const tag = svg.slice(at, svg.indexOf('>', at));
  return { x: numberIn(tag, 'x'), baseline: numberIn(tag, 'y'), size: numberIn(tag, 'font-size') };
}

/**
 * The leftmost point of a glyph outline, read back from the `d` the font writes
 * for it: the point whose x is smallest, with its own y. Every coordinate pair
 * the outline names is a point on the ink or on the curve it turns through, so
 * the leftmost of them is where the ink begins.
 */
function leftmostInk(path: string): { x: number; y: number } {
  let leftmost = { x: Number.POSITIVE_INFINITY, y: 0 };
  for (const match of path.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    const values = (match[2] ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
    for (let index = 0; index + 1 < values.length; index += 2) {
      const point = { x: values[index]!, y: values[index + 1]! };
      if (point.x < leftmost.x) {
        leftmost = point;
      }
    }
  }
  assert.ok(Number.isFinite(leftmost.x), 'the outline names a point');
  return leftmost;
}

/** One number the tag writes under `name`. */
function numberIn(tag: string, name: string): number {
  const at = tag.indexOf(`${name}="`);
  assert.ok(at >= 0, `the tag writes ${name}`);
  const from = at + name.length + 2;
  return Number(tag.slice(from, tag.indexOf('"', from)));
}

function parsed(scene: unknown): Scene {
  const result = parseScene(JSON.stringify(scene));
  if (!result.ok) {
    throw new Error(`Scene did not parse: ${result.problems.map((p) => p.message).join('; ')}`);
  }
  return result.scene;
}

test('an Anchor names the outline point it draws, so writing one down moves nothing', () => {
  // The editor writes the Anchor of the point an end attached at, and `ez
  // anchor --all` freezes every end where it draws: both go through the inverse
  // of `anchorPoint`, and every shape has to survive the round trip. The
  // fractions are a file's own numbers, so the only loss is the rounding, and
  // that must leave the drawn point within the half pixel an end may move.
  const OUTLINES: { label: string; outline: Outline }[] = [
    {
      label: 'a rectangle',
      outline: { type: 'rectangle', x: 100, y: 100, width: 120, height: 80, corners: 'sharp' },
    },
    {
      label: 'a rounded rectangle',
      outline: { type: 'rectangle', x: 100, y: 100, width: 120, height: 80, corners: 'round' },
    },
    {
      label: 'an ellipse',
      outline: { type: 'ellipse', x: 100, y: 100, width: 120, height: 80, corners: 'sharp' },
    },
    {
      label: 'a diamond',
      outline: { type: 'diamond', x: 100, y: 100, width: 120, height: 80, corners: 'sharp' },
    },
  ];
  // The corners, the middle of each side, the middle of the box and places a
  // person would put an end: the box fraction, then the nearest outline point.
  const PLACES = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 0.5, y: 0 },
    { x: 1, y: 0.25 },
    { x: 0.5, y: 1 },
    { x: 0, y: 0.75 },
    { x: 0.5, y: 0.5 },
    { x: 0.85, y: 0.1 },
    { x: 0.7, y: 0.9 },
  ];

  for (const { label, outline } of OUTLINES) {
    for (const place of PLACES) {
      const drawn = anchorPoint(outline, place);
      const written = anchorOf(outline, drawn);
      const again = anchorPoint(outline, written);
      const moved = Math.hypot(again.x - drawn.x, again.y - drawn.y);
      assert.ok(
        moved <= 0.5,
        `${label} at ${place.x},${place.y}: written ${JSON.stringify(written)} draws back ${moved.toFixed(3)} px off`,
      );
      assert.ok(
        written.x >= 0 && written.x <= 1 && written.y >= 0 && written.y <= 1,
        `${label} at ${place.x},${place.y}: ${JSON.stringify(written)} is a fraction of the box`,
      );
    }
  }
});
