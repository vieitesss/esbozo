/**
 * Seam 1: multi-point and curved `arrow` and `line` Elements.
 *
 * The schema half runs the built `ez` CLI on Scene files in temporary folders
 * and asserts on exit codes and plain-text problems; the saving half drives the
 * public Scene module the editor loads, because a canonical file is what the
 * editor saves and no `ez` command writes one. Nothing here imports a private
 * helper.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ez, sceneFolder } from './cli.ts';
import { loadProjectModules } from './modules.ts';
import type { Scene } from '../src/scene.ts';
import { carriesSnaps } from '../src/geometry.ts';
import { removeTempFolders } from './temp.ts';

after(removeTempFolders);

const { parseScene, serialiseScene, renderScene, elementBounds, createLayout, parseFontFile, KALAM } =
  await loadProjectModules();

/** The drawing is measured with the bundled font, as `ez render` measures it. */
const HAND = parseFontFile(KALAM);
const LAYOUT = createLayout(HAND);

const BOX = { id: 'box', type: 'rectangle', x: 0, y: 0, width: 80, height: 80 };

/** A Scene holding one shaft, with the box a Snap can land on in front of it. */
function sceneWith(points: unknown[], extra: Record<string, unknown> = {}): unknown {
  return {
    version: 1,
    elements: [BOX, { id: 'a', type: 'arrow', points, ...extra }],
  };
}

/** What `ez check` says about one shaft: its exit code and its stderr. */
async function check(scene: unknown): Promise<{ code: number; stderr: string }> {
  const folder = await sceneFolder(scene);
  const run = await ez(['check', 'scene.json'], folder);
  return { code: run.code, stderr: run.stderr };
}

/** The Scene one shaft saves as, read back from canonical JSON. */
function saved(scene: unknown): Record<string, unknown> {
  const parsed = parseScene(JSON.stringify(scene));
  assert.ok(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.problems));
  return JSON.parse(serialiseScene(parsed.scene)) as Record<string, unknown>;
}

/** One Scene, parsed as the editor parses it. */
function parsed(scene: unknown): Scene {
  const result = parseScene(JSON.stringify(scene));
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.problems));
  return result.scene;
}

/** The points of the one shaft a saved Scene holds. */
function savedPoints(scene: unknown): Record<string, unknown>[] {
  const elements = saved(scene).elements as Record<string, unknown>[];
  return elements[1]!.points as Record<string, unknown>[];
}

test('a shaft bends through the points between its two ends', async () => {
  const bent = await check(sceneWith([{ x: 100, y: 0 }, { x: 140, y: 80 }, { x: 180, y: 0 }]));
  assert.equal(bent.code, 0, bent.stderr);

  const straight = await check(sceneWith([{ x: 100, y: 0 }, { x: 180, y: 0 }]));
  assert.equal(straight.code, 0, straight.stderr);
});

test('a Snap belongs to an end, so a middle point cannot hold one', async () => {
  const result = await check(
    sceneWith([{ x: 100, y: 0 }, { x: 120, y: 40, snap: 'box' }, { x: 180, y: 0 }]),
  );

  assert.equal(result.code, 3);
  assert.match(result.stderr, /^a: points\[1\]\.snap applies only to the first or last point$/m);
});

test('a corner belongs to a bend point, so an end cannot hold one', async () => {
  const start = await check(
    sceneWith([{ x: 100, y: 0, corner: 'round' }, { x: 140, y: 80 }, { x: 180, y: 0 }]),
  );
  assert.equal(start.code, 3, 'the first point is an end');
  assert.match(start.stderr, /^a: points\[0\]\.corner applies only to a middle point$/m);

  const end = await check(
    sceneWith([{ x: 100, y: 0 }, { x: 140, y: 80 }, { x: 180, y: 0, corner: 'sharp' }]),
  );
  assert.equal(end.code, 3, 'the last point is an end');
  assert.match(end.stderr, /^a: points\[2\]\.corner applies only to a middle point$/m);
});

test('a corner is sharp or round, and nothing else', async () => {
  const result = await check(
    sceneWith([{ x: 100, y: 0 }, { x: 140, y: 80, corner: 'curved' }, { x: 180, y: 0 }]),
  );

  assert.equal(result.code, 3);
  assert.match(
    result.stderr,
    /^a: points\[1\]\.corner must be one of sharp, round, got "curved"$/m,
  );
});

test('both ends Snap to one Element once a bend point lies between them', async () => {
  const loop = await check(
    sceneWith([
      { x: 100, y: 0, snap: 'box' },
      { x: 160, y: -60 },
      { x: 100, y: 0, snap: 'box' },
    ]),
  );
  assert.equal(loop.code, 0, loop.stderr);

  const straight = await check(
    sceneWith([
      { x: 100, y: 0, snap: 'box' },
      { x: 100, y: 80, snap: 'box' },
    ]),
  );
  assert.equal(straight.code, 3);
  assert.match(straight.stderr, /^a: both ends Snap to box$/m);
});

test('a shaft with a bend carries its Snaps, and a straight one lets them go', () => {
  // The editor reads this rule where a move asks what to do with a Snap: two
  // points have no bend to move instead, so a straight shaft that kept both ends
  // attached would not move at all.
  assert.equal(carriesSnaps([{ x: 0, y: 0 }, { x: 200, y: 0 }]), false);
  assert.equal(carriesSnaps([{ x: 0, y: 0 }, { x: 100, y: 80 }, { x: 200, y: 0 }]), true);
  assert.equal(
    carriesSnaps([
      { x: 0, y: 0 },
      { x: 60, y: 80 },
      { x: 140, y: 80 },
      { x: 200, y: 0 },
    ]),
    true,
  );
});

