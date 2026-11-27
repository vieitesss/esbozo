/**
 * Script seam: `scripts/check-rules.mjs` on a folder of its own.
 *
 * Every test here writes the files the rule is about into a temporary folder
 * and runs the script on it, so what is asserted is the script's whole
 * behaviour: the finding it prints, the line it names and the exit code. The
 * fixtures are deliberately tiny and deliberately wrong in one way each, and
 * the folder is removed when the file's tests are done.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

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
  '**Frame**:',
  'One drawn border.',
  '_Avoid_: canvas (old name)',
  '',
].join('\n');

/** Every folder a fixture made, removed when this file's tests are done. */
const folders: string[] = [];

after(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A folder holding the given files, as a root the script can check. */
async function root(files: Record<string, string>, raw = false): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'esbozo-rules-'));
  folders.push(folder);
  await writeFile(join(folder, 'GLOSSARY.md'), GLOSSARY, 'utf8');
  await put(folder, raw ? files : withDefaultSeams(files));
  return folder;
}

/** Prepend a valid inline seam comment to synthetic test fixtures for rules 1–6. */
function withDefaultSeams(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, contents] of Object.entries(files)) {
    if (/^test\/[^/]+\.test\.ts$/.test(path)) {
      out[path] = `/* CLI seam */ ${contents}`;
    } else if (/^tests\/[^/]+\.e2e\.ts$/.test(path)) {
      out[path] = `/* Browser seam */ ${contents}`;
    } else {
      out[path] = contents;
    }
  }
  return out;
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
async function check(files: Record<string, string>, raw = false): Promise<Run> {
  return checkIn(await root(files, raw));
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
async function finding(files: Record<string, string>, raw = false): Promise<string> {
  const run = await check(files, raw);
  assert.equal(run.code, 1, run.all);
  assert.equal(run.found.length, 1, run.all);
  return run.found[0]!;
}

/** A fixture that the rules must let through, with nothing printed. */
async function quiet(files: Record<string, string>, raw = false): Promise<void> {
  const run = await check(files, raw);
  assert.equal(run.code, 0, run.all);
  assert.deepEqual(run.found, []);
}

// Rule 1: a Node builtin in a browser-safe module.

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

test('a dynamic import of a builtin is the same finding as a static one', async () => {
  const line = await finding({
    'src/scene.ts': ["const { randomUUID } = await import('node:crypto');", '', 'export const id = randomUUID();'].join('\n'),
  });

  assert.match(line, /^src\/scene\.ts:1: node import "node:crypto" in a browser-safe module$/);
});

test('an import written as an alias of a required builtin is the same finding', async () => {
  const line = await finding({
    'src/scene.ts': ["import crypto = require('node:crypto');", '', 'export const id = crypto.randomUUID();'].join('\n'),
  });

  assert.match(line, /^src\/scene\.ts:1: node import "node:crypto" in a browser-safe module$/);
});

test('a comment between import and its specifier does not hide the builtin', async () => {
  const line = await finding({
    'src/renderer.ts': ["import /* the digest is the browser's own */ 'node:crypto';", ''].join('\n'),
  });

  assert.match(line, /^src\/renderer\.ts:1: node import "node:crypto" in a browser-safe module$/);
});

test('a module the browser never loads may import Node, and no finding is printed', async () => {
  await quiet({
    'src/serve.ts': ["import { randomUUID } from 'node:crypto';", 'export const id = randomUUID();'].join('\n'),
  });
});

// Rule 2: a GLOSSARY.md _Avoid_ term, as a name, a test name or copy.

test('an Avoid term in a name the code chooses is a finding', async () => {
  const line = await finding({
    'src/scene.ts': 'export interface ShapeElement {\n  type: string;\n}\n',
  });

  assert.match(line, /^src\/scene\.ts:1: avoid term "shape" in name "ShapeElement"$/);
});

test('an Avoid term in a name the module exports under another name is a finding', async () => {
  const line = await finding({
    'src/scene.ts': ["const stem = 'a';", 'export { stem as ShapeElement };'].join('\n'),
  });

  assert.match(line, /^src\/scene\.ts:2: avoid term "shape" in name "ShapeElement"$/);
});

test('an Avoid term in a SCREAMING_CASE name is a finding', async () => {
  const line = await finding({
    'src/layout.ts': 'export const SHAPE_ELEMENT = 1;\n',
  });

  assert.match(line, /^src\/layout\.ts:1: avoid term "shape" in name "SHAPE_ELEMENT"$/);
});

test('a plural or a past tense of an Avoid term is that term', async () => {
  const past = await finding({ 'src/layout.ts': 'export const shaped = 1;\n' });
  assert.match(past, /^src\/layout\.ts:1: avoid term "shape" in name "shaped"$/);

  const plural = await finding({ 'src/layout.ts': 'export const drawings: string[] = [];\n' });
  assert.match(plural, /^src\/layout\.ts:1: avoid term "drawing" in name "drawings"$/);
});

test('an Avoid term in a test name is a finding too', async () => {
  const line = await finding({
    'test/render.test.ts': "test('a connector follows its Element', () => {});\n",
  });

  assert.match(line, /^test\/render\.test\.ts:1: avoid term "connector" in test name "a connector follows its Element"$/);
});

test('an Avoid term in a test name written through a member call is a finding', async () => {
  const line = await finding({
    'test/render.test.ts': "t.test('a connector follows its Element', () => {});\n",
  });

  assert.match(
    line,
    /^test\/render\.test\.ts:1: avoid term "connector" in test name "a connector follows its Element"$/,
  );
});

test('the aliases a runner puts on the front of a test call do not hide the name', async () => {
  const run = await check({
    'test/render.test.ts': [
      "describe.skip('the drawing', () => {});",
      "it.only('a drawing', () => {});",
    ].join('\n'),
  });

  assert.equal(run.code, 1, run.all);
  assert.deepEqual(run.found, [
    'test/render.test.ts:1: avoid term "drawing" in test name "the drawing"',
    'test/render.test.ts:2: avoid term "drawing" in test name "a drawing"',
  ]);
});

test('an Avoid term in the copy a person reads is a finding', async () => {
  const line = await finding({
    'src/editor/menu.ts': 'export const title = "Export Drawing";\n',
  });

  assert.match(line, /^src\/editor\/menu\.ts:1: avoid term "drawing" in copy "Export Drawing"$/);
});

test('the words of an interpolated message are copy, and each part is judged', async () => {
  const line = await finding({
    'src/editor/open.ts': [
      'export function message(name: string): string {',
      '  return `The drawing ${name} could not be opened.`;',
      '}',
    ].join('\n'),
  });

  assert.match(line, /^src\/editor\/open\.ts:2: avoid term "drawing" in copy "The drawing"$/);
});

test('a button label inside the editor template is copy, like any other words', async () => {
  const line = await finding({
    'src/editor/editor.ts': [
      'const SHELL = `<div class="tools">',
      '  <button class="tool" title="Draw">Add connector</button>',
      '</div>`;',
      'export const shell = SHELL;',
    ].join('\n'),
  });

  assert.match(line, /^src\/editor\/editor\.ts:2: avoid term "connector" in copy "Add connector"$/);
});

test('a two-word Avoid term is caught when the words are joined in one name', async () => {
  const line = await finding({
    'src/editor/editor.ts': 'export const boundText = 1;\n',
  });

  assert.match(line, /^src\/editor\/editor\.ts:1: avoid term "bound text" in name "boundText"$/);
});

test('a qualifier makes an Avoid term one sense only, and every such entry is left to a person', async () => {
  await quiet({
    'src/scene.ts': ['export interface LabelledBase {', '  label: string;', '}'].join('\n'),
    'src/layout.ts': 'export class CanvasLayer {\n  width = 1;\n}\n',
  });
});

test('the runtime keeps its own name: Node 22, Node-compatible and Node.js are not Elements', async () => {
  await quiet({
    'test/cli.test.ts': [
      "test('the CLI starts under Node 22', () => {});",
      "test('and runs on Node.js', () => {});",
    ].join('\n'),
    'src/serve.ts': "export const note = 'Node-compatible, so it runs anywhere';\n",
  });
});

test('a name with the runtime word inside it is still a name: makeNode is a finding', async () => {
  const line = await finding({
    'src/scene.ts': 'export function makeNode(): number {\n  return 1;\n}\n',
  });

  assert.match(line, /^src\/scene\.ts:1: avoid term "node" in name "makeNode"$/);
});

test('copy that capitalises the runtime word is still copy: Add Node is a finding', async () => {
  const line = await finding({
    'src/editor/menu.ts': 'export const title = "Add Node";\n',
  });

  assert.match(line, /^src\/editor\/menu\.ts:1: avoid term "node" in copy "Add Node"$/);
});

test('an unreadable GLOSSARY.md fails the check loudly, rather than quietly checking nothing', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'esbozo-rules-'));
  folders.push(folder);
  await put(folder, { 'src/scene.ts': 'export interface ShapeElement {\n  type: string;\n}\n' });

  const run = await checkIn(folder);

  assert.equal(run.code, 1, run.all);
  assert.match(run.found[0]!, /^GLOSSARY\.md: cannot read the Avoid list: ENOENT/);
});

