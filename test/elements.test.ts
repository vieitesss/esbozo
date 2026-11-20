/**
 * Seam 1: every Element type and style value, through the built `ez` CLI.
 *
 * The assertions are external behaviour only: the files written, exit codes,
 * stdout and stderr, plus the coordinates of the drawn paths where the ticket
 * asks for geometry (a Snapped end on an outline, a head pointing along an
 * arrow). Every path-number check uses a roughness-0 Scene, where Rough.js
 * draws the exact line, so the numbers are the model's own answer and not a
 * sketch. The seven-grey ladder is checked as colours: CSS variables and
 * ink-into-paper mixes, never a literal colour.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const KITCHEN_SINK = fileURLToPath(new URL('./fixtures/every-element.json', import.meta.url));

interface Point {
  x: number;
  y: number;
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function tempFolder(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'esbozo-elements-')));
}

async function sceneFolder(scene: unknown, name = 'scene.json'): Promise<string> {
  const folder = await tempFolder();
  await writeFile(join(folder, name), JSON.stringify(scene, null, 2), 'utf8');
  return folder;
}

async function ez(args: string[], cwd: string): Promise<Run> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string };
    return {
      code: typeof failed.code === 'number' ? failed.code : -1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    };
  }
}

async function render(scene: unknown): Promise<Run & { svg: string }> {
  const folder = await sceneFolder(scene);
  const result = await ez(['render', 'scene.json'], folder);
  const svg = existsSync(join(folder, 'scene.svg'))
    ? await readFile(join(folder, 'scene.svg'), 'utf8')
    : '';
  return { ...result, svg };
}

async function renderOne(scene: unknown): Promise<string> {
  const result = await render(scene);
  assert.equal(result.code, 0, result.stderr);
  return result.svg;
}

/** A Scene with one rectangle, so a test varies only the part it cares about. */
function oneBox(style: Record<string, unknown> = {}): unknown {
  return {
    version: 1,
    title: 'One box',
    defaults: { roughness: 0 },
    elements: [{ id: 'a', type: 'rectangle', x: 20, y: 20, width: 80, height: 80, ...style }],
  };
}

test('a Scene with every Element type and style value renders', async () => {
  const fixture = JSON.parse(await readFile(KITCHEN_SINK, 'utf8'));
  const svg = await renderOne(fixture);

  assert.match(svg, /data-scene-hash="sha256:[0-9a-f]{64}"/);
  assert.match(svg, /<title>Every Element type and style<\/title>/);
  assert.ok(pathTags(svg).length > 20, 'every Element left its ink on the page');
  assert.equal(tags(svg, 'text').length, 5, 'every Text is drawn as text');
});

test('the kitchen-sink SVG is byte-identical across runs', async () => {
  const folder = await tempFolder();
  const source = await readFile(KITCHEN_SINK, 'utf8');
  await writeFile(join(folder, 'scene.json'), source, 'utf8');

  assert.equal((await ez(['render', 'scene.json'], folder)).code, 0);
  const first = await readFile(join(folder, 'scene.svg'), 'utf8');
  assert.equal((await ez(['render', 'scene.json'], folder)).code, 0);
  const second = await readFile(join(folder, 'scene.svg'), 'utf8');

  assert.equal(second, first);
});

test('the kitchen sink paints only CSS variables and ink-into-paper mixes', async () => {
  const svg = await renderOne(JSON.parse(await readFile(KITCHEN_SINK, 'utf8')));

  const colours = [...svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)].map((match) => match[1]!);
  assert.ok(colours.length > 0);
  for (const colour of colours) {
    assert.ok(
      colour === 'none' || SCENE_VARIABLE.test(colour) || INK_INTO_PAPER.test(colour),
      `colour ${colour} is a Scene variable or a mix of two`,
    );
  }
  assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
});

test('an ellipse is drawn through its own extremes, not its bounding box', async () => {
  const ellipse = { id: 'oval', type: 'ellipse', x: 100, y: 100, width: 200, height: 100 };
  const svg = await renderOne({
    version: 1,
    defaults: { roughness: 0 },
    elements: [{ ...ellipse, fill: { kind: 'none' } }],
  });

  const points = pointsOf(pathTags(svg).map((tag) => tag.d).join(' '));
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));

  // Rough.js approximates the ellipse with curves, so an extreme can overshoot
  // the mathematical edge by a tenth of a pixel.
  assert.ok(near(left, 100, 0.2), `left edge at ${left}`);
  assert.ok(near(right, 300, 0.2), `right edge at ${right}`);
  assert.ok(near(top, 100, 0.2), `top edge at ${top}`);
  assert.ok(near(bottom, 200, 0.2), `bottom edge at ${bottom}`);
});

