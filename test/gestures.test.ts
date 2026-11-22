/**
 * Seam 3: the pointer's pick reads the ink the page painted.
 *
 * `ez` cannot reach this case: no command presses on a Scene, so the pick that
 * decides what a press lands on is only reached by the editor's pointer. The
 * pointer asks its host for the painted ink of the Scene in hand, and this seam
 * drives that press against a page double, so the ink a pick reads is the one
 * the page shows rather than one measured again.
 *
 * The module is loaded through the bundle for the same reason the Scene seam is:
 * that is how the editor loads it, and Rough.js ships imports Node cannot
 * resolve on its own.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';
import type { Scene } from '../src/scene.ts';

const { parseScene, createLayout, parseFontFile, KALAM, Gestures } = await loadProjectModules();

/** The drawing is measured with the bundled font, as `ez render` measures it. */
const LAYOUT = createLayout(parseFontFile(KALAM));

test('a press picks by the ink the page painted for the Scene', () => {
  // The page painted this Scene's Element at `painted`, so a press there lands
  // on the Element and a press on the box the Renderer would have used lands on
  // nothing: the frame the page holds answers a press, and it is not re-measured.
  const scene = parsed({
    version: 1,
    elements: [{ id: 'box', type: 'rectangle', x: 100, y: 100, width: 200, height: 100 }],
  });
  const painted = { x: 600, y: 100, width: 200, height: 100 };
  const editor = editorOn(scene, () => painted);

  editor.gestures.down(press(700, 150));
  assert.deepEqual(editor.selected, ['box'], 'a press on the painted ink picks its Element');

  editor.gestures.down(press(200, 150));
  assert.deepEqual(editor.selected, [], 'and a press where only the Renderer would draw it does not');
});

/**
 * A page double for one Scene: the host a press asks, with the painted ink it
 * answers and the selection it took, so a press can be driven without a browser.
 */
function editorOn(scene: Scene, ink: () => Box) {
  const state = { selected: [] as string[] };
  const viewport = {
    view: { zoom: 1, panX: 0, panY: 0 },
    scenePoint: (pointer: { clientX: number; clientY: number }) => ({
      x: pointer.clientX,
      y: pointer.clientY,
    }),
    screenPoint: (pointer: { clientX: number; clientY: number }) => ({
      x: pointer.clientX,
      y: pointer.clientY,
    }),
  };
  const nothing = (): never => {
    throw new Error('the press asked its host for something it should not need');
  };
  const host: ConstructorParameters<typeof Gestures>[0] = {
    board: { classList: { add() {}, remove() {}, toggle() {} } } as unknown as HTMLElement,
    canvas: {} as SVGSVGElement,
    menu: {} as HTMLElement,
    scene: () => scene,
    layout: () => LAYOUT,
    page: {
      ink,
      paint: nothing,
      viewport,
      wordsNearest: nothing,
      wordsOffset: nothing,
    } as unknown as ConstructorParameters<typeof Gestures>[0]['page'],
    selected: () => state.selected,
    select: (ids) => {
      state.selected = [...ids];
    },
    tool: () => 'select',
    setTool: nothing,
    writable: () => true,
    typing: {
      text: () => null,
      typedOffset: nothing,
      openWords: nothing,
      openTextInput: nothing,
    },
    applyScene: nothing,
    refresh() {},
    showPanning() {},
  };
  return {
    gestures: new Gestures(host),
    get selected() {
      return state.selected;
    },
  };
}

/** A left press at a point on the page, as the pointer delivers it. */
function press(x: number, y: number): PointerEvent {
  return {
    button: 0,
    clientX: x,
    clientY: y,
    pointerId: 1,
    timeStamp: 0,
    shiftKey: false,
    altKey: false,
    target: null,
    preventDefault() {},
  } as unknown as PointerEvent;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function parsed(scene: unknown): Scene {
  const result = parseScene(JSON.stringify(scene));
  if (!result.ok) {
    throw new Error(`Scene did not parse: ${result.problems.map((p) => p.message).join('; ')}`);
  }
  return result.scene;
}
