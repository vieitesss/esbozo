/**
 * Seam 1: `ez png` on Scene files in temporary folders.
 *
 * Everything here is external behaviour: the files written, stdout, stderr and
 * exit codes. Nothing imports src/. PNGs are read straight from the bytes:
 * the IHDR chunk gives the page size, and IDAT is inflated and unfiltered with
 * node:zlib so a single pixel can be sampled.
 */
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { inflateSync } from 'node:zlib';
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

/**
 * The page the Renderer lays out for SAMPLE_SCENE: the Elements span
 * (40, 40) to (300, 160), plus 16 px of padding, on whole pixels:
 * 316 - 24 = 292 wide and 176 - 24 = 152 tall.
 */
const PAGE = { width: 292, height: 152 };

/** Built-in paper colours, from sb's Excalidraw converter. */
const LIGHT_PAPER = [0xff, 0xff, 0xf8];
const DARK_PAPER = [0x1a, 0x1a, 0x1a];

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function tempFolder(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'esbozo-png-')));
}

async function sceneFolder(scene: unknown = SAMPLE_SCENE, name = 'scene.json'): Promise<string> {
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

interface Png {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  /** The pixel at (x, y) as [red, green, blue, alpha]. */
  pixel(x: number, y: number): [number, number, number, number];
}

/**
 * Reads a PNG with no dependency: IHDR for the header, IDAT for the pixels.
 * resvg writes 8-bit RGBA, so one scanline is `width * 4` bytes behind one
 * filter byte; the five PNG filters are undone here.
 */
function readPng(bytes: Buffer): Png {
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'not a PNG',
  );

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat: Buffer[] = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colourType = data[9] ?? 0;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  assert.equal(bitDepth, 8, 'expected an 8-bit PNG');
  assert.ok(colourType === 6 || colourType === 2, `unexpected PNG colour type ${colourType}`);

  const bytesPerPixel = colourType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bytesPerPixel ? (row[i - bytesPerPixel] ?? 0) : 0;
      const up = above?.[i] ?? 0;
      const upLeft = above !== null && i >= bytesPerPixel ? (above[i - bytesPerPixel] ?? 0) : 0;
      const value = line[i] ?? 0;
      switch (filter) {
        case 0:
          row[i] = value;
          break;
        case 1:
          row[i] = (value + left) & 0xff;
          break;
        case 2:
          row[i] = (value + up) & 0xff;
          break;
        case 3:
          row[i] = (value + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          row[i] = (value + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
    }
  }

  return {
    width,
    height,
    bitDepth,
    colourType,
    pixel(x: number, y: number): [number, number, number, number] {
      const at = y * stride + x * bytesPerPixel;
      return [
        pixels[at] ?? 0,
        pixels[at + 1] ?? 0,
        pixels[at + 2] ?? 0,
        bytesPerPixel === 4 ? (pixels[at + 3] ?? 0) : 255,
      ];
    },
  };
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) {
    return left;
  }
  return toUp <= toUpLeft ? up : upLeft;
}

async function pngOne(args: string[], folder: string): Promise<{ run: Run; png: Png; path: string }> {
  const run = await ez(args, folder);
  assert.equal(run.code, 0, run.stderr);
  const path = run.stdout.trim();
  return { run, path, png: readPng(await readFile(path)) };
}

/** Pixels matching a predicate, as a list of [x, y, rgba]. */
function findPixels(png: Png, wanted: (rgba: [number, number, number, number]) => boolean): [number, number][] {
  const found: [number, number][] = [];
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (wanted(png.pixel(x, y))) {
        found.push([x, y]);
      }
    }
  }
  return found;
}

const isRed = ([r, g, b]: [number, number, number, number]): boolean => r > 200 && g < 100 && b < 100;
const isGreen = ([r, g, b]: [number, number, number, number]): boolean => g > 200 && r < 100 && b < 100;

test('png --theme light writes a PNG beside the Scene and prints its path', async () => {
  const folder = await sceneFolder();

  const { run, png, path } = await pngOne(['png', 'scene.json', '--theme', 'light'], folder);

  assert.equal(path, join(folder, 'scene.light.png'));
  assert.equal(run.stderr, '');
  assert.equal(png.width, PAGE.width);
  assert.equal(png.height, PAGE.height);
});

test('png --theme dark writes its own PNG beside the Scene', async () => {
  const folder = await sceneFolder();

  const { png } = await pngOne(['png', 'scene.json', '--theme', 'dark'], folder);

  assert.equal(existsSync(join(folder, 'scene.dark.png')), true);
  assert.equal(png.width, PAGE.width);
  assert.equal(png.height, PAGE.height);
});

