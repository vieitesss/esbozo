/**
 * Seam 1: the built `ez` CLI on Scene files in temporary folders.
 *
 * Everything here is external behaviour: the files written, stdout, stderr and
 * exit codes. Nothing imports src/, so the modules behind the CLI stay free to
 * change.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ez, sceneFolder, tempFolder } from './cli.ts';
import { FONT, assertOnlyThemeColours, inkPercent, isThemeColour } from './palette.ts';
import { removeTempFolders } from './temp.ts';

after(removeTempFolders);

interface SceneElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  seed?: number;
  roughness?: number;
  tone?: string;
  stroke?: { width: string; style: string };
  fill?: { kind: string; grey: number };
}

interface Scene {
  version: number;
  title?: string;
  defaults?: { roughness?: number };
  elements: SceneElement[];
}

/** A rectangle in page pixels, as a written SVG names it. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SAMPLE_SCENE: Scene = {
  version: 1,
  title: 'Two boxes',
  defaults: { roughness: 1 },
  elements: [
    { id: 'a', type: 'rectangle', x: 40, y: 40, width: 120, height: 80 },
    {
      id: 'b',
      type: 'rectangle',
      x: 200,
      y: 60,
      width: 100,
      height: 100,
      tone: 'muted',
      fill: { kind: 'solid', grey: 4 },
      stroke: { width: 'bold', style: 'dashed' },
    },
  ],
};

test('render writes the SVG beside the Scene and prints its path', async () => {
  const folder = await sceneFolder(SAMPLE_SCENE);

  const run = await ez(['render', 'scene.json'], folder);

  assert.equal(run.code, 0, run.stderr);
  const svgPath = join(folder, 'scene.svg');
  assert.equal(run.stdout.trim(), svgPath);
  const svg = await readFile(svgPath, 'utf8');
  // check-rules: markup of a written SVG file, not the page
  assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  // check-rules: markup of a written SVG file, not the page
  assert.match(svg, /^<svg [^>]*>[\s\n]*<title>Two boxes<\/title>/);
  assert.equal(fillsOf(svg).length, 1, 'the solid-filled Element painted a fill');
  assert.deepEqual(mixesIn(svg), [], 'the Element that writes no fill painted no lines');
});

test('two runs produce byte-identical SVG', async () => {
  const folder = await sceneFolder(SAMPLE_SCENE);

  await ez(['render', 'scene.json'], folder);
  const first = await readFile(join(folder, 'scene.svg'), 'utf8');
  await ez(['render', 'scene.json'], folder);
  const second = await readFile(join(folder, 'scene.svg'), 'utf8');

  assert.equal(second, first);
  assert.ok(first.length > 0);
});

test('different Scenes give different Scene hashes', async () => {
  const first = await renderOne(SAMPLE_SCENE);
  const second = await renderOne({
    ...SAMPLE_SCENE,
    elements: [SAMPLE_SCENE.elements[0]],
  });

  assert.match(first, /data-scene-hash="sha256:[0-9a-f]{64}"/);
  assert.match(second, /data-scene-hash="sha256:[0-9a-f]{64}"/);
  assert.notEqual(hashOf(first), hashOf(second));
});

test('the Scene hash covers the seed the SVG is drawn with', async () => {
  const first = await renderOne(withSeed(SAMPLE_SCENE, 1));
  const second = await renderOne(withSeed(SAMPLE_SCENE, 2));

  assert.equal(withSeed(SAMPLE_SCENE, 1).elements[0]?.seed, 1);
  assert.notEqual(first, second, 'a different seed draws a different SVG');
  assert.notEqual(hashOf(first), hashOf(second), 'and the hash follows it');
});

test('a fractional coordinate rounds to a whole pixel once, for the hash and the SVG', async () => {
  const at40 = await renderOne(boxAt(40, 40));
  const at40point2 = await renderOne(boxAt(40.2, 40));
  const at39point9 = await renderOne(boxAt(39.9, 40));
  const at41 = await renderOne(boxAt(41, 40));

  assert.equal(at40point2, at40, 'x: 40.2 draws exactly what x: 40 draws');
  assert.equal(at39point9, at40, 'x: 39.9 draws exactly what x: 40 draws');
  assert.equal(hashOf(at40point2), hashOf(at40));

  assert.match(at40, /viewBox="24 24 152 112"/);
  assert.notEqual(at41, at40, 'a whole pixel of difference moves the SVG');
  assert.notEqual(hashOf(at41), hashOf(at40), 'and changes the hash');
});

test('the SVG takes every colour and the font from CSS variables', async () => {
  const svg = await renderOne(SAMPLE_SCENE);

  const colours = [...svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)].map((match) => match[1]);
  assert.ok(colours.length > 0, 'the SVG paints something');
  for (const colour of colours) {
    assert.ok(
      colour === 'none' || isThemeColour(colour ?? ''),
      `colour ${colour} is not a Scene CSS variable or a mix of two`,
    );
  }

  const fonts = [...svg.matchAll(/font-family="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(fonts, [FONT]);

  assertOnlyThemeColours(svg);
  assert.doesNotMatch(svg, /\burl\(|blend-mode/i);
});

test('every variable in the SVG carries the light theme as a fallback', async () => {
  const svg = await renderOne({
    version: 1,
    title: 'Every colour',
    defaults: { roughness: 0 },
    elements: [
      { id: 'paper', type: 'rectangle', x: 20, y: 20, width: 60, height: 40, fill: { kind: 'solid', grey: 0 } },
      { id: 'mid', type: 'rectangle', x: 100, y: 20, width: 60, height: 40, fill: { kind: 'solid', grey: 3 } },
      { id: 'words', type: 'text', x: 20, y: 100, content: 'hi', fontSize: 'M' },
      { id: 'quiet', type: 'text', x: 20, y: 140, content: 'hi', fontSize: 'M', tone: 'muted' },
      { id: 'shaft', type: 'line', points: [{ x: 20, y: 200 }, { x: 200, y: 200 }], label: 'on paper' },
    ],
  });

  // The editor's own light theme (`src/editor/editor.css`), spelled out so a
  // browser with no stylesheet at all draws the same drawing: ink `#1b1a17`,
  // paper `#fbf8f1`, muted the 52% srgb mix of the two (`#878580`), and Kalam
  // first in the hand's font stack.
  const fallbacks = new Map([
    ['--ink', '#1b1a17'],
    ['--paper', '#fbf8f1'],
    ['--muted', '#878580'],
    ['--font-hand', "'Kalam', 'Bradley Hand', 'Segoe Print', cursive"],
  ]);

  const used = [...svg.matchAll(/var\(([^()]*)\)/g)].map((match) => match[1] ?? '');
  assert.ok(used.length > 0, 'the SVG takes its colours from variables');
  for (const argument of used) {
    const name = argument.split(',')[0]!.trim();
    const fallback = fallbacks.get(name);
    assert.ok(fallback !== undefined, `${name} is a theme variable`);
    assert.equal(
      argument.slice(name.length + 1).trim(),
      fallback,
      `${name} falls back to the light theme's ${fallback}`,
    );
  }
  for (const name of fallbacks.keys()) {
    assert.ok(
      used.some((argument) => argument.startsWith(name)),
      `the Scene paints ${name}, so its fallback is what a standalone SVG shows`,
    );
  }

  assert.match(svg, /font-family="var\(--font-hand, 'Kalam', 'Bradley Hand', 'Segoe Print', cursive\)"/);
});

test('every fill colour is paper, ink, or a mix of only those two', async () => {
  const svg = await renderOne({ version: 1, title: 'Greys', elements: greyBoxes([0, 1, 2, 3, 4, 5, 6]) });

  const fills = fillsOf(svg);
  assert.equal(fills.length, 7, 'one solid fill per grey step');
  for (const fill of fills) {
    assert.ok(isThemeColour(fill), fill);
    assert.doesNotMatch(fill, /--(?:muted|font-hand|anything)/, fill);
  }

  const steps = fills.map(inkPercent);
  assert.deepEqual(steps, [0, 12, 24, 38, 55, 72, 100], 'grey 0 is paper, grey 6 is ink, steps in between grow');
});

test('overlapping fills stay one grey: no transparency on fills', async () => {
  const svg = await renderOne({
    version: 1,
    title: 'Overlap',
    elements: [
      { id: 'under', type: 'rectangle', x: 20, y: 20, width: 120, height: 120, fill: { kind: 'solid', grey: 2 } },
      { id: 'over', type: 'rectangle', x: 60, y: 60, width: 120, height: 120, fill: { kind: 'solid', grey: 2 } },
    ],
  });

  assert.doesNotMatch(svg, /\b(?:fill-|stroke-)?opacity\s*=/, 'an overlap cannot darken without transparency');
  const fills = fillsOf(svg);
  assert.equal(fills.length, 2);
  assert.deepEqual(new Set(fills), new Set([fills[0]]), 'both grey-2 fills are the same opaque colour');
});

test('a hachure fill paints one step more ink than the same solid grey', async () => {
  const hachured = await renderOne(oneBox({ fill: { kind: 'hachure', grey: 3 } }));
  const solidAt3 = await renderOne(oneBox({ fill: { kind: 'solid', grey: 3 } }));
  const solidAt4 = await renderOne(oneBox({ fill: { kind: 'solid', grey: 4 } }));

  assert.deepEqual(fillsOf(hachured), [], 'a hachure fill paints lines, not a wash');
  const hachureLines = mixesIn(hachured);
  assert.deepEqual(hachureLines, [inkPercent(fillsOf(solidAt4)[0]!)], 'its lines take the grey-4 mix');
  assert.deepEqual(hachureLines, [55]);
  assert.deepEqual(fillsOf(solidAt3).map(inkPercent), [38]);
});

test('the root SVG carries the Scene title as its accessible name, with no shared id', async () => {
  const first = await renderOne(SAMPLE_SCENE);
  const second = await renderOne({ ...SAMPLE_SCENE, title: 'Other boxes' });
  const escaped = await renderOne({ version: 1, title: 'A & B <tag> "quoted"', elements: [] });

  assert.match(rootTag(first), /\brole="img"/);
  assert.equal(accessibleName(first), 'Two boxes');
  assert.equal(accessibleName(second), 'Other boxes', 'each SVG names its own Scene');
  assert.equal(accessibleName(escaped), 'A & B <tag> "quoted"', 'the name is the title itself, not its markup');

  const ids = new Set(idsOf(first));
  for (const id of idsOf(second)) {
    assert.equal(ids.has(id), false, `both SVGs use id ${id}`);
  }
});

test('the title is escaped, so any text XML can carry survives', async () => {
  const svg = await renderOne({ version: 1, title: 'A & B <tag> "quoted" ✓', elements: [] });

  // check-rules: markup of a written SVG file, not the page
  assert.match(svg, /<title>A &amp; B &lt;tag&gt; &quot;quoted&quot; ✓<\/title>/);
});

test('characters XML cannot represent are rejected in the title', async () => {
  const folder = await sceneFolder({ version: 1, title: 'bad \u0000 title', elements: [] });

  const run = await ez(['render', 'scene.json'], folder);

  assert.equal(run.code, 3);
  assert.match(run.stderr, /title must not contain characters XML cannot represent/);
  assert.equal(existsSync(join(folder, 'scene.svg')), false);
});


test('an Element id is a Scene label, so XML-only characters do not matter', async () => {
  const folder = await sceneFolder({
    version: 1,
    elements: [{ id: 'a\u0000b', type: 'rectangle', x: 10, y: 10, width: 40, height: 40 }],
  });

  const run = await ez(['render', 'scene.json'], folder);

  assert.equal(run.code, 0, run.stderr);
  const svg = await readFile(join(folder, 'scene.svg'), 'utf8');
  assert.deepEqual(idsOf(svg), [], 'the id never enters the SVG');
});

test('the SVG carries the Scene hash and a title and no script or external reference', async () => {
  const svg = await renderOne(SAMPLE_SCENE);

  assert.match(svg, /data-scene-hash="sha256:[0-9a-f]{64}"/);
  // check-rules: markup of a written SVG file, not the page
  assert.match(svg, /<title>Two boxes<\/title>/);
  // check-rules: markup of a written SVG file, not the page
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, /\burl\(/i);
  assert.doesNotMatch(svg, /xlink/i);
  assert.doesNotMatch(svg, /@import|@font-face/i);
  const urls = svg.match(/https?:\/\/[^"'\s)>]+/g) ?? [];
  assert.deepEqual(urls, ['http://www.w3.org/2000/svg']);
});

test('wrong arguments exit 2 and explain the usage', async () => {
  const folder = await sceneFolder(SAMPLE_SCENE);

  for (const args of [[], ['render'], ['render', 'scene.json', 'extra.json'], ['draw', 'scene.json']]) {
    const run = await ez(args, folder);
    assert.equal(run.code, 2, `\`ez ${args.join(' ')}\``);
    assert.match(run.stderr, /usage: ez render <scene>/);
    assert.equal(existsSync(join(folder, 'scene.svg')), false);
  }
});

test('an invalid Scene exits 3 and names the Element', async () => {
  const folder = await sceneFolder({
    version: 1,
    elements: [{ id: 'box-a', type: 'rectangle', x: 10, y: 10, width: 0, height: 40 }],
  });

  const run = await ez(['render', 'scene.json'], folder);

  assert.equal(run.code, 3);
  assert.match(run.stderr, /^box-a: width must be at least 1 pixel/m);
  assert.equal(existsSync(join(folder, 'scene.svg')), false);
});

test('an invalid Scene reports every Element it cannot parse', async () => {
  const folder = await sceneFolder({
    version: 1,
    elements: [
      { id: 'star-a', type: 'star', x: 10, y: 10, width: 40, height: 40 },
      { id: 'typo-b', type: 'rectangle', x: 10, y: 10, width: 40, height: 40, roughnes: 2 },
    ],
  });

  const run = await ez(['render', 'scene.json'], folder);

  assert.equal(run.code, 3);
  assert.match(
    run.stderr,
    /^star-a: type must be one of rectangle, ellipse, diamond, arrow, line, text, got "star"/m,
  );
  assert.match(run.stderr, /^typo-b: unknown key "roughnes"/m);
});

test('unknown keys are reported once with their Scene, defaults or Element context', async () => {
  const folder = await sceneFolder({
    ...SAMPLE_SCENE,
    titel: 'Two boxes',
    defaults: { roughnes: 2 },
    elements: [{ ...SAMPLE_SCENE.elements[0], stroke: { widht: 2 }, fill: { gey: 0 } }],
  });

  const run = await ez(['render', 'scene.json'], folder);

  assert.equal(run.code, 3);
  assert.deepEqual(run.stderr.trimEnd().split('\n'), [
    'unknown key "titel"',
    'defaults: unknown key "roughnes"',
    'a: unknown key "widht"',
    'a: unknown key "gey"',
  ]);
  assert.equal(existsSync(join(folder, 'scene.svg')), false);
});

test('an empty Scene still renders a titled SVG page', async () => {
  const svg = await renderOne({ version: 1, title: 'Blank', elements: [] });

  // check-rules: markup of a written SVG file, not the page
  assert.match(svg, /<title>Blank<\/title>/);
  assert.match(svg, /viewBox="0 0 320 240"/);
});

test('a Scene that is not JSON exits 3', async () => {
  const folder = await tempFolder();
  await writeFile(join(folder, 'scene.json'), '{ not json', 'utf8');

  const run = await ez(['render', 'scene.json'], folder);

  assert.equal(run.code, 3);
  assert.match(run.stderr, /not valid JSON/);
});

test('a missing Scene exits 3', async () => {
  const folder = await tempFolder();

  const run = await ez(['render', 'nowhere.json'], folder);

  assert.equal(run.code, 3);
  assert.match(run.stderr, /cannot read Scene nowhere\.json/);
});

test('the SVG keeps everything of the Scene name but the .json suffix', async () => {
  const folder = await sceneFolder(SAMPLE_SCENE, 'a.esbozo.json');

  const run = await ez(['render', 'a.esbozo.json'], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout.trim(), join(folder, 'a.esbozo.svg'));
  assert.equal(existsSync(join(folder, 'a.esbozo.svg')), true);
  assert.equal(existsSync(join(folder, 'a.svg')), false, 'no shortened alias to overwrite');
});

test('a Scene named .esbozo renders its SVG beside it, by the same rule', async () => {
  const folder = await sceneFolder(SAMPLE_SCENE, 'flow.esbozo');

  const run = await ez(['render', 'flow.esbozo'], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout.trim(), join(folder, 'flow.svg'));
  assert.equal(existsSync(join(folder, 'flow.svg')), true);
  assert.equal(existsSync(join(folder, 'flow.esbozo.svg')), false, 'the extension is not part of the stem');
});

test('a Scene extension is read in any letter case', async () => {
  const folder = await sceneFolder(SAMPLE_SCENE, 'flow.ESBOZO');

  const run = await ez(['render', 'flow.ESBOZO'], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout.trim(), join(folder, 'flow.svg'));
});

test('a failed write exits 4, which no other failure uses', async () => {
  const folder = await sceneFolder(SAMPLE_SCENE);
  await mkdir(join(folder, 'scene.svg'));

  const run = await ez(['render', 'scene.json'], folder);

  assert.equal(run.code, 4, run.stderr);
  assert.match(run.stderr, /cannot write SVG .*scene\.svg/);
});

test('a shaft Label keeps one block, and each line reads from the edge its textAlign names', async () => {
  /** One drawing of a two-line shaft Label: the lines it draws. */
  const drawing = async (
    textAlign: string,
  ): Promise<{ lines: { x: number; y: number; anchor: string }[] }> => {
    const svg = await renderOne({
      version: 1,
      title: 'Aligned',
      defaults: { roughness: 0 },
      elements: [
        {
          id: 'a',
          type: 'line',
          points: [
            { x: 0, y: 100 },
            { x: 400, y: 100 },
          ],
          label: 'one\ntwo',
          textAlign,
        },
      ],
    });
    return { lines: textTags(svg).map(placeOf) };
  };

  const centred = await drawing('center');
  const left = await drawing('left');
  const right = await drawing('right');
  assert.equal(centred.lines.length, 2, 'a newline breaks a shaft Label into two lines');
  assert.equal(centred.lines[0]!.anchor, 'middle');
  assert.equal(centred.lines[0]!.x, 200, 'centred, as every shaft Label was before an alignment');

  // One block either way: the lines read from its left edge, or its right one,
  // and the block itself keeps the middle and the width it had, so the words
  // cover the same space whatever the alignment says.
  assert.equal(left.lines[0]!.anchor, 'start');
  assert.equal(right.lines[0]!.anchor, 'end');
  assert.equal(left.lines[0]!.x + right.lines[0]!.x, 400, 'the two edges straddle the shaft’s middle');
  assert.ok(
    left.lines[0]!.x < centred.lines[0]!.x && centred.lines[0]!.x < right.lines[0]!.x,
    'and sit either side',
  );
  for (const [index, line] of left.lines.entries()) {
    assert.equal(line.x, left.lines[0]!.x, 'every left line starts at the same edge');
    assert.equal(right.lines[index]!.x, right.lines[0]!.x, 'and every right line ends at the other');
    assert.equal(line.y, centred.lines[index]!.y, 'and every line keeps the height it had');
    assert.equal(
      centred.lines[index]!.x - line.x,
      right.lines[index]!.x - centred.lines[index]!.x,
      'the block is as wide on one edge as on the other',
    );
  }
});

