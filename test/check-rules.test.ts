/**
 * Seam 3: `scripts/check-rules.mjs` on a folder of its own.
 *
 * Every test here writes the files the rule is about into a temporary folder
 * and runs the script on it, so what is asserted is the script's whole
 * behaviour: the finding it prints, the line it names and the exit code. The
 * fixtures are deliberately tiny and deliberately wrong in one way each.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../scripts/check-rules.mjs', import.meta.url));

const GLOSSARY = [
  '# esbozo',
  '',
  '## Language',
  '',
  '**Scene**:',
  'One diagram.',
  '_Avoid_: drawing, document, board',
  '',
  '**Element**:',
  'Anything drawn.',
  '_Avoid_: shape, connector, node',
  '',
  '**Label**:',
  'Text that belongs to an Element.',
  '_Avoid_: caption, bound text',
  '',
  '**Text**:',
  'Only words.',
  '_Avoid_: label (for free-standing text)',
  '',
].join('\n');

/** A folder holding the given files, as a root the script can check. */
async function root(files: Record<string, string>): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'esbozo-rules-'));
  await writeFile(join(folder, 'GLOSSARY.md'), GLOSSARY, 'utf8');
  await put(folder, files);
  return folder;
}

/** The files, written into a folder that already has a glossary. */
async function put(folder: string, files: Record<string, string>): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), contents, 'utf8');
  }
}

interface Run {
  code: number;
  found: string[];
  all: string;
}

/** The script on that folder, as the lines it printed. */
async function check(files: Record<string, string>): Promise<Run> {
  return checkIn(await root(files));
}

/** The script on a folder prepared by hand. */
async function checkIn(folder: string): Promise<Run> {
  const run = await new Promise<Run>((resolve) => {
    execFile(process.execPath, [SCRIPT, folder], (error, stdout, stderr) => {
      const all = `${stdout}${stderr}`;
      resolve({ code: error === null ? 0 : (error.code as number), found: [], all });
    });
  });
  return { ...run, found: run.all.split('\n').filter((line) => line !== '') };
}

/** The one finding a fixture produced, so the message is asserted whole. */
async function finding(files: Record<string, string>): Promise<string> {
  const run = await check(files);
  assert.equal(run.code, 1, run.all);
  assert.equal(run.found.length, 1, run.all);
  return run.found[0]!;
}

test('a plain Node import in a browser-safe module is a finding, with its line', async () => {
  const line = await finding({
    'src/scene.ts': ["import { randomUUID } from 'node:crypto';", '', 'export const id = randomUUID();'].join('\n'),
  });

  assert.match(line, /^src\/scene\.ts:1: node import "node:crypto" in a browser-safe module$/);
});

test('the editor folder is browser-safe too, every file of it', async () => {
  const line = await finding({
    'src/editor/palette.ts': ["import { homedir } from 'node:os';", ''].join('\n'),
  });

  assert.match(line, /^src\/editor\/palette\.ts:1: node import "node:os" in a browser-safe module$/);
});

test('a module the browser never loads may import Node, and no finding is printed', async () => {
  const run = await check({
    'src/serve.ts': ["import { randomUUID } from 'node:crypto';", 'export const id = randomUUID();'].join('\n'),
  });

  assert.equal(run.code, 0, run.all);
  assert.deepEqual(run.found, []);
});

test('an Avoid term in a name the code chooses is a finding', async () => {
  const line = await finding({
    'src/scene.ts': 'export interface ShapeElement {\n  type: string;\n}\n',
  });

  assert.match(line, /^src\/scene\.ts:1: avoid term "shape" in name "ShapeElement"$/);
});

test('an Avoid term in a test name is a finding too', async () => {
  const line = await finding({
    'test/render.test.ts': "test('a connector follows its Element', () => {});\n",
  });

  assert.match(line, /^test\/render\.test\.ts:1: avoid term "connector" in test name "a connector follows its Element"$/);
});

test('an Avoid term in the copy a person reads is a finding', async () => {
  const line = await finding({
    'src/editor/menu.ts': 'export const title = "Export Drawing";\n',
  });

  assert.match(line, /^src\/editor\/menu\.ts:1: avoid term "drawing" in copy "Export Drawing"$/);
});

test('a two-word Avoid term is caught when the words are joined in one name', async () => {
  const line = await finding({
    'src/editor/editor.ts': 'export const boundText = 1;\n',
  });

  assert.match(line, /^src\/editor\/editor\.ts:1: avoid term "bound text" in name "boundText"$/);
});

