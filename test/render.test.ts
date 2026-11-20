/**
 * Seam 1: the built `ez` CLI on Scene files in temporary folders.
 *
 * Everything here is external behaviour: the files written, stdout, stderr and
 * exit codes. Nothing imports src/, so the modules behind the CLI stay free to
 * change shape.
 */
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

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
  stroke?: { width: number; style: string };
  fill?: { kind: string; grey: number };
}

interface Scene {
  version: number;
  title?: string;
  defaults?: { roughness?: number };
  elements: SceneElement[];
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
      stroke: { width: 2, style: 'dashed' },
    },
  ],
};

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function tempFolder(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'esbozo-')));
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

test('render writes the SVG beside the Scene and prints its path', async () => {
  const folder = await sceneFolder(SAMPLE_SCENE);

  const run = await ez(['render', 'scene.json'], folder);

  assert.equal(run.code, 0, run.stderr);
  const svgPath = join(folder, 'scene.svg');
  assert.equal(run.stdout.trim(), svgPath);
  const svg = await readFile(svgPath, 'utf8');
  assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /^<svg [^>]*>[\s\n]*<title>Two boxes<\/title>/);
  assert.equal(fillsOf(svg).length, 1, 'the solid-filled Element painted a fill');
  assert.deepEqual(mixesIn(svg), [38], 'the hachure-filled Element painted its lines');
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

test('a fractional coordinate rounds to a whole pixel once, for hash and drawing', async () => {
  const at40 = await renderOne(boxAt(40, 40));
  const at40point2 = await renderOne(boxAt(40.2, 40));
  const at39point9 = await renderOne(boxAt(39.9, 40));
  const at41 = await renderOne(boxAt(41, 40));

  assert.equal(at40point2, at40, 'x: 40.2 draws exactly what x: 40 draws');
  assert.equal(at39point9, at40, 'x: 39.9 draws exactly what x: 40 draws');
  assert.equal(hashOf(at40point2), hashOf(at40));

  assert.match(at40, /viewBox="24 24 152 112"/);
  assert.notEqual(at41, at40, 'a whole pixel of difference moves the drawing');
  assert.notEqual(hashOf(at41), hashOf(at40), 'and changes the hash');
});

test('the SVG takes every colour and the font from CSS variables', async () => {
  const svg = await renderOne(SAMPLE_SCENE);

  const colours = [...svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)].map((match) => match[1]);
  assert.ok(colours.length > 0, 'the SVG paints something');
  for (const colour of colours) {
    assert.ok(
      colour === 'none' || CSS_VARIABLE.test(colour ?? '') || INK_INTO_PAPER.test(colour ?? ''),
      `colour ${colour} is not a Scene CSS variable or a mix of two`,
    );
  }

  const fonts = [...svg.matchAll(/font-family="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(fonts, ['var(--font-hand)']);

  assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
  assert.doesNotMatch(svg, /\burl\(|blend-mode/i);
});

test('every fill colour is paper, ink, or a mix of only those two', async () => {
  const svg = await renderOne({ version: 1, title: 'Greys', elements: greyBoxes([0, 1, 2, 3, 4, 5, 6]) });

  const fills = fillsOf(svg);
  assert.equal(fills.length, 7, 'one solid fill per grey step');
  for (const fill of fills) {
    assert.match(fill, new RegExp(`${CSS_VARIABLE.source}|${INK_INTO_PAPER.source}`), fill);
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

test('the root SVG names itself with its own title, with no shared id', async () => {
  const first = await renderOne(SAMPLE_SCENE);
  const second = await renderOne({ ...SAMPLE_SCENE, title: 'Other boxes' });

  const root = /^<svg\b[^>]*>/.exec(first)?.[0] ?? '';
  assert.match(root, /\brole="img"/);
  assert.doesNotMatch(first, /aria-labelledby|aria-label=/, 'the name is not borrowed through a reference');

  const body = first.slice(root.length);
  assert.match(body, /^\n<title>Two boxes<\/title>/, 'the accessible name is the SVG own first child');
  assert.equal(body.match(/<title\b/g)?.length, 1);

  const ids = new Set(idsOf(first));
  for (const id of idsOf(second)) {
    assert.equal(ids.has(id), false, `both SVGs use id ${id}`);
  }
});

test('the title is escaped, so any text XML can carry survives', async () => {
  const svg = await renderOne({ version: 1, title: 'A & B <tag> "quoted" ✓', elements: [] });

  assert.match(svg, /<title>A &amp; B &lt;tag&gt; &quot;quoted&quot; ✓<\/title>/);
});

test('characters XML cannot represent are rejected in the title', async () => {
  const folder = await sceneFolder({ version: 1, title: 'bad \u0000 title', elements: [] });

  const run = await ez(['render', 'scene.json'], folder);

  assert.equal(run.code, 3);
  assert.match(run.stderr, /title must not contain characters XML cannot represent/);
  assert.equal(existsSync(join(folder, 'scene.svg')), false);
});

test('characters XML cannot represent are rejected in an Element id', async () => {
  const folder = await sceneFolder({
    version: 1,
    elements: [{ id: 'a\u0000b', type: 'rectangle', x: 10, y: 10, width: 40, height: 40 }],
  });

  const run = await ez(['render', 'scene.json'], folder);

  assert.equal(run.code, 3);
  assert.match(run.stderr, /id must not contain characters XML cannot represent/);
  assert.equal(existsSync(join(folder, 'scene.svg')), false);
});


test('the SVG carries the Scene hash and a title and no script or external reference', async () => {
  const svg = await renderOne(SAMPLE_SCENE);

  assert.match(svg, /data-scene-hash="sha256:[0-9a-f]{64}"/);
  assert.match(svg, /<title>Two boxes<\/title>/);
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
      { id: 'ellipse-a', type: 'ellipse', x: 10, y: 10, width: 40, height: 40 },
      { id: 'typo-b', type: 'rectangle', x: 10, y: 10, width: 40, height: 40, roughnes: 2 },
    ],
  });

  const run = await ez(['render', 'scene.json'], folder);

  assert.equal(run.code, 3);
  assert.match(run.stderr, /^ellipse-a: type must be one of rectangle/m);
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

test('a failed write exits 4, which no other failure uses', async () => {
  const folder = await sceneFolder(SAMPLE_SCENE);
  await mkdir(join(folder, 'scene.svg'));

  const run = await ez(['render', 'scene.json'], folder);

  assert.equal(run.code, 4, run.stderr);
  assert.match(run.stderr, /cannot write SVG .*scene\.svg/);
});

async function renderOne(scene: unknown): Promise<string> {
  const folder = await sceneFolder(scene);
  const run = await ez(['render', 'scene.json'], folder);
  assert.equal(run.code, 0, run.stderr);
  return readFile(join(folder, 'scene.svg'), 'utf8');
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

/** The ink percentage a fill colour paints: paper is 0 and ink is 100. */
function inkPercent(colour: string): number {
  if (colour === 'var(--paper)') {
    return 0;
  }
  if (colour === 'var(--ink)') {
    return 100;
  }
  const match = /^color-mix\(in srgb, var\(--ink\) (\d+)%, var\(--paper\)\)$/.exec(colour);
  assert.ok(match, `not a grey colour: ${colour}`);
  return Number(match[1]);
}

const CSS_VARIABLE = /^var\(--(?:ink|muted|paper)\)$/;
const INK_INTO_PAPER = /^color-mix\(in srgb, var\(--ink\) \d{1,3}%, var\(--paper\)\)$/;
function withSeed(scene: Scene, seed: number): Scene {
  return {
    ...scene,
    elements: scene.elements.map((element) => ({ ...element, seed })),
  };
}

function hashOf(svg: string): string {
  return /data-scene-hash="(sha256:[0-9a-f]{64})"/.exec(svg)?.[1] ?? '';
}