test('a shaft Label with labelAt sits at the fraction and to the side it names', async () => {
  // `text-anchor="middle"` puts the text's x on the anchor itself, so the
  // fraction reads straight off the drawing: 0 is the start, 1 the end.
  assert.equal((await placedLabel([0, 100], [400, 100], { t: 0, offset: 0 })).x, 0);
  assert.equal((await placedLabel([0, 100], [400, 100], { t: 0.25, offset: 0 })).x, 100);
  assert.equal((await placedLabel([0, 100], [400, 100], { t: 1, offset: 0 })).x, 400);

  // An SVG's y grows downward, so the side that points up is negative y, and
  // the offset is signed: positive is the side the default Label sits on.
  const middle = (await placedLabel([0, 100], [400, 100], { t: 0.5, offset: 0 })).y;
  closeTo((await placedLabel([0, 100], [400, 100], { t: 0.5, offset: 40 })).y, middle - 40);
  closeTo((await placedLabel([0, 100], [400, 100], { t: 0.5, offset: -40 })).y, middle + 40);
  closeTo((await placedLabel([0, 100], [400, 100], { t: 0.5, offset: 0 })).x, 200);

  // A vertical shaft has no upper side, so its side is the left one, as it is
  // for the Label Layout places.
  assert.equal((await placedLabel([200, 0], [200, 400], { t: 0.5, offset: 10 })).x, 190);
  assert.equal((await placedLabel([200, 0], [200, 400], { t: 0.5, offset: -10 })).x, 210);
});

