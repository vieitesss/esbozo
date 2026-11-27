/**
 * CLI seam: `ez anchor` and `ez snap` on Scene files in temporary folders.
 *
 * Everything here is external behaviour: the line on stdout, the exit code and
 * the Scene the command left on disk. `--all` promises the ink does not move, so
 * that one case also measures what `ez render` wrote.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ez, sceneFolder } from './cli.ts';
import { removeTempFolders, tempFolder } from './temp.ts';

after(removeTempFolders);

interface SceneAnchor {
  x: number;
  y: number;
}

interface ScenePoint {
  x: number;
  y: number;
  snap?: string | false;
  anchor?: SceneAnchor;
  corner?: string;
}

interface SceneMember {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  content?: string;
  points?: ScenePoint[];
}

interface Scene {
  version: number;
  title?: string;
  elements: SceneMember[];
}

/** Two boxes, the arrow between them aimed the old way (no Anchors), and a Text. */
function twoBoxes(): Scene {
  return {
    version: 1,
    title: 'Anchor CLI',
    elements: [
      { id: 'a', type: 'rectangle', x: 40, y: 40, width: 120, height: 80 },
      { id: 'b', type: 'rectangle', x: 240, y: 40, width: 100, height: 100 },
      {
        id: 'a-b',
        type: 'arrow',
        points: [
          { x: 160, y: 80, snap: 'a' },
          { x: 240, y: 90, snap: 'b' },
        ],
      },
      { id: 'note', type: 'text', x: 400, y: 300, content: 'words' },
    ],
  };
}

/** `twoBoxes` with a bent line as well, so `--all` has two shafts to walk. */
function withBentLine(scene: Scene): Scene {
  return {
    ...scene,
    elements: [
      ...scene.elements,
      {
        id: 'bend',
        type: 'line',
        points: [
          { x: 60, y: 180, snap: 'a' },
          { x: 160, y: 250 },
          { x: 240, y: 180, snap: 'b' },
        ],
      },
    ],
  };
}

/** The Scene on disk, as the command left it. */
async function stored(folder: string): Promise<Scene> {
  return JSON.parse(await readFile(join(folder, 'scene.json'), 'utf8')) as Scene;
}

/** The two ends of `a-b` as the command left them. */
async function ends(folder: string): Promise<{ start: ScenePoint; end: ScenePoint }> {
  const arrow = (await stored(folder)).elements.find((element) => element.id === 'a-b');
  assert.ok(arrow?.points !== undefined, 'a-b has no points');
  assert.equal(arrow.points.length, 2);
  return { start: arrow.points[0]!, end: arrow.points[1]! };
}

test('ez anchor writes a named place as fractions, and the spot they draw at', async () => {
  const folder = await sceneFolder(twoBoxes());

  const run = await ez(['anchor', 'scene.json', 'a-b', 'end', 'top'], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, 'a-b end: snap b, anchor {x: 0.5, y: 0}\n');
  // b is 240..340 by 40..140, so `top` is the middle of its top edge.
  assert.deepEqual((await ends(folder)).end, {
    x: 290,
    y: 40,
    snap: 'b',
    anchor: { x: 0.5, y: 0 },
  });
});

test('ez anchor takes a pair of fractions as it writes them', async () => {
  const folder = await sceneFolder(twoBoxes());

  const run = await ez(['anchor', 'scene.json', 'a-b', 'start', '1,0.25'], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, 'a-b start: snap a, anchor {x: 1, y: 0.25}\n');
  // a is 40..160 by 40..120, so `1,0.25` is its right side, a quarter down.
  assert.deepEqual((await ends(folder)).start, {
    x: 160,
    y: 60,
    snap: 'a',
    anchor: { x: 1, y: 0.25 },
  });
});

test('a corner name lands on the corner of a box', async () => {
  const folder = await sceneFolder(twoBoxes());

  const run = await ez(['anchor', 'scene.json', 'a-b', 'end', 'bottom-left'], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, 'a-b end: snap b, anchor {x: 0, y: 1}\n');
  // b's bottom-left corner is 240,140.
  assert.deepEqual((await ends(folder)).end, {
    x: 240,
    y: 140,
    snap: 'b',
    anchor: { x: 0, y: 1 },
  });
});

