/**
 * Seam 1: `ez png` on Scene files in temporary folders.
 *
 * Everything here is external behaviour: the files written, stdout, stderr and
 * exit codes. Nothing imports src/. PNGs are read straight from the bytes: the
 * IHDR chunk gives the page size on its own, and IDAT is inflated and
 * unfiltered with node:zlib so a single pixel can be sampled from the 8-bit
 * encodings resvg writes without the test requiring one particular colour type.
 */
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { inflateSync } from 'node:zlib';
import opentype from 'opentype.js';
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
      stroke: { width: 'bold', style: 'dashed' },
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

async function sceneFolder(scene: unknown = SAMPLE_SCENE): Promise<string> {
  const folder = await tempFolder();
  await writeFile(join(folder, 'scene.json'), JSON.stringify(scene, null, 2), 'utf8');
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

interface Size {
  width: number;
  height: number;
}

interface Chunk {
  type: string;
  data: Buffer;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Walks a PNG's chunks; the signature is checked once, here. */
function* chunks(bytes: Buffer): Generator<Chunk> {
  assert.deepEqual([...bytes.subarray(0, 8)], PNG_SIGNATURE, 'not a PNG');
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    yield { type, data: bytes.subarray(offset + 8, offset + 8 + length) };
    if (type === 'IEND') {
      return;
    }
    offset += 12 + length;
  }
}

/** The page size from IHDR alone, with no assumption about how it is encoded. */
function readSize(bytes: Buffer): Size {
  for (const chunk of chunks(bytes)) {
    if (chunk.type === 'IHDR') {
      return { width: chunk.data.readUInt32BE(0), height: chunk.data.readUInt32BE(4) };
    }
  }
  throw new Error('PNG without an IHDR chunk');
}

interface Png extends Size {
  /** The pixel at (x, y) as [red, green, blue, alpha]. */
  pixel(x: number, y: number): [number, number, number, number];
}

/** Channels per pixel, by PNG colour type: the four resvg writes. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * Reads an 8-bit grey, RGB, grey+alpha or RGBA PNG — the colour types resvg
 * writes. A bit depth or colour type outside that is an error naming what was
 * found, not a guess at samples this test does not read.
 */
function readPng(bytes: Buffer): Png {
  const size = readSize(bytes);
  let bitDepth = 8;
  let colourType = 6;
  const data: Buffer[] = [];
  for (const chunk of chunks(bytes)) {
    if (chunk.type === 'IHDR') {
      bitDepth = chunk.data[8] ?? 8;
      colourType = chunk.data[9] ?? 6;
    } else if (chunk.type === 'IDAT') {
      data.push(chunk.data);
    }
  }

  const pixelBytes = CHANNELS[colourType];
  if (pixelBytes === undefined) {
    throw new Error(`the PNG is colour type ${colourType}; this test reads 0, 2, 4 or 6`);
  }
  if (bitDepth !== 8) {
    throw new Error(`the PNG is ${bitDepth} bits per sample; this test reads 8`);
  }
  const stride = size.width * pixelBytes;
  const raw = inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(size.height * stride);
  for (let y = 0; y < size.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= pixelBytes ? (row[i - pixelBytes] ?? 0) : 0;
      const up = above?.[i] ?? 0;
      const upLeft = above !== null && i >= pixelBytes ? (above[i - pixelBytes] ?? 0) : 0;
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
    ...size,
    pixel(x: number, y: number): [number, number, number, number] {
      const at = y * stride + x * pixelBytes;
      const sample = (index: number): number => pixels[at + index] ?? 0;
      switch (colourType) {
        case 0: {
          const grey = sample(0);
          return [grey, grey, grey, 255];
        }
        case 4: {
          const grey = sample(0);
          return [grey, grey, grey, sample(1)];
        }
        case 2:
          return [sample(0), sample(1), sample(2), 255];
        case 6:
          return [sample(0), sample(1), sample(2), sample(3)];
        default:
          throw new Error(`unsupported PNG colour type ${colourType}`);
      }
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

/** Whether any pixel matches, stopping at the first one. */
function hasPixel(png: Png, wanted: (rgba: [number, number, number, number]) => boolean): boolean {
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (wanted(png.pixel(x, y))) {
        return true;
      }
    }
  }
  return false;
}

const isRed = ([r, g, b]: [number, number, number, number]): boolean => r > 200 && g < 100 && b < 100;
const isGreen = ([r, g, b]: [number, number, number, number]): boolean => g > 200 && r < 100 && b < 100;
const isInk = ([r, g, b]: [number, number, number, number]): boolean =>
  r < 0x80 && g < 0x80 && b < 0x80;

test('png --theme light writes a PNG beside the Scene and prints its path', async () => {
  const folder = await sceneFolder();

  const run = await ez(['png', 'scene.json', '--theme', 'light'], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stderr, '');
  assert.equal(run.stdout.trim(), join(folder, 'scene.light.png'));
  assert.deepEqual(readSize(await readFile(run.stdout.trim())), PAGE);
});

test('png --theme dark writes its own PNG beside the Scene', async () => {
  const folder = await sceneFolder();

  const run = await ez(['png', 'scene.json', '--theme', 'dark'], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(readSize(await readFile(join(folder, 'scene.dark.png'))), PAGE);
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
  assert.ok(hasPixel(png, isRed), 'the ink outline is red');
  assert.ok(hasPixel(png, isGreen), 'the muted outline is green');
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

test('a grey fill mixes rgb() and named inks into the paper', async () => {
  const folder = await sceneFolder({
    version: 1,
    elements: [
      { id: 'grey', type: 'rectangle', x: 20, y: 20, width: 160, height: 120, fill: { kind: 'solid', grey: 3 } },
    ],
  });

  // Grey 3 is 38% ink into paper. With red ink on white paper the middle of the
  // fill is rgb(255, 158, 158) whichever way the ink was written.
  for (const ink of ['rgb(255, 0, 0)', 'rgb(255 0 0)', 'red']) {
    const { png } = await pngOne(
      ['png', 'scene.json', '--theme', 'light', '--ink', ink, '--paper', '#ffffff'],
      folder,
    );
    assert.deepEqual(png.pixel(100, 80), [255, 158, 158, 255], `ink ${ink}`);
  }
});

test('a dashed or dotted Snap reaches its target as ink, not bare paper', async () => {
  // An architect (roughness 0) extra-width line from (0,50) to a thin, solid box
  // at x=119. The page is padded 16px left and up, so Scene x lands on pixel
  // x + 16 and the contact point x=119 is pixel 135: the four pixels before it
  // are the end of the shaft, and bare paper there is a stroke that stopped
  // short.
  const contact = 135;
  const y = 66;

  for (const style of ['dashed', 'dotted'] as const) {
    const folder = await sceneFolder({
      version: 1,
      defaults: { roughness: 0 },
      elements: [
        {
          id: 'box',
          type: 'rectangle',
          x: 119,
          y: 0,
          width: 100,
          height: 100,
          fill: { kind: 'none' },
          stroke: { width: 'thin', style: 'solid' },
        },
        {
          id: 'line',
          type: 'line',
          points: [
            { x: 0, y: 50 },
            { x: 0, y: 50, snap: 'box' },
          ],
          stroke: { width: 'extra', style },
        },
      ],
    });

    const { png } = await pngOne(['png', 'scene.json', '--theme', 'light'], folder);

    for (let x = contact - 4; x < contact; x += 1) {
      const rgba = png.pixel(x, y);
      assert.ok(isInk(rgba), `${style}: pixel ${x} reaches the contact, got ${rgba}`);
    }
    const shaft: [number, number, number, number][] = [];
    for (let x = 20; x < contact - 8; x += 1) {
      shaft.push(png.pixel(x, y));
    }
    assert.ok(
      shaft.some((rgba) => !isInk(rgba)),
      `${style}: the shaft keeps its ${style} gaps instead of turning solid`,
    );
  }
});

test('a colour the subset cannot resolve exits 5 and names it', async () => {
  const folder = await sceneFolder();
  const cases = [
    ['alias.css', ':root { --ink: var(--accent); --paper: #fafafa; --muted: #777777; }', /^stylesheet colour --ink is unresolved: var\(--accent\)$/m],
    ['cycle.css', ':root { --ink: var(--paper); --paper: var(--ink); --muted: #777777; }', /^stylesheet colour --ink is unresolved: var\(--paper\)$/m],
    ['oklch.css', ':root { --ink: hsl(10 20% 30%); --paper: #fafafa; --muted: #777777; }', /^stylesheet colour --ink is not a colour: hsl\(10 20% 30%\)$/m],
  ] as const;

  for (const [css, source, expected] of cases) {
    await writeFile(join(folder, css), source, 'utf8');
    const run = await ez(['png', 'scene.json', '--theme', 'light', '--css', css], folder);
    assert.equal(run.code, 5, css);
    assert.match(run.stderr, expected);
    assert.equal(existsSync(join(folder, 'scene.light.png')), false);
  }
});

test('a name that is only a property of Object is not a colour', async () => {
  const folder = await sceneFolder({
    version: 1,
    elements: [{ id: 'box', type: 'rectangle', x: 20, y: 20, width: 120, height: 80 }],
  });
  await writeFile(
    join(folder, 'site.css'),
    ':root { --ink: constructor; --paper: #fafafa; --muted: #777777; }',
    'utf8',
  );

  const run = await ez(['png', 'scene.json', '--theme', 'light', '--css', 'site.css'], folder);

  assert.equal(run.code, 5);
  assert.match(run.stderr, /^stylesheet colour --ink is not a colour: constructor$/m);
  assert.equal(existsSync(join(folder, 'scene.light.png')), false);
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
  assert.ok(hasPixel(light.png, ([r, g, b]) => r < 60 && g < 90 && b > 90), 'light ink is the site ink');
  assert.ok(hasPixel(dark.png, ([r, g, b]) => r > 200 && g > 200 && b > 200), 'dark ink is the site ink');
});

test('the dark theme inherits the base colours and overrides only what it declares', async () => {
  const folder = await sceneFolder({
    version: 1,
    elements: [
      { id: 'ink', type: 'rectangle', x: 20, y: 20, width: 120, height: 80 },
      { id: 'muted', type: 'rectangle', x: 200, y: 20, width: 120, height: 80, tone: 'muted', stroke: { width: 'extra' } },
    ],
  });
  await writeFile(
    join(folder, 'site.css'),
    [
      ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; }',
      '@media (prefers-color-scheme: dark) {',
      '  :root { --ink: #e8e8e8; --paper: #101010; }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  const light = await pngOne(['png', 'scene.json', '--theme', 'light', '--css', 'site.css'], folder);
  const dark = await pngOne(['png', 'scene.json', '--theme', 'dark', '--css', 'site.css'], folder);

  assert.deepEqual(light.png.pixel(0, 0), [0xfa, 0xfa, 0xfa, 255]);
  assert.deepEqual(dark.png.pixel(0, 0), [0x10, 0x10, 0x10, 255]);
  // --muted is declared once, in the base block, and still applies in dark.
  assert.ok(hasPixel(dark.png, ([r, g, b]) => r === 0x77 && g === 0x77 && b === 0x77), 'dark keeps the base muted');
});

test('the dark theme comes from the root scopes, not from any dark selector', async () => {
  const folder = await sceneFolder();
  await writeFile(
    join(folder, 'site.css'),
    [
      ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; }',
      '.dark-card { --paper: #ff0000; --ink: #ff0000; --muted: #ff0000; }',
      ':root.dark { --ink: #e8e8e8; }',
      'html[data-theme="dark"] { --paper: #123456; }',
      '',
    ].join('\n'),
    'utf8',
  );

  const light = await pngOne(['png', 'scene.json', '--theme', 'light', '--css', 'site.css'], folder);
  const dark = await pngOne(['png', 'scene.json', '--theme', 'dark', '--css', 'site.css'], folder);

  assert.deepEqual(light.png.pixel(0, 0), [0xfa, 0xfa, 0xfa, 255]);
  // #123456 from html[data-theme="dark"], never #ff0000 from .dark-card.
  assert.deepEqual(dark.png.pixel(0, 0), [0x12, 0x34, 0x56, 255]);
});

test('only the dark media query feeds a theme; other groups are ignored', async () => {
  const folder = await sceneFolder();
  await writeFile(
    join(folder, 'site.css'),
    [
      ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; }',
      '@media print { :root { --ink: #ff0000; --paper: #ff0000; --muted: #ff0000; } }',
      '@media (prefers-color-scheme: light) { :root { --paper: #ff0000; } }',
      '@supports (color: #ff0000) { :root { --ink: #ff0000; } }',
      '@layer base { :root { --muted: #ff0000; } }',
      '',
    ].join('\n'),
    'utf8',
  );

  for (const theme of ['light', 'dark'] as const) {
    const { png } = await pngOne(['png', 'scene.json', '--theme', theme, '--css', 'site.css'], folder);

    // Dark inherits the base values, so both themes keep the base paper.
    assert.deepEqual(png.pixel(0, 0), [0xfa, 0xfa, 0xfa, 255], theme);
    assert.equal(hasPixel(png, isRed), false, `${theme} reads no rule from an ignored group`);
  }
});

test('a translucent palette colour exits 5 instead of being mixed', async () => {
  const folder = await sceneFolder();

  for (const ink of ['rgba(255, 0, 0, 0.5)', '#ff000080', 'transparent']) {
    await writeFile(
      join(folder, 'site.css'),
      `:root { --ink: ${ink}; --paper: #ffffff; --muted: #777777; }`,
      'utf8',
    );
    const run = await ez(['png', 'scene.json', '--theme', 'light', '--css', 'site.css'], folder);
    assert.equal(run.code, 5, ink);
    assert.match(run.stderr, /^colours must be opaque: stylesheet colour --ink is /m, ink);
    assert.equal(existsSync(join(folder, 'scene.light.png')), false, ink);
  }

  // Alpha 1 is opaque, so rgba() stays a colour the palette accepts.
  await writeFile(
    join(folder, 'opaque.css'),
    ':root { --ink: rgba(255, 0, 0, 1); --paper: #ffffff; --muted: #777777; }',
    'utf8',
  );
  const { png } = await pngOne(['png', 'scene.json', '--theme', 'light', '--css', 'opaque.css'], folder);
  assert.ok(hasPixel(png, isRed), 'an opaque rgba() ink reaches the drawing');
});

test('a later declaration wins over an earlier one', async () => {
  const folder = await sceneFolder();
  await writeFile(
    join(folder, 'site.css'),
    [':root { --paper: #ff0000; }', ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; }', ''].join('\n'),
    'utf8',
  );

  const { png } = await pngOne(['png', 'scene.json', '--theme', 'light', '--css', 'site.css'], folder);

  assert.deepEqual(png.pixel(0, 0), [0xfa, 0xfa, 0xfa, 255]);
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
  await writeFile(join(folder, 'ink-only.css'), ':root { --ink: #003366; }', 'utf8');

  for (const [css, theme, missing] of [
    ['site.css', 'light', /^stylesheet is missing: --muted$/m],
    // Dark inherits the light values, so only the two names nobody declares are missing.
    ['ink-only.css', 'dark', /^stylesheet is missing: --paper \(dark\), --muted \(dark\)$/m],
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

test('a readable font file given with --font is accepted', async () => {
  const folder = await sceneFolder();
  const kalam = fileURLToPath(new URL('../fonts/Kalam-Regular.ttf', import.meta.url));

  const { png } = await pngOne(['png', 'scene.json', '--theme', 'light', '--font', kalam], folder);

  assert.equal(png.width, PAGE.width);
});

test('an explicit --font needs no resolvable --font-hand', async () => {
  const folder = await sceneFolder();
  const kalam = fileURLToPath(new URL('../fonts/Kalam-Regular.ttf', import.meta.url));
  await writeFile(
    join(folder, 'site.css'),
    ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; --font-hand: var(--nowhere); }',
    'utf8',
  );

  const { png } = await pngOne(
    ['png', 'scene.json', '--theme', 'light', '--css', 'site.css', '--font', kalam],
    folder,
  );

  assert.equal(png.width, PAGE.width);
});

test('a local @font-face matching --font-hand is the stylesheet font', async () => {
  const folder = await sceneFolder();
  await copyFile(fileURLToPath(new URL('../fonts/Kalam-Regular.ttf', import.meta.url)), join(folder, 'hand.ttf'));

  await writeFile(
    join(folder, 'hand.css'),
    [
      ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; --font-hand: Hand, cursive; }',
      '@font-face { font-family: Hand; src: url(hand.ttf) format("truetype"); }',
      '',
    ].join('\n'),
    'utf8',
  );
  const used = await pngOne(['png', 'scene.json', '--theme', 'light', '--css', 'hand.css'], folder);
  assert.equal(used.run.stderr, '');
  assert.equal(used.png.width, PAGE.width);

  await writeFile(
    join(folder, 'missing.css'),
    [
      ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; --font-hand: Hand; }',
      '@font-face { font-family: Hand; src: url(nowhere.ttf) format("truetype"); }',
      '',
    ].join('\n'),
    'utf8',
  );
  const missing = await ez(['png', 'scene.json', '--theme', 'light', '--css', 'missing.css'], folder);
  assert.equal(missing.code, 5);
  assert.match(missing.stderr, /^cannot read font nowhere\.ttf \(from missing\.css\): /m);
});

test('the stylesheet font is read instead of falling back to Kalam', async () => {
  const folder = await sceneFolder();
  await writeFile(join(folder, 'broken.ttf'), Buffer.from([0x00, 0x01, 0x00, 0x00]));
  await writeFile(
    join(folder, 'site.css'),
    [
      ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; --font-hand: Hand; }',
      '@font-face { font-family: Hand; src: url(broken.ttf) format("truetype"); }',
      '',
    ].join('\n'),
    'utf8',
  );

  const run = await ez(['png', 'scene.json', '--theme', 'light', '--css', 'site.css'], folder);

  assert.equal(run.code, 5);
  assert.match(run.stderr, /^broken\.ttf \(from site\.css\) is not a TrueType or OpenType font$/m);
});

test('a @font-face declared in dark scope is never read by the light theme', async () => {
  const folder = await sceneFolder();
  await writeFile(
    join(folder, 'media.css'),
    [
      ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; --font-hand: Hand; }',
      '@media (prefers-color-scheme: dark) {',
      '  @font-face { font-family: Hand; src: url(dark-hand.ttf) format("truetype"); }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(folder, 'scope.css'),
    [
      ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; --font-hand: Hand; }',
      ':root.dark {',
      '  @font-face { font-family: Hand; src: url(dark-hand.ttf) format("truetype"); }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  for (const css of ['media.css', 'scope.css']) {
    const light = await pngOne(['png', 'scene.json', '--theme', 'light', '--css', css], folder);
    assert.equal(light.png.width, PAGE.width, css);

    // The dark theme reads the face, so its missing file is a problem there.
    const dark = await ez(['png', 'scene.json', '--theme', 'dark', '--css', css], folder);
    assert.equal(dark.code, 5, css);
    assert.match(dark.stderr, /^cannot read font dark-hand\.ttf \(from /m);
  }
});

test('a remote @font-face is ignored with a note, and Kalam is used', async () => {
  const folder = await sceneFolder();
  await writeFile(
    join(folder, 'site.css'),
    [
      ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; --font-hand: Hand; }',
      '@font-face { font-family: Hand; src: url(https://example.com/hand.woff2) format("woff2"); }',
      '',
    ].join('\n'),
    'utf8',
  );

  const { run } = await pngOne(['png', 'scene.json', '--theme', 'light', '--css', 'site.css'], folder);

  assert.match(run.stderr, /stylesheet font https:\/\/example\.com\/hand\.woff2 is remote/);
  assert.match(run.stderr, /Kalam/);
});

test('the light theme never reads the dark font', async () => {
  const folder = await sceneFolder();
  await writeFile(
    join(folder, 'site.css'),
    [
      ':root { --ink: #003366; --paper: #fafafa; --muted: #777777; }',
      '@media (prefers-color-scheme: dark) {',
      '  :root { --font-hand: Hand; }',
      '}',
      '@font-face { font-family: Hand; src: url(nowhere.ttf) format("truetype"); }',
      '',
    ].join('\n'),
    'utf8',
  );

  const light = await pngOne(['png', 'scene.json', '--theme', 'light', '--css', 'site.css'], folder);
  const dark = await ez(['png', 'scene.json', '--theme', 'dark', '--css', 'site.css'], folder);

  assert.equal(light.png.width, PAGE.width);
  assert.equal(dark.code, 5);
  assert.match(dark.stderr, /cannot read font nowhere\.ttf/);
});

test('a font with no glyphs exits 5', async () => {
  const folder = await sceneFolder();
  const empty = new opentype.Font({
    familyName: 'Empty',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [],
  });
  await writeFile(join(folder, 'empty.ttf'), Buffer.from(empty.toArrayBuffer()));

  const run = await ez(['png', 'scene.json', '--theme', 'light', '--font', 'empty.ttf'], folder);

  assert.equal(run.code, 5);
  assert.match(run.stderr, /^empty\.ttf has no glyphs$/m);
  assert.equal(existsSync(join(folder, 'scene.light.png')), false);
});

test('a font file with only a signature, or a webfont, exits 5', async () => {
  const folder = await sceneFolder();
  await writeFile(join(folder, 'four-bytes.ttf'), Buffer.from([0x00, 0x01, 0x00, 0x00]));
  await writeFile(join(folder, 'compressed.woff2'), Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(28)]));

  const four = await ez(['png', 'scene.json', '--theme', 'light', '--font', 'four-bytes.ttf'], folder);
  assert.equal(four.code, 5);
  assert.match(four.stderr, /^four-bytes\.ttf is not a TrueType or OpenType font$/m);

  const webfont = await ez(['png', 'scene.json', '--theme', 'light', '--font', 'compressed.woff2'], folder);
  assert.equal(webfont.code, 5);
  assert.match(webfont.stderr, /^compressed\.woff2 is a compressed webfont \(wOF2\)/m);

  assert.equal(existsSync(join(folder, 'scene.light.png')), false);
});

test('--help documents the stylesheet subset', async () => {
  const folder = await sceneFolder();

  const help = await ez(['--help'], folder);

  assert.equal(help.code, 0);
  assert.match(help.stdout, /prefers-color-scheme: dark/);
  assert.match(help.stdout, /:root\.dark/);
  assert.match(help.stdout, /color-mix\(in srgb/);
  assert.equal(help.stderr, '');
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

test('color-mix takes one weight and one bare colour, as documented', async () => {
  const folder = await sceneFolder();

  for (const [css, paper] of [
    ['bare.css', 'color-mix(in srgb, #ffffff, #000000)'],
    ['double.css', 'color-mix(in srgb, #ffffff 50%, #000000 50%)'],
  ] as const) {
    await writeFile(join(folder, css), `:root { --ink: #003366; --paper: ${paper}; --muted: #777777; }`, 'utf8');
    const run = await ez(['png', 'scene.json', '--theme', 'light', '--css', css], folder);
    assert.equal(run.code, 5, css);
    assert.match(run.stderr, /^stylesheet colour --paper is unresolved: color-mix\(/m, css);
    assert.equal(existsSync(join(folder, 'scene.light.png')), false, css);
  }
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
