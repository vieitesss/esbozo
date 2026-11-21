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
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ez, sceneFolder, tempFolder } from './cli.ts';
import type { Run } from './cli.ts';

const KITCHEN_SINK = fileURLToPath(new URL('./fixtures/every-element.json', import.meta.url));

interface Point {
  x: number;
  y: number;
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
  // check-rules: markup of a written SVG file, not the page
  assert.match(svg, /<title>Every Element type and style<\/title>/);

  // Every Element shows up as what it draws: words for a Text, ink for
  // everything else.
  const ink = allDrawnPoints(svg);
  for (const element of fixture.elements as Record<string, unknown>[]) {
    if (element.type === 'text') {
      const words = escapeXml(String(element.content).split('\n')[0]!);
      assert.ok(svg.includes(words), `${String(element.id)} draws its words`);
      continue;
    }
    const box = boxOf(element);
    assert.ok(
      ink.some((point) => withinBox(box, point, 4)),
      `${String(element.id)} leaves ink on the page`,
    );
  }
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

  const points = allDrawnPoints(svg);
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
  const points = allDrawnPoints(svg);
  for (const corner of corners) {
    assert.ok(
      points.some((point) => near(point.x, corner.x) && near(point.y, corner.y)),
      `corner at ${corner.x},${corner.y}`,
    );
  }
});

test('a Snapped end follows a round rectangle around its corner arc', async () => {
  // 160x100 box at (100,100): the corner fillet of radius 12 is centred at
  // (248,112), and the ray from the box centre through the top-right corner
  // leaves that arc at (255.59,102.75), 5.2px in from the sharp corner.
  const svg = await renderOne({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      {
        id: 'card',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 160,
        height: 100,
        corners: 'round',
        fill: { kind: 'none' },
      },
      {
        id: 'arrow',
        type: 'arrow',
        points: [
          { x: 420, y: 0 },
          { x: 420, y: 0, snap: 'card' },
        ],
        heads: { start: 'none', end: 'none' },
      },
    ],
  });

  const shaft = shaftFrom(svg, { x: 420, y: 0 });
  const end = shaft[shaft.length - 1]!;
  assert.ok(near(end.x, 255.59, 0.2), `the end is on the corner arc at x=${end.x}`);
  assert.ok(near(end.y, 102.75, 0.2), `the end is on the corner arc at y=${end.y}`);
});

test('a round diamond rounds its vertices in the SVG and in Snap', async () => {
  // 200x100 diamond at (100,100): top (200,100), right (300,150), bottom
  // (200,200), left (100,150). A 12px fillet at the sharp right vertex sits
  // 26.83px inside it, so its nearest point to that vertex is x=285.17.
  const diamond = { id: 'gem', type: 'diamond', x: 100, y: 100, width: 200, height: 100 };
  const svg = await renderOne({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      { ...diamond, corners: 'round', fill: { kind: 'none' } },
      {
        id: 'arrow',
        type: 'arrow',
        points: [
          { x: 400, y: 150 },
          { x: 400, y: 150, snap: 'gem' },
        ],
        heads: { start: 'none', end: 'none' },
      },
    ],
  });

  const shaft = shaftFrom(svg, { x: 400, y: 150 });
  const end = shaft[shaft.length - 1]!;
  assert.ok(near(end.x, 285.17, 0.2), `a Snapped end reaches the rounded vertex at x=${end.x}`);
  assert.ok(near(end.y, 150, 0.2), `on the bisector of the exported diamond at y=${end.y}`);

  // The drawing rounds the same vertices: no ink sits on a corner, and all of
  // it stays on or inside the sharp diamond.
  const rounded = await renderOne({
    version: 1,
    defaults: { roughness: 0 },
    elements: [{ ...diamond, corners: 'round', fill: { kind: 'none' } }],
  });
  const sharp = await renderOne({
    version: 1,
    defaults: { roughness: 0 },
    elements: [{ ...diamond, corners: 'sharp', fill: { kind: 'none' } }],
  });
  const corners: Point[] = [
    { x: 200, y: 100 },
    { x: 300, y: 150 },
    { x: 200, y: 200 },
    { x: 100, y: 150 },
  ];
  for (const point of allDrawnPoints(rounded)) {
    assert.ok(onOrInsideDiamond(diamond, point), `rounded ink at ${point.x},${point.y} is inside`);
  }
  for (const corner of corners) {
    assert.equal(
      allDrawnPoints(sharp).some(
        (point) => near(point.x, corner.x, 0.5) && near(point.y, corner.y, 0.5),
      ),
      true,
      `a sharp diamond draws its corner at ${corner.x},${corner.y}`,
    );
    assert.deepEqual(
      allDrawnPoints(rounded).filter(
        (point) => near(point.x, corner.x, 0.5) && near(point.y, corner.y, 0.5),
      ),
      [],
      `no rounded ink sits on the corner at ${corner.x},${corner.y}`,
    );
  }
});