test('a corner name on an ellipse lands where the box corner meets its outline', async () => {
  const scene = twoBoxes();
  scene.elements.push({ id: 'oval', type: 'ellipse', x: 300, y: 270, width: 200, height: 60 });
  scene.elements.push({
    id: 'to-oval',
    type: 'arrow',
    points: [
      { x: 540, y: 420 },
      { x: 480, y: 330, snap: 'oval' },
    ],
  });
  const folder = await sceneFolder(scene);

  const run = await ez(['anchor', 'scene.json', 'to-oval', 'end', 'bottom-left'], folder);

  assert.equal(run.code, 0, run.stderr);
  // The line from the box's bottom-left corner (300,330) to its centre (400,300)
  // leaves the ellipse 1/root 2 of the way along, at (329.289, 321.213); the
  // point of the ellipse nearest that corner is elsewhere, at (310,313).
  assert.equal(run.stdout, 'to-oval end: snap oval, anchor {x: 0.146, y: 0.85}\n');
  const oval = (await stored(folder)).elements.find((element) => element.id === 'to-oval');
  assert.deepEqual(oval?.points?.[1], {
    x: 329,
    y: 321,
    snap: 'oval',
    anchor: { x: 0.146, y: 0.85 },
  });
});

test('ez anchor none drops the Anchor and lets the end aim again', async () => {
  const folder = await sceneFolder(twoBoxes());
  await ez(['anchor', 'scene.json', 'a-b', 'end', 'top'], folder);

  const run = await ez(['anchor', 'scene.json', 'a-b', 'end', 'none'], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, 'a-b end: snap b\n');
  const point = (await ends(folder)).end;
  assert.equal(point.anchor, undefined);
  assert.equal(point.snap, 'b');
});

test('ez anchor refuses what the Scene cannot hold, with ez check exit codes', async () => {
  const scene = twoBoxes();
  scene.elements.push({
    id: 'free',
    type: 'line',
    points: [
      { x: 60, y: 400 },
      { x: 200, y: 400 },
    ],
  });
  const folder = await sceneFolder(scene);

  const cases: [string[], number, RegExp][] = [
    [['anchor', 'scene.json', 'nope', 'end', 'top'], 3, /no Element "nope"/],
    [['anchor', 'scene.json', 'a', 'end', 'top'], 3, /"a" is a rectangle/],
    [['anchor', 'scene.json', 'note', 'end', 'top'], 3, /"note" is a text/],
    [['anchor', 'scene.json', 'free', 'end', 'top'], 3, /no Snap/],
    [['anchor', 'scene.json', 'a-b', 'middle', 'top'], 2, /start or end/],
    [['anchor', 'scene.json', 'a-b', 'end', 'sideways'], 2, /place/],
    [['anchor', 'scene.json', 'a-b', 'end', '0.5,x'], 2, /fraction/],
    [['anchor', 'scene.json', 'a-b', 'end', '1.5,0.5'], 3, /between 0 and 1/],
    [['anchor', 'scene.json'], 2, /usage: ez anchor/],
    [['anchor', 'scene.json', 'a-b', 'end'], 2, /usage: ez anchor/],
    [['anchor', 'scene.json', 'a-b', 'end', 'top', 'extra'], 2, /usage: ez anchor/],
  ];
  for (const [args, code, message] of cases) {
    const run = await ez(args, folder);
    assert.equal(run.code, code, `${args.join(' ')}: ${run.stderr}`);
    assert.match(run.stderr, message, args.join(' '));
  }
  // A refused command writes nothing.
  assert.deepEqual((await ends(folder)).end, { x: 240, y: 90, snap: 'b' });
});

/** Every number of every path the SVG `ez render` wrote, in the order it draws them. */
async function ink(folder: string): Promise<number[]> {
  const run = await ez(['render', 'scene.json'], folder);
  assert.equal(run.code, 0, run.stderr);
  const svg = await readFile(join(folder, 'scene.svg'), 'utf8');
  // check-rules: markup of a written SVG file, not the page
  const paths = [...svg.matchAll(/ d="([^"]+)"/g)];
  return paths.flatMap((match) =>
    // check-rules: markup of a written SVG file, not the page
    (match[1]!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number),
  );
}

/** The furthest one number of the ink moved between two renders. */
function drift(before: readonly number[], after: readonly number[]): number {
  assert.equal(after.length, before.length, 'the ink draws a different number of pieces');
  let most = 0;
  for (const [index, number] of before.entries()) {
    most = Math.max(most, Math.abs(number - after[index]!));
  }
  return most;
}

