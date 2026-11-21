/**
 * Seam 3: the Scene module the editor calls.
 *
 * The CLI parses a Scene before it uses it, but the editor holds one in memory
 * and mutates it: it assigns `x = 40.2` when a rectangle is dragged. Saving,
 * hashing and drawing must all agree on one whole-pixel geometry, so this seam
 * drives the public Scene functions directly.
 *
 * The modules are loaded through a bundle because that is how the editor loads
 * them, and because Rough.js ships imports Node cannot resolve on its own.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';
import type { RectangleElement, Scene } from '../src/scene.ts';

const BOX = {
  version: 1,
  title: 'One box',
  defaults: { roughness: 1 },
  elements: [{ id: 'a', type: 'rectangle', x: 40, y: 40, width: 120, height: 80 }],
};

const { hashScene, parseScene, renderScene, serialiseScene, emptyScene, createLayout, parseFontFile, KALAM } =
  await loadProjectModules();

/** The drawing is measured with the bundled font, as `ez render` measures it. */
const LAYOUT = createLayout(parseFontFile(KALAM));

test('a Scene mutated in memory saves, hashes and draws as its whole pixels', () => {
  const whole = parsed(BOX);
  const dragged = parsed(BOX);
  const box = rectangleOf(dragged);
  box.x = 40.2;
  box.y = 39.9;
  box.width = 120.4;
  box.height = 80.4;

  const saved = serialiseScene(dragged);
  assert.equal(saved, serialiseScene(whole), 'the saved Scene is the whole-pixel Scene');
  assert.doesNotMatch(saved, /40\.2|39\.9|120\.4|80\.4/, 'no fractional geometry is saved');

  const reopened = parseScene(saved);
  assert.ok(reopened.ok, 'the saved Scene still parses');
  assert.deepEqual(reopened.scene, whole, 'reopening gives the whole-pixel Scene');
  assert.equal(serialiseScene(reopened.scene), saved, 'saving that Scene again changes nothing');

  assert.equal(hashScene(dragged), hashScene(whole), 'the hash follows the saved geometry');
  assert.equal(renderScene(dragged, LAYOUT), renderScene(whole, LAYOUT), 'and so does the SVG');
  assert.match(renderScene(dragged, LAYOUT), /viewBox="24 24 152 112"/);
});

test('saving and rendering leave the Scene the caller holds alone', () => {
  const scene = parsed(BOX);
  const box = rectangleOf(scene);
  box.x = 40.2;

  serialiseScene(scene);
  renderScene(scene, LAYOUT);

  assert.equal(box.x, 40.2, 'the editor still owns the value it assigned');
});

test('an arrow dragged in memory saves and draws as its whole-pixel points', () => {
  const scene = parsed(CONNECTOR);
  const arrow = scene.elements[1];
  assert.equal(arrow?.type, 'arrow');
  if (arrow?.type !== 'arrow') {
    throw new Error('expected an arrow');
  }
  arrow.points = [
    { x: 200.4, y: 39.9 },
    { x: 100.3, y: 100.2, snap: 'box' },
  ];

  const whole = parsed({
    ...CONNECTOR,
    elements: [
      CONNECTOR.elements[0],
      {
        ...CONNECTOR.elements[1],
        points: [
          { x: 200, y: 40 },
          { x: 100, y: 100, snap: 'box' },
        ],
      },
    ],
  });

  const saved = serialiseScene(scene);
  assert.equal(saved, serialiseScene(whole), 'the points are saved as whole pixels');
  assert.doesNotMatch(saved, /200\.4|39\.9|100\.3|100\.2/);
  assert.equal(hashScene(scene), hashScene(whole), 'the hash follows the saved points');
  assert.equal(renderScene(scene, LAYOUT), renderScene(whole, LAYOUT), 'and so does the SVG');
  assert.equal(parseScene(saved).ok, true, 'the saved Scene still parses');
});

test('rendering a Snap whose target has no outline fails loudly', () => {
  // The editor can hold a Scene that never went through parseScene, so the
  // Renderer refuses to draw a free end where the Scene says there is a Snap.
  const toWords = parsed({
    version: 1,
    elements: [
      { id: 'words', type: 'text', x: 40, y: 40, content: 'Words' },
      { id: 'box', type: 'rectangle', x: 200, y: 40, width: 60, height: 60 },
      {
        id: 'arrow',
        type: 'arrow',
        points: [
          { x: 40, y: 200 },
          { x: 100, y: 100, snap: 'box' },
        ],
      },
    ],
  });
  const arrow = toWords.elements[2];
  assert.equal(arrow?.type, 'arrow');
  if (arrow?.type !== 'arrow') {
    throw new Error('expected an arrow');
  }

  arrow.points[1] = { ...arrow.points[1]!, snap: 'words' };
  assert.throws(
    () => renderScene(toWords, LAYOUT),
    /arrow: snap target "words" must be a rectangle, ellipse or diamond/,
  );

  arrow.points[1] = { ...arrow.points[1]!, snap: 'nowhere' };
  assert.throws(() => renderScene(toWords, LAYOUT), /arrow: snap target "nowhere" does not exist/);
});

