/**
 * Seam 1: Labels and Text through the built `ez` CLI.
 *
 * Words are measured, so the assertions are numeric: the lines the SVG draws
 * are the lines the real font makes at that box width, each baseline is one
 * measured line height below the last, and the page is the measured width of
 * the words plus the page padding. The expected numbers are computed here with
 * `opentype.js` and the bundled font — the same measurement anyone reading the
 * SVG would make — so the test checks the placement, not one implementation.
 *
 * `--font` is exercised with a font this file builds: every glyph one em wide,
 * so the same words are unmistakably wider than Kalam's.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import opentype from 'opentype.js';
import type { Glyph } from 'opentype.js';
import { ez, sceneFolder } from './cli.ts';

const KALAM = fileURLToPath(new URL('../fonts/Kalam-Regular.ttf', import.meta.url));

/** Font size of `fontSize: "M"`, which these Scenes use unless they say otherwise. */
const M = 18;
/** Layout's room between the words and the outline, before the stroke width. */
const PADDING = 8;

const kalamBytes = await readFile(KALAM);
const kalam = opentype.parse(
  kalamBytes.buffer.slice(kalamBytes.byteOffset, kalamBytes.byteOffset + kalamBytes.byteLength) as ArrayBuffer,
);

/**
 * The vertical metrics Layout takes from the font itself: the line height is
 * the file's ascender, descender and line gap, and a line's ink is centred on
 * that same box. Computed here from the font's own numbers.
 */
function vertical(size: number): { lineHeight: number; inkCentre: number } {
  const os2 = kalam.tables.os2 ?? {};
  const upm = kalam.unitsPerEm;
  const ascender = os2.sTypoAscender ?? kalam.ascender;
  const descender = os2.sTypoDescender ?? kalam.descender;
  const lineGap = os2.sTypoLineGap ?? 0;
  return {
    lineHeight: (size * (ascender - descender + lineGap)) / upm,
    inkCentre: (size * (ascender + descender)) / (2 * upm),
  };
}

interface Drawn {
  text: string;
  x: number;
  baseline: number;
  size: number;
  anchor: string;
}

/** Every `<text>` the SVG draws, read as numbers. */
function texts(svg: string): Drawn[] {
  return [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].map((match) => ({
    text: unescapeXml(match[2] ?? ''),
    x: Number(attribute(match[1] ?? '', 'x')),
    baseline: Number(attribute(match[1] ?? '', 'y')),
    size: Number(attribute(match[1] ?? '', 'font-size')),
    anchor: attribute(match[1] ?? '', 'text-anchor'),
  }));
}

function attribute(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match?.[1] ?? '';
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

function pageOf(svg: string): { x: number; y: number; width: number; height: number } {
  const [, viewBox] = /viewBox="([^"]*)"/.exec(svg) ?? [];
  const [x = 0, y = 0, width = 0, height = 0] = (viewBox ?? '').split(' ').map(Number);
  return { x, y, width, height };
}

function advance(text: string, size = M): number {
  return kalam.getAdvanceWidth(text, size, { kerning: true });
}