test('a placed Label follows the shaft Snap drew, not the point the Scene stores', async () => {
  const svg = await renderOne({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      { id: 'box', type: 'rectangle', x: 0, y: 0, width: 80, height: 80 },
      {
        id: 'a',
        type: 'arrow',
        label: 'words',
        labelAt: { t: 1, offset: 0 },
        points: [
          { x: 200, y: 40 },
          { x: 40, y: 40, snap: 'box' },
        ],
      },
    ],
  });

  // The end Snap put on the box is the point where the line from the free end
  // through the box's centre meets its outline: (80, 40).
  const words = textOf(svg);
  assert.equal(words.x, 80);
  assert.ok(words.y > 40, 'and the words straddle that end rather than sit beside it');
});

test('a shaft Label without labelAt keeps its place above the middle of the shaft', async () => {
  const words = textOf(await renderOne(lineScene([0, 100], [400, 100])));

  assert.equal(words.x, 200, 'centred on the middle of the shaft');
  assert.ok(words.y < 96, 'and clear above it, as Layout has always placed it');
});

test('a shaft Label cuts its own shaft open and paints no paper behind it', async () => {
  const bare = await renderOne(SAMPLE_SCENE);
  // check-rules: markup of a written SVG file, not the page
  assert.deepEqual(bare.match(/<rect\b/g) ?? [], [], 'nothing to knock out, nothing knocked out');

  const svg = await renderOne(lineScene([0, 100], [400, 100], { t: 0.5, offset: 0 }));
  // check-rules: markup of a written SVG file, not the page
  assert.deepEqual(svg.match(/<rect\b/g) ?? [], [], 'a Label paints no paper of its own');
  assert.doesNotMatch(svg, /NaN/, 'and cuts path data it can draw');
  assert.ok(pathsOf(svg).length >= 2, 'the shaft is cut where the words sit on it');
  textOf(svg);
});

test('a centred Label cuts a level, leaning, steep, upright and curved shaft open', async () => {
  const cases: { name: string; points: Record<string, unknown>[]; middle: { x: number; y: number } }[] = [
    { name: 'level', points: [{ x: 20, y: 200 }, { x: 380, y: 200 }], middle: { x: 200, y: 200 } },
    { name: '30°', points: [{ x: 20, y: 200 }, { x: 314, y: 30 }], middle: { x: 167, y: 115 } },
    { name: '75°', points: [{ x: 20, y: 360 }, { x: 108, y: 31 }], middle: { x: 64, y: 195.5 } },
    { name: 'upright', points: [{ x: 200, y: 20 }, { x: 200, y: 380 }], middle: { x: 200, y: 200 } },
    {
      name: 'curved',
      points: [{ x: 20, y: 200 }, { x: 200, y: 90, corner: 'round' }, { x: 380, y: 200 }],
      middle: { x: 200, y: 145 },
    },
  ];

  for (const one of cases) {
    const svg = await renderOne({
      version: 1,
      title: one.name,
      defaults: { roughness: 0 },
      elements: [
        {
          id: 'a',
          type: 'line',
          points: one.points,
          label: 'l l',
          labelAt: { t: 0.5, offset: 0 },
        },
      ],
    });
    const runs = pathsOf(svg);
    assert.ok(runs.length >= 2, `${one.name}: the shaft is cut where the words sit`);

    const ink = pathBox(svg);
    assert.ok(
      (ink.x < one.middle.x && ink.x + ink.width > one.middle.x) ||
        (ink.y < one.middle.y && ink.y + ink.height > one.middle.y),
      `${one.name}: the ink reaches either side of the words`,
    );
  }
});