test('a two-point shaft saves as it always has, and a bend point saves its corner', () => {
  const straight = savedPoints(sceneWith([{ x: 10.4, y: 20.6 }, { x: 90.2, y: 60.4 }]));
  assert.deepEqual(straight, [
    { x: 10, y: 21 },
    { x: 90, y: 60 },
  ]);

  const bent = savedPoints(
    sceneWith([
      { x: 10.4, y: 20.6 },
      { x: 50.6, y: 60.4, corner: 'round' },
      { x: 90.2, y: 20.4 },
    ]),
  );
  assert.deepEqual(bent, [
    { x: 10, y: 21 },
    { x: 51, y: 60, corner: 'round' },
    { x: 90, y: 20 },
  ]);
  assert.deepEqual(Object.keys(bent[1]!), ['x', 'y', 'corner'], 'the corner is written after y');
  assert.deepEqual(Object.keys(bent[0]!), ['x', 'y'], 'an unwritten corner is never written');

  const inherited = savedPoints(
    sceneWith(
      [
        { x: 10, y: 20 },
        { x: 50, y: 60 },
        { x: 90, y: 20 },
      ],
      { corners: 'round' },
    ),
  );
  assert.deepEqual(inherited[1], { x: 50, y: 60 }, "a bend point that writes no corner takes the Element's");
  assert.deepEqual(Object.keys(inherited[1]!), ['x', 'y'], 'so the file writes none');
});

test('a Scene of bent shafts reopens as the Scene it saved', () => {
  const savedScene = saved(
    sceneWith(
      [
        { x: 100, y: 0 },
        { x: 140, y: 80, corner: 'sharp' },
        { x: 180, y: 0 },
      ],
      { corners: 'round' },
    ),
  );

  const parsed = parseScene(JSON.stringify(savedScene));
  assert.ok(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.problems));
  assert.equal(serialiseScene(parsed.scene), JSON.stringify(savedScene, null, 2) + '\n');
});

/** One rendered Scene: its exit code, its stderr and the SVG it wrote. */
async function render(scene: unknown): Promise<{ code: number; stderr: string; svg: string }> {
  const folder = await sceneFolder(scene);
  const run = await ez(['render', 'scene.json'], folder);
  const svg = existsSync(join(folder, 'scene.svg')) ? await readFile(join(folder, 'scene.svg'), 'utf8') : '';
  return { code: run.code, stderr: run.stderr, svg };
}

/** The rendered SVG of a Scene that must render, at roughness 0 so it is exact. */
async function ink(scene: unknown): Promise<string> {
  const result = await render(scene);
  assert.equal(result.code, 0, result.stderr);
  return result.svg;
}

/** A Scene of one shaft at roughness 0, so every drawn number is the model's own. */
function oneShaft(
  type: 'arrow' | 'line',
  points: unknown[],
  extra: Record<string, unknown> = {},
): unknown {
  return {
    version: 1,
    defaults: { roughness: 0 },
    elements: [{ id: 'a', type, points, ...extra }],
  };
}

/** A Scene of one arrow at roughness 0, so every drawn number is the model's own. */
function oneArrow(points: unknown[], extra: Record<string, unknown> = {}): unknown {
  return oneShaft('arrow', points, extra);
}

/** Every `<tag ...>` of one kind, in document order. */
function tags(svg: string, name: string): string[] {
  // check-rules: markup of a written SVG file, not the page
  return [...svg.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((match) => match[0]);
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

/** The Renderer's ink and hand font, with the light theme as the fallback they carry. */
const INK = 'var(--ink, #1b1a17)';
const FONT = "var(--font-hand, 'Kalam', 'Bradley Hand', 'Segoe Print', cursive)";

/** The shaft's own path: the stroked path that starts where the shaft does. */
function shaftFrom(svg: string, from: Point): string {
  const path = tags(svg, 'path')
    .filter((tag) => attribute(tag, 'stroke') === INK)
    .find((tag) => {
      const [start] = drawnPoints(attribute(tag, 'd') ?? '');
      return start !== undefined && near(start.x, from.x) && near(start.y, from.y);
    });
  assert.ok(path !== undefined, `a shaft starts at ${from.x},${from.y}`);
  return path;
}

/**
 * The points a path passes through, in order: where each Move, Line and Curve
 * lands. Control points are skipped, because the ink goes to the end point and
 * the args of one command carry no command letter of their own.
 */
function drawnPoints(d: string): Point[] {
  const points: Point[] = [];
  for (const [, command = '', args = ''] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    if (command !== 'M' && command !== 'L' && command !== 'C') {
      continue;
    }
    const numbers = (args.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const last = numbers.length - 2;
    points.push({ x: numbers[last]!, y: numbers[last + 1]! });
  }
  return points;
}

/** How close the ink of a path comes to a point, sampled along every curve it draws. */
function inkDistance(path: string, point: Point): number {
  return Math.min(
    ...inkSamples(attribute(path, 'd') ?? '').map((drawn) =>
      Math.hypot(drawn.x - point.x, drawn.y - point.y),
    ),
  );
}

/** Every point of a path's ink: where a line lands, and points along each curve. */
function inkSamples(d: string, along = 16): Point[] {
  const points: Point[] = [];
  let from: Point = { x: 0, y: 0 };
  for (const [, command = '', args = ''] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const numbers = (args.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (command === 'M' || command === 'L') {
      from = { x: numbers[0]!, y: numbers[1]! };
      points.push(from);
      continue;
    }
    if (command !== 'C') {
      continue;
    }
    const control1 = { x: numbers[0]!, y: numbers[1]! };
    const control2 = { x: numbers[2]!, y: numbers[3]! };
    const to = { x: numbers[4]!, y: numbers[5]! };
    for (let step = 0; step <= along; step += 1) {
      points.push(curveAt(from, control1, control2, to, step / along));
    }
    from = to;
  }
  return points;
}

/**
 * The ink of one stroke pass: a shaft's path carries one pass per subpath, and
 * this is the first of them.
 */
function firstPass(d: string): string {
  const start = d.indexOf('M');
  const next = d.indexOf('M', start + 1);
  return next < 0 ? d : d.slice(0, next);
}

/**
 * The point half way along a path's ink, measured by walking the ink itself in
 * fine steps: the length of the whole path, then the point that length leads to.
 */
function arcMiddle(d: string, along = 2000): Point {
  const points = inkSamples(d, along);
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1]!;
    const point = points[index]!;
    lengths.push(lengths[index - 1]! + Math.hypot(point.x - before.x, point.y - before.y));
  }
  const half = lengths[lengths.length - 1]! / 2;
  const step = lengths.findIndex((length) => length >= half);
  const before = points[step - 1]!;
  const point = points[step]!;
  const span = lengths[step]! - lengths[step - 1]!;
  const inside = span === 0 ? 0 : (half - lengths[step - 1]!) / span;
  return { x: before.x + (point.x - before.x) * inside, y: before.y + (point.y - before.y) * inside };
}

/** How long a path's ink is, walked in fine steps. */
function inkLength(d: string): number {
  const points = inkSamples(d, 2000);
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1]!;
    const point = points[index]!;
    length += Math.hypot(point.x - before.x, point.y - before.y);
  }
  return length;
}