/** The greedy wrap the drawing has to make: a line takes words while they fit. */
function wrapped(text: string, width: number, size = M): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((word) => word !== '');
    let line = words[0] ?? '';
    for (const word of words.slice(1)) {
      if (advance(`${line} ${word}`, size) <= width) {
        line = `${line} ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** The box a rectangle's Label may fill, at `stroke: "bold"`. */
function rectangleArea(width: number, height: number): { width: number; height: number } {
  const pad = PADDING + 2;
  return { width: width - 2 * pad, height: height - 2 * pad };
}

async function render(scene: unknown, flags: string[] = []): Promise<string> {
  const folder = await sceneFolder(scene);
  const run = await ez(['render', 'scene.json', ...flags], folder);
  assert.equal(run.code, 0, run.stderr);
  return readFile(join(folder, 'scene.svg'), 'utf8');
}

function oneBox(element: Record<string, unknown>): unknown {
  return {
    version: 1,
    title: 'One Element',
    defaults: { roughness: 0 },
    elements: [{ id: 'a', type: 'rectangle', x: 40, y: 40, width: 160, height: 120, ...element }],
  };
}

const LONG_LABEL = 'orders and invoices for the autumn release';

test('a Label wraps inside its Element, measured with the real font', async () => {
  const svg = await render(oneBox({ label: LONG_LABEL }));
  const area = rectangleArea(160, 120);
  const expected = wrapped(LONG_LABEL, area.width);
  const drawn = texts(svg);

  assert.ok(expected.length > 1, 'the words take more than one line');
  assert.deepEqual(
    drawn.map((line) => line.text),
    expected,
    'the words break where the measured font runs out of room',
  );
  for (const line of drawn) {
    assert.ok(advance(line.text) <= area.width, `"${line.text}" fits the box`);
    assert.equal(line.x, 50, 'a left-aligned Label starts at the box edge');
    assert.equal(line.size, M);
    assert.equal(line.anchor, 'start');
  }
  const metrics = vertical(M);
  for (let index = 1; index < drawn.length; index += 1) {
    const gap = drawn[index]!.baseline - drawn[index - 1]!.baseline;
    assert.ok(Math.abs(gap - metrics.lineHeight) < 0.01, 'one measured line height between baselines');
  }
  const block = drawn.length * metrics.lineHeight;
  const first = 50 + (area.height - block) / 2 + metrics.lineHeight / 2 + metrics.inkCentre;
  assert.ok(Math.abs(drawn[0]!.baseline - first) < 0.01, 'the block is centred in the box on its ink');
});

test('wrapping follows the Element width and sees whole words', async () => {
  const narrow = texts(await render(oneBox({ width: 100, label: LONG_LABEL })));
  const wide = texts(await render(oneBox({ width: 320, label: LONG_LABEL })));
  const narrowArea = rectangleArea(100, 120);
  const wideArea = rectangleArea(320, 120);

  assert.ok(narrow.length > wide.length, `${narrow.length} lines narrow, ${wide.length} wide`);
  assert.deepEqual(narrow.map((line) => line.text), wrapped(LONG_LABEL, narrowArea.width));
  assert.deepEqual(wide.map((line) => line.text), wrapped(LONG_LABEL, wideArea.width));
  for (const line of narrow) {
    assert.ok(advance(line.text) <= narrowArea.width, `"${line.text}" fits the narrow box`);
  }
});

test('a diamond wraps inside the room its outline leaves', async () => {
  const label = 'narrow middle words';
  const svg = await render({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      { id: 'gem', type: 'diamond', x: 40, y: 40, width: 240, height: 160, label },
    ],
  });
  const areaWidth = 240 * 0.5 - 2 * (PADDING + 2);
  const areaHeight = 160 * 0.5 - 2 * (PADDING + 2);
  const drawn = texts(svg);

  assert.deepEqual(drawn.map((line) => line.text), wrapped(label, areaWidth));
  assert.ok(drawn.length > 1, 'the diamond narrows the lines');
  assert.ok(drawn.length * vertical(M).lineHeight <= areaHeight, 'and the lines fit its height');
  for (const line of drawn) {
    assert.ok(advance(line.text) <= areaWidth, `"${line.text}" fits the diamond's middle`);
    assert.equal(line.anchor, 'start', 'the Element alignment still sets the lines');
  }
});

test('an ellipse wraps inside the box its curve leaves', async () => {
  const label = 'a wider box hides inside an ellipse';
  const svg = await render({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      { id: 'oval', type: 'ellipse', x: 40, y: 40, width: 240, height: 160, label },
    ],
  });
  const areaWidth = 240 * Math.SQRT1_2 - 2 * (PADDING + 2);
  const drawn = texts(svg);

  assert.deepEqual(drawn.map((line) => line.text), wrapped(label, areaWidth));
  for (const line of drawn) {
    assert.ok(advance(line.text) <= areaWidth, `"${line.text}" fits the ellipse's middle`);
  }
});

test("an arrow's Label sits above the middle of the shaft it draws", async () => {
  const free = texts(
    await render({
      version: 1,
      elements: [
        {
          id: 'arrow',
          type: 'arrow',
          points: [
            { x: 100, y: 200 },
            { x: 300, y: 200 },
          ],
          label: 'and then',
        },
      ],
    }),
  );
  assert.equal(free.length, 1, 'a short Label on a shaft stays one line');
  assert.equal(free[0]!.x, 200, 'centred on the middle of the shaft');
  assert.equal(free[0]!.anchor, 'middle');
  assert.ok(free[0]!.baseline < 200, 'above the line, never on it');
  assert.ok(free[0]!.baseline > 200 - 40, 'and close enough to belong to it');

  // Snap moves the drawn ends, so the middle moves with them: the box's right
  // side is x=80, which puts the drawn middle at x=190, not at x=200.
  const snapped = texts(
    await render({
      version: 1,
      elements: [
        { id: 'box', type: 'rectangle', x: 0, y: 0, width: 80, height: 80 },
        {
          id: 'arrow',
          type: 'arrow',
          points: [
            { x: 40, y: 40, snap: 'box' },
            { x: 300, y: 40 },
          ],
          label: 'snapped',
        },
      ],
    }),
  );
  assert.equal(snapped[0]!.x, 190, 'the Label follows the shaft Snap drew');
  assert.ok(snapped[0]!.baseline < 40);
});