test('a GLOSSARY.md that is not a file fails the same way', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'esbozo-rules-'));
  folders.push(folder);
  await mkdir(join(folder, 'GLOSSARY.md'));
  await put(folder, { 'src/scene.ts': 'export const scene = 1;\n' });

  const run = await checkIn(folder);

  assert.equal(run.code, 1, run.all);
  assert.match(run.found[0]!, /^GLOSSARY\.md: cannot read the Avoid list: EISDIR/);
});

test('the Avoid list is read from GLOSSARY.md, so a new term is enforced the day it is written', async () => {
  const folder = await root({});
  await writeFile(
    join(folder, 'GLOSSARY.md'),
    `${GLOSSARY}\n**Stroke**:\nOne drawn line.\n_Avoid_: tracing\n`,
    'utf8',
  );
  await put(folder, { 'src/scene.ts': 'export interface TracingStyle {\n  width: number;\n}\n' });

  const run = await checkIn(folder);

  assert.equal(run.code, 1, run.all);
  assert.match(run.found[0]!, /avoid term "tracing" in name "TracingStyle"/);
});

test('a word that merely contains an Avoid term is not one, and a comment is not a name', async () => {
  await quiet({
    'src/editor/keys.ts': [
      '// The drawing is a Scene: this comment names nothing.',
      'const keyboard = 1;',
      'const clipboard = 2;',
      'export const sum = keyboard + clipboard;',
    ].join('\n'),
  });
});