test('a curve that only clips a corner of the words is cut across that corner', async () => {
  const scene = (offset: number): unknown => ({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      {
        id: 'a',
        type: 'line',
        points: [{ x: 0, y: 300 }, { x: 150, y: 80, corner: 'round' }, { x: 300, y: 300 }],
        label: 'middle',
        labelAt: { t: 0.2, offset },
      },
    ],
  });

  // 28px beside the steep part of the curve, one corner of the words reaches it
  // and nothing else does: the curve is cut across that corner alone, a short
  // chord rather than the width of the block.
  const svg = await renderOne(scene(28));
  const runs = pathsOf(svg);
  assert.ok(runs.length >= 2, 'the curve is cut where it clips the words');
  assert.doesNotMatch(svg, /NaN/);
  const before = pointsOf(runs[0]!).at(-1)!;
  const after = pointsOf(runs[1]!)[0]!;
  const corner = Math.hypot(after.x - before.x, after.y - before.y);
  assert.ok(corner > 0 && corner < 20, `the cut is a corner's width, ${corner}px`);

  // A pixel further out and the centre line misses the words altogether: the
  // corner above is the nearest the words come to the curve.
  const missed = pathsOf(await renderOne(scene(29)));
  assert.equal(missed.length, 1, 'a hair further out and the curve is not cut at all');
});

test('a leaning bold arrow splits its shaft under the labelAt the Scene wrote', async () => {
  const svg = await renderOne({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      {
        id: 'a',
        type: 'arrow',
        points: [
          { x: -252, y: -72 },
          { x: -218, y: -195 },
        ],
        stroke: { width: 'bold' },
        labelAt: { t: 0.5566, offset: 12 },
        label: 'hola',
      },
    ],
  });

  assert.ok(pathsOf(svg).length >= 3, 'the head and a shaft cut under the words');
  assert.doesNotMatch(svg, /NaN/);
});

test('a default Label leaves its shaft’s bytes alone at every angle, roughness, width, size and line count', async () => {
  // A Label placed beside its shaft never meets it: the shaft's centre line stays
  // out of the words' advance box, so the drawing has no gap to cut and every
  // path is the one the same Scene draws with no Label at all.
  const shafts: Record<string, unknown>[] = [];
  for (let angle = 0; angle < 180; angle += 5) {
    const radians = (angle * Math.PI) / 180;
    for (const label of ['a label', 'two\nlines']) {
      for (const width of ['thin', 'extra']) {
        for (const roughness of [0, 2]) {
          for (const fontSize of ['M', 'XL']) {
            shafts.push({
              id: `a${angle}-${label.length}-${width}-${roughness}-${fontSize}`,
              type: 'arrow',
              points: [
                { x: 0, y: 0 },
                {
                  x: Math.round(260 * Math.cos(radians)),
                  y: -Math.round(260 * Math.sin(radians)),
                },
              ],
              label,
              roughness,
              fontSize,
              stroke: { width },
            });
          }
        }
      }
    }
  }
  const scene = (elements: Record<string, unknown>[]): unknown => ({
    version: 1,
    title: 'Every angle',
    defaults: { roughness: 1 },
    elements,
  });
  const bare = scene(shafts.map(({ label: _label, ...rest }) => rest));

  const labelled = pathsOf(await renderOne(scene(shafts)));
  const plain = pathsOf(await renderOne(bare));
  assert.equal(labelled.length, plain.length, 'the same Elements, so the same paths');
  assert.deepEqual(labelled, plain, 'and every path is byte for byte what it is with no Label');
});

test('an arrow head’s triangle is the last ink of its own arrow', async () => {
  const arrows = headMatrix();
  const svg = await renderOne({
    version: 1,
    title: 'Heads',
    defaults: { roughness: 1 },
    elements: arrows.map((one) => one.element),
  });

  const groups = inkGroups(svg);
  assert.equal(groups.length, arrows.length, 'one group of ink per arrow');
  for (const [index, one] of arrows.entries()) {
    assertHeadIsLastInk(one, groups[index]!);
  }
  // A shaft shorter than its head is covered whole: its head is all the ink there is.
  const covered = groups.filter((group) =>
    pathsOf(group).every((tag) => attributeIn(tag, 'fill') !== 'none'),
  );
  assert.equal(covered.length, 3, 'three shafts are shorter than their heads');
});

test('a head’s cut takes ink from its own end, and no more than the head reaches', async () => {
  const arrows = turnedMatrix();
  const headed = await renderOne(turnedScene(arrows.map((one) => one.element)));
  const bare = await renderOne(turnedScene(arrows.map((one) => one.bare)));

  const groups = inkGroups(headed);
  const bareGroups = inkGroups(bare);
  assert.equal(groups.length, arrows.length, 'one group of ink per arrow');
  assert.equal(bareGroups.length, arrows.length, 'and one per arrow drawn with no head');
  for (const [index, one] of arrows.entries()) {
    assertCutIsLocal(one, groups[index]!, bareGroups[index]!);
  }
});

test('a short leg at a head still runs into its triangle', async () => {
  const arrows = shortLegMatrix();
  const svg = await renderOne(turnedScene(arrows.map((one) => one.element)));

  const groups = inkGroups(svg);
  assert.equal(groups.length, arrows.length, 'one group of ink per arrow');
  for (const [index, one] of arrows.entries()) {
    assertShaftTouches(one, groups[index]!);
  }
});

test('a start head leaves the dash phase it cut at the far end of every run', async () => {
  const shafts = phaseMatrix();
  const headed = await renderOne(turnedScene(shafts.map((one) => one.element)));
  const bare = await renderOne(turnedScene(shafts.map((one) => one.bare)));

  const groups = inkGroups(headed);
  const bareGroups = inkGroups(bare);
  assert.equal(groups.length, shafts.length, 'one group of ink per arrow');
  assert.equal(bareGroups.length, shafts.length, 'and one per arrow drawn with no head');
  for (const [index, one] of shafts.entries()) {
    const runs = dashPhases(groups[index]!);
    const plain = dashPhases(bareGroups[index]!);
    assert.equal(runs.length, plain.length, `${one.id}: the same runs of shaft ink`);
    for (const [runIndex, run] of runs.entries()) {
      const own = plain[runIndex]!;
      assert.ok(
        far(own.end, run.end) <= INK_STEP_SLACK,
        `${one.id}: run ${runIndex} ends at (${run.end.x}, ${run.end.y}), not at (${own.end.x}, ${own.end.y})`,
      );
      const moved = Math.abs(own.phase - run.phase);
      assert.ok(
        moved <= INK_STEP_SLACK,
        `${one.id}: run ${runIndex} reaches dash phase ${run.phase.toFixed(2)}, its headless own ${own.phase.toFixed(2)}, ${moved.toFixed(2)} away`,
      );
    }
  }
});

test('the same Scene renders the same bytes twice', async () => {
  const scene = lineScene([0, 100], [400, 100], { t: 0.5, offset: 0 });

  assert.equal(await renderOne(scene), await renderOne(scene));
});

async function renderOne(scene: unknown): Promise<string> {
  const folder = await sceneFolder(scene);
  const run = await ez(['render', 'scene.json'], folder);
  assert.equal(run.code, 0, run.stderr);
  return readFile(join(folder, 'scene.svg'), 'utf8');
}