test('corners on an ellipse change nothing: an ellipse has no corners', async () => {
  const ellipse = { id: 'oval', type: 'ellipse', x: 40, y: 40, width: 120, height: 80 };
  const round = await renderOne({
    version: 1,
    defaults: { roughness: 1 },
    elements: [{ ...ellipse, corners: 'round' }],
  });
  const sharp = await renderOne({
    version: 1,
    defaults: { roughness: 1 },
    elements: [{ ...ellipse, corners: 'sharp' }],
  });

  assert.equal(round.replace(/sha256:[0-9a-f]{64}/, ''), sharp.replace(/sha256:[0-9a-f]{64}/, ''));
});

test('a rough line still reaches the contact point of the outline it Snaps to', async () => {
  // Roughness 2 draws the sketchiest line Rough.js has, and its seed is the one
  // that made both strokes stop short of the contact point.
  const contact = { x: 100, y: 50 };
  const svg = await renderOne({
    version: 1,
    defaults: { roughness: 2 },
    elements: [
      {
        id: 'box',
        type: 'rectangle',
        x: 100,
        y: 0,
        width: 100,
        height: 100,
        roughness: 0,
        fill: { kind: 'none' },
      },
      {
        id: 'line',
        type: 'line',
        points: [
          { x: 0, y: 50 },
          { x: 0, y: 50, snap: 'box' },
        ],
        heads: { start: 'none', end: 'none' },
        seed: 1258386250,
        stroke: { width: 'thin', style: 'solid' },
      },
    ],
  });

  const strokes = pathTags(svg)
    .map((tag) => drawnPoints(tag.d))
    .filter((drawn) => drawn.some((point) => near(point.x, 0, 10) && near(point.y, 50, 10)));
  assert.ok(strokes.length > 0, 'the line leaves its free end');
  for (const stroke of strokes) {
    const end = stroke.reduce((furthest, point) => (point.x > furthest.x ? point : furthest));
    const gap = Math.hypot(end.x - contact.x, end.y - contact.y);
    assert.ok(gap <= 0.5, `a stroke ends ${gap.toFixed(2)}px from the contact point`);
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

    const shaft = shaftFrom(svg, from);
    const end = shaft[shaft.length - 1]!;
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
  const start = shaft[0]!;
  const end = shaft[shaft.length - 1]!;

  assert.ok(near(start.x, 140) && near(start.y, 80), 'the start sits on the rectangle edge');
  assert.ok(near(end.x, 360) && near(end.y, 80), 'the end sits on the ellipse edge');
});

test('two Snapped ends aim at each other even after one box moves past the other', async () => {
  // The boxes are now the other way round from when the arrow was drawn: the
  // left box sits at x=500 and the right one at x=300. The arrow's own points
  // still say 100 -> 300, as an editor leaves them after a drag.
  const left = { id: 'left', type: 'rectangle', x: 500, y: 0, width: 100, height: 100 };
  const right = { id: 'right', type: 'rectangle', x: 300, y: 0, width: 100, height: 100 };
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
          { x: 100, y: 50, snap: 'left' },
          { x: 300, y: 50, snap: 'right' },
        ],
        heads: { start: 'arrow', end: 'arrow' },
      },
    ],
  });

  const points = allDrawnPoints(svg);
  for (const [name, box] of [['left', left], ['right', right]] as const) {
    const inside = points.filter((point) => strictlyInside(box, point));
    assert.deepEqual(inside, [], `nothing is drawn inside the ${name} box`);
  }
  // The shaft spans the gap between the facing edges: x 500 to x 400, at the
  // height of both centres (y 50), and nowhere else.
  const shaft = pathTags(svg)
    .map((tag) => drawnPoints(tag.d))
    .find(
      (drawn) =>
        drawn.length >= 2 &&
        drawn.every((point) => near(point.y, 50, 1) && point.x >= 399 && point.x <= 501),
    );
  assert.ok(shaft, 'a shaft runs along y=50 between the facing edges');
  assert.ok(near(shaft[0]!.x, 500, 0.5), `the shaft starts on the left box at ${shaft[0]!.x}`);
  assert.ok(
    near(shaft[shaft.length - 1]!.x, 400, 0.5),
    `the shaft ends on the right box at ${shaft[shaft.length - 1]!.x}`,
  );

  // Each head has its apex on the facing edge where the shaft meets it, and its
  // base back over the gap, so it points into its box rather than away.
  for (const contact of [
    { x: 500, y: 50 },
    { x: 400, y: 50 },
  ]) {
    const head = pathTags(svg)
      .filter((tag) => tag.fill !== 'none')
      .map((tag) => drawnPoints(tag.d))
      .find((triangle) =>
        triangle.some((point) => near(point.x, contact.x) && near(point.y, contact.y)),
      );
    assert.ok(head, `a head apex sits on the contact at ${contact.x},${contact.y}`);
    for (const point of head) {
      if (near(point.x, contact.x) && near(point.y, contact.y)) {
        continue;
      }
      assert.ok(
        point.x > 400 && point.x < 500,
        `the head base at ${point.x},${point.y} reaches back over the gap`,
      );
    }
  }
});