test('a qualifier makes an Avoid term one sense only, and that one is left to a person', async () => {
  const run = await check({
    'src/scene.ts': [
      'export interface LabelledBase {',
      '  label: string;',
      '}',
    ].join('\n'),
  });

  assert.equal(run.code, 0, run.all);
  assert.deepEqual(run.found, []);
});

test('a word that merely contains an Avoid term is not one, and a comment is not a name', async () => {
  const run = await check({
    'src/editor/keys.ts': [
      '// The drawing is a Scene: this comment names nothing.',
      'const keyboard = 1;',
      'const clipboard = 2;',
      'export const sum = keyboard + clipboard;',
    ].join('\n'),
  });

  assert.equal(run.code, 0, run.all);
  assert.deepEqual(run.found, []);
});

test('the Avoid list is read from GLOSSARY.md, so a new term is enforced the day it is written', async () => {
  const folder = await root({});
  await writeFile(
    join(folder, 'GLOSSARY.md'),
    `${GLOSSARY}\n**Frame**:\nOne drawn border.\n_Avoid_: border\n`,
    'utf8',
  );
  await put(folder, { 'src/scene.ts': 'export interface BorderStyle {\n  width: number;\n}\n' });

  const run = await checkIn(folder);

  assert.equal(run.code, 1, run.all);
  assert.match(run.found[0]!, /avoid term "border" in name "BorderStyle"/);
});

test('a markup regex in a test is a finding', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': "test('a box is drawn', async () => {\n  assert.match(await markup(ui), /^<svg[\\s>]/);\n});\n",
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:2: markup in a regex: drive the page, do not read the SVG it wrote$/);
});

test('a bounding box in a test is a finding', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': "const box = await element.boundingBox();\n",
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:1: bounding box: assert on what the page shows, not on the SVG's geometry$/);
});

test('a tag-name selector in a test is a finding', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': "const paths = await page.evaluate(() => document.querySelectorAll('path'));\n",
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:1: tag-name selector "path": use a role, a name or a key$/);
});

test('data-element-id in a test is a finding', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': "const id = ui['data-element-id'] ?? '';\n",
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:1: data-element-id reaches into the page: use a role, a name or a key$/);
});

test('a test that reads a src file for itself is a finding, except the module seam', async () => {
  const line = await finding({
    'test/render.test.ts': "const source = await readFile('src/renderer.ts', 'utf8');\n",
  });

  assert.match(line, /^test\/render\.test\.ts:1: a test reads "src\/renderer\.ts": the module seam is test\/modules\.ts$/);

  const seam = await check({
    'test/modules.ts': "const path = new URL('../src/scene.ts', import.meta.url);\n",
  });
  assert.equal(seam.code, 0, seam.all);
});

test('a test that drives the page by role and key, and asserts on pixels, is quiet', async () => {
  const run = await check({
    'tests/editor.e2e.ts': [
      "test('a box is drawn where the pointer dragged', async ({ screen }) => {",
      "  await screen.getByRole('button', { name: 'Rectangle' }).click();",
      "  await drag(ui, from, to);",
      "  expect((await shot(ui)).darkCount(BOX, 0.6)).toBeGreaterThan(0);",
      '});',
    ].join('\n'),
  });

  assert.equal(run.code, 0, run.all);
  assert.deepEqual(run.found, []);
});

test('a name that holds an Avoid term inside one word is quiet: node_modules is not a node', async () => {
  const run = await check({
    'test/bundle.test.ts': "test('the bundled CLI runs with no node_modules beside it', () => {});\n",
  });

  assert.equal(run.code, 0, run.all);
  assert.deepEqual(run.found, []);
});

test('a selector is not copy a person reads', async () => {
  const run = await check({
    'tests/editor.e2e.ts': "const board = 'esbozo-editor .board';\n",
  });

  assert.equal(run.code, 0, run.all);
  assert.deepEqual(run.found, []);
});

test('a markup regex on the SVG file a test read is quiet with the one comment', async () => {
  const excused = await check({
    'test/render.test.ts': [
      'function titleOf(svg: string): string {',
      "  // check-rules: markup of the CLI's SVG, not the page",
      "  return /<title>([^<]*)<\\/title>/.exec(svg)?.[1] ?? '';",
      '}',
    ].join('\n'),
  });
  assert.equal(excused.code, 0, excused.all);
  assert.deepEqual(excused.found, []);

  const saved = await check({
    'tests/snap.e2e.ts': [
      "  // check-rules: markup of the SVG the save wrote, not the page",
      "  assert.match((await savedFiles(ui))['scene.svg'] ?? '', /^<svg[\\s>]/);",
    ].join('\n'),
  });
  assert.equal(saved.code, 0, saved.all);
  assert.deepEqual(saved.found, []);
});
