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
import type { Scene } from '../src/scene.ts';

const {
  parseScene,
  renderScene,
  renderElement,
  pageBounds,
  elementBounds,
  elementAt,
  caretLine,
  railFrame,
  clampedDock,
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

  assert.ok(inside(elementBounds(line, held, LAYOUT), painted), 'the bounds cover the painted Label');
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
  const box = elementBounds(element, byId, LAYOUT);
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
  const OUTLINE = { height: 63, overhang: 7 };
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
  const empty = railFrame(parsed({ version: 1, elements: [] }), still, WINDOW, OUTLINE, LAYOUT);
  assert.deepEqual(empty.frame, { x: 160, y: 100, width: 960, height: 600 });
  assert.deepEqual(empty.dock, { x: 640, y: 100 - 16 - 63 + 7 });

  // A tiny diagram gets the minimum about its own centre, not the editor's: a
  // 40×40 box at (700, 480) is framed by 960×600 around (720, 500).
  const tiny = railFrame(oneBox(100, 100, 40, 40), { zoom: 1, panX: 600, panY: 380 }, WINDOW, OUTLINE, LAYOUT);
  assert.deepEqual(tiny.frame, { x: 240, y: 200, width: 960, height: 600 });
  assert.deepEqual(tiny.dock, { x: 720, y: 200 - 16 - 63 + 7 });

  // A diagram already larger than the minimum is its own frame, and the dock is
  // one gap above its top side, centred on it. The window is tall enough to
  // hold the whole of it, so the frame is not cut.
  const large = railFrame(oneBox(140, 370, 1000, 700), still, { width: 1280, height: 1440 }, OUTLINE, LAYOUT);
  assert.deepEqual(large.frame, { x: 140, y: 370, width: 1000, height: 700 });
  assert.deepEqual(large.dock, { x: 140 + 500, y: 370 - 16 - 63 + 7 });

  // A frame cut by the editor's box: the dock follows the cut's top side.
  const cut = railFrame(oneBox(-400, 140, 1000, 620), still, WINDOW, OUTLINE, LAYOUT);
  assert.deepEqual(cut.frame, { x: 0, y: 140, width: 600, height: 620 });
  assert.deepEqual(cut.dock, { x: 300, y: 140 - 16 - 63 + 7 });

  // No room above the frame's top side: the rail stops 15 px inside the
  // editor's top edge, over the paper.
  const squeezed = railFrame(oneBox(140, 40, 1000, 700), still, WINDOW, OUTLINE, LAYOUT);
  assert.deepEqual(squeezed.frame, { x: 140, y: 40, width: 1000, height: 700 });
  assert.equal(squeezed.dock.y, 15);

  // Nothing of a diagram on screen: the frame is the empty Scene's.
  const offscreen = railFrame(oneBox(4000, 4000, 40, 40), still, WINDOW, OUTLINE, LAYOUT);
  assert.deepEqual(offscreen.frame, empty.frame);

  // A window shorter than the minimum frame: the frame is the editor's own box,
  // which leaves no room above it.
  const short = railFrame(parsed({ version: 1, elements: [] }), still, { width: 1280, height: 300 }, OUTLINE, LAYOUT);
  assert.deepEqual(short.frame, { x: 160, y: 0, width: 960, height: 300 });
  assert.equal(short.dock.y, 15);
});

test('a dock is pulled inside the editor box, and the inset wins where the strip does not fit', () => {
  // The strip as the sheet draws it: seven 30 px tiles, six 1 px gaps and 8 px of
  // padding either side, so 232 px wide and 49 px tall.
  const strip = { width: 232, height: 49 };
  const window = { width: 1280, height: 800 };

  // A dock the editor holds is left exactly where it was measured.
  assert.deepEqual(clampedDock({ x: 640, y: 348 }, strip, window), { x: 640, y: 348 });

  // A short window: the dock carried up with the editor's middle is 372 px above
  // it, which is outside the box, so the strip stops 15 px inside the top edge.
  assert.deepEqual(clampedDock({ x: 640, y: -122 }, strip, { width: 1280, height: 500 }), {
    x: 640,
    y: 15,
  });

  // The sides and the bottom stop at the same inset, measured to the strip's own
  // box: 15 px in from the edge, not 15 px of its centre or its top.
  assert.deepEqual(clampedDock({ x: 1200, y: 100 }, strip, window), { x: 1280 - 15 - 116, y: 100 });
  assert.deepEqual(clampedDock({ x: 100, y: 100 }, strip, window), { x: 15 + 116, y: 100 });
  assert.deepEqual(clampedDock({ x: 640, y: 900 }, strip, window), { x: 640, y: 800 - 15 - 49 });

  // An editor smaller than the strip has no place that holds it inside: the low
  // inset wins and the strip is clipped by the far edge, never shrunk to fit.
  assert.deepEqual(clampedDock({ x: 130, y: 100 }, strip, { width: 200, height: 60 }), {
    x: 15 + 116,
    y: 15,
  });
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