/** One line with a Label, so a test can vary only where the words sit. */
function lineScene(
  started: [number, number],
  ended: [number, number],
  labelAt?: unknown,
): unknown {
  return {
    version: 1,
    title: 'One line',
    defaults: { roughness: 0 },
    elements: [
      {
        id: 'a',
        type: 'line',
        points: [
          { x: started[0], y: started[1] },
          { x: ended[0], y: ended[1] },
        ],
        label: 'words',
        ...(labelAt === undefined ? {} : { labelAt }),
      },
    ],
  };
}

/** The one line of `lineScene`, drawn, as the place its `<text>` puts the words. */
async function placedLabel(
  started: [number, number],
  ended: [number, number],
  labelAt: unknown,
): Promise<{ x: number; y: number }> {
  return textOf(await renderOne(lineScene(started, ended, labelAt)));
}

/** One `<text>` tag a drawing wrote, with the place it puts its words. */
function textOf(svg: string): { x: number; y: number; anchor: string } {
  const [tag] = textTags(svg);
  assert.ok(tag !== undefined, 'the Scene wrote its words');
  return placeOf(tag);
}

/** Every `<text>` tag a drawing wrote, in the order it wrote them. */
function textTags(svg: string): string[] {
  // check-rules: markup of a written SVG file, not the page
  return [...svg.matchAll(/<text\b[^>]*>/g)].map((found) => found[0]);
}

/** Where a `<text>` tag puts its words, and the edge it anchors them by. */
function placeOf(tag: string): { x: number; y: number; anchor: string } {
  return {
    x: attributeOf(tag, 'x'),
    y: attributeOf(tag, 'y'),
    anchor: attributeIn(tag, 'text-anchor'),
  };
}

/** Every path a drawing wrote, in the order it wrote them. */
function pathsOf(svg: string): string[] {
  // check-rules: markup of a written SVG file, not the page
  return [...svg.matchAll(/<path\b[^>]*>/g)].map((found) => found[0]);
}

/** The box every point a drawing's paths run through covers. */
function pathBox(svg: string): Box {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const tag of pathsOf(svg)) {
    for (const point of pointsOf(tag)) {
      left = Math.min(left, point.x);
      top = Math.min(top, point.y);
      right = Math.max(right, point.x);
      bottom = Math.max(bottom, point.y);
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The points one written path runs through, its curves followed a step at a time. */
function pointsOf(tag: string): { x: number; y: number }[] {
  const tokens = attributeIn(tag, 'd').match(/[MLC]|-?\d+(?:\.\d+)?/g) ?? [];
  const points: { x: number; y: number }[] = [];
  let at = { x: 0, y: 0 };
  let index = 0;
  const read = (): number => Number(tokens[index++]);
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M' || command === 'L') {
      at = { x: read(), y: read() };
      points.push(at);
      continue;
    }
    if (command !== 'C') {
      continue;
    }
    const control1 = { x: read(), y: read() };
    const control2 = { x: read(), y: read() };
    const to = { x: read(), y: read() };
    for (let step = 1; step <= 8; step += 1) {
      points.push(curveAt(at, control1, control2, to, step / 8));
    }
    at = to;
  }
  return points;
}

/** One point on a cubic curve, a `step` of the way along it. */
function curveAt(
  from: { x: number; y: number },
  control1: { x: number; y: number },
  control2: { x: number; y: number },
  to: { x: number; y: number },
  step: number,
): { x: number; y: number } {
  const rest = 1 - step;
  const before = rest * rest * rest;
  const first = 3 * rest * rest * step;
  const second = 3 * rest * step * step;
  const last = step * step * step;
  return {
    x: from.x * before + control1.x * first + control2.x * second + to.x * last,
    y: from.y * before + control1.y * first + control2.y * second + to.y * last,
  };
}

/** One attribute of a written tag, as the number the drawing put there. */
function attributeOf(tag: string, name: string): number {
  return Number(attributeIn(tag, name));
}

/** One attribute of a written tag, as the text the drawing put there. */
function attributeIn(tag: string, name: string): string {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? '';
}

/** A position the drawing rounded to two decimals: a hundredth of a pixel of slack either way. */
function closeTo(actual: number, wanted: number): void {
  assert.ok(Math.abs(actual - wanted) <= 0.02, `${actual} is not ${wanted}`);
}

interface BoxOptions {
  seed?: number;
}

/** A single rectangle Scene: geometry and seed are what most hash tests vary. */
function boxAt(x: number, y: number, options: BoxOptions = {}): Scene {
  return {
    version: 1,
    title: 'One box',
    defaults: { roughness: 1 },
    elements: [
      {
        id: 'a',
        type: 'rectangle',
        x,
        y,
        width: 120,
        height: 80,
        ...(options.seed === undefined ? {} : { seed: options.seed }),
      },
    ],
  };
}

/** One solid-filled box per grey step, left to right. */
function greyBoxes(steps: number[]): SceneElement[] {
  return steps.map((grey, index) => ({
    id: `grey-${grey}`,
    type: 'rectangle',
    x: 20 + index * 60,
    y: 20,
    width: 40,
    height: 40,
    fill: { kind: 'solid', grey },
  }));
}

/** The ink percentages of the grey mixes painted as lines, in document order. */
function mixesIn(svg: string): number[] {
  const mixes = [...svg.matchAll(/stroke="(color-mix\([^"]*\))"/g)].map((match) => inkPercent(match[1]!));
  return [...new Set(mixes)];
}

/** One box Scene, so a test can vary a single part of it. */
function oneBox(style: Partial<SceneElement> = {}): Scene {
  return {
    version: 1,
    title: 'One box',
    defaults: { roughness: 1 },
    elements: [{ id: 'a', type: 'rectangle', x: 20, y: 20, width: 80, height: 80, ...style }],
  };
}

/** Solid fills in document order: the opaque colour of each painted fill. */
function fillsOf(svg: string): string[] {
  return [...svg.matchAll(/fill="(?!none")([^"]*)"/g)].map((match) => match[1]!);
}

function idsOf(svg: string): string[] {
  return [...svg.matchAll(/\bid="([^"]*)"/g)].map((match) => match[1]!);
}

/** The root `<svg>` start tag: everything before its first child. */
function rootTag(svg: string): string {
  // check-rules: markup of a written SVG file, not the page
  return /^<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
}

/**
 * The name a viewer announces for the SVG, in the order ARIA picks it:
 * `aria-labelledby`, then `aria-label`, then the SVG's own `<title>`.
 */
function accessibleName(svg: string): string {
  const root = rootTag(svg);
  const labelledBy = /\baria-labelledby="([^"]+)"/.exec(root)?.[1];
  if (labelledBy !== undefined) {
    return labelledBy.split(/\s+/).map((id) => textOfId(svg, id)).join(' ');
  }
  const label = /\baria-label="([^"]*)"/.exec(root)?.[1];
  if (label !== undefined) {
    return decodeXml(label);
  }
  // check-rules: markup of a written SVG file, not the page
  return decodeXml(/^<svg\b[^>]*>\s*<title>([^<]*)<\/title>/.exec(svg)?.[1] ?? '');
}

function textOfId(svg: string, id: string): string {
  // check-rules: markup of a written SVG file, not the page
  const target = new RegExp(`<([a-z]+)\\b[^>]*\\bid="${id}"[^>]*>([^<]*)</\\1>`).exec(svg);
  return decodeXml(target?.[2] ?? '');
}

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeXml(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity);
}

function withSeed(scene: Scene, seed: number): Scene {
  return {
    ...scene,
    elements: scene.elements.map((element) => ({ ...element, seed })),
  };
}

function hashOf(svg: string): string {
  return /data-scene-hash="(sha256:[0-9a-f]{64})"/.exec(svg)?.[1] ?? '';
}

/** A place in a drawing, in Scene units. */
type At = { readonly x: number; readonly y: number };