/** One point of a cubic curve at `u`. */
function curveAt(from: Point, control1: Point, control2: Point, to: Point, u: number): Point {
  const rest = 1 - u;
  const [a, b, c, d] = [rest * rest * rest, 3 * rest * rest * u, 3 * rest * u * u, u * u * u];
  return {
    x: from.x * a + control1.x * b + control2.x * c + to.x * d,
    y: from.y * a + control1.y * b + control2.y * c + to.y * d,
  };
}

/** Every drawn point of the whole SVG, whatever path it belongs to. */
function allInk(svg: string): Point[] {
  return tags(svg, 'path').flatMap((tag) => drawnPoints(attribute(tag, 'd') ?? ''));
}

/** The page a written SVG shows. */
function viewBoxOf(svg: string): Box {
  const [x = '0', y = '0', width = '0', height = '0'] =
    /viewBox="([^"]*)"/.exec(svg)?.[1]!.split(/\s+/) ?? [];
  return { x: Number(x), y: Number(y), width: Number(width), height: Number(height) };
}

interface Point {
  x: number;
  y: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function near(actual: number, expected: number, tolerance = 0.5): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

test('a round bend point pulls the shaft into a curve through itself', async () => {
  const svg = await ink(
    oneArrow([
      { x: 0, y: 0 },
      { x: 100, y: 100, corner: 'round' },
      { x: 200, y: 0 },
    ]),
  );

  const shaft = shaftFrom(svg, { x: 0, y: 0 });
  assert.ok(inkDistance(shaft, { x: 100, y: 100 }) <= 0.5, 'the curve passes through the bend');
  assert.ok(
    inkDistance(shaft, { x: 100, y: 50 }) > 20,
    'and leaves the line between the ends, which runs 50px below the bend',
  );
});

test('a sharp bend point turns at a corner softened by a small fillet', async () => {
  const bend = { x: 100, y: 100 };
  const svg = await ink(
    oneArrow(
      [
        { x: 0, y: 0 },
        { x: 100, y: 100, corner: 'sharp' },
        { x: 200, y: 0 },
      ],
      // The fillet is what this shaft is measured for, so it draws no head: a
      // head is the last ink of its arrow, and would stop the shaft short of it.
      { heads: { start: 'none', end: 'none' } },
    ),
  );

  const shaft = shaftFrom(svg, { x: 0, y: 0 });
  const distance = inkDistance(shaft, bend);
  assert.ok(distance > 1, 'the ink keeps out of the vertex instead of cutting it');
  assert.ok(distance < 4, `the corner is softened, not cut away (got ${distance})`);
  const points = drawnPoints(attribute(shaft, 'd') ?? '');
  assert.ok(near(points[0]!.x, 0) && near(points[0]!.y, 0), 'the shaft starts at its start');
  assert.ok(near(points[points.length - 1]!.x, 200) && near(points[points.length - 1]!.y, 0), 'and ends at its end');
});

test('a sharp bend takes the same pullback from a short leg as from a long one', async () => {
  // The corner is 1px from the middle of its 2px leg, so the fillet may take
  // only 1px from either leg: the ink leaves the short leg at (1,0) and joins
  // the long one at (2,1). Taking a full 7px from the long leg alone would bend
  // the corner about a leg it has already left.
  const svg = await ink(
    oneArrow(
      [
        { x: 0, y: 0 },
        { x: 2, y: 0, corner: 'sharp' },
        { x: 2, y: 100 },
      ],
      // No head: the whole leg is drawn, so every point of it can be read.
      { heads: { start: 'none', end: 'none' } },
    ),
  );

  const drawn = drawnPoints(attribute(shaftFrom(svg, { x: 0, y: 0 }), 'd') ?? '');
  assert.ok(
    drawn.some((point) => near(point.x, 1) && near(point.y, 0)),
    'the fillet leaves the short leg at (1,0)',
  );
  assert.ok(
    drawn.some((point) => near(point.x, 2) && near(point.y, 1)),
    'and joins the long leg at (2,1)',
  );
  assert.ok(
    !drawn.some((point) => near(point.x, 2) && point.y > 1.5 && point.y < 99.5),
    'the long leg starts no lower than the short leg allows',
  );
});

test('a sharp fillet bulges inside the box a host selects by', () => {
  // A nearly doubled-back corner bulges past both of the fillet's own ends, to
  // x about 10.6. The box is measured by solving where the curve turns back, so
  // a root the solver misses leaves ink outside the box a person selects.
  const scene = parsed(
    oneArrow(
      [
        { x: 0, y: 0 },
        { x: 14, y: 4, corner: 'sharp' },
        { x: 0, y: 8 },
      ],
      { heads: { start: 'none', end: 'none' } },
    ),
  );
  const shaft = scene.elements[0]!;
  const svg = renderScene(scene, LAYOUT);
  const drawn = attribute(shaftFrom(svg, { x: 0, y: 0 }), 'd') ?? '';
  const reach = Math.max(...inkSamples(drawn).map((point) => point.x));

  const box = elementBounds(shaft, new Map([['a', shaft]]), LAYOUT);
  assert.ok(reach > 9, `the fillet bulges past its ends (got ${reach})`);
  // The written ink is rounded to hundredths on its way into the SVG, so the
  // box is compared with the ink as written.
  assert.ok(
    box.x + box.width >= reach - 0.02,
    `the box holds the bulge: ${box.x + box.width} < ${reach}`,
  );
});

test('a shaft mixes round and sharp bend points without one spoiling the other', async () => {
  const svg = await ink(
    oneArrow([
      { x: 0, y: 0 },
      { x: 100, y: 100, corner: 'round' },
      { x: 200, y: 0, corner: 'sharp' },
      { x: 300, y: 100 },
    ]),
  );

  const shaft = shaftFrom(svg, { x: 0, y: 0 });
  assert.ok(inkDistance(shaft, { x: 100, y: 100 }) <= 0.5, 'the round bend is drawn through');
  const softened = inkDistance(shaft, { x: 200, y: 0 });
  assert.ok(softened > 1 && softened < 4, `the sharp bend is softened (got ${softened})`);
});

test('a bend point unwritten takes the Element corners, and a written one wins', async () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 200, y: 0 },
  ];
  const round = shaftFrom(await ink(oneArrow(points, { corners: 'round' })), { x: 0, y: 0 });
  assert.ok(inkDistance(round, { x: 100, y: 100 }) <= 0.5, 'the Element makes the bend round');

  const written = shaftFrom(
    await ink(oneArrow([points[0], { ...points[1], corner: 'sharp' }, points[2]], { corners: 'round' })),
    { x: 0, y: 0 },
  );
  assert.ok(inkDistance(written, { x: 100, y: 100 }) > 1, 'the point makes its own bend sharp');
});