test('a name that holds an Avoid term inside one word is quiet: node_modules is not a node', async () => {
  await quiet({
    'test/bundle.test.ts': "test('the bundled CLI runs with no node_modules beside it', () => {});\n",
  });
});

test('a selector is not copy a person reads', async () => {
  await quiet({
    'tests/editor.e2e.ts': "const board = 'esbozo-editor .board';\n",
  });
});

test('an Avoid term in a Go comment is a finding, with its line', async () => {
  const line = await finding({
    'internal/core/core.go': [
      'package core',
      '',
      '// The drawing the host hands over is one Scene.',
      'type In struct{}',
    ].join('\n'),
  });

  assert.match(line, /^internal\/core\/core\.go:3: avoid term "drawing" in comment /);
});

test('a Go identifier with the runtime word inside it is still a name, one finding each', async () => {
  const run = await check({
    'cmd/ez/scene.go': ['package main', '', 'var renderNode = 3', 'type Node struct{}'].join('\n'),
  });

  assert.equal(run.code, 1, run.all);
  assert.deepEqual(run.found, [
    'cmd/ez/scene.go:3: avoid term "node" in identifier "renderNode"',
    'cmd/ez/scene.go:4: avoid term "node" in identifier "Node"',
  ]);
});

test('a Go comment names the runtime by its proper noun, with no version after it', async () => {
  await quiet({
    'internal/core/host.go': [
      'package core',
      '',
      '// The message Node prints when a file is missing.',
      'const api = 1',
    ].join('\n'),
  });
});

test('a Go string is not a name, and NodeMessage is the runtime, not an Element', async () => {
  await quiet({
    'internal/resvg/resvg.go': [
      'package resvg',
      '',
      'const api = "the drawing the module exports"',
      '',
      'func NodeMessage() string { return api }',
    ].join('\n'),
  });
});