test('free-standing Text is measured with the real font', async () => {
  const content = 'Hamburgefonstiv';
  const svg = await render({
    version: 1,
    elements: [{ id: 'words', type: 'text', x: 20, y: 20, content, fontSize: 'L' }],
  });
  const page = pageOf(svg);
  const width = advance(content, 24);
  const left = Math.floor(20 - 16);
  const right = Math.ceil(20 + width + 16);

  assert.equal(page.x, left);
  assert.equal(page.width, right - left, 'the page is the measured words, not a guessed character width');
  assert.ok(
    Math.abs(width - content.length * 24 * 0.55) > 1,
    'the measured width is not the old 0.55-per-character guess',
  );

  const drawn = texts(svg);
  assert.equal(drawn.length, 1, 'one line, no guesswork');
  assert.equal(drawn[0]!.text, content);
  assert.equal(drawn[0]!.x, 20, 'x is the aligned edge, as before');
});

test('--font is the font the words are measured with', async () => {
  const folder = await sceneFolder(oneBox({ label: LONG_LABEL }));
  await writeWideFont(folder);

  const plain = await ez(['render', 'scene.json'], folder);
  assert.equal(plain.code, 0, plain.stderr);
  const kalamLines = texts(await readFile(join(folder, 'scene.svg'), 'utf8'));

  const wide = await ez(['render', 'scene.json', '--font', 'wide.ttf'], folder);
  assert.equal(wide.code, 0, wide.stderr);
  const wideLines = texts(await readFile(join(folder, 'scene.svg'), 'utf8'));

  assert.ok(
    wideLines.length > kalamLines.length,
    `a wider font wraps sooner: ${wideLines.length} lines against ${kalamLines.length}`,
  );
  assert.equal(wideLines[0]!.text, 'orders', 'one wide word to a line');
});

test('--font is the font png measures with, so the page follows it', async () => {
  const folder = await sceneFolder({
    version: 1,
    elements: [{ id: 'words', type: 'text', x: 20, y: 20, content: 'Hamburgefonstiv', fontSize: 'L' }],
  });
  await writeWideFont(folder);

  const plain = await ez(['png', 'scene.json', '--theme', 'light'], folder);
  assert.equal(plain.code, 0, plain.stderr);
  const plainWidth = pngWidth(await readFile(join(folder, 'scene.light.png')));

  const wide = await ez(['png', 'scene.json', '--theme', 'light', '--font', 'wide.ttf'], folder);
  assert.equal(wide.code, 0, wide.stderr);
  const wideWidth = pngWidth(await readFile(join(folder, 'scene.light.png')));

  assert.ok(wideWidth > plainWidth, `${wideWidth}px wide with the wide font, ${plainWidth}px with Kalam`);
  const content = 'Hamburgefonstiv';
  assert.equal(
    wideWidth,
    Math.ceil(20 + content.length * 24 + 16) - Math.floor(20 - 16),
    'one em per glyph, measured',
  );
});

test('a Label that does not fit is still drawn, and runs past its box', async () => {
  const label = 'this box is far too small for these words';
  const svg = await render(oneBox({ width: 100, height: 40, label }));
  const drawn = texts(svg);
  const area = rectangleArea(100, 40);

  assert.ok(drawn.length > 0, 'the words are drawn where the author put them');
  assert.ok(
    drawn.length * vertical(M).lineHeight > area.height,
    'and they take more room than the box has, which is what `ez check` reports',
  );
});

test('a Text carries content, so a Label on one is a schema problem', async () => {
  const folder = await sceneFolder({
    version: 1,
    elements: [{ id: 'words', type: 'text', x: 10, y: 10, content: 'Words', label: 'Extra' }],
  });

  const run = await ez(['render', 'scene.json'], folder);

  assert.equal(run.code, 3);
  assert.match(run.stderr, /^words: unknown key "label"$/m);
});

/** A font whose every glyph advances one em, so measurement is unmistakable. */
async function writeWideFont(folder: string): Promise<void> {
  const glyph = (name: string, code: number): Glyph => {
    const path = new opentype.Path();
    path.moveTo(0, 0);
    path.lineTo(800, 0);
    path.lineTo(800, 800);
    path.close();
    return new opentype.Glyph({ name, unicode: code, advanceWidth: 1000, path });
  };
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,';
  const glyphs = [
    glyph('.notdef', 0),
    ...alphabet
      .split('')
      .map((character) => glyph(character === ' ' ? 'space' : character, character.codePointAt(0)!)),
  ];
  const font = new opentype.Font({
    familyName: 'Wide',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs,
  });
  await writeFile(join(folder, 'wide.ttf'), Buffer.from(font.toArrayBuffer()));
}

/** The page width a PNG was rendered at, straight from IHDR. */
function pngWidth(bytes: Buffer): number {
  return bytes.readUInt32BE(16);
}