test('a self-loop leaves its box at one point and comes back at another', async () => {
  const svg = await ink({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      { id: 'box', type: 'rectangle', x: 100, y: 100, width: 100, height: 100, tone: 'muted' },
      {
        id: 'loop',
        type: 'arrow',
        heads: { start: 'none', end: 'none' },
        points: [
          { x: 150, y: 100, snap: 'box' },
          { x: 150, y: 30 },
          { x: 200, y: 150, snap: 'box' },
        ],
      },
    ],
  });

  const shaft = tags(svg, 'path').find((tag) => attribute(tag, 'stroke') === INK);
  assert.ok(shaft !== undefined, 'the loop is drawn');
  const d = attribute(shaft, 'd') ?? '';
  const drawn = drawnPoints(d);
  const start = drawn[0]!;
  const end = drawn[drawn.length - 1]!;
  assert.ok(near(start.y, 100) && near(end.y, 100), 'both ends stop on the box outline');
  assert.ok(
    [start.x, end.x].every((x) => x >= 100 && x <= 200),
    `both ends sit on the box's top edge, got x ${start.x} and ${end.x}`,
  );
  assert.ok(
    Math.abs(start.x - end.x) > 20,
    `the shaft leaves and returns at two points, got ${start.x} and ${end.x}`,
  );

  const ink_ = inkSamples(d);
  assert.ok(Math.min(...ink_.map((point) => point.y)) < 40, 'and loops through its bend point');
  assert.ok(Math.max(...ink_.map((point) => point.x)) >= Math.max(start.x, end.x), 'the ink reaches both ends');
});

test('a self-loop on a tiny target still leaves and returns at two points', async () => {
  // A 2px box with a bend 400px away: a spread measured by the box alone is a
  // fraction of a degree across from where it sits, so both ends would land on
  // one point of the outline and the loop would retrace a single line. The
  // spread grows with the distance the bend is at, so the two ends always leave
  // at a corner of their own.
  const svg = await ink({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      { id: 'dot', type: 'rectangle', x: 0, y: 0, width: 2, height: 2, tone: 'muted' },
      {
        id: 'loop',
        type: 'line',
        heads: { start: 'none', end: 'none' },
        points: [
          { x: 1, y: 0, snap: 'dot' },
          { x: 1, y: -400 },
          { x: 1, y: 2, snap: 'dot' },
        ],
      },
    ],
  });

  const shaft = tags(svg, 'path').find((tag) => attribute(tag, 'stroke') === INK);
  assert.ok(shaft !== undefined, 'the loop is drawn');
  const drawn = drawnPoints(firstPass(attribute(shaft, 'd') ?? ''));
  const start = drawn[0]!;
  const end = drawn[drawn.length - 1]!;
  assert.ok(
    [start, end].every((point) => point.x >= -0.01 && point.x <= 2.01),
    `both ends stop on the box outline, got ${start.x} and ${end.x}`,
  );
  assert.ok(
    Math.abs(start.x - end.x) >= 1,
    `the loop leaves and returns at two points, got ${start.x} and ${end.x}`,
  );
});

test('two targets that share an outline are two targets, not one loop', async () => {
  // Each end Snaps to its own Element, and the two Elements happen to sit in
  // the same place. A loop is one Element's outline, held by the same Snap at
  // both ends; two Snaps aim at the bend point beside each end, so both land on
  // the point the ray through the bend reaches and the shaft retraces it.
  const svg = await ink({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      { id: 'left', type: 'rectangle', x: 100, y: 100, width: 100, height: 100, tone: 'muted' },
      { id: 'right', type: 'rectangle', x: 100, y: 100, width: 100, height: 100, tone: 'muted' },
      {
        id: 'a',
        type: 'line',
        heads: { start: 'none', end: 'none' },
        points: [
          { x: 150, y: 100, snap: 'left' },
          { x: 150, y: 30 },
          { x: 200, y: 150, snap: 'right' },
        ],
      },
    ],
  });

  const shaft = tags(svg, 'path').find((tag) => attribute(tag, 'stroke') === INK);
  assert.ok(shaft !== undefined, 'the shaft is drawn');
  const drawn = drawnPoints(firstPass(attribute(shaft, 'd') ?? ''));
  const start = drawn[0]!;
  const end = drawn[drawn.length - 1]!;
  assert.ok(
    near(start.x, 150) && near(end.x, 150),
    `both ends aim at the bend, got ${start.x} and ${end.x}`,
  );
  assert.ok(near(start.y, 100) && near(end.y, 100), 'and land on the shared top edge');
});