/** One arrow of the head matrix: the case it names, and the Element that draws it. */
interface HeadCase {
  readonly id: string;
  readonly element: HeadArrow;
}

/** An arrow Element of the head matrix, as a Scene writes it. */
interface HeadArrow {
  readonly id: string;
  readonly type: 'arrow';
  readonly points: readonly At[];
  readonly heads: { readonly start: 'none' | 'arrow'; readonly end: 'none' | 'arrow' };
  readonly corners: 'round' | 'sharp';
  readonly stroke: { readonly width: string; readonly style: string };
  readonly roughness: number;
  readonly label?: string;
  readonly labelAt?: { readonly t: number; readonly offset: number };
}

/** What varies from one arrow of the head matrix to the next. */
interface HeadOptions {
  readonly width: string;
  readonly roughness: number;
  readonly shape: 'straight' | 'bent';
  readonly corners: 'round' | 'sharp';
  readonly style: string;
  readonly label: boolean;
  readonly short?: boolean;
  readonly both?: boolean;
}

/** Room one arrow of the head matrix has to itself: a bent shaft, a head and a Label. */
const HEAD_CELL = 220;

/** How many arrows one row of the head matrix holds. */
const HEAD_COLUMNS = 15;

/** Steps one curve of a drawing is sampled in, when its ink is read back. */
const INK_STEPS = 24;

/** Points the ink around one sample is read at: the round cap's reach, in every direction. */
const INK_DIRECTIONS = 12;

/** How far two numbers of a written drawing may drift: it rounds its own to a hundredth. */
const INK_SLACK = 0.02;

/**
 * How far two readings of the same ink may drift: each is sampled a step at a
 * time, and a run cut into two curves is sampled at other places along it.
 */
const INK_STEP_SLACK = 0.5;

/**
 * The head matrix: an arrow for every stroke width, roughness, shape, corner,
 * dash and Label a head has to hold for, then a shaft shorter than its own head
 * and one with a head at each end.
 */
function headMatrix(): HeadCase[] {
  const cases: HeadCase[] = [];
  for (const width of ['thin', 'bold', 'extra']) {
    for (const roughness of [0, 1, 2]) {
      for (const shape of ['straight', 'bent'] as const) {
        for (const corners of ['round', 'sharp'] as const) {
          for (const style of ['solid', 'dashed', 'dotted']) {
            for (const label of [false, true]) {
              cases.push(headCase(cases.length, { width, roughness, shape, corners, style, label }));
            }
          }
        }
      }
    }
  }
  for (const width of ['thin', 'bold', 'extra']) {
    for (const shorter of [true, false]) {
      cases.push(
        headCase(cases.length, {
          width,
          roughness: 2,
          shape: shorter ? 'straight' : 'bent',
          corners: 'round',
          style: 'dashed',
          label: !shorter,
          short: shorter,
          both: !shorter,
        }),
      );
    }
  }
  return cases;
}

/** One arrow of the head matrix, laid out so no two arrows overlap. */
function headCase(index: number, options: HeadOptions): HeadCase {
  const id = `head-${index}`;
  const x = (index % HEAD_COLUMNS) * HEAD_CELL + 40;
  const y = Math.floor(index / HEAD_COLUMNS) * HEAD_CELL + 40;
  // A short shaft is shorter than the longest head, so its head covers it whole.
  const points =
    options.short === true
      ? [
          { x, y },
          { x: x + 6, y },
        ]
      : options.shape === 'straight'
        ? [
            { x, y },
            { x: x + 140, y },
          ]
        : [
            { x, y },
            { x: x + 70, y },
            { x: x + 70, y: y + 130 },
          ];
  return {
    id,
    element: {
      id,
      type: 'arrow',
      points,
      heads: { start: options.both === true ? 'arrow' : 'none', end: 'arrow' },
      corners: options.corners,
      stroke: { width: options.width, style: options.style },
      roughness: options.roughness,
      ...(options.label ? { label: 'words', labelAt: { t: 0.45, offset: 0 } } : {}),
    },
  };
}

/** Every arrow's ink, in Scene order: the page wraps each Element in a group of its own. */
function inkGroups(svg: string): string[] {
  // check-rules: markup of a written SVG file, not the page
  const groups = /<g stroke-linecap="round" stroke-linejoin="round">([\s\S]*?)<\/g>/g;
  return [...svg.matchAll(groups)].map((found) => found[1]!);
}

/**
 * One arrow of the head matrix checked against what a person sees: each head's
 * tip sits on the end of its arrow, and no ink of the shaft reaches past a
 * head's base except where the head's own triangle covers it.
 */
function assertHeadIsLastInk(one: HeadCase, group: string): void {
  const shaft = pathsOf(group).filter((tag) => attributeIn(tag, 'fill') === 'none');
  const heads = pathsOf(group).filter((tag) => attributeIn(tag, 'fill') !== 'none');
  const { points, heads: kinds } = one.element;
  const allEnds: { at: 'start' | 'end'; tip: At }[] = [
    { at: 'start', tip: points[0]! },
    { at: 'end', tip: points[points.length - 1]! },
  ];
  const ends = allEnds.filter((end) => kinds[end.at] === 'arrow');
  assert.equal(heads.length, ends.length, `${one.id}: one filled triangle per arrow head`);
  if (one.element.label !== undefined) {
    // The Label reached the case it names: each stroke pass is cut in two by it.
    assert.equal(shaft.length, 4, `${one.id}: the Label cuts both passes of the shaft`);
  }

  const spare = [...heads];
  for (const end of ends) {
    const triangle = trianglesIn(spare, end.tip, one.id);
    spare.splice(spare.indexOf(triangle.tag), 1);
    const { at: apex, off } = nearestOf(triangle.corners, end.tip);
    assert.ok(off <= INK_SLACK, `${one.id}: the ${end.at} head’s tip is ${off.toFixed(2)} off its end`);
    assertShaftStops(one, end, triangle.corners, apex, shaft);
  }
}

/**
 * The head path that belongs to one end of a shaft: of the heads still unread,
 * the one with a corner nearest that end. The page draws each head over its own
 * end, so the tip of that head is the one that end owns.
 */
function trianglesIn(
  tags: readonly string[],
  tip: At,
  id: string,
): { tag: string; corners: At[] } {
  let best: { tag: string; corners: At[]; off: number } | null = null;
  for (const tag of tags) {
    const corners = flatPoints(tag);
    assert.equal(corners.length, 3, `${id}: the head fills a triangle`);
    const { off } = nearestOf(corners, tip);
    if (best === null || off < best.off) {
      best = { tag, corners, off };
    }
  }
  assert.ok(best !== null, `${id}: the drawing has a head for every arrow head`);
  return best;
}

/** The corners of one written path, a move and a line at a time. */
function flatPoints(tag: string): At[] {
  const tokens = attributeIn(tag, 'd').match(/[MLC]|-?\d+(?:\.\d+)?/g) ?? [];
  const corners: At[] = [];
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M' || command === 'L') {
      corners.push({ x: Number(tokens[index++]), y: Number(tokens[index++]) });
      continue;
    }
    index += 6;
  }
  return corners;
}

/** The shaft's ink, checked against one head: nothing of it may lie past the base but under the triangle. */
function assertShaftStops(
  one: HeadCase,
  end: { at: 'start' | 'end'; tip: At },
  triangle: readonly At[],
  apex: At,
  shaft: readonly string[],
): void {
  const base = middleOf(triangle.filter((corner) => corner !== apex));
  const away = towards(apex, base);
  for (const tag of shaft) {
    const radius = attributeOf(tag, 'stroke-width') / 2;
    for (const run of inkRuns(tag)) {
      for (const sample of run) {
        for (const ink of inkAround(sample, radius)) {
          // Behind the base is the shaft's own side of the head, and no concern of it.
          if ((ink.x - base.x) * away.x + (ink.y - base.y) * away.y >= 0) {
            continue;
          }
          assert.ok(
            covers(triangle, ink),
            `${one.id}: the shaft inks (${ink.x.toFixed(2)}, ${ink.y.toFixed(2)}) past the ${end.at} head’s base, outside its triangle`,
          );
        }
      }
    }
  }
}

