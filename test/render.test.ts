/**
 * Seam 1: the built `ez` CLI on Scene files in temporary folders.
 *
 * Everything here is external behaviour: the files written, stdout, stderr and
 * exit codes. Nothing imports src/, so the modules behind the CLI stay free to
 * change shape.
 */
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const SAMPLE_SCENE = {
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
  assert.match(svg, /<title id="esbozo-title">Two boxes<\/title>/);
  assert.match(svg, /<g data-element-id="a"/);
  assert.match(svg, /<g data-element-id="b"/);
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

test('the SVG takes every colour and the font from CSS variables', async () => {
  const svg = await renderOne(SAMPLE_SCENE);

  const colours = [...svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)].map((match) => match[1]);
  assert.ok(colours.length > 0, 'the SVG paints something');
  for (const colour of colours) {
    assert.ok(
      colour === 'none' || /^var\(--(ink|muted)\)$/.test(colour ?? ''),
      `colour ${colour} is not a Scene CSS variable`,
    );
  }

  const fonts = [...svg.matchAll(/font-family="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(fonts, ['var(--font-hand)']);

  assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
});

test('the SVG carries the Scene hash and a title and no script or external reference', async () => {
  const svg = await renderOne(SAMPLE_SCENE);

  assert.match(svg, /data-scene-hash="sha256:[0-9a-f]{64}"/);
  assert.match(svg, /<title id="esbozo-title">Two boxes<\/title>/);
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

test('an empty Scene still renders a titled SVG page', async () => {
  const svg = await renderOne({ version: 1, title: 'Blank', elements: [] });

  assert.match(svg, /<title id="esbozo-title">Blank<\/title>/);
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

async function renderOne(scene: unknown): Promise<string> {
  const folder = await sceneFolder(scene);
  const run = await ez(['render', 'scene.json'], folder);
  assert.equal(run.code, 0, run.stderr);
  return readFile(join(folder, 'scene.svg'), 'utf8');
}

function hashOf(svg: string): string {
  return /data-scene-hash="(sha256:[0-9a-f]{64})"/.exec(svg)?.[1] ?? '';
}