test('a bend a move puts inside its target keeps the head on the near edge', async () => {
  // The Review's 225px nudge of a three-point shaft, drawn: the target spans
  // x=0..100 and is painted over the arrow, and the move leaves the bend at
  // (75,50), inside the box. The end keeps its Snap, so it lands where the
  // arrow reaches the outline from outside — the near edge at (0,50) — and its
  // head points into the target with its wings clear of the fill, rather than
  // meeting the far edge with the wings hidden under it.
  const svg = await ink({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      {
        id: 'arrow',
        type: 'arrow',
        points: [
          { x: -75, y: 50 },
          { x: 75, y: 50, corner: 'sharp' },
          { x: 225, y: 50, snap: 'box' },
        ],
      },
      {
        id: 'box',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fill: { kind: 'solid', grey: 1 },
      },
    ],
  });

  const head = tags(svg, 'path')
    .filter((tag) => attribute(tag, 'fill') === INK)
    .map((tag) => drawnPoints(attribute(tag, 'd') ?? ''))
    .find((points) => points.some((point) => near(point.x, 0) && near(point.y, 50)));
  assert.ok(head !== undefined, 'a head sits on the near edge, not on the far one');
  const wings = head.filter((point) => !(near(point.x, 0) && near(point.y, 50)));
  assert.equal(wings.length, 2, 'the head is a triangle');
  assert.ok(
    wings.every((point) => point.x < 0),
    `its wings sit outside the fill, got ${JSON.stringify(wings)}`,
  );

  const drawn = drawnPoints(attribute(shaftFrom(svg, { x: -75, y: 50 }), 'd') ?? '');
  assert.ok(
    drawn.every((point) => point.x <= 0.01),
    `no ink runs on into the fill, got ${JSON.stringify(drawn)}`,
  );
});

test('a line bends and softens its corners the same way an arrow does', async () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 100, corner: 'round' },
    { x: 200, y: 0, corner: 'sharp' },
    { x: 300, y: 100 },
  ];
  const arrow = await ink(oneShaft('arrow', points, { heads: { start: 'none', end: 'none' } }));
  const line = await ink(oneShaft('line', points));

  assert.equal(
    attribute(shaftFrom(line, { x: 0, y: 0 }), 'd'),
    attribute(shaftFrom(arrow, { x: 0, y: 0 }), 'd'),
    'one shaft, drawn by either Element',
  );
});

test('a curved shaft bulges inside the page it is drawn on', async () => {
  const svg = await ink(
    oneArrow([
      { x: 0, y: 0 },
      { x: 100, y: 150, corner: 'round' },
      { x: 200, y: 0 },
    ]),
  );

  const page = viewBoxOf(svg);
  const bulge = Math.max(
    ...inkSamples(attribute(shaftFrom(svg, { x: 0, y: 0 }), 'd') ?? '', 64).map((point) => point.y),
  );
  assert.ok(bulge > 100, `the curve reaches past its ends (got ${bulge})`);
  assert.ok(page.y <= 0 && page.y + page.height >= bulge, 'the page holds the whole bulge');
});

test('a tiny or doubled-back leg softens its corner instead of breaking the ink', async () => {
  const result = await render(
    oneArrow([
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 4, y: 0 },
      { x: 4, y: 0 },
      { x: 20, y: 40, corner: 'sharp' },
      { x: 40, y: 0 },
    ]),
  );

  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.svg, /NaN|Infinity/);
  const points = allInk(result.svg);
  assert.ok(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('a shaft’s box and page reach the ink Rough.js draws', () => {
  // This shaft's bend bulges far below its own ends, and at roughness 2 the
  // stroke roughened from it reaches a hair further still. A box or a page
  // measured by the curve alone would cut the ink it was measured for.
  const scene = parsed({
    version: 1,
    defaults: { roughness: 2 },
    elements: [
      {
        id: 'a',
        type: 'line',
        seed: 3,
        heads: { start: 'none', end: 'none' },
        points: [
          { x: 0, y: 0 },
          { x: 10000, y: 0, corner: 'sharp' },
          { x: 10100, y: 100, corner: 'round' },
          { x: 10200, y: 0 },
        ],
      },
    ],
  });
  const svg = renderScene(scene, LAYOUT);
  const shaft = scene.elements[0]!;
  const drawn = tags(svg, 'path').flatMap((tag) => inkSamples(attribute(tag, 'd') ?? '', 200));
  const top = Math.min(...drawn.map((point) => point.y));
  const bottom = Math.max(...drawn.map((point) => point.y));
  const left = Math.min(...drawn.map((point) => point.x));
  const right = Math.max(...drawn.map((point) => point.x));
  assert.ok(top < -20, `the bend bulges past its ends, up to y ${top}`);

  const box = elementBounds(shaft, new Map([['a', shaft]]), LAYOUT);
  // The written SVG keeps hundredths, so the ink as written can sit a hair
  // outside the box, which is measured in full precision.
  const written = 0.02;
  assert.ok(box.y <= top + written && box.y + box.height >= bottom - written, `the box holds the ink: y ${box.y}..${box.y + box.height} for ${top}..${bottom}`);
  assert.ok(box.x <= left + written && box.x + box.width >= right - written, `and x ${box.x}..${box.x + box.width} for ${left}..${right}`);

  const page = viewBoxOf(svg);
  assert.ok(page.y <= top + written && page.y + page.height >= bottom - written, `the page holds the ink: y ${page.y}..${page.y + page.height} for ${top}..${bottom}`);
  assert.ok(page.x <= left + written && page.x + page.width >= right - written, `and x ${page.x}..${page.x + page.width} for ${left}..${right}`);
});

test('a two-point shaft keeps the whole SVG it always drew, its page included', async () => {
  // A straight shaft reaches no further than its two ends: roughening its one
  // run wobbles the stroke inside the box those ends make. Growing the page for
  // ink a bend would have left behind would redraw every Scene that never bent,
  // so the bytes below are the ones 132dfa9 wrote, viewBox and all.
  const svg = await ink({
    version: 1,
    defaults: { roughness: 2 },
    elements: [
      {
        id: 'a',
        type: 'line',
        seed: 3,
        heads: { start: 'none', end: 'none' },
        points: [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
        ],
      },
    ],
  });

  assert.equal(
    svg,
    `<svg xmlns="http://www.w3.org/2000/svg" width="332" height="32" viewBox="-16 -16 332 32" role="img" font-family="${FONT}" data-scene-hash="sha256:14d52072702e35774f3f5a3238d6244c5f6a3ae1f0d591fd1c2993ffb735aaaa">
<title>Scene</title>
<g stroke-linecap="round" stroke-linejoin="round"><path d="M0 0 C57.91 -4.3, 118.6 -3.42, 300 0 M0 0 C65.66 -4.09, 128.58 -4.6, 300 0" fill="none" stroke="${INK}" stroke-width="2"/></g>
</svg>
`,
  );
});

test('a two-point shaft keeps the bytes it always drew, its Snap fraction included', async () => {
  // The Snap lands on a fraction of a pixel of the ellipse, and the ink is
  // roughened from that fraction: rounding it on the way into Rough.js moves a
  // control point in the last decimal and changes the SVG of a Scene that never
  // bent at all. The shaft is drawn with no head, so the bytes below are the
  // shaft's own.
  const svg = await ink({
    version: 1,
    defaults: { roughness: 2 },
    elements: [
      { id: 'e', type: 'ellipse', x: 0, y: 0, width: 97, height: 61 },
      {
        id: 'a',
        type: 'arrow',
        heads: { start: 'none', end: 'none' },
        points: [
          { x: 48, y: 61, snap: 'e' },
          { x: 300, y: 200 },
        ],
      },
    ],
  });

  // The page this Scene is drawn on is the two ends' box padded, as it always
  // was: a two-point shaft reaches no further than its ends. The hash is the
  // Scene's own, so it moved with the one field that says the shaft has no head.
  assert.equal(
    svg.slice(0, svg.indexOf('\n')),
    `<svg xmlns="http://www.w3.org/2000/svg" width="332" height="232" viewBox="-16 -16 332 232" role="img" font-family="${FONT}" data-scene-hash="sha256:12158a7a977d3d16497d4f447898682cde72301ac635d39f51cf0f9e27f14c34">`,
  );
  assert.equal(
    attribute(shaftFrom(svg, { x: 81.59, y: 52.8 }), 'd'),
    'M81.59 52.8 C161.38 106.61, 242.21 158.16, 300 200 M81.59 52.8 C157.09 106.34, 231.16 157.81, 300 200',
  );
});

test('a zero-length shaft keeps the bytes it always drew', async () => {
  // Two ends on one point have no direction of their own. Both heads keep the
  // way they have always been drawn — pointing right, base behind them — so a
  // Scene that never bent still writes the bytes it wrote before.
  const svg = await ink({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      {
        id: 'z',
        type: 'line',
        heads: { start: 'arrow', end: 'arrow' },
        points: [
          { x: 700, y: 300 },
          { x: 700, y: 300 },
        ],
      },
    ],
  });

  assert.deepEqual(
    tags(svg, 'path')
      .filter((tag) => attribute(tag, 'fill') === INK)
      .map((tag) => attribute(tag, 'd')),
    ['M700 300 L687 305.85 L687 294.15', 'M700 300 L687 305.85 L687 294.15'],
  );
});