test('the saved file is written the one way a person reads: two spaces, one Element per block', () => {
  // A Scene file as it sits on disk, and as `serialiseScene` has to keep it:
  // the version, the title, the whole defaults object, then each Element's own
  // block, its style spelled out and an alignment only when one is written.
  const FILE = `{
  "version": 1,
  "title": "Two things",
  "defaults": {
    "roughness": 1,
    "stroke": {
      "width": "bold",
      "style": "solid"
    },
    "fill": {
      "kind": "none",
      "grey": 2
    },
    "tone": "ink",
    "corners": "sharp",
    "fontSize": "M"
  },
  "elements": [
    {
      "id": "box",
      "type": "rectangle",
      "x": 40,
      "y": 40,
      "width": 160,
      "height": 120,
      "label": "orders",
      "seed": 3,
      "roughness": 2,
      "stroke": {
        "width": "thin",
        "style": "dashed"
      },
      "fill": {
        "kind": "solid",
        "grey": 5
      },
      "tone": "muted",
      "corners": "round",
      "fontSize": "L",
      "textAlign": "left"
    },
    {
      "id": "words",
      "type": "text",
      "x": 40,
      "y": 200,
      "content": "free-standing",
      "seed": 5,
      "roughness": 1,
      "stroke": {
        "width": "bold",
        "style": "solid"
      },
      "fill": {
        "kind": "none",
        "grey": 2
      },
      "tone": "ink",
      "corners": "sharp",
      "fontSize": "M",
      "textAlign": "right"
    }
  ]
}
`;

  const scene = parsed(JSON.parse(FILE));
  assert.equal(serialiseScene(scene), FILE, 'the file read and written is the same file, byte for byte');
});

test('a Scene that writes no alignment centres its Labels and leaves its Text left', () => {
  // The Scene the editor starts from: no alignment, so each Element resolves
  // its own. A Scene saved from it and reopened must read the same way.
  const saved = JSON.parse(serialiseScene(emptyScene('Bare')));
  assert.deepEqual(
    saved.defaults,
    {
      roughness: 1,
      stroke: { width: 'bold', style: 'solid' },
      fill: { kind: 'none', grey: 2 },
      tone: 'ink',
      corners: 'sharp',
      fontSize: 'M',
    },
    'a new Scene writes no alignment and no fill',
  );

  saved.elements = [
    { id: 'box', type: 'rectangle', x: 40, y: 40, width: 160, height: 120, label: 'orders' },
    { id: 'words', type: 'text', x: 40, y: 200, content: 'free-standing' },
  ];
  const [box, words] = parsed(saved).elements;
  assert.equal(box?.textAlign, 'center', 'a Label centres in the Element it belongs to');
  assert.equal(words?.textAlign, 'left', 'a Text keeps the left edge its x places');
});

test('a written textAlign wins, in the Scene or in the Element', () => {
  const elements = [
    { id: 'box', type: 'rectangle', x: 40, y: 40, width: 160, height: 120, label: 'orders' },
    { id: 'words', type: 'text', x: 40, y: 200, content: 'free-standing' },
  ];

  const fromScene = parsed({ version: 1, defaults: { textAlign: 'right' }, elements });
  assert.deepEqual(
    fromScene.elements.map((element) => element.textAlign),
    ['right', 'right'],
    'defaults.textAlign reaches Labels and Text alike',
  );

  const fromElement = parsed({
    version: 1,
    elements: [{ ...elements[0], textAlign: 'left' }, { ...elements[1], textAlign: 'center' }],
  });
  assert.deepEqual(
    fromElement.elements.map((element) => element.textAlign),
    ['left', 'center'],
    "an Element's own textAlign wins over the type default",
  );
});

const CONNECTOR = {
  version: 1,
  title: 'One arrow',
  elements: [
    { id: 'box', type: 'rectangle', x: 40, y: 40, width: 60, height: 60 },
    {
      id: 'arrow',
      type: 'arrow',
      points: [
        { x: 200, y: 40 },
        { x: 100, y: 100, snap: 'box' },
      ],
    },
  ],
};

/** The one rectangle this seam drives, narrowed so the editor can mutate its geometry. */
function rectangleOf(scene: Scene): RectangleElement {
  const element = scene.elements[0]!;
  if (element.type !== 'rectangle') {
    throw new Error(`expected a rectangle, got ${element.type}`);
  }
  return element;
}

function parsed(scene: unknown): Scene {
  const result = parseScene(JSON.stringify(scene));
  if (!result.ok) {
    throw new Error(`Scene did not parse: ${result.problems.map((p) => p.message).join('; ')}`);
  }
  return result.scene;
}