test('the paper colour is painted under the drawing, light or dark', async () => {
  const folder = await sceneFolder();

  const light = await pngOne(['png', 'scene.json', '--theme', 'light'], folder);
  const dark = await pngOne(['png', 'scene.json', '--theme', 'dark'], folder);

  assert.deepEqual(light.png.pixel(0, 0), [...LIGHT_PAPER, 255]);
  assert.deepEqual(dark.png.pixel(0, 0), [...DARK_PAPER, 255]);
});

test('explicit --ink, --paper and --muted colours reach the PNG', async () => {
  const folder = await sceneFolder();

  const { png } = await pngOne(
    ['png', 'scene.json', '--theme', 'light', '--ink', '#ff0000', '--paper', '#ffffff', '--muted', '#00ff00'],
    folder,
  );

  assert.deepEqual(png.pixel(0, 0), [255, 255, 255, 255]);
  assert.ok(findPixels(png, isRed).length > 0, 'the ink outline is red');
  assert.ok(findPixels(png, isGreen).length > 0, 'the muted outline is green');
});

test('a grey fill resolves to ink mixed into paper, with no CSS left to read', async () => {
  const folder = await sceneFolder({
    version: 1,
    elements: [
      { id: 'paper-grey', type: 'rectangle', x: 20, y: 20, width: 160, height: 120, fill: { kind: 'solid', grey: 0 } },
      { id: 'ink-grey', type: 'rectangle', x: 220, y: 20, width: 160, height: 120, fill: { kind: 'solid', grey: 6 } },
    ],
  });

  const { png } = await pngOne(['png', 'scene.json', '--theme', 'light'], folder);

  // Grey 0 is bare paper and grey 6 is solid ink, whatever the Renderer uses to
  // say so: an ink-at-opacity wash or a mix() of ink into paper.
  assert.deepEqual(png.pixel(100, 80), [...LIGHT_PAPER, 255]);
  assert.deepEqual(png.pixel(300, 80), [0x1a, 0x1a, 0x1a, 255]);
});

test('--css supplies the colours of each theme', async () => {
  const folder = await sceneFolder();
  await writeFile(
    join(folder, 'site.css'),
    [
      '/* the site */',
      ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; --font-hand: "Kalam", cursive; }',
      '@media (prefers-color-scheme: dark) {',
      '  :root { --ink: #e8e8e8; --paper: #101010; --muted: #909090; }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  const light = await pngOne(['png', 'scene.json', '--theme', 'light', '--css', 'site.css'], folder);
  const dark = await pngOne(['png', 'scene.json', '--theme', 'dark', '--css', 'site.css'], folder);

  assert.deepEqual(light.png.pixel(0, 0), [0xfa, 0xfa, 0xfa, 255]);
  assert.deepEqual(dark.png.pixel(0, 0), [0x10, 0x10, 0x10, 255]);
  assert.ok(findPixels(light.png, ([r, g, b]) => r < 60 && g < 90 && b > 90).length > 0, 'light ink is the site ink');
  assert.ok(findPixels(dark.png, ([r, g, b]) => r > 200 && g > 200 && b > 200).length > 0, 'dark ink is the site ink');
});

test('an explicit colour wins over the stylesheet', async () => {
  const folder = await sceneFolder();
  await writeFile(join(folder, 'site.css'), ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; }', 'utf8');

  const { png } = await pngOne(
    ['png', 'scene.json', '--theme', 'light', '--css', 'site.css', '--paper', '#ffffff'],
    folder,
  );

  assert.deepEqual(png.pixel(0, 0), [255, 255, 255, 255]);
});

test('png without a usable theme exits 2 and explains the usage', async () => {
  const folder = await sceneFolder();

  for (const args of [
    ['png'],
    ['png', 'scene.json'],
    ['png', 'scene.json', '--theme'],
    ['png', 'scene.json', '--theme', 'sunset'],
    ['png', 'scene.json', '--theme', 'light', '--colour', 'red'],
    ['png', 'scene.json', 'scene.json', '--theme', 'light'],
    ['png', '--theme=light', 'scene.json'],
  ]) {
    const run = await ez(args, folder);
    assert.equal(run.code, 2, `\`ez ${args.join(' ')}\``);
    assert.match(run.stderr, /usage: ez png <scene> --theme light\|dark/);
    assert.equal(run.stdout, '');
    assert.equal(existsSync(join(folder, 'scene.light.png')), false);
  }
});

test('a stylesheet without a theme colour exits 5 and names what is missing', async () => {
  const folder = await sceneFolder();
  await writeFile(join(folder, 'site.css'), ':root { --ink: #003366; --paper: #fafafa; }', 'utf8');
  await writeFile(
    join(folder, 'light-only.css'),
    ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; }',
    'utf8',
  );

  for (const [css, theme, missing] of [
    ['site.css', 'light', /^stylesheet is missing: --muted$/m],
    ['light-only.css', 'dark', /^stylesheet is missing: --ink \(dark\), --paper \(dark\), --muted \(dark\)$/m],
  ] as const) {
    const run = await ez(['png', 'scene.json', '--theme', theme, '--css', css], folder);
    assert.equal(run.code, 5, `\`--theme ${theme} --css ${css}\``);
    assert.match(run.stderr, missing);
    assert.equal(run.stdout, '');
    assert.equal(existsSync(join(folder, `scene.${theme}.png`)), false);
  }
});