/** Every run of one written path, sampled a step at a time: the stroke it draws. */
function inkRuns(tag: string): At[][] {
  const tokens = attributeIn(tag, 'd').match(/[MLC]|-?\d+(?:\.\d+)?/g) ?? [];
  const runs: At[][] = [];
  let at = { x: 0, y: 0 };
  let index = 0;
  const read = (): number => Number(tokens[index++]);
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') {
      at = { x: read(), y: read() };
      runs.push([at]);
      continue;
    }
    const run = runs[runs.length - 1]!;
    if (command === 'L') {
      at = { x: read(), y: read() };
      run.push(at);
      continue;
    }
    if (command !== 'C') {
      continue;
    }
    const control1 = { x: read(), y: read() };
    const control2 = { x: read(), y: read() };
    const to = { x: read(), y: read() };
    for (let step = 1; step <= INK_STEPS; step += 1) {
      run.push(curveAt(at, control1, control2, to, step / INK_STEPS));
    }
    at = to;
  }
  return runs;
}

/** The ink one sample of a stroke covers: a round cap's reach around it, in every direction. */
function inkAround(sample: At, radius: number): At[] {
  const ink = [sample];
  for (let step = 0; step < INK_DIRECTIONS; step += 1) {
    const angle = (step / INK_DIRECTIONS) * 2 * Math.PI;
    ink.push({
      x: sample.x + radius * Math.cos(angle),
      y: sample.y + radius * Math.sin(angle),
    });
  }
  return ink;
}

/** Whether a triangle covers a point, its own edges included. */
function covers(triangle: readonly At[], point: At): boolean {
  const [a, b, c] = triangle as [At, At, At];
  const sides = [
    turn(a, b, point),
    turn(b, c, point),
    turn(c, a, point),
  ];
  const outside = sides.some((side) => side < -INK_SLACK);
  const inside = sides.some((side) => side > INK_SLACK);
  return !(outside && inside);
}