test('ez anchor --all freezes every unanchored end where it draws', async () => {
  const folder = await sceneFolder(withBentLine(twoBoxes()));
  const before = await ink(folder);

  const run = await ez(['anchor', 'scene.json', '--all'], folder);

  assert.equal(run.code, 0, run.stderr);
  const lines = run.stdout.trim().split('\n');
  assert.equal(lines.length, 4, run.stdout);
  for (const line of lines) {
    assert.match(line, /^(a-b|bend) (start|end): snap [ab], anchor \{x: [\d.]+, y: [\d.]+\}$/);
  }

  // Every end holds an Anchor now, and the ink has not moved by more than the
  // half pixel `anchorOf` rounds to.
  const after = await ink(folder);
  assert.ok(drift(before, after) <= 0.5, `the ink moved ${drift(before, after)}px`);

  const again = await ez(['anchor', 'scene.json', '--all'], folder);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.stdout, '');
});

test('ez snap attaches an end at the outline point nearest where it draws', async () => {
  const scene = twoBoxes();
  // A third box the arrow's end sits inside of, so no aiming rule could pick the
  // place the end draws at: only the outline point nearest it can.
  scene.elements.push({ id: 'c', type: 'rectangle', x: 200, y: 20, width: 100, height: 100 });
  const folder = await sceneFolder(scene);

  const run = await ez(['snap', 'scene.json', 'a-b', 'end', 'c'], folder);

  assert.equal(run.code, 0, run.stderr);
  // The end drew on b's outline at 240,87, and c's outline point nearest that is
  // 240,120: the middle of c's bottom side, well off its centre.
  assert.equal(run.stdout, 'a-b end: snap c, anchor {x: 0.4, y: 1}\n');
  assert.deepEqual((await ends(folder)).end, {
    x: 240,
    y: 120,
    snap: 'c',
    anchor: { x: 0.4, y: 1 },
  });
});

test('ez snap off turns the Snap off and drops the Anchor', async () => {
  const folder = await sceneFolder(twoBoxes());
  await ez(['anchor', 'scene.json', 'a-b', 'end', 'top'], folder);

  const run = await ez(['snap', 'scene.json', 'a-b', 'end', 'off'], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, 'a-b end: snap off\n');
  assert.deepEqual((await ends(folder)).end, { x: 290, y: 40, snap: false });
});

test('ez snap refuses a target that is not a box, and any other form it has no word for', async () => {
  const folder = await sceneFolder(twoBoxes());

  const cases: [string[], number, RegExp][] = [
    [['snap', 'scene.json', 'a-b', 'end', 'note'], 3, /"note" must be a rectangle, ellipse or diamond/],
    [['snap', 'scene.json', 'a-b', 'end', 'nope'], 3, /no Element "nope"/],
    [['snap', 'scene.json', 'a', 'end', 'b'], 3, /"a" is a rectangle/],
    [['snap', 'scene.json', 'a-b', 'middle', 'b'], 2, /start or end/],
    [['snap', 'scene.json', 'a-b', 'end'], 2, /usage: ez snap/],
    [['snap', 'scene.json', 'a-b', 'end', '--all'], 2, /usage: ez snap/],
  ];
  for (const [args, code, message] of cases) {
    const run = await ez(args, folder);
    assert.equal(run.code, code, `${args.join(' ')}: ${run.stderr}`);
    assert.match(run.stderr, message, args.join(' '));
  }
  assert.deepEqual((await ends(folder)).end, { x: 240, y: 90, snap: 'b' });
});

test('a Scene it cannot read still has the words judged first', async () => {
  const folder = await tempFolder();

  const word = await ez(['anchor', 'missing.json', 'a-b', 'middle', 'top'], folder);
  assert.equal(word.code, 2, word.stderr);
  assert.equal(word.stderr, 'an end is start or end, got "middle"\n');

  const read = await ez(['anchor', 'missing.json', 'a-b', 'end', 'top'], folder);
  assert.equal(read.code, 3, read.stderr);
  assert.match(read.stderr, /^cannot read Scene missing\.json: ENOENT/);

  const folderScene = await ez(['anchor', '.', 'a-b', 'end', 'top'], folder);
  assert.equal(folderScene.code, 3, folderScene.stderr);
  assert.equal(folderScene.stderr, 'cannot read Scene .: EISDIR: illegal operation on a directory, read\n');
});

test('ez --help names both anchor commands', async () => {
  const folder = await sceneFolder(twoBoxes());

  const run = await ez(['--help'], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /^  anchor\s+\S/m);
  assert.match(run.stdout, /^  snap\s+\S/m);
});
