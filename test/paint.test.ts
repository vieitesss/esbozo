/**
 * Seam 3: the drawings an editor keeps between frames.
 *
 * The editor saves what it has already drawn, out of the Element JSON and the
 * SVG fragments the page holds, instead of serialising and drawing the Scene a
 * second time on the way out. So what it assembles has to be the Renderer's own
 * bytes: the file `serialiseScene` writes, the SVG `renderScene` draws, and the
 * hash the CLI stamps into it — computed with the platform's digest, which has
 * to be the CLI's hash of the same bytes.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ez, tempFolder } from './cli.ts';
import { fontBytes } from './fonts.ts';
import { loadProjectModules } from './modules.ts';
import { removeTempFolders } from './temp.ts';
import type { Layout } from '../src/layout.ts';
import type { Scene } from '../src/scene.ts';

after(removeTempFolders);

const {
  PaintCache,
  sceneFile,
  parseScene,
  serialiseScene,
  renderScene,
  hashScene,
  createLayout,
  parseFontFile,
  KALAM,
} = await loadProjectModules();

/** The measurement the CLI draws with, and the wide one a swapped font gives. */
const KALAM_LAYOUT: Layout = createLayout(parseFontFile(KALAM));
const WIDE_LAYOUT: Layout = createLayout(parseFontFile(fontBytes({ advance: 1200 })));

/** A Label, two Snapped ends and a Text: the kinds of drawing an Element has. */
const SOURCE = JSON.stringify(
  {
    version: 1,
    title: 'Drawn',
    defaults: { roughness: 1 },
    elements: [
      {
        id: 'box',
        type: 'rectangle',
        x: 40,
        y: 40,
        width: 160,
        height: 80,
        label: 'a label that wraps',
      },
      { id: 'box2', type: 'rectangle', x: 320, y: 40, width: 120, height: 80 },
      {
        id: 'shaft',
        type: 'arrow',
        points: [
          { x: 200, y: 80, snap: 'box' },
          { x: 320, y: 80, snap: 'box2' },
        ],
      },
      { id: 'words', type: 'text', x: 40, y: 200, content: 'hello' },
    ],
  },
  null,
  2,
);

function sceneOf(source = SOURCE): Scene {
  const parsed = parseScene(source);
  if (!parsed.ok) {
    throw new Error(`the Scene did not parse: ${JSON.stringify(parsed.problems)}`);
  }
  return parsed.scene;
}

test('the file and the SVG in hand are the ones the Renderer writes', async () => {
  const scene = sceneOf();
  const paintables = new PaintCache(KALAM_LAYOUT);
  paintables.paint(scene.elements);

  const files = await paintables.files(scene);
  const expectedHash = hashScene(scene);
  assert.equal(files.json, serialiseScene(scene), 'the file is the serialiser’s own bytes');
  assert.equal(
    files.svg,
    renderScene(scene, KALAM_LAYOUT, expectedHash),
    'the SVG is the Renderer’s own bytes with data-source-hash',
  );
  assert.ok(
    files.svg.includes(`data-scene-hash="sha256:${expectedHash}"`),
    'the platform digest is the CLI’s hash of the same bytes',
  );
  assert.ok(
    files.svg.includes(`data-source-hash="sha256:${expectedHash}"`),
    'editor save stamps data-source-hash from the Scene bytes it writes',
  );
  assert.ok(
    !renderScene(scene, KALAM_LAYOUT).includes('data-source-hash='),
    'in-memory renderScene without a source file omits data-source-hash',
  );

  const folder = await tempFolder();
  await writeFile(join(folder, 'saved.esbozo'), files.json, 'utf8');
  const rendered = await ez(['render', 'saved.esbozo'], folder);
  assert.equal(rendered.code, 0, rendered.stderr);
  const cliSvg = await readFile(join(folder, 'saved.svg'), 'utf8');
  assert.equal(cliSvg, files.svg, 'editor save then ez render gives identical SVG and matching data-source-hash');
});