// Rule 3: a test that reaches past the seam it is testing.

test('a markup regex in a test is a finding', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': "test('a box is drawn', async () => {\n  assert.match(await markup(ui), /^<svg[\\s>]/);\n});\n",
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:2: markup in a regex: drive the page, do not read the SVG it wrote$/);
});

test('the historical page-body markup assertion is a finding too', async () => {
  const line = await finding({
    'test/serve.test.ts': [
      "test('the page holds the editor', async ({ page }) => {",
      '  assert.match(page.body, /<esbozo-editor>/);',
      '});',
    ].join('\n'),
  });

  assert.match(line, /^test\/serve\.test\.ts:2: markup in a regex: drive the page, do not read the SVG it wrote$/);
});

test('a regex a helper returns is a finding', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': ['function tagName(): RegExp {', '  return /<svg>/;', '}'].join('\n'),
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:2: markup in a regex: drive the page, do not read the SVG it wrote$/);
});

test('a markup pattern built with new RegExp is a finding', async () => {
  const line = await finding({
    'test/elements.test.ts': "const root = new RegExp('<svg');\nexport const found = root;\n",
  });

  assert.match(line, /^test\/elements\.test\.ts:1: markup in a regex: drive the page, do not read the SVG it wrote$/);
});

test('a regex on a namespaced tag reads markup just the same', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': "const box = /<svg:svg>/.exec(markup);\n",
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:1: markup in a regex: drive the page, do not read the SVG it wrote$/);
});

test('a tag whose name carries a capital is matched whatever case it is written in', async () => {
  const pattern = await finding({
    'tests/snap.e2e.ts': 'const clip = /<clipPath\\b/.exec(markup);\n',
  });
  assert.match(pattern, /^tests\/snap\.e2e\.ts:1: markup in a regex: drive the page, do not read the SVG it wrote$/);

  const selector = await finding({
    'tests/editor.e2e.ts': "const gradients = await page.evaluate(() => document.querySelectorAll('linearGradient'));\n",
  });
  assert.match(
    selector,
    /^tests\/editor\.e2e\.ts:1: tag-name selector "linearGradient": use a role, a name or a key$/,
  );
});

test('a bounding box in a test is a finding', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': 'const box = await element.boundingBox();\n',
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:1: bounding box: assert on what the page shows, not on the SVG's geometry$/);
});

test('a tag-name selector in a test is a finding', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': "const paths = await page.evaluate(() => document.querySelectorAll('path'));\n",
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:1: tag-name selector "path": use a role, a name or a key$/);
});

test('a compound selector names a tag just as plainly', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': "const paths = await page.evaluate(() => document.querySelectorAll('svg path'));\n",
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:1: tag-name selector "svg path": use a role, a name or a key$/);
});

test('a tag name and an attribute in one compound selector is still a tag name', async () => {
  const line = await finding({
    'tests/embed.e2e.ts': "const drawn = await page.evaluate(() => document.querySelector('g[data-element=\"link\"]'));\n",
  });

  assert.match(line, /^tests\/embed\.e2e\.ts:1: tag-name selector "g\[data-element="link"\]": use a role, a name or a key$/);
});

test('a tag name reached through locator is a finding, because a role is the seam', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': "await page.locator('button').click();\n",
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:1: tag-name selector "button": use a role, a name or a key$/);
});

test('the title element is one of the tags a selector may not name', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': "const heading = await page.evaluate(() => document.querySelector('title'));\n",
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:1: tag-name selector "title": use a role, a name or a key$/);
});

test('the public embed element is not a drawing tag, so naming it stays allowed', async () => {
  await quiet({
    'tests/embed.e2e.ts': "const element = await page.evaluate(() => document.querySelector('esbozo-editor'));\n",
  });
});

test('data-element-id in a test is a finding', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': "const id = ui['data-element-id'] ?? '';\n",
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:1: data-element-id reaches into the page: use a role, a name or a key$/);
});