test('a head points into its target even when the two targets overlap', async () => {
  // Two 100px boxes at x=0 and x=90: the first box's exit point (x=100) sits to
  // the right of the second box's exit point (x=90), so aiming each end at the
  // other's centre puts the two outline points the wrong way round. However
  // they are placed, an end stays on its own box's outline: neither box draws
  // its end inside the other.
  const first = { id: 'first', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 };
  const second = { id: 'second', type: 'rectangle', x: 90, y: 0, width: 100, height: 100 };
  const svg = await renderOne({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      { ...first, fill: { kind: 'none' } },
      { ...second, fill: { kind: 'none' } },
      {
        id: 'arrow',
        type: 'arrow',
        points: [
          { x: 100, y: 50, snap: 'first' },
          { x: 90, y: 50, snap: 'second' },
        ],
        heads: { start: 'none', end: 'arrow' },
      },
    ],
  });

  // The start end leaves the first box on the far side from the second (0,50),
  // so the shaft runs along +x into the second box and ends on its outline at
  // (90,50). Both ends are on their own box's outline.
  const shaft = shaftFrom(svg, { x: 0, y: 50 });
  const start = shaft[0]!;
  const end = shaft[shaft.length - 1]!;
  assert.ok(onOutline('rectangle', first, start), `the start ${start.x},${start.y} is on the first box`);
  assert.ok(onOutline('rectangle', second, end), `the end ${end.x},${end.y} is on the second box`);
  assert.ok(near(end.x, 90) && near(end.y, 50), `the end lands on the second box at ${end.x},${end.y}`);

  // Nothing at all is drawn inside the second box's outline.
  assert.deepEqual(
    allDrawnPoints(svg).filter((point) => strictlyInside(second, point)),
    [],
    'nothing is drawn inside the second box',
  );

  // The head's apex is on that outline point and its base reaches back over the
  // first box, so the head points along +x, into the second box.
  const heads = pathTags(svg)
    .filter((tag) => tag.fill !== 'none')
    .map((tag) => drawnPoints(tag.d));
  const head = heads.find((points) =>
    points.some((point) => near(point.x, 90) && near(point.y, 50)),
  );
  assert.ok(head, 'the head apex sits on the second box outline');
  for (const point of head) {
    if (near(point.x, 90) && near(point.y, 50)) {
      continue;
    }
    assert.ok(point.x < 90, `the head base at ${point.x} reaches back behind the apex`);
  }
});