test('a curved shaft draws its dash pattern along an unbroken stroke', async () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 100, corner: 'round' },
    { x: 200, y: 0 },
  ];
  for (const style of ['dashed', 'dotted'] as const) {
    const bare = await ink(
      oneArrow(points, { stroke: { width: 'bold', style }, heads: { start: 'none', end: 'none' } }),
    );
    const headed = await ink(
      oneArrow(points, { stroke: { width: 'bold', style }, heads: { start: 'none', end: 'arrow' } }),
    );

    const patterned = (svg: string) =>
      tags(svg, 'path').filter((tag) => attribute(tag, 'stroke-dasharray') !== undefined);
    assert.equal(patterned(bare).length, 1, `${style}: one pattern fits one path`);
    assert.equal(patterned(headed).length, 1, `${style}: and one with a head on the end`);
    // The head takes ink off the end of the shaft, and nothing else: the pattern
    // is still fitted to the whole of it, so every dash away from the head falls
    // where it fell with no head at all.
    assert.equal(
      attribute(patterned(headed)[0]!, 'stroke-dasharray'),
      attribute(patterned(bare)[0]!, 'stroke-dasharray'),
      `${style}: the head changes neither the fit nor the phase`,
    );

    const d = attribute(patterned(bare)[0]!, 'd') ?? '';
    // One subpath per stroke pass, each running the whole shaft: a move per
    // piece would start the pattern again at every bend.
    const subpaths = d.split('M').slice(1);
    assert.equal(subpaths.length, 2, `${style}: one subpath per stroke pass, got ${subpaths.length}`);
    for (const subpath of subpaths) {
      const stroke = inkSamples(`M${subpath}`);
      assert.ok(
        stroke.some((point) => near(point.x, 0) && near(point.y, 0)),
        `${style}: the stroke starts at the shaft`,
      );
      assert.ok(
        stroke.some((point) => near(point.x, 200) && near(point.y, 0)),
        `${style}: and runs to its end`,
      );
    }

    // The pattern is fitted to the ink's own length, not to the line between
    // the ends: whole periods of it fit what the stroke draws, and that is a
    // good deal longer than the chord on this shaft.
    const [dash = 0, gap = 0] = (attribute(patterned(bare)[0]!, 'stroke-dasharray') ?? '')
      .split(' ')
      .map(Number);
    const length = inkLength(firstPass(d));
    assert.ok(length > 230, `the ink is longer than the chord between its ends (${length})`);
    const periods = (length - dash) / (dash + gap);
    assert.ok(
      Math.abs(periods - Math.round(periods)) < 0.1,
      `${style}: whole periods fit the ink, ${periods} did`,
    );

    // With a head on the end the strokes are still one run each, and they stop
    // under the head instead of at the arrow's tip.
    const cut = (attribute(patterned(headed)[0]!, 'd') ?? '').split('M').slice(1);
    assert.equal(cut.length, 2, `${style}: the head leaves a subpath per stroke pass`);
    for (const subpath of cut) {
      const stroke = inkSamples(`M${subpath}`);
      assert.ok(
        stroke.some((point) => near(point.x, 0) && near(point.y, 0)),
        `${style}: the headed stroke starts at the shaft too`,
      );
      assert.ok(
        !stroke.some((point) => near(point.x, 200) && near(point.y, 0)),
        `${style}: and stops under the head, not on the tip`,
      );
      const nearest = Math.min(...stroke.map((point) => Math.hypot(point.x - 200, point.y)));
      assert.ok(nearest <= 13, `${style}: the stroke reaches its head, ${nearest} from the tip`);
    }
  }
});