test('a diamond is drawn to its four corners', async () => {
  const diamond = { id: 'gem', type: 'diamond', x: 100, y: 100, width: 200, height: 100 };
  const svg = await renderOne({
    version: 1,
    defaults: { roughness: 0 },
    elements: [{ ...diamond, fill: { kind: 'none' } }],
  });

  const corners: Point[] = [
    { x: 200, y: 100 },
    { x: 300, y: 150 },
    { x: 200, y: 200 },
    { x: 100, y: 150 },
  ];
  const points = pointsOf(pathTags(svg).map((tag) => tag.d).join(' '));
  for (const corner of corners) {
    assert.ok(
      points.some((point) => near(point.x, corner.x) && near(point.y, corner.y)),
      `corner at ${corner.x},${corner.y}`,
    );
  }
});

const OUTLINES = {
  rectangle: { id: 'target', type: 'rectangle', x: 100, y: 100, width: 160, height: 100 },
  ellipse: { id: 'target', type: 'ellipse', x: 100, y: 100, width: 160, height: 100 },
  diamond: { id: 'target', type: 'diamond', x: 100, y: 100, width: 160, height: 100 },
};

for (const [kind, target] of Object.entries(OUTLINES)) {
  test(`a Snapped end lands on a ${kind}'s real outline`, async () => {
    const from = { x: 520, y: 420 };
    const svg = await renderOne({
      version: 1,
      defaults: { roughness: 0 },
      elements: [
        { ...target, fill: { kind: 'none' } },
        {
          id: 'arrow',
          type: 'arrow',
          points: [from, { x: from.x, y: from.y, snap: 'target' }],
          heads: { start: 'none', end: 'none' },
        },
      ],
    });

    const end = lastPoint(shaftFrom(svg, from));
    const centre = {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    };

    assert.ok(onOutline(kind, target, end), `${kind} outline holds ${end.x},${end.y}`);
    assert.ok(
      onSegment(from, centre, end),
      `the end ${end.x},${end.y} lies between the other end and the centre, pointing at it`,
    );
  });
}

test('both ends of an arrow can Snap, each to its own target', async () => {
  const left = { id: 'left', type: 'rectangle', x: 40, y: 40, width: 100, height: 80 };
  const right = { id: 'right', type: 'ellipse', x: 360, y: 40, width: 100, height: 80 };
  const svg = await renderOne({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      { ...left, fill: { kind: 'none' } },
      { ...right, fill: { kind: 'none' } },
      {
        id: 'arrow',
        type: 'arrow',
        points: [
          { x: left.x + left.width, y: 80, snap: 'left' },
          { x: right.x, y: 80, snap: 'right' },
        ],
        heads: { start: 'none', end: 'arrow' },
      },
    ],
  });

  const shaft = shaftFrom(svg, { x: 140, y: 80 });
  const points = pointsOf(shaft);
  const start = points[0]!;
  const end = points[points.length - 1]!;

  assert.ok(near(start.x, 140) && near(start.y, 80), 'the start sits on the rectangle edge');
  assert.ok(near(end.x, 360) && near(end.y, 80), 'the end sits on the ellipse edge');
});

test('arrow heads point along the arrow, into each end', async () => {
  const start = { x: 40, y: 40 };
  const end = { x: 240, y: 140 };
  const svg = await renderOne({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      {
        id: 'a',
        type: 'arrow',
        points: [start, end],
        heads: { start: 'arrow', end: 'arrow' },
        fill: { kind: 'none' },
      },
    ],
  });

  const triangles = pathTags(svg)
    .filter((tag) => tag.fill !== 'none')
    .map((tag) => pointsOf(tag.d));
  assert.equal(triangles.length, 2, 'one head at each end');

  for (const [apexAt, other] of [
    [start, end],
    [end, start],
  ] as const) {
    const triangle = triangles.find((points) =>
      points.some((point) => near(point.x, apexAt.x) && near(point.y, apexAt.y)),
    );
    assert.ok(triangle, `a head apex sits on ${apexAt.x},${apexAt.y}`);
    const apex = triangle.find(
      (point) => near(point.x, apexAt.x) && near(point.y, apexAt.y),
    )!;
    const along = unit(other, apexAt);
    for (const base of triangle) {
      if (base === apex) {
        continue;
      }
      const offset = { x: base.x - apex.x, y: base.y - apex.y };
      const behind = offset.x * along.x + offset.y * along.y;
      assert.ok(behind < -HEAD_LENGTH / 2, `the base ${behind}px behind the apex, not in front`);
    }
  }
});