test('crossing targets draw a shaft into the target, not a stub or an outward head', async () => {
  // Two bars crossing at (50,50): a horizontal one (0..100 by 40..60) and a
  // vertical one (40..60 by 0..100). Every outline point of either bar that the
  // centre line would pick sits inside the other bar, so aiming each end at the
  // other's centre cannot work: the pair has to be chosen off that line.
  const bar = { id: 'bar', type: 'rectangle', x: 0, y: 40, width: 100, height: 20 };
  const post = { id: 'post', type: 'rectangle', x: 40, y: 0, width: 20, height: 100 };
  const svg = await renderOne({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      { ...bar, fill: { kind: 'none' } },
      { ...post, fill: { kind: 'none' } },
      {
        id: 'arrow',
        type: 'arrow',
        points: [
          { x: 50, y: 50, snap: 'bar' },
          { x: 50, y: 50, snap: 'post' },
        ],
        heads: { start: 'none', end: 'arrow' },
      },
    ],
  });

  // The shaft is the first pairing that works walking the end target's outline
  // from its right-hand point: the bar's right edge to the bar's own right-hand
  // edge inside the post's, so it enters the post going left.
  const shaft = shaftFrom(svg, { x: 100, y: 50 });
  const start = shaft[0]!;
  const end = shaft[shaft.length - 1]!;
  assert.ok(onOutline('rectangle', bar, start), `the start ${start.x},${start.y} is on the bar`);
  assert.ok(onOutline('rectangle', post, end), `the end ${end.x},${end.y} is on the post`);
  assert.ok(near(start.x, 100) && near(start.y, 50), `the shaft starts at ${start.x},${start.y}`);
  assert.ok(near(end.x, 60) && near(end.y, 50), `the shaft ends at ${end.x},${end.y}`);
  assert.ok(
    Math.hypot(end.x - start.x, end.y - start.y) > 1,
    'the shaft is longer than a point',
  );

  // Nothing at all is drawn inside the post: the head stops on its outline.
  assert.deepEqual(
    allDrawnPoints(svg).filter((point) => strictlyInside(post, point)),
    [],
    'nothing is drawn inside the post',
  );

  // The head's apex is there on the outline and its base reaches back to the
  // right, behind the apex, so the head points left into the post.
  const head = pathTags(svg)
    .filter((tag) => tag.fill !== 'none')
    .map((tag) => drawnPoints(tag.d))
    .find((points) => points.some((point) => near(point.x, 60) && near(point.y, 50)));
  assert.ok(head, 'the head apex sits on the post outline');
  for (const point of head) {
    if (near(point.x, 60) && near(point.y, 50)) {
      continue;
    }
    assert.ok(point.x > 60, `the head base at ${point.x} reaches back behind the apex`);
  }
});