test('a test that reads a src file for itself is a finding', async () => {
  const line = await finding({
    'test/render.test.ts': "const source = await readFile('src/renderer.ts', 'utf8');\n",
  });

  assert.match(line, /^test\/render\.test\.ts:1: a test reads "src\/renderer\.ts": the module seam is test\/modules\.ts$/);
});

test('a src path joined from its parts is the same read', async () => {
  const line = await finding({
    'test/render.test.ts': [
      "import { readFile } from 'node:fs/promises';",
      '',
      "const source = await readFile(join(root, 'src', 'renderer.ts'), 'utf8');",
    ].join('\n'),
  });

  assert.match(line, /^test\/render\.test\.ts:3: a test reads "src": the module seam is test\/modules\.ts$/);
});

test('a src path named by new URL is the same read', async () => {
  const line = await finding({
    'test/render.test.ts': "const file = await readFile(new URL('../src/scene.ts', import.meta.url));\n",
  });

  assert.match(line, /^test\/render\.test\.ts:1: a test reads "\.\.\/src\/scene\.ts": the module seam is test\/modules\.ts$/);
});

test('a test that drives the page by role and key, and asserts on pixels, is quiet', async () => {
  await quiet({
    'tests/editor.e2e.ts': [
      "test('a box is drawn where the pointer dragged', async ({ screen }) => {",
      "  await screen.getByRole('button', { name: 'Rectangle' }).click();",
      '  await drag(ui, from, to);',
      '  expect((await shot(ui)).darkCount(BOX, 0.6)).toBeGreaterThan(0);',
      "  const moved = await page.evaluate(() => document.querySelector('[data-element=\"l\"] > *'));",
      '});',
    ].join('\n'),
  });
});

test('a markup regex on the SVG file a save wrote is quiet with the one comment', async () => {
  await quiet({
    'test/render.test.ts': [
      'function titleOf(svg: string): string {',
      '  // check-rules: markup of a written SVG file, not the page',
      "  return /<title>([^<]*)<\\/title>/.exec(svg)?.[1] ?? '';",
      '}',
    ].join('\n'),
    'tests/snap.e2e.ts': [
      'function paths(svg: string): string[] {',
      '  // check-rules: markup of a written SVG file, not the page',
      '  return [...svg.matchAll(/<path\\b[^>]*>/g)].map((match) => match[0]);',
      '}',
    ].join('\n'),
  });
});

test('the comment may sit on the line the markup regex is written on', async () => {
  await quiet({
    'test/render.test.ts': [
      "const title = // check-rules: markup of a written SVG file, not the page",
      "  /<title>([^<]*)<\\/title>/.exec(svg)?.[1] ?? '';",
    ].join('\n'),
  });
});

test('a string that says check-rules: excuses nothing', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': [
      "const note = 'check-rules: markup of a written SVG file, not the page';",
      'assert.match(await markup(ui), /<svg[\\s>]/);',
    ].join('\n'),
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:2: markup in a regex: drive the page, do not read the SVG it wrote$/);
});

test('only the exact comment excuses a finding', async () => {
  const line = await finding({
    'test/render.test.ts': [
      'function titleOf(svg: string): string {',
      "  // check-rules: markup of the SVG it wrote, not the page",
      "  return /<title>([^<]*)<\\/title>/.exec(svg)?.[1] ?? '';",
      '}',
    ].join('\n'),
  });

  assert.match(line, /^test\/render\.test\.ts:3: markup in a regex: drive the page, do not read the SVG it wrote$/);
});

test('the comment does not reach a finding two lines below it', async () => {
  const line = await finding({
    'test/render.test.ts': [
      'function titleOf(svg: string): string {',
      '  // check-rules: markup of a written SVG file, not the page',
      '  const text = svg;',
      "  return /<title>([^<]*)<\\/title>/.exec(text)?.[1] ?? '';",
      '}',
    ].join('\n'),
  });

  assert.match(line, /^test\/render\.test\.ts:4: markup in a regex: drive the page, do not read the SVG it wrote$/);
});