test('free-standing Text renders its content, font size and alignment', async () => {
  const svg = await renderOne({
    version: 1,
    defaults: { roughness: 1 },
    elements: [
      { id: 's', type: 'text', x: 20, y: 20, content: 'Small left', fontSize: 'S' },
      {
        id: 'm',
        type: 'text',
        x: 300,
        y: 20,
        content: 'Medium center',
        fontSize: 'M',
        textAlign: 'center',
      },
      {
        id: 'l',
        type: 'text',
        x: 580,
        y: 20,
        content: 'Large right',
        fontSize: 'L',
        textAlign: 'right',
      },
      {
        id: 'xl',
        type: 'text',
        x: 20,
        y: 120,
        content: 'Extra & <large>\nsecond line',
        fontSize: 'XL',
        tone: 'muted',
      },
    ],
  });

  const text = tags(svg, 'text');
  assert.equal(text.length, 4);
  assert.deepEqual(
    text.map((tag) => attribute(tag, 'font-size')),
    ['14', '18', '24', '32'],
  );
  assert.deepEqual(
    text.map((tag) => attribute(tag, 'text-anchor')),
    ['start', 'middle', 'end', 'start'],
  );
  assert.equal(attribute(text[3]!, 'fill'), 'var(--muted)');
  assert.match(svg, /Extra &amp; &lt;large&gt;/);
  assert.equal(tags(svg, 'tspan').length, 5, 'the last Text carries its second line');
});

test('a bad value for any style field exits 3 and names the Element', async () => {
  const cases: { label: string; scene: unknown; message: RegExp }[] = [
    {
      label: 'roughness',
      scene: oneBox({ roughness: 3 }),
      message: /^a: roughness must be between 0 and 2$/m,
    },
    {
      label: 'stroke width',
      scene: oneBox({ stroke: { width: 'huge' } }),
      message: /^a: stroke\.width must be one of thin, bold, extra, got "huge"$/m,
    },
    {
      label: 'stroke style',
      scene: oneBox({ stroke: { style: 'wavy' } }),
      message: /^a: stroke\.style must be one of solid, dashed, dotted, got "wavy"$/m,
    },
    {
      label: 'fill kind',
      scene: oneBox({ fill: { kind: 'gradient' } }),
      message: /^a: fill\.kind must be one of none, solid, hachure, cross-hatch, got "gradient"$/m,
    },
    {
      label: 'fill grey',
      scene: oneBox({ fill: { kind: 'solid', grey: 7 } }),
      message: /^a: fill\.grey must be between 0 and 6, got 7$/m,
    },
    {
      label: 'tone',
      scene: oneBox({ tone: 'red' }),
      message: /^a: tone must be one of ink, muted, got "red"$/m,
    },
    {
      label: 'corners',
      scene: oneBox({ corners: 'bevel' }),
      message: /^a: corners must be one of sharp, round, got "bevel"$/m,
    },
    {
      label: 'font size',
      scene: oneBox({ fontSize: 'XXL' }),
      message: /^a: fontSize must be one of S, M, L, XL, got "XXL"$/m,
    },
    {
      label: 'text align',
      scene: oneBox({ textAlign: 'justify' }),
      message: /^a: textAlign must be one of left, center, right, got "justify"$/m,
    },
    {
      label: 'start head',
      scene: {
        version: 1,
        elements: [
          {
            id: 'a',
            type: 'arrow',
            points: [
              { x: 10, y: 10 },
              { x: 100, y: 10 },
            ],
            heads: { start: 'triangle' },
          },
        ],
      },
      message: /^a: heads\.start must be one of none, arrow, dot, bar, got "triangle"$/m,
    },
  ];

  for (const { label, scene, message } of cases) {
    const result = await render(scene);
    assert.equal(result.code, 3, `${label}: ${result.stderr}`);
    assert.match(result.stderr, message, label);
    assert.equal(result.svg, '', `${label} writes no SVG`);
  }
});

test('a Snap target that does not exist exits 3 and names the arrow', async () => {
  const result = await render({
    version: 1,
    elements: [
      { id: 'box', type: 'rectangle', x: 10, y: 10, width: 80, height: 80 },
      {
        id: 'arrow',
        type: 'arrow',
        points: [
          { x: 200, y: 200 },
          { x: 100, y: 100, snap: 'nowhere' },
        ],
      },
    ],
  });

  assert.equal(result.code, 3);
  assert.match(result.stderr, /^arrow: snap target "nowhere" does not exist$/m);
  assert.equal(result.svg, '');
});