test('a target drawn wholly inside the other falls back to the centre line', async () => {
  // A small box inside a big one: every point of the inner outline is inside the
  // outer target, so no pair of outline points can enter it from outside. The
  // fallback is the pair on the line between the centres, head outward: it is
  // the only pair the two outlines offer, and never drawing the arrow would hide
  // the Element.
  const outer = { id: 'outer', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 };
  const inner = { id: 'inner', type: 'rectangle', x: 30, y: 30, width: 40, height: 40 };
  const svg = await renderOne({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      { ...outer, fill: { kind: 'none' } },
      { ...inner, fill: { kind: 'none' } },
      {
        id: 'arrow',
        type: 'arrow',
        points: [
          { x: 50, y: 50, snap: 'inner' },
          { x: 50, y: 50, snap: 'outer' },
        ],
        heads: { start: 'none', end: 'arrow' },
      },
    ],
  });

  const shaft = shaftFrom(svg, { x: 50, y: 30 });
  const start = shaft[0]!;
  const end = shaft[shaft.length - 1]!;
  assert.ok(onOutline('rectangle', inner, start), `the start ${start.x},${start.y} is on the inner box`);
  assert.ok(onOutline('rectangle', outer, end), `the end ${end.x},${end.y} is on the outer box`);
  assert.ok(near(start.y, 30) && near(end.y, 0), `the shaft is the centre line, ${start.y} to ${end.y}`);
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

  const heads = pathTags(svg)
    .filter((tag) => tag.fill !== 'none')
    .map((tag) => drawnPoints(tag.d));

  for (const [apexAt, other] of [
    [start, end],
    [end, start],
  ] as const) {
    const head = heads.find((points) =>
      points.some((point) => near(point.x, apexAt.x) && near(point.y, apexAt.y)),
    );
    assert.ok(head, `a head sits on ${apexAt.x},${apexAt.y}`);
    const apex = head.find((point) => near(point.x, apexAt.x) && near(point.y, apexAt.y))!;
    const along = unit(other, apexAt);
    for (const base of head) {
      if (base === apex) {
        continue;
      }
      const offset = { x: base.x - apex.x, y: base.y - apex.y };
      const behind = offset.x * along.x + offset.y * along.y;
      assert.ok(behind < -1, `the head base ${behind.toFixed(2)}px behind the apex, not in front`);
      assert.ok(behind > -40, `and still a head, ${behind.toFixed(2)}px deep`);
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

  const drawn = [
    { words: 'Small left', size: '14', anchor: 'start', fill: 'var(--ink)' },
    { words: 'Medium center', size: '18', anchor: 'middle', fill: 'var(--ink)' },
    { words: 'Large right', size: '24', anchor: 'end', fill: 'var(--ink)' },
    { words: 'Extra &amp; &lt;large&gt;', size: '32', anchor: 'start', fill: 'var(--muted)' },
  ];
  for (const { words, size, anchor, fill } of drawn) {
    const drawn = textElements(svg).find((candidate) => candidate.includes(words));
    assert.ok(drawn, `${words} is drawn`);
    assert.equal(attribute(drawn, 'font-size'), size, `${words} font size`);
    assert.equal(attribute(drawn, 'text-anchor'), anchor, `${words} alignment`);
    assert.equal(attribute(drawn, 'fill'), fill, `${words} tone`);
  }
  assert.match(svg, /second line/, 'the multi-line Text keeps its second line');
});

test('a bad value for any style field exits 3 and names the Element', async () => {
  const cases: { label: string; scene: unknown; message: RegExp }[] = [
    {
      label: 'roughness',
      scene: oneBox({ roughness: 3 }),
      message: /^a: roughness must be between 0 and 2, got 3$/m,
    },
    {
      label: 'fractional roughness',
      scene: oneBox({ roughness: 1.5 }),
      message: /^a: roughness must be an integer, got 1\.5$/m,
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
    {
      label: 'labelAt fraction',
      scene: {
        version: 1,
        elements: [
          {
            id: 'a',
            type: 'line',
            points: [
              { x: 10, y: 10 },
              { x: 100, y: 10 },
            ],
            labelAt: { t: 2, offset: 0 },
          },
        ],
      },
      message: /^a: labelAt\.t must be between 0 and 1, got 2$/m,
    },
    {
      label: 'labelAt on a box',
      scene: oneBox({ label: 'words', labelAt: { t: 0.5, offset: 0 } }),
      message: /^a: labelAt applies only to an arrow or line$/m,
    },
  ];

  for (const { label, scene, message } of cases) {
    const result = await render(scene);
    assert.equal(result.code, 3, `${label}: ${result.stderr}`);
    assert.match(result.stderr, message, label);
    assert.equal(result.svg, '', `${label} writes no SVG`);
  }
});

test('a fractional roughness in the Scene defaults is a parse problem too', async () => {
  const result = await render({ version: 1, defaults: { roughness: 1.5 }, elements: [] });

  assert.equal(result.code, 3);
  assert.match(result.stderr, /^roughness must be an integer, got 1\.5$/m);
  assert.equal(result.svg, '');
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

test('both ends Snapped to one Element exits 3 and names the arrow', async () => {
  const result = await render({
    version: 1,
    elements: [
      { id: 'box', type: 'rectangle', x: 10, y: 10, width: 80, height: 80 },
      {
        id: 'arrow',
        type: 'arrow',
        points: [
          { x: 100, y: 10, snap: 'box' },
          { x: 100, y: 90, snap: 'box' },
        ],
      },
    ],
  });

  assert.equal(result.code, 3, result.stderr);
  assert.match(result.stderr, /^arrow: both ends Snap to box$/m);
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
  // check-rules: markup of a written SVG file, not the page
  return [...svg.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((match) => match[0]);
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

/** Each `<text>` Element with its content, so a test can ask what one Text drew. */
function textElements(svg: string): string[] {
  // check-rules: markup of a written SVG file, not the page
  return [...svg.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)].map((match) => match[0]);
}

function pathTags(svg: string): { d: string; fill: string }[] {
  return tags(svg, 'path').map((tag) => ({
    d: attribute(tag, 'd') ?? '',
    fill: attribute(tag, 'fill') ?? '',
  }));
}

/** Every drawn point on the page, whatever path it belongs to. */
function allDrawnPoints(svg: string): Point[] {
  return pathTags(svg).flatMap((tag) => drawnPoints(tag.d));
}

/** A point with room to spare inside a box: a drawn boundary does not count. */
function strictlyInside(box: Box, point: Point): boolean {
  const margin = 0.5;
  return (
    point.x > box.x + margin &&
    point.x < box.x + box.width - margin &&
    point.y > box.y + margin &&
    point.y < box.y + box.height - margin
  );
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The box an Element asks for in the Scene: a container's own, an arrow's two ends. */
function boxOf(element: Record<string, unknown>): Box {
  if (element.type === 'arrow' || element.type === 'line') {
    const [start, end] = element.points as Point[];
    return {
      x: Math.min(start!.x, end!.x),
      y: Math.min(start!.y, end!.y),
      width: Math.abs(end!.x - start!.x),
      height: Math.abs(end!.y - start!.y),
    };
  }
  return {
    x: Number(element.x),
    y: Number(element.y),
    width: Number(element.width),
    height: Number(element.height),
  };
}

/** A point inside a box, with the tolerance a rough stroke needs. */
function withinBox(box: Box, point: Point, tolerance: number): boolean {
  return (
    point.x >= box.x - tolerance &&
    point.x <= box.x + box.width + tolerance &&
    point.y >= box.y - tolerance &&
    point.y <= box.y + box.height + tolerance
  );
}

/** A Scene string in the SVG, escaped the way the Renderer escapes it. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The points of the shaft that starts at `from`: with roughness 0 that start is exact. */
function shaftFrom(svg: string, from: Point): Point[] {
  const shaft = pathTags(svg)
    .map((tag) => drawnPoints(tag.d))
    .find(
      (points) => points.length > 0 && near(points[0]!.x, from.x) && near(points[0]!.y, from.y),
    );
  assert.ok(shaft, `a path starts at ${from.x},${from.y}`);
  return shaft;
}

/**
 * The points a path actually passes through, in order: the end of each Move,
 * Line, Curve and Arc, which is where the ink is. Control points and arc radii
 * are skipped, and the numbers are read on their own, so the whitespace between
 * commands and the order of the path data do not matter.
 */
function drawnPoints(d: string): Point[] {
  const points: Point[] = [];
  for (const [, command = '', args = ''] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const numbers = (args.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (command === 'A') {
      // Arc: rx ry rotation large-arc sweep x y
      points.push({ x: numbers[5]!, y: numbers[6]! });
      continue;
    }
    if (command !== 'M' && command !== 'L' && command !== 'C') {
      continue;
    }
    // Move and Line take one point; a Cubic ends on its last pair.
    const last = numbers.length - 2;
    points.push({ x: numbers[last]!, y: numbers[last + 1]! });
  }
  return points;
}

function near(actual: number, expected: number, tolerance = 0.05): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

/** On or inside the sharp diamond: the Manhattan normalised radius never passes 1. */
function onOrInsideDiamond(
  box: { x: number; y: number; width: number; height: number },
  point: Point,
): boolean {
  const a = box.width / 2;
  const b = box.height / 2;
  const dx = Math.abs(point.x - (box.x + a)) / a;
  const dy = Math.abs(point.y - (box.y + b)) / b;
  return dx + dy <= 1.001;
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

const SCENE_VARIABLE = /^var\(--(?:ink|muted|paper)\)$/;
const INK_INTO_PAPER = /^color-mix\(in srgb, var\(--ink\) \d{1,3}%, var\(--paper\)\)$/;