test('the comment forgives a markup regex, and nothing else', async () => {
  const line = await finding({
    'tests/editor.e2e.ts': [
      'const box = // check-rules: markup of a written SVG file, not the page',
      '  await element.boundingBox();',
    ].join('\n'),
  });

  assert.match(line, /^tests\/editor\.e2e\.ts:2: bounding box: assert on what the page shows, not on the SVG's geometry$/);
});

test('a DOM structure read in a test is a finding, whichever one it is', async () => {
  const reads = [
    'tagName',
    'nodeName',
    'children',
    'childElementCount',
    'firstElementChild',
    'lastElementChild',
    'innerHTML',
    'outerHTML',
  ];

  for (const read of reads) {
    const line = await finding({ 'tests/editor.e2e.ts': `const seen = node.${read};\n` });
    assert.match(
      line,
      new RegExp(
        `^tests/editor\\.e2e\\.ts:1: dom read "${read}": assert on what the page shows, not on its structure or its rect$`,
      ),
    );
  }
});

test('a rect read in a test is a finding, so a box is no way round the bounding-box rule', async () => {
  const line = await finding({
    'tests/embed.e2e.ts': 'const box = element.getBoundingClientRect();\n',
  });

  assert.match(
    line,
    /^tests\/embed\.e2e\.ts:1: dom read "getBoundingClientRect": assert on what the page shows, not on its structure or its rect$/,
  );
});

test('the host page’s own words may be measured, with the one comment that says so', async () => {
  await quiet({
    'tests/embed.e2e.ts': [
      'function wordsTop(): number {',
      "  // check-rules: rect of the host page's own words, outside <esbozo-editor>",
      "  return Math.round(document.querySelector('.after')!.getBoundingClientRect().top);",
      '}',
    ].join('\n'),
  });
});

test('each comment forgives its own rule, and not the other', async () => {
  const read = await finding({
    'tests/embed.e2e.ts': [
      'const box = // check-rules: markup of a written SVG file, not the page',
      '  element.getBoundingClientRect();',
    ].join('\n'),
  });
  assert.match(
    read,
    /^tests\/embed\.e2e\.ts:2: dom read "getBoundingClientRect": assert on what the page shows, not on its structure or its rect$/,
  );

  const markup = await finding({
    'tests/editor.e2e.ts': [
      "const box = // check-rules: rect of the host page's own words, outside <esbozo-editor>",
      '  /<svg[\\s>]/.exec(markup);',
    ].join('\n'),
  });
  assert.match(markup, /^tests\/editor\.e2e\.ts:2: markup in a regex: drive the page, do not read the SVG it wrote$/);
});

test('the host-page comment forgives the rect of its words, and no other read', async () => {
  const line = await finding({
    'tests/embed.e2e.ts': [
      "const markup = // check-rules: rect of the host page's own words, outside <esbozo-editor>",
      '  element.innerHTML;',
    ].join('\n'),
  });

  assert.match(
    line,
    /^tests\/embed\.e2e\.ts:2: dom read "innerHTML": assert on what the page shows, not on its structure or its rect$/,
  );
});

test('what a node says and how it is styled is not structure, and stays quiet', async () => {
  await quiet({
    'tests/editor.e2e.ts': [
      "const words = document.querySelector('[data-element=\"l\"]')!.textContent;",
      "const role = document.querySelector('[role=\"option\"]')?.getAttribute('role');",
      'const family = getComputedStyle(document.body).fontFamily;',
      'const focused = document.activeElement;',
      'const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink");',
    ].join('\n'),
  });
});

// Rule 4: a Node test reaches the Editor only through the allow-list.

test('an Editor module no Node test may load is a finding, however the bundle names it', async () => {
  const line = await finding({
    'test/modules.ts': [
      'const source = (module: string): string => `../src/${module}`;',
      "source('editor/registry.ts');",
    ].join('\n'),
  });

  assert.match(
    line,
    /^test\/modules\.ts:2: loads "editor\/registry\.ts": node:test reaches the Editor only through the allow-list in check-rules$/,
  );
});

test('a test that imports an Editor module for itself is the same finding', async () => {
  const line = await finding({
    'test/placement.test.ts': "import type { Scene } from '../src/editor/registry.ts';\n",
  });

  assert.match(
    line,
    /^test\/placement\.test\.ts:1: loads "\.\.\/src\/editor\/registry\.ts": node:test reaches the Editor only through the allow-list in check-rules$/,
  );
});

test('every module on the allow-list, and a module outside the Editor, is quiet', async () => {
  await quiet({
    'test/modules.ts': [
      'const source = (module: string): string => `../src/${module}`;',
      "source('editor/history.ts');",
      "source('editor/words.ts');",
      "source('editor/geometry.ts');",
      "source('editor/paint.ts');",
      "source('editor/bend-point.ts');",
    ].join('\n'),
    'test/placement.test.ts': "import type { Scene } from '../src/scene.ts';\n",
  });
});

// Rule 5: every e2e file runs in exactly one script.

/** A package.json whose scripts are the given commands, and nothing else. */
function scriptsJson(commands: Record<string, string>): string {
  return `${JSON.stringify({ scripts: commands }, null, 2)}\n`;
}

test('an e2e file no script runs is a finding, and package.json is where it is fixed', async () => {
  const line = await finding({
    'package.json': scriptsJson({ e2e: 'e2e run tests/editor-opens.e2e.ts' }),
    'tests/editor-opens.e2e.ts': 'export const opened = true;\n',
    'tests/editor-bends.e2e.ts': 'export const bent = true;\n',
  });

  assert.match(
    line,
    /^package\.json:2: tests\/editor-bends\.e2e\.ts is in no e2e script: name it in e2e, e2e:agent or e2e:shots$/,
  );
});

test('a script that names a file which is not there is a finding too', async () => {
  const line = await finding({
    'package.json': scriptsJson({ 'e2e:agent': 'e2e run tests/gone.e2e.ts' }),
  });

  assert.match(line, /^package\.json:3: the e2e:agent script names "tests\/gone\.e2e\.ts", which does not exist$/);
});

test('an e2e file two scripts run is a finding, because exactly one runs it', async () => {
  const line = await finding({
    'package.json': scriptsJson({
      e2e: 'e2e run tests/visual.e2e.ts',
      'e2e:shots': 'e2e run tests/visual.e2e.ts',
    }),
    'tests/visual.e2e.ts': 'export const seen = true;\n',
  });

  assert.match(
    line,
    /^package\.json:3: tests\/visual\.e2e\.ts is in more than one e2e script \(e2e, e2e:shots\): exactly one runs it$/,
  );
});

test('a folder whose every e2e file its one script names is quiet', async () => {
  await quiet({
    'package.json': scriptsJson({
      e2e: 'pnpm build && e2e run tests/editor-opens.e2e.ts tests/svg.e2e.ts',
      'e2e:agent': 'e2e run tests/visual.e2e.ts',
    }),
    'tests/editor-opens.e2e.ts': 'export const opened = true;\n',
    'tests/svg.e2e.ts': 'export const written = true;\n',
    'tests/visual.e2e.ts': 'export const seen = true;\n',
  });
});

// Rule 6: the Editor reaches the Renderer only through its drawn-geometry query.

test('an Editor module that reaches into the outline maths is a finding, with its line', async () => {
  const line = await finding({
    'src/editor/snap.ts': [
      "import { drawnGeometry } from '../renderer.js';",
      "import { shaftPath } from '../geometry.js';",
    ].join('\n'),
  });

  assert.match(
    line,
    /^src\/editor\/snap\.ts:2: reaches "shaftPath" in the outline maths: ask drawnGeometry for the drawn place$/,
  );
});

test('a fine-grained drawn-geometry answer beside the query is the same finding', async () => {
  const line = await finding({
    'src/editor/page.ts': "import { drawnGeometry, wordsInkBounds } from '../renderer.js';\n",
  });

  assert.match(
    line,
    /^src\/editor\/page\.ts:1: reaches "wordsInkBounds" in the Renderer: drawnGeometry is the one answer to a drawn place$/,
  );
});

test('an alias and a re-export are read by the name the outline maths is known by', async () => {
  const alias = await finding({
    'src/editor/gestures.ts': "import { shaftDots as dots } from '../geometry.js';\n",
  });
  assert.match(alias, /^src\/editor\/gestures\.ts:1: reaches "shaftDots" in the outline maths/);

  const reexport = await finding({
    'src/editor/paint.ts': "export { cornerOf } from '../geometry.js';\n",
  });
  assert.match(reexport, /^src\/editor\/paint\.ts:1: reaches "cornerOf" in the outline maths/);
});

test('the outline maths under a namespace is the same finding, because no name is left to judge', async () => {
  const line = await finding({
    'src/editor/bend-point.ts': "import * as maths from '../geometry.js';\n",
  });

  assert.match(
    line,
    /^src\/editor\/bend-point\.ts:1: reaches the outline maths whole: name the export the Editor needs, or ask drawnGeometry$/,
  );
});

test('the query, the helpers the Editor shares over a box, and the CLI are quiet', async () => {
  await quiet({
    'src/editor/page.ts': [
      "import { drawnGeometry } from '../renderer.js';",
      "import { anchorOf, insideOutline, labelAtFor } from '../geometry.js';",
      "import type { ShaftPath } from '../geometry.js';",
    ].join('\n'),
    'src/cli.ts': [
      "import { pointOnOutline, shaftPath } from './geometry.js';",
      "import { drawnGeometry } from './renderer.js';",
    ].join('\n'),
  });
});

// Rule 7: every test file names its seam in its leading comment.

test('a test file without a leading seam comment is a finding', async () => {
  const nodeLine = await finding({ 'test/render.test.ts': "import { test } from 'node:test';\n" }, true);
  assert.match(
    nodeLine,
    /^test\/render\.test\.ts:1: missing leading seam comment: name CLI seam, Module seam, or Script seam$/,
  );

  const e2eLine = await finding({ 'tests/editor.e2e.ts': "import { test } from '@e2e-dev/web';\n" }, true);
  assert.match(e2eLine, /^tests\/editor\.e2e\.ts:1: missing leading seam comment: name Browser seam$/);
});

test('a numbered seam in a test file header is a finding', async () => {
  const line = await finding(
    {
      'test/render.test.ts': ['/**', ' * Seam 1: the built ez CLI.', ' */', "import { test } from 'node:test';"].join(
        '\n',
      ),
    },
    true,
  );
  assert.match(
    line,
    /^test\/render\.test\.ts:2: numbered seam "Seam 1": use a named seam \(CLI seam, Browser seam, Module seam, or Script seam\)$/,
  );
});

test('a leading comment that names no seam is a finding', async () => {
  const line = await finding(
    {
      'test/render.test.ts': ['/**', ' * Tests for rendering.', ' */', "import { test } from 'node:test';"].join('\n'),
    },
    true,
  );
  assert.match(
    line,
    /^test\/render\.test\.ts:1: leading comment must name a seam \(CLI seam, Module seam, or Script seam\)$/,
  );
});

test('a test file naming a seam from the wrong directory is a finding', async () => {
  const nodeLine = await finding(
    {
      'test/render.test.ts': ['/** Browser seam: wrong place. */', "import { test } from 'node:test';"].join('\n'),
    },
    true,
  );
  assert.match(
    nodeLine,
    /^test\/render\.test\.ts:1: test\/\*\.test\.ts must use CLI seam, Module seam, or Script seam, not Browser seam$/,
  );

  const e2eLine = await finding(
    {
      'tests/editor.e2e.ts': ['/** CLI seam: wrong place. */', "import { test } from '@e2e-dev/web';"].join('\n'),
    },
    true,
  );
  assert.match(e2eLine, /^tests\/editor\.e2e\.ts:1: tests\/\*\.e2e\.ts must use Browser seam, not CLI seam$/);
});

test('every valid named seam in its matching directory is quiet', async () => {
  await quiet(
    {
      'test/cli.test.ts': ['/**', ' * CLI seam: runs ez.', ' */', "import { test } from 'node:test';"].join('\n'),
      'test/mod.test.ts': ['// Module seam: exercises Layout.', "import { test } from 'node:test';"].join('\n'),
      'test/scr.test.ts': ['/** Script seam: runs a script. */', "import { test } from 'node:test';"].join('\n'),
      'tests/ui.e2e.ts': ['/**', ' * Browser seam: drives the editor.', ' */', "import { test } from '@e2e-dev/web';"].join('\n'),
    },
    true,
  );
});