test('clustered round bends never reverse or overshoot the points they run through', async () => {
  // A bend point 1px from its neighbour must not swing the curve like a lever:
  // the whole run is one smooth curve, so the ink stays between the points it
  // passes through instead of stopping and doubling back over them. A run that
  // reversed on its middle span would still fit between the two ends, so every
  // step of the ink is checked, not just its extremes.
  for (const [points, last] of [
    [
      [
        { x: 0, y: 0 },
        { x: 1, y: 0, corner: 'round' },
        { x: 100, y: 0 },
      ],
      100,
    ],
    [
      [
        { x: 0, y: 0 },
        { x: 100, y: 0, corner: 'round' },
        { x: 101, y: 0, corner: 'round' },
        { x: 200, y: 0 },
      ],
      200,
    ],
  ] as const) {
    const svg = await ink(oneArrow([...points], { heads: { start: 'none', end: 'none' } }));
    const drawn = inkSamples(attribute(shaftFrom(svg, { x: 0, y: 0 }), 'd') ?? '');
    const left = Math.min(...drawn.map((point) => point.x));
    const right = Math.max(...drawn.map((point) => point.x));
    assert.ok(left >= -0.01, `the ink never backs up behind the start (got ${left})`);
    assert.ok(right <= last + 0.01, `and never overshoots the end (got ${right})`);
    // Each stroke pass runs the whole shaft one way — Rough.js draws the second
    // from the far end — so the run is checked in the direction it goes.
    const passes = (attribute(shaftFrom(svg, { x: 0, y: 0 }), 'd') ?? '').split('M').slice(1);
    for (const pass of passes) {
      const xs = inkSamples(`M${pass}`).map((point) => point.x);
      const forward = xs[xs.length - 1]! >= xs[0]!;
      for (let index = 1; index < xs.length; index += 1) {
        const behind = xs[index - 1]!;
        const ahead = xs[index]!;
        assert.ok(
          forward ? ahead >= behind - 0.01 : ahead <= behind + 0.01,
          `the ink never backs up along the run, at x ${ahead} after x ${behind}`,
        );
      }
    }
  }
});

test('a cusp keeps its Label on the side the curve arrives from', async () => {
  // The shaft runs up to a sharp corner and back down the same line, so the
  // fillet between the two legs is a spike: at its tip the direction vanishes,
  // and that tip is the middle of the ink. The side is the one the ink is on,
  // the left of a vertical shaft; a fallback of "rightwards" would put the
  // words above the tip instead of beside it.
  const svg = await ink(
    oneArrow(
      [
        { x: 0, y: 0 },
        { x: 0, y: 100, corner: 'sharp' },
        { x: 0, y: 0 },
      ],
      {
        label: 'middle',
        labelAt: { t: 0.5, offset: 12 },
        heads: { start: 'none', end: 'none' },
      },
    ),
  );

  const centre = wordsCentre(svg);
  assert.ok(centre.x < -6, `the words sit beside the shaft, got x ${centre.x}`);
  assert.ok(near(centre.x, -12, 1), `one offset to its left, got x ${centre.x}`);
  assert.ok(centre.y > 90, `and level with the tip, got y ${centre.y}`);
});

test('an arrow head follows the curve it arrives on, not the line between the ends', async () => {
  const svg = await ink(
    oneArrow([
      { x: 0, y: 0 },
      { x: 100, y: 0, corner: 'round' },
      { x: 100, y: 100 },
    ]),
  );

  // The shaft arrives straight down, so the head's base sits above its apex. A
  // head aimed along the chord from (0,0) to (100,100) would lean to the left.
  const head = tags(svg, 'path')
    .filter((tag) => attribute(tag, 'fill') === INK)
    .map((tag) => drawnPoints(attribute(tag, 'd') ?? ''))
    .find((points) => points.some((point) => near(point.x, 100) && near(point.y, 100, 0.5)));
  assert.ok(head !== undefined, 'a head sits on the end');
  const base = head.filter((point) => !near(point.y, 100, 0.5));
  assert.equal(base.length, 2, 'the head is a triangle');
  const middle = { x: (base[0]!.x + base[1]!.x) / 2, y: (base[0]!.y + base[1]!.y) / 2 };
  assert.ok(near(middle.x, 100, 1), `the base centres under the apex, got ${middle.x}`);
  assert.ok(near(middle.y, 87, 1.5), `the base sits one head length back, got ${middle.y}`);
});

/** Where the words of a Label sit: the middle of the block the drawing put them in. */
function wordsCentre(svg: string): Point {
  const [tag] = tags(svg, 'text');
  assert.ok(tag !== undefined, 'the Label paints words');
  const size = Number(attribute(tag, 'font-size'));
  return {
    x: Number(attribute(tag, 'x')),
    // A line's baseline sits its own ink centre below the middle of its block,
    // measured by the same font the drawing measured the words with.
    y: Number(attribute(tag, 'y')) - HAND.metrics.inkCentre(size),
  };
}

test('labelAt places a shaft Label by arc length along the curve', async () => {
  const svg = await ink(
    oneArrow(
      [
        { x: 0, y: 0 },
        { x: 100, y: 150, corner: 'round' },
        { x: 200, y: 0 },
      ],
      { label: 'middle', labelAt: { t: 0.5, offset: 0 } },
    ),
  );

  // The middle of this curve is its bend, at (100,150). The middle of the line
  // between the two ends is (100,0), so this is the arc length, not the chord.
  const centre = wordsCentre(svg);
  assert.ok(near(centre.x, 100, 1), `the words sit on the bend, got x ${centre.x}`);
  assert.ok(near(centre.y, 150, 1.5), `the words sit on the ink, got y ${centre.y}`);
});

test('labelAt offsets along the side the curve is on at that fraction', async () => {
  const svg = await ink(
    oneArrow(
      [
        { x: 0, y: 0 },
        { x: 100, y: 150, corner: 'round' },
        { x: 200, y: 0 },
      ],
      { label: 'middle', labelAt: { t: 0.5, offset: 12 } },
    ),
  );

  // The curve is level where it passes the bend, so the upper side is up.
  const centre = wordsCentre(svg);
  assert.ok(near(centre.x, 100, 1), `the words stay on the bend, got x ${centre.x}`);
  assert.ok(near(centre.y, 138, 1.5), `the words move up by the offset, got y ${centre.y}`);
});