test('a Snap target must be an Element with an outline', async () => {
  const result = await render({
    version: 1,
    elements: [
      { id: 'words', type: 'text', x: 10, y: 10, content: 'Words' },
      {
        id: 'arrow',
        type: 'arrow',
        points: [
          { x: 200, y: 200 },
          { x: 100, y: 100, snap: 'words' },
        ],
      },
    ],
  });

  assert.equal(result.code, 3);
  assert.match(
    result.stderr,
    /^arrow: snap target "words" must be a rectangle, ellipse or diamond$/m,
  );
  assert.equal(result.svg, '');
});

test('an arrow needs exactly two end points', async () => {
  for (const points of [
    [{ x: 10, y: 10 }],
    [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ],
  ]) {
    const result = await render({
      version: 1,
      elements: [{ id: 'a', type: 'arrow', points }],
    });
    assert.equal(result.code, 3);
    assert.match(result.stderr, /^a: points must be an array of exactly two end points$/m);
    assert.equal(result.svg, '');
  }
});

test('a Text without words exits 3 and names the Element', async () => {
  const result = await render({
    version: 1,
    elements: [{ id: 'words', type: 'text', x: 10, y: 10, content: '   ' }],
  });

  assert.equal(result.code, 3);
  assert.match(result.stderr, /^words: content must be a non-empty string, got "   "$/m);
  assert.equal(result.svg, '');
});

/** Every `<tag ...>` of one kind, in document order. */
function tags(svg: string, name: string): string[] {
  return [...svg.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((match) => match[0]);
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

function pathTags(svg: string): { d: string; fill: string }[] {
  return tags(svg, 'path').map((tag) => ({
    d: attribute(tag, 'd') ?? '',
    fill: attribute(tag, 'fill') ?? '',
  }));
}

/** The two-point shaft that starts at `from`: with roughness 0 its last pair is the end. */
function shaftFrom(svg: string, from: Point): string {
  const prefix = `M${format(from.x)} ${format(from.y)}`;
  const shaft = pathTags(svg).find((tag) => tag.d.startsWith(prefix));
  assert.ok(shaft, `a path starts at ${from.x},${from.y}`);
  return shaft.d;
}

function lastPoint(d: string): Point {
  const points = pointsOf(d);
  assert.ok(points.length > 0, `path data carries a point: ${d}`);
  return points[points.length - 1]!;
}

/**
 * The coordinate pairs of path data. It reads only Move, Line and Curve
 * commands, which is all a roughness-0 arrow or Element outline emits; the one
 * place a test reads path numbers, because the ticket asks for coordinates.
 */
function pointsOf(d: string): Point[] {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const points: Point[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index]!, y: numbers[index + 1]! });
  }
  return points;
}

function near(actual: number, expected: number, tolerance = 0.05): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

/** A point on the named outline, not on its bounding box. */
function onOutline(
  kind: string,
  box: { x: number; y: number; width: number; height: number },
  point: Point,
): boolean {
  const a = box.width / 2;
  const b = box.height / 2;
  const cx = box.x + a;
  const cy = box.y + b;
  if (kind === 'ellipse') {
    return near(Math.hypot((point.x - cx) / a, (point.y - cy) / b), 1, 0.005);
  }
  if (kind === 'diamond') {
    return near(Math.abs(point.x - cx) / a + Math.abs(point.y - cy) / b, 1, 0.005);
  }
  const onVertical =
    (near(point.x, box.x, 0.02) || near(point.x, box.x + box.width, 0.02)) &&
    point.y >= box.y - 0.02 &&
    point.y <= box.y + box.height + 0.02;
  const onHorizontal =
    (near(point.y, box.y, 0.02) || near(point.y, box.y + box.height, 0.02)) &&
    point.x >= box.x - 0.02 &&
    point.x <= box.x + box.width + 0.02;
  return onVertical || onHorizontal;
}

/** `point` between `from` and `to`, on the line through both. */
function onSegment(from: Point, to: Point, point: Point): boolean {
  const cross = (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
  const reach = Math.hypot(to.x - from.x, to.y - from.y);
  if (Math.abs(cross) / reach > 0.05) {
    return false;
  }
  return Math.hypot(point.x - from.x, point.y - from.y) <= reach + 0.05;
}

function unit(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return { x: dx / length, y: dy / length };
}

/** Arrow head length of a bold stroke, the one the direction test draws. */
const HEAD_LENGTH = 13;

/** Same formatting as the Renderer, so a path prefix matches. */
function format(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
}

const SCENE_VARIABLE = /^var\(--(?:ink|muted|paper)\)$/;
const INK_INTO_PAPER = /^color-mix\(in srgb, var\(--ink\) \d{1,3}%, var\(--paper\)\)$/;