/** Which side of the line from `from` to `to` a point falls on. */
function turn(from: At, to: At, point: At): number {
  return (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
}

/** The point of `points` nearest `target`, and how far off it is. */
function nearestOf(points: readonly At[], target: At): { at: At; off: number } {
  let at = points[0]!;
  let off = far(at, target);
  for (const point of points) {
    const distance = far(point, target);
    if (distance < off) {
      at = point;
      off = distance;
    }
  }
  return { at, off };
}

/** How far apart two places are. */
function far(from: At, to: At): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** The place between two places. */
function middleOf(points: readonly At[]): At {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

/** The step from one place towards another, one unit long. */
function towards(from: At, to: At): At {
  const length = far(from, to) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/**
 * The legs of the shapes whose cut was wrong: a short leg at one end that turns
 * under the head, a staircase whose last leg is short, and a hairpin a Label
 * splits in two. Each is laid out from its own top-left corner, in Scene units.
 */
const TURNED_LEGS = {
  shortLastLeg: [
    [0, 0],
    [0, 200],
    [5, 200],
  ],
  shortFirstLeg: [
    [0, 0],
    [5, 0],
    [5, 200],
  ],
  stairs: [
    [0, 0],
    [100, 0],
    [100, 100],
    [105, 100],
  ],
  hairpin: [
    [0, 0],
    [400, 0],
    [400, 100],
    [200, 100],
  ],
} as const;

/** Room one arrow of the turned matrix has to itself: the widest shape, a head and a Label. */
const TURN_CELL = 460;

/** How many arrows one row of the turned matrix holds. */
const TURN_COLUMNS = 4;

/** What varies from one arrow of the turned matrix to the next. */
interface TurnedOptions {
  readonly shape: keyof typeof TURNED_LEGS;
  readonly at: 'start' | 'end';
  readonly corners: 'round' | 'sharp';
  readonly roughness: number;
  readonly label: boolean;
}

/** One arrow of the turned matrix: the head it puts on which end, and the same arrow with no head. */
interface TurnedCase {
  readonly id: string;
  readonly at: 'start' | 'end';
  readonly element: HeadArrow;
  readonly bare: HeadArrow;
}

/** One Scene of the turned matrix, so the arrows never share a cell. */
function turnedScene(elements: readonly HeadArrow[]): unknown {
  return { version: 1, title: 'Turned', defaults: { roughness: 0 }, elements };
}

/**
 * The turned matrix: every leg shape with the head at either end, sharp and
 * round, at roughness 0 and 2, with and without a Label — beside the same arrow
 * drawn with no head at all, which is what its cut is measured against.
 */
function turnedMatrix(): TurnedCase[] {
  const cases: TurnedCase[] = [];
  const shapes = Object.keys(TURNED_LEGS) as (keyof typeof TURNED_LEGS)[];
  for (const shape of shapes) {
    for (const at of ['start', 'end'] as const) {
      for (const corners of ['round', 'sharp'] as const) {
        for (const roughness of [0, 2]) {
          for (const label of [false, true]) {
            cases.push(turnedCase(cases.length, { shape, at, corners, roughness, label }));
          }
        }
      }
    }
  }
  return cases;
}

/** One arrow of the turned matrix, laid out so no two arrows overlap. */
function turnedCase(index: number, options: TurnedOptions): TurnedCase {
  const id = `turned-${index}`;
  const x = (index % TURN_COLUMNS) * TURN_CELL + 40;
  const y = Math.floor(index / TURN_COLUMNS) * TURN_CELL + 40;
  const points = TURNED_LEGS[options.shape].map(([dx, dy]) => ({ x: x + dx, y: y + dy }));
  const shared = {
    id,
    type: 'arrow' as const,
    points,
    corners: options.corners,
    // A bold stroke at its whole width, so the round cap is wide enough to show.
    stroke: { width: 'bold', style: 'solid' },
    roughness: options.roughness,
    // The words sit midway along the shaft, so the Label cuts between the two
    // ends of every shape and never inside a head's own reach.
    ...(options.label ? { label: 'words', labelAt: { t: 0.5, offset: 0 } } : {}),
  };
  return {
    id,
    at: options.at,
    element: {
      ...shared,
      heads:
        options.at === 'start'
          ? { start: 'arrow', end: 'none' }
          : { start: 'none', end: 'arrow' },
    },
    bare: { ...shared, heads: { start: 'none', end: 'none' } },
  };
}

/**
 * One arrow of the turned matrix checked against the same arrow drawn with no
 * head: every run of shaft ink farther in from the head's own end than that head
 * reaches is the ink the headless arrow draws, the cut takes no more off any
 * run than the head reaches, and the shaft still reaches under the head, so the
 * two meet rather than leaving a gap.
 */
function assertCutIsLocal(one: TurnedCase, group: string, bare: string): void {
  const head = pathsOf(group).find((tag) => attributeIn(tag, 'fill') !== 'none');
  assert.ok(head !== undefined, `${one.id}: the arrow draws its head`);
  const corners = flatPoints(head);
  assert.equal(corners.length, 3, `${one.id}: the head fills a triangle`);
  const tip = one.element.points[one.at === 'start' ? 0 : one.element.points.length - 1]!;
  const apex = nearestOf(corners, tip).at;
  const reach = far(apex, middleOf(corners.filter((corner) => corner !== apex)));

  const headed = shaftRuns(group);
  const headless = shaftRuns(bare);
  assert.equal(headed.length, headless.length, `${one.id}: the same runs of shaft ink`);
  let lost = 0;
  for (const [index, run] of headed.entries()) {
    const whole = headless[index]!;
    const cut = runLength(whole) - runLength(run);
    lost += cut;
    assert.ok(cut >= -INK_SLACK, `${one.id}: run ${index} draws no more ink than the headless arrow`);
    const kept = runBeyond(run, Math.max(0, reach - cut), one.at);
    const wanted = runBeyond(whole, reach, one.at);
    assert.ok(
      Math.abs(kept - wanted) <= INK_STEP_SLACK,
      `${one.id}: run ${index} keeps ${kept.toFixed(2)} of the ${wanted.toFixed(2)} units of ink ${reach.toFixed(2)} in from the ${one.at}, the headless arrow’s own`,
    );
  }
  assert.ok(
    lost <= headed.length * reach + INK_SLACK * 2,
    `${one.id}: the cut took ${lost.toFixed(2)} units, more than ${headed.length} runs of ${reach.toFixed(2)} the head reaches`,
  );

  const nearest = nearestOf(headed.flat(), apex);
  assert.ok(
    covers(corners, nearest.at),
    `${one.id}: the shaft’s ink at (${nearest.at.x}, ${nearest.at.y}) is outside the head, a gap beside the ${one.at}`,
  );
}

/** Every run of shaft ink a drawing wrote, in the order it wrote them. */
function shaftRuns(svg: string): At[][] {
  return pathsOf(svg)
    .filter((tag) => attributeIn(tag, 'fill') === 'none')
    .flatMap((tag) => inkRuns(tag));
}

/** How long the ink one run draws, a step at a time. */
function runLength(run: readonly At[]): number {
  let length = 0;
  for (let index = 1; index < run.length; index += 1) {
    length += far(run[index - 1]!, run[index]!);
  }
  return length;
}

/** How much of one run's ink lies farther in than `arc`, from the end the head sits at. */
function runBeyond(run: readonly At[], arc: number, at: 'start' | 'end'): number {
  const forward = at === 'start' ? [...run] : [...run].reverse();
  let walked = 0;
  let beyond = 0;
  for (let index = 1; index < forward.length; index += 1) {
    const step = far(forward[index - 1]!, forward[index]!);
    if (walked + step <= arc) {
      walked += step;
      continue;
    }
    beyond += walked + step - Math.max(arc, walked);
    walked += step;
  }
  return beyond;
}

/**
 * Legs shorter than the head that covers them: the leg turns away before a
 * stroke's whole width is ever under the triangle, so the cut has to stop where
 * the ink still runs into the triangle rather than take the head's whole reach.
 */
const SHORT_LEGS = [1, 3, 5, 8] as const;

/** Room one arrow of the short-leg matrix has to itself: a turned 120-unit leg and a head. */
const SHORT_CELL = 200;

/** How many arrows one row of the short-leg matrix holds. */
const SHORT_COLUMNS = 8;

/** What varies from one arrow of the short-leg matrix to the next. */
interface ShortOptions {
  readonly leg: number;
  readonly width: string;
  readonly at: 'start' | 'end';
  readonly corners: 'round' | 'sharp';
  readonly roughness: number;
}

/** One arrow of the short-leg matrix: a leg that turns under a head. */
interface ShortCase {
  readonly id: string;
  readonly at: 'start' | 'end';
  readonly element: HeadArrow;
}

/** Every short leg, at every width, on either end, sharp and round, flat and rough. */
function shortLegMatrix(): ShortCase[] {
  const cases: ShortCase[] = [];
  for (const leg of SHORT_LEGS) {
    for (const width of ['thin', 'bold', 'extra']) {
      for (const at of ['start', 'end'] as const) {
        for (const corners of ['round', 'sharp'] as const) {
          for (const roughness of [0, 2]) {
            cases.push(shortLegCase(cases.length, { leg, width, at, corners, roughness }));
          }
        }
      }
    }
  }
  return cases;
}

/** One arrow of the short-leg matrix: a leg that turns under a head. */
function shortLegCase(index: number, options: ShortOptions): ShortCase {
  const id = `short-${index}`;
  const x = (index % SHORT_COLUMNS) * SHORT_CELL + 60;
  const y = Math.floor(index / SHORT_COLUMNS) * SHORT_CELL + 60;
  const bend = { x: x - options.leg, y };
  const tail = { x: bend.x, y: bend.y + 120 };
  const points = options.at === 'end' ? [tail, bend, { x, y }] : [{ x, y }, bend, tail];
  return {
    id,
    at: options.at,
    element: {
      id,
      type: 'arrow',
      points,
      corners: options.corners,
      stroke: { width: options.width, style: 'solid' },
      roughness: options.roughness,
      heads:
        options.at === 'start'
          ? { start: 'arrow', end: 'none' }
          : { start: 'none', end: 'arrow' },
    },
  };
}

/**
 * One arrow of the short-leg matrix, checked against what a person sees: the ink
 * of its shaft runs into its head, so the two meet rather than leaving a gap.
 * The stroke's own width counts, since that ink is what touches the head.
 */
function assertShaftTouches(one: ShortCase, group: string): void {
  const head = pathsOf(group).find((tag) => attributeIn(tag, 'fill') !== 'none');
  assert.ok(head !== undefined, `${one.id}: the arrow draws its head`);
  const corners = flatPoints(head);
  assert.equal(corners.length, 3, `${one.id}: the head fills a triangle`);
  const touching = pathsOf(group)
    .filter((tag) => attributeIn(tag, 'fill') === 'none')
    .some((tag) => {
      const radius = attributeOf(tag, 'stroke-width') / 2;
      return inkRuns(tag).some((run) =>
        run.some((sample) => inkAround(sample, radius).some((ink) => covers(corners, ink))),
      );
    });
  assert.ok(touching, `${one.id}: the shaft’s ink touches the ${one.at} head`);
}

/** Room one dashed shaft of the phase matrix has to itself: its 280 units and a Label. */
const PHASE_CELL = 420;

/** How many dashed shafts one row of the phase matrix holds. */
const PHASE_COLUMNS = 4;

/** What varies from one dashed shaft with a start head to the next. */
interface PhaseOptions {
  readonly width: string;
  readonly rise: number;
  readonly roughness: number;
  readonly label: boolean;
}

/**
 * The phase matrix: a dashed shaft with a head on its start — curved by its round
 * corners and roughened — beside the same shaft with no head at all, which is
 * the dash pattern its head must leave alone.
 */
function phaseMatrix(): TurnedCase[] {
  const cases: TurnedCase[] = [];
  for (const width of ['thin', 'bold', 'extra']) {
    for (const rise of [40, 160]) {
      for (const roughness of [0, 2]) {
        for (const label of [false, true]) {
          cases.push(phaseCase(cases.length, { width, rise, roughness, label }));
        }
      }
    }
  }
  return cases;
}

/** One dashed shaft of the phase matrix, laid out so no two shafts overlap. */
function phaseCase(index: number, options: PhaseOptions): TurnedCase {
  const id = `phase-${index}`;
  const x = (index % PHASE_COLUMNS) * PHASE_CELL + 60;
  const y = Math.floor(index / PHASE_COLUMNS) * PHASE_CELL + 80;
  const shared = {
    id,
    type: 'arrow' as const,
    corners: 'round' as const,
    roughness: options.roughness,
    stroke: { width: options.width, style: 'dashed' },
    points: [
      { x, y },
      { x: x + 40, y: y + options.rise },
      { x: x + 280, y },
    ],
    ...(options.label ? { label: 'words', labelAt: { t: 0.5, offset: 0 } } : {}),
  };
  return {
    id,
    at: 'start',
    element: { ...shared, heads: { start: 'arrow', end: 'none' } },
    bare: { ...shared, heads: { start: 'none', end: 'none' } },
  };
}

/**
 * Every run of a dashed drawing, and the dash phase it reaches at its far end:
 * the offset the run starts at plus the arc of ink it draws. A headless shaft
 * writes both of its passes as one path, so the runs are the path's subpaths.
 */
function dashPhases(group: string): { end: At; phase: number }[] {
  return pathsOf(group)
    .filter((tag) => attributeIn(tag, 'fill') === 'none')
    .flatMap((tag) => {
      const offset = attributeOf(tag, 'stroke-dashoffset');
      return inkRuns(tag).map((run) => ({
        end: run[run.length - 1]!,
        phase: offset + runLength(run),
      }));
    });
}