test('a drawn Element keeps the words it placed, so a caret that moves measures nothing', () => {
  const parsed = parseFontFile(KALAM);
  const measured: string[] = [];
  const counted = createLayout({
    ...parsed,
    metrics: {
      ...parsed.metrics,
      advance: (text, size) => {
        measured.push(text);
        return parsed.metrics.advance(text, size);
      },
    },
  });
  const scene = sceneOf();
  const paintables = new PaintCache(counted);

  const drawn = paintables.paint(scene.elements);
  const box = drawn.elements.get('box')!;
  // The words a caret and a selection sit in are the ones the Element drew:
  // asking the Renderer for them again would measure the same lines twice.
  assert.deepEqual(box.words, counted.label(scene.elements[0]!), 'the Block the Element drew');
  const placed = measured.length;
  assert.ok(placed > 0, 'the Element measured the words it drew');

  // A caret that moved is a frame the Scene is not asked for: the drawing is the
  // one already made, and the Block inside it comes with it.
  const carried = paintables.paint(scene.elements);
  assert.equal(carried.elements.get('box'), box, 'the frame keeps its SVG');
  assert.equal(measured.length, placed, 'no line was measured again');
});

test('an Element that changed is the only one drawn again, and the file follows it', async () => {
  const scene = sceneOf();
  const paintables = new PaintCache(KALAM_LAYOUT);
  const before = paintables.paint(scene.elements);
  const moved: Scene = {
    ...scene,
    elements: scene.elements.map((element) =>
      element.id === 'box' ? { ...element, x: 140 } : element,
    ),
  };
  const after = paintables.paint(moved.elements);

  for (const id of ['box2', 'words']) {
    assert.equal(after.elements.get(id), before.elements.get(id), `${id} keeps the SVG it had`);
  }
  assert.notEqual(after.elements.get('box'), before.elements.get('box'), 'the moved box is drawn again');
  // Its end rides the box: the shaft's own drawing is the target's outline.
  assert.notEqual(after.elements.get('shaft'), before.elements.get('shaft'), 'its Snapped end follows it');

  const files = await paintables.files(moved);
  assert.equal(files.json, serialiseScene(moved));
  assert.equal(files.svg, renderScene(moved, KALAM_LAYOUT, hashScene(moved)));
});

test('a Scene edited by replacing one Element writes that Element again', () => {
  const scene = sceneOf();
  assert.equal(sceneFile(scene), serialiseScene(scene));
  const moved: Scene = {
    ...scene,
    elements: scene.elements.map((element) =>
      element.id === 'box' ? { ...element, x: 140 } : element,
    ),
  };
  assert.equal(
    sceneFile(moved),
    serialiseScene(moved),
    'the block of the Element that changed is the block of the Element it is now',
  );
  assert.notEqual(sceneFile(moved), sceneFile(scene), 'and the file moved with it');
});

test('a new measurement draws the Scene again, and the file keeps its bytes', async () => {
  const scene = sceneOf();
  const paintables = new PaintCache(KALAM_LAYOUT);
  paintables.paint(scene.elements);
  const before = await paintables.files(scene);

  paintables.measure(WIDE_LAYOUT);
  paintables.paint(scene.elements);
  assert.equal(paintables.generation, 1, 'a measurement is a new generation of the painted Elements');
  const after = await paintables.files(scene);

  assert.equal(after.json, before.json, 'a font is not part of the Scene file');
  assert.equal(after.svg, renderScene(scene, WIDE_LAYOUT, hashScene(scene)), 'the SVG is drawn with the new font');
  assert.notEqual(after.svg, before.svg, 'and the wide font draws other words');
});

test('a Scene whose Elements changed since they were painted is drawn before its file is written', async () => {
  const scene = sceneOf();
  const paintables = new PaintCache(KALAM_LAYOUT);
  paintables.paint(scene.elements);
  // The same Elements again, as a gesture that settled hands them over: the
  // drawings in hand were made from another array, so they cannot speak for it.
  const rebuilt: Scene = { ...scene, elements: [...scene.elements] };

  const files = await paintables.files(rebuilt);
  assert.equal(files.json, serialiseScene(rebuilt));
  assert.equal(files.svg, renderScene(rebuilt, KALAM_LAYOUT, hashScene(rebuilt)));
});