test('an explicit colour fills in what the stylesheet leaves out', async () => {
  const folder = await sceneFolder();
  await writeFile(join(folder, 'site.css'), ':root { --ink: #003366; --paper: #fafafa; }', 'utf8');

  const { png } = await pngOne(
    ['png', 'scene.json', '--theme', 'light', '--css', 'site.css', '--muted', '#777777'],
    folder,
  );

  assert.deepEqual(png.pixel(0, 0), [0xfa, 0xfa, 0xfa, 255]);
});

test('a missing stylesheet exits 5', async () => {
  const folder = await sceneFolder();

  const run = await ez(['png', 'scene.json', '--theme', 'light', '--css', 'nowhere.css'], folder);

  assert.equal(run.code, 5);
  assert.match(run.stderr, /cannot read stylesheet nowhere\.css/);
  assert.equal(existsSync(join(folder, 'scene.light.png')), false);
});

test('a missing font file exits 5, and so does a file that is not a font', async () => {
  const folder = await sceneFolder();
  await writeFile(join(folder, 'not-a-font.ttf'), 'hello, not a font', 'utf8');

  const missing = await ez(['png', 'scene.json', '--theme', 'light', '--font', 'nowhere.ttf'], folder);
  assert.equal(missing.code, 5);
  assert.match(missing.stderr, /cannot read font nowhere\.ttf/);

  const wrong = await ez(['png', 'scene.json', '--theme', 'light', '--font', 'not-a-font.ttf'], folder);
  assert.equal(wrong.code, 5);
  assert.match(wrong.stderr, /^not-a-font\.ttf is not a TrueType or OpenType font$/m);

  assert.equal(existsSync(join(folder, 'scene.light.png')), false);
});

test('a font file given with --font is used in place of Kalam', async () => {
  const folder = await sceneFolder();
  const kalam = fileURLToPath(new URL('../fonts/Kalam-Regular.ttf', import.meta.url));

  const { png } = await pngOne(['png', 'scene.json', '--theme', 'light', '--font', kalam], folder);

  assert.equal(png.width, PAGE.width);
});

test('png on an invalid Scene exits 3 and names the Element', async () => {
  const folder = await sceneFolder({
    version: 1,
    elements: [{ id: 'box-a', type: 'rectangle', x: 10, y: 10, width: 0, height: 40 }],
  });

  const run = await ez(['png', 'scene.json', '--theme', 'light'], folder);

  assert.equal(run.code, 3);
  assert.match(run.stderr, /^box-a: width must be at least 1 pixel/m);
  assert.equal(existsSync(join(folder, 'scene.light.png')), false);
});

test('every path and problem is plain text', async () => {
  const folder = await sceneFolder();

  const ok = await ez(['png', 'scene.json', '--theme', 'dark'], folder);
  const bad = await ez(['png', 'scene.json', '--theme', 'dark', '--font', 'nowhere.ttf'], folder);

  for (const output of [ok.stdout, ok.stderr, bad.stdout, bad.stderr]) {
    assert.doesNotMatch(output, /\u001b\[/, 'no ANSI escape sequences');
  }
  assert.equal(ok.stdout.trim(), join(folder, 'scene.dark.png'));
  assert.match(bad.stderr, /^cannot read font nowhere\.ttf: /);
});

test('a theme colour written as a color-mix is resolved too', async () => {
  const folder = await sceneFolder();
  await writeFile(
    join(folder, 'site.css'),
    ':root { --ink: #003366; --paper: color-mix(in srgb, #ffffff 100%, #000000); --muted: #777777; }',
    'utf8',
  );

  const { png } = await pngOne(['png', 'scene.json', '--theme', 'light', '--css', 'site.css'], folder);

  assert.deepEqual(png.pixel(0, 0), [255, 255, 255, 255]);
});