test('labelAt puts the words on the middle of a long curve, not the middle of its chords', async () => {
  // A curve this long holds a lot of arc between two of its own chords: the ink
  // is measured finely enough that half its length lands on the ink, not a few
  // pixels behind it as thirty-two chords would have it.
  const points = [
    { x: 0, y: 0 },
    { x: 10000, y: 15000, corner: 'round' },
    { x: 30000, y: 0, corner: 'round' },
    { x: 100000, y: 10000 },
  ];
  const svg = await ink(
    oneArrow(points, {
      label: 'middle',
      labelAt: { t: 0.5, offset: 0 },
      heads: { start: 'none', end: 'none' },
    }),
  );
  // The words cut the shaft they sit on, so the ink's own middle is measured on
  // the same curve drawn without a Label.
  const bare = await ink(oneArrow(points, { heads: { start: 'none', end: 'none' } }));

  const shaft = firstPass(attribute(shaftFrom(bare, { x: 0, y: 0 }), 'd') ?? '');
  const middle = arcMiddle(shaft);
  const centre = wordsCentre(svg);
  const missed = Math.hypot(centre.x - middle.x, centre.y - middle.y);
  assert.ok(missed < 0.5, `the words sit on the middle of the ink, ${missed}px off`);
});

test('labelAt still finds the middle when the same curve is 250 times as long', async () => {
  // The middle of a curve is found by its own arc length, and a curve 250 times
  // as long holds 250 times as much ink between two steps of any fixed table.
  // The steps are integrated over their own spans and the fraction of a step is
  // solved for on the curve, so the words stay on the middle however far the
  // ink runs.
  const far = 250;
  const points = [
    { x: 0, y: 0 },
    { x: 10000 * far, y: 15000 * far, corner: 'round' },
    { x: 30000 * far, y: 0, corner: 'round' },
    { x: 100000 * far, y: 10000 * far },
  ];
  const svg = await ink(
    oneArrow(points, {
      label: 'middle',
      labelAt: { t: 0.5, offset: 0 },
      heads: { start: 'none', end: 'none' },
    }),
  );
  const bare = await ink(oneArrow(points, { heads: { start: 'none', end: 'none' } }));

  const shaft = firstPass(attribute(shaftFrom(bare, { x: 0, y: 0 }), 'd') ?? '');
  const middle = arcMiddle(shaft, 100000);
  const centre = wordsCentre(svg);
  const missed = Math.hypot(centre.x - middle.x, centre.y - middle.y);
  assert.ok(missed < 0.5, `the words sit on the middle of the ink, ${missed}px off`);
});

test('labelAt places a shaft Label by arc length on uneven legs too', async () => {
  // Legs of 100px and 20px: a tenth of the ink is 12px along the long one, a
  // long way from the middle of the line between the two ends.
  const svg = await ink(
    oneArrow(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 20 },
      ],
      { label: 'middle', labelAt: { t: 0.1, offset: 0 } },
    ),
  );

  const centre = wordsCentre(svg);
  assert.ok(near(centre.x, 12, 1), `a tenth of the ink in, got x ${centre.x}`);
  assert.ok(near(centre.y, 0, 1), `on the long leg, got y ${centre.y}`);
  assert.ok(
    Math.hypot(centre.x - 50, centre.y - 10) > 30,
    'nowhere near the middle of the line between the ends',
  );
});

test('labelAt measures a cornered shaft along its legs, corner included', async () => {
  const svg = await ink(
    oneArrow(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      { label: 'middle', labelAt: { t: 0.5, offset: 0 } },
    ),
  );

  // Two legs of 100px each: the middle of the ink is the corner, and the middle
  // of the line between the ends is (50,50), where no ink runs.
  const centre = wordsCentre(svg);
  assert.ok(Math.hypot(centre.x - 100, centre.y) < 4, `the words sit on the corner, got ${centre.x},${centre.y}`);
  assert.ok(Math.hypot(centre.x - 50, centre.y - 50) > 40, 'the words left the chord behind');
});

test('a Label keeps its place along a bent shaft a move carries', async () => {
  // A move translates the shaft's points, and `labelAt` is a fraction of the
  // path they draw: the words ride the shaft and stay at the same place on it.
  const bent = (dy: number): unknown => ({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      {
        id: 'a',
        type: 'arrow',
        label: 'moved',
        labelAt: { t: 0.5, offset: 0 },
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 80, corner: 'sharp' },
          { x: 200, y: 0 },
        ].map((point) => ({ ...point, y: point.y + dy })),
      },
    ],
  });

  const before = wordsCentre(await ink(bent(0)));
  const after = wordsCentre(await ink(bent(40)));
  assert.ok(Math.abs(after.x - before.x) <= 1, `the words keep their x, got ${after.x} from ${before.x}`);
  assert.ok(
    Math.abs(after.y - before.y - 40) <= 1,
    `the words move with the shaft, got ${after.y} from ${before.y}`,
  );
});

test('a bent shaft draws the same bytes at every roughness', async () => {
  const scene = (roughness: number): unknown => ({
    version: 1,
    defaults: { roughness },
    elements: [
      { id: 'box', type: 'rectangle', x: 300, y: 0, width: 100, height: 100 },
      {
        id: 'a',
        type: 'arrow',
        label: 'bent',
        labelAt: { t: 0.5, offset: 0 },
        points: [
          { x: 0, y: 0, snap: 'box' },
          { x: 150, y: 120, corner: 'round' },
          { x: 200, y: 0, corner: 'sharp' },
          { x: 300, y: 50, snap: 'box' },
        ],
      },
    ],
  });

  for (const roughness of [0, 1, 2]) {
    const first = await ink(scene(roughness));
    const second = await ink(scene(roughness));
    assert.equal(second, first, `roughness ${roughness} draws the same bytes twice`);
    assert.doesNotMatch(first, /NaN|Infinity/, `roughness ${roughness} draws real numbers`);
  }
});
