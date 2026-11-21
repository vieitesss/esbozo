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
import { test } from 'node:test';
import { ez, sceneFolder } from './cli.ts';
import { loadProjectModules } from './modules.ts';
import type { Scene } from '../src/scene.ts';

const { parseScene, serialiseScene, renderScene, elementBounds, createLayout, parseFontFile, KALAM } =
  await loadProjectModules();

/** The drawing is measured with the bundled font, as `ez render` measures it. */
const LAYOUT = createLayout(parseFontFile(KALAM));

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
  for (const index of [0, 2]) {
    const points = [
      { x: 100, y: 0, corner: 'round' },
      { x: 140, y: 80 },
      { x: 180, y: 0, corner: 'sharp' },
    ];
    const result = await check(sceneWith(points));
    assert.equal(result.code, 3, `points[${index}] is an end`);
    assert.match(
      result.stderr,
      new RegExp(`^a: points\\[${index}\\]\\.corner applies only to a middle point$`, 'm'),
    );
  }
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

/** A Scene of one arrow at roughness 0, so every drawn number is the model's own. */
function oneArrow(points: unknown[], extra: Record<string, unknown> = {}): unknown {
  return {
    version: 1,
    defaults: { roughness: 0 },
    elements: [{ id: 'a', type: 'arrow', points, ...extra }],
  };
}

/** Every `<tag ...>` of one kind, in document order. */
function tags(svg: string, name: string): string[] {
  // check-rules: markup of a written SVG file, not the page
  return [...svg.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((match) => match[0]);
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

/** The shaft's own path: the stroked path that starts where the shaft does. */
function shaftFrom(svg: string, from: Point): string {
  const path = tags(svg, 'path')
    .filter((tag) => attribute(tag, 'stroke') === 'var(--ink)')
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
function inkSamples(d: string): Point[] {
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
    for (let step = 0; step <= 16; step += 1) {
      points.push(curveAt(from, control1, control2, to, step / 16));
    }
    from = to;
  }
  return points;
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
  assert.ok(attribute(shaft, 'd')!.includes('C'), 'the shaft is drawn as a curve');
  assert.ok(inkDistance(shaft, { x: 100, y: 100 }) <= 0.5, 'the curve passes through the bend');
});

test('a sharp bend point turns at a corner softened by a small fillet', async () => {
  const bend = { x: 100, y: 100 };
  const svg = await ink(
    oneArrow([
      { x: 0, y: 0 },
      { x: 100, y: 100, corner: 'sharp' },
      { x: 200, y: 0 },
    ]),
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
    oneArrow([
      { x: 0, y: 0 },
      { x: 2, y: 0, corner: 'sharp' },
      { x: 2, y: 100 },
    ]),
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

  const shaft = tags(svg, 'path').find((tag) => attribute(tag, 'stroke') === 'var(--ink)');
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

test('a curved shaft bulges inside the page it is drawn on', async () => {
  const svg = await ink(
    oneArrow([
      { x: 0, y: 0 },
      { x: 100, y: 150, corner: 'round' },
      { x: 200, y: 0 },
    ]),
  );

  const page = viewBoxOf(svg);
  const bulge = Math.max(...allInk(svg).map((point) => point.y));
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

test('a curved shaft draws its dash pattern along an unbroken stroke', async () => {
  for (const style of ['dashed', 'dotted'] as const) {
    const svg = await ink(
      oneArrow(
        [
          { x: 0, y: 0 },
          { x: 100, y: 100, corner: 'round' },
          { x: 200, y: 0 },
        ],
        { stroke: { width: 'bold', style } },
      ),
    );

    const dashed = tags(svg, 'path').filter((tag) => attribute(tag, 'stroke-dasharray') !== undefined);
    assert.equal(dashed.length, 1, `${style}: one pattern fits one path`);
    const d = attribute(dashed[0]!, 'd') ?? '';
    // One subpath per stroke pass, each running the whole shaft: a move per
    // piece would start the pattern again at every bend.
    const subpaths = d.split('M').slice(1);
    assert.equal(subpaths.length, 2, `${style}: one subpath per stroke pass, got ${subpaths.length}`);
    for (const subpath of subpaths) {
      const drawn = inkSamples(`M${subpath}`);
      assert.ok(
        drawn.some((point) => near(point.x, 0) && near(point.y, 0)),
        `${style}: the stroke starts at the shaft`,
      );
      assert.ok(
        drawn.some((point) => near(point.x, 200) && near(point.y, 0)),
        `${style}: and runs to its end`,
      );
    }
  }
});

test('clustered round bends never reverse or overshoot the points they run through', async () => {
  // A bend point 1px from its neighbour must not swing the curve like a lever:
  // the whole run is one smooth curve, so the ink stays between the points it
  // passes through instead of stopping and doubling back over them.
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
    .filter((tag) => attribute(tag, 'fill') === 'var(--ink)')
    .map((tag) => drawnPoints(attribute(tag, 'd') ?? ''))
    .find((points) => points.some((point) => near(point.x, 100) && near(point.y, 100, 0.5)));
  assert.ok(head !== undefined, 'a head sits on the end');
  const base = head.filter((point) => !near(point.y, 100, 0.5));
  assert.equal(base.length, 2, 'the head is a triangle');
  const middle = { x: (base[0]!.x + base[1]!.x) / 2, y: (base[0]!.y + base[1]!.y) / 2 };
  assert.ok(near(middle.x, 100, 1), `the base centres under the apex, got ${middle.x}`);
  assert.ok(near(middle.y, 87, 1.5), `the base sits one head length back, got ${middle.y}`);
});

/** The paper a shaft's Label sits on, read from the written SVG. */
function paperOf(svg: string): Box {
  const tag = tags(svg, 'rect').find((candidate) => attribute(candidate, 'fill') === 'var(--paper)');
  assert.ok(tag !== undefined, 'the Label paints paper behind its words');
  return {
    x: Number(attribute(tag, 'x')),
    y: Number(attribute(tag, 'y')),
    width: Number(attribute(tag, 'width')),
    height: Number(attribute(tag, 'height')),
  };
}

/** Where the words of a Label sit: the middle of the paper behind them. */
function wordsCentre(svg: string): Point {
  const paper = paperOf(svg);
  return { x: paper.x + paper.width / 2, y: paper.y + paper.height / 2 };
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
