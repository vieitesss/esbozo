/**
 * Seam 1: Labels and Text through the built `ez` CLI.
 *
 * Only outcomes a reader of the drawing would see are asserted here: the page
 * size, the PNG the command writes, the exit code and the plain-text problems.
 * Where the words land and how they break is asserted through Layout's own
 * Block in `layout.test.ts`, so moving one line of SVG from one tag to another
 * cannot break a test that the drawing did not break.
 *
 * `--font` is exercised with a font this file builds: every glyph one em wide,
 * so the same words are unmistakably wider than Kalam's.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import opentype from 'opentype.js';
import { ez, sceneFolder } from './cli.ts';
import { writeFont } from './fonts.ts';

const KALAM = fileURLToPath(new URL('../fonts/Kalam-Regular.ttf', import.meta.url));

const kalamBytes = await readFile(KALAM);
const kalam = opentype.parse(
  kalamBytes.buffer.slice(kalamBytes.byteOffset, kalamBytes.byteOffset + kalamBytes.byteLength) as ArrayBuffer,
);

/** Renderer's padding around the Scene's Elements. */
const PAGE_PADDING = 16;

function advance(text: string, size: number): number {
  return kalam.getAdvanceWidth(text, size, { kerning: true });
}

function pageOf(svg: string): { x: number; y: number; width: number; height: number } {
  const [, viewBox] = /viewBox="([^"]*)"/.exec(svg) ?? [];
  const [x = 0, y = 0, width = 0, height = 0] = (viewBox ?? '').split(' ').map(Number);
  return { x, y, width, height };
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

test('free-standing Text is measured with the real font', async () => {
  const content = 'Hamburgefonstiv';
  const svg = await render({
    version: 1,
    elements: [{ id: 'words', type: 'text', x: 20, y: 20, content, fontSize: 'L' }],
  });
  const page = pageOf(svg);
  const width = advance(content, 24);
  const left = Math.floor(20 - PAGE_PADDING);
  const right = Math.ceil(20 + width + PAGE_PADDING);

  assert.equal(page.x, left);
  assert.equal(
    page.width,
    right - left,
    'the page is the measured words, not a guessed character width',
  );
});

test('--font is the font the words are measured with', async () => {
  const folder = await sceneFolder({
    version: 1,
    elements: [{ id: 'words', type: 'text', x: 20, y: 20, content: 'Hamburgefonstiv', fontSize: 'L' }],
  });
  await writeFont(folder, 'wide.ttf');

  const plain = await ez(['render', 'scene.json'], folder);
  assert.equal(plain.code, 0, plain.stderr);
  const kalamPage = pageOf(await readFile(join(folder, 'scene.svg'), 'utf8'));

  const wide = await ez(['render', 'scene.json', '--font', 'wide.ttf'], folder);
  assert.equal(wide.code, 0, wide.stderr);
  const widePage = pageOf(await readFile(join(folder, 'scene.svg'), 'utf8'));

  assert.ok(widePage.width > kalamPage.width, `${widePage.width}px wide, ${kalamPage.width}px with Kalam`);
  assert.equal(
    widePage.width,
    Math.ceil(20 + 'Hamburgefonstiv'.length * 24 + PAGE_PADDING) - Math.floor(20 - PAGE_PADDING),
    'one em per glyph, measured',
  );
});

test('--font is the font png measures with, so the page follows it', async () => {
  const folder = await sceneFolder({
    version: 1,
    elements: [{ id: 'words', type: 'text', x: 20, y: 20, content: 'Hamburgefonstiv', fontSize: 'L' }],
  });
  await writeFont(folder, 'wide.ttf');

  const plain = await ez(['png', 'scene.json', '--theme', 'light'], folder);
  assert.equal(plain.code, 0, plain.stderr);
  const plainWidth = pngWidth(await readFile(join(folder, 'scene.light.png')));

  const wide = await ez(['png', 'scene.json', '--theme', 'light', '--font', 'wide.ttf'], folder);
  assert.equal(wide.code, 0, wide.stderr);
  const wideWidth = pngWidth(await readFile(join(folder, 'scene.light.png')));

  assert.ok(wideWidth > plainWidth, `${wideWidth}px wide with the wide font, ${plainWidth}px with Kalam`);
  assert.equal(
    wideWidth,
    Math.ceil(20 + 'Hamburgefonstiv'.length * 24 + PAGE_PADDING) - Math.floor(20 - PAGE_PADDING),
    'the PNG is drawn at the page the same measurement gives',
  );
});

test('a Label that does not fit is still drawn, and check reports it', async () => {
  const folder = await sceneFolder(oneBox({ width: 100, height: 40, label: LONG_LABEL }));

  const drawn = await ez(['render', 'scene.json'], folder);
  const checked = await ez(['check', 'scene.json'], folder);

  assert.equal(drawn.code, 0, drawn.stderr);
  assert.equal(existsSync(join(folder, 'scene.svg')), true, 'the words are drawn where the author put them');
  assert.equal(checked.code, 6);
  assert.match(checked.stderr, /^a: label does not fit:/m);
});

test('1,000 words render in under two seconds', async () => {
  const content = Array.from({ length: 1000 }, () => 'word').join(' ');
  const folder = await sceneFolder({
    version: 1,
    elements: [{ id: 'words', type: 'text', x: 20, y: 20, content }],
  });

  const started = performance.now();
  const run = await ez(['render', 'scene.json'], folder);
  const elapsed = performance.now() - started;

  assert.equal(run.code, 0, run.stderr);
  assert.ok(elapsed < 2000, `${Math.round(elapsed)}ms for 1,000 words`);
  assert.ok(pageOf(await readFile(join(folder, 'scene.svg'), 'utf8')).width > 0);
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

/** The page width a PNG was rendered at, straight from IHDR. */
function pngWidth(bytes: Buffer): number {
  return bytes.readUInt32BE(16);
}
