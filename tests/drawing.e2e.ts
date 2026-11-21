/**
 * Seam 2: drawing, shortcuts, undo, duplicate and copy/paste in the editor.
 *
 * Same rules as `tests/editor.e2e.ts`: a person's input only — the rail, the
 * pointer, the keys and the system clipboard — and the assertion is the Scene
 * the editor saves. No test here reads the DOM, an editor field or a class name,
 * so a refactor that keeps the behaviour cannot break one. No test here uses the
 * model either, so `pnpm e2e` still passes with no key set.
 *
 * The viewport and the fixtures put every Scene point at a fixed page point
 * (`VIEW`), so the pointer lands where the test means without reading a
 * transform.
 */
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  SCENE,
  SNAPPED,
  SNAPPED_SCENE,
  at,
  browseFolder,
  clickScene,
  drag,
  dragBy,
  openEditor,
  savedFiles,
  savedScene,
} from './helpers.ts';
import type { Folders, Ui } from './helpers.ts';
import type { Point } from './helpers.ts';

const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
const SCENES: Folders = { A: { 'scene.json': SCENE_SOURCE } };
const SNAPPED_SOURCE = JSON.stringify(SNAPPED_SCENE, null, 2);

/** Open a Scene from its folder, `scene.json` by default: two rectangles, `a` and `b`. */
async function open(ui: Ui, folders: Folders = SCENES, name = 'scene.json'): Promise<void> {
  await openEditor(ui, folders, name);
}

/** A spot on the empty canvas, clear of both rectangles. */
const PAPER: Point = { x: 420, y: 40 };

/** The Scene a test just saved, as a map by id. */
async function saved(ui: Ui, name = 'scene.json') {
  const scene = await savedScene(ui, name);
  return new Map(scene.elements.map((element) => [element.id, element]));
}

describe('drawing', () => {
  test('R draws a rectangle where it is dragged, and the tool goes back to Select', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await browser.keyboard.press('r');
    await drag(ui, at(PAPER), at({ x: PAPER.x + 120, y: PAPER.y + 100 }));

    const scene = await savedScene(ui);
    expect(scene.elements.length).toBe(3);
    const drawn = scene.elements[2];
    expect({
      type: drawn?.type,
      x: drawn?.x,
      y: drawn?.y,
      width: drawn?.width,
      height: drawn?.height,
    }).toEqual({ type: 'rectangle', x: 420, y: 40, width: 120, height: 100 });

    // The tool went back to Select: dragging the new box moves it, and no
    // second Element is drawn.
    await dragBy(ui, { x: PAPER.x + 60, y: PAPER.y + 50 }, 10, 10);
    const after = await savedScene(ui);
    expect(after.elements.length).toBe(3);
    expect(after.elements[2]?.x).toBe(430);
  });

  test('the rail draws every Element type, and a drawn Element takes the Scene defaults', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    const drawings: Array<[string, Point, Point]> = [
      ['Rectangle', { x: 420, y: 40 }, { x: 520, y: 120 }],
      ['Ellipse', { x: 540, y: 40 }, { x: 640, y: 120 }],
      ['Diamond', { x: 660, y: 40 }, { x: 760, y: 120 }],
      ['Arrow', { x: 420, y: 200 }, { x: 560, y: 260 }],
      ['Line', { x: 600, y: 200 }, { x: 740, y: 260 }],
    ];
    for (const [tool, from, to] of drawings) {
      await screen.getByRole('button', { name: tool }).click();
      await drag(ui, at(from), at(to));
    }

    const scene = savedScene(ui);
    const elements = (await scene).elements;
    expect(elements.map((element) => element.type)).toEqual([
      'rectangle',
      'rectangle',
      'rectangle',
      'ellipse',
      'diamond',
      'arrow',
      'line',
    ]);

    // A drawn Element carries the Scene's defaults, not a copy of the editor's
    // idea of them: this Scene draws with a hachure fill and bold solid stroke.
    const ellipse = elements[3];
    expect(ellipse?.fill).toEqual({ kind: 'hachure', grey: 2 });
    expect(ellipse?.stroke).toEqual({ width: 'bold', style: 'solid' });
    expect(ellipse?.tone).toBe('ink');

    // An arrow and a line are exactly two free ends: Snap is #8's.
    expect(elements[5]?.points).toEqual([
      { x: 420, y: 200 },
      { x: 560, y: 260 },
    ]);
    expect(elements[6]?.points).toEqual([
      { x: 600, y: 200 },
      { x: 740, y: 260 },
    ]);
  });

  test('a drawn Element takes the Scene defaults of roughness and fill, not the editor latest look', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    // An empty Scene: the page is the empty page, so the view is known here.
    const ROUGH_SCENE = {
      version: 1,
      title: 'Rough',
      defaults: { roughness: 0, fill: { kind: 'none' } },
      elements: [],
    };
    await openEditor(
      ui,
      { A: { 'rough.json': JSON.stringify(ROUGH_SCENE, null, 2) } },
      'rough.json',
    );
    const EMPTY = { zoom: 1, panX: 480, panY: 280 };

    await browser.keyboard.press('d');
    await drag(ui, at({ x: 40, y: 40 }, EMPTY), at({ x: 160, y: 120 }, EMPTY));

    const scene = await savedScene(ui, 'rough.json');
    const drawn = scene.elements[0];
    expect({
      type: drawn?.type,
      x: drawn?.x,
      y: drawn?.y,
      roughness: drawn?.roughness,
      fill: drawn?.fill,
    }).toEqual({ type: 'diamond', x: 40, y: 40, roughness: 0, fill: { kind: 'none', grey: 2 } });
  });

  test('a plain click with a box tool draws a default box, and with a stroke tool draws nothing', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await browser.keyboard.press('e');
    await clickScene(ui, PAPER);
    const one = await savedScene(ui);
    expect(one.elements.length).toBe(3);
    expect({
      type: one.elements[2]?.type,
      x: one.elements[2]?.x,
      y: one.elements[2]?.y,
      width: one.elements[2]?.width,
      height: one.elements[2]?.height,
    }).toEqual({ type: 'ellipse', x: 420, y: 40, width: 160, height: 100 });

    // A stroke needs a length to be seen, so a click with the line tool adds
    // nothing and writes nothing.
    await browser.keyboard.press('s');
    await clickScene(ui, { x: 620, y: 300 });
    const files = await savedFiles(ui);
    expect(JSON.parse(files['scene.json'] ?? '{}').elements.length).toBe(3);
  });

  test('the numbers 1–7 pick the rail tools in rail order', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);

    // 4 is Diamond: whatever key was pressed before, this draws a diamond.
    await browser.keyboard.press('r');
    await browser.keyboard.press('4');
    await drag(ui, at(PAPER), at({ x: PAPER.x + 100, y: PAPER.y + 100 }));

    // 7 is Text: a click opens the words rather than drawing a box.
    await browser.keyboard.press('7');
    await clickScene(ui, { x: 620, y: 300 });
    const input = screen.getByRole('textbox', { name: 'Text' });
    await input.pressSequentially('rail order');
    await input.press('Escape');

    const scene = await savedScene(ui);
    expect(scene.elements.map((element) => element.type)).toEqual([
      'rectangle',
      'rectangle',
      'diamond',
      'text',
    ]);
  });

  test('Space pans with a tool in hand instead of drawing', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await browser.keyboard.press('r');
    await browser.keyboard.down('Space');
    await drag(ui, { x: 640, y: 400 }, { x: 700, y: 460 });
    await browser.keyboard.up('Space');

    // Panning is a view change: the Scene on disk is untouched.
    expect((await savedFiles(ui))['scene.json']).toBe(SCENE_SOURCE);
  });
});

describe('Text typed in place', () => {
  test('T places a Text, the letters type instead of picking tools, and Escape commits', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await browser.keyboard.press('t');
    await clickScene(ui, { x: 420, y: 300 });
    // Every letter here is a tool shortcut: the input keeps them all.
    await screen.getByRole('textbox', { name: 'Text' }).pressSequentially('draw me');
    await screen.getByRole('textbox', { name: 'Text' }).press('Escape');

    const scene = await savedScene(ui);
    expect(scene.elements.length).toBe(3);
    const text = scene.elements[2];
    expect({ type: text?.type, x: text?.x, y: text?.y, content: text?.content }).toEqual({
      type: 'text',
      x: 420,
      y: 300,
      content: 'draw me',
    });

    // The tool is back on Select: a drag on `a` moves it.
    await dragBy(ui, { x: 100, y: 80 }, 5, 5);
    expect((await saved(ui)).get('a')?.x).toBe(45);
  });

  test('Enter on an empty line commits, and an empty Text leaves nothing behind', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await browser.keyboard.press('t');
    await clickScene(ui, { x: 420, y: 300 });
    const input = screen.getByRole('textbox', { name: 'Text' });
    await input.pressSequentially('first line');
    await input.press('Enter');
    await input.pressSequentially('second line');

    // A click elsewhere commits what is typed.
    await clickScene(ui, { x: 700, y: 500 });
    const scene = await savedScene(ui);
    expect(scene.elements.length).toBe(3);
    expect(scene.elements[2]?.content).toBe('first line\nsecond line');

    // A Text with no words in it is discarded, and nothing is written.
    const files = await savedFiles(ui);
    await browser.keyboard.press('t');
    await clickScene(ui, { x: 700, y: 300 });
    await screen.getByRole('textbox', { name: 'Text' }).press('Enter');
    await browser.keyboard.press('Escape');
    expect((await savedFiles(ui))['scene.json']).toBe(files['scene.json']);
  });
});

describe('shortcuts that edit', () => {
  test('X, Backspace and Delete remove the selection, and undo brings it back', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, { x: 100, y: 80 });
    await browser.keyboard.press('x');
    expect((await savedScene(ui)).elements.map((element) => element.id)).toEqual(['b']);

    await browser.keyboard.press('Meta+z');
    expect((await savedScene(ui)).elements.map((element) => element.id)).toEqual(['a', 'b']);

    await clickScene(ui, { x: 100, y: 80 });
    await browser.keyboard.press('Backspace');
    expect((await savedScene(ui)).elements.map((element) => element.id)).toEqual(['b']);

    await browser.keyboard.press('Meta+z');
    await clickScene(ui, { x: 100, y: 80 });
    await browser.keyboard.press('Delete');
    expect((await savedScene(ui)).elements.map((element) => element.id)).toEqual(['b']);
  });

  test('deleting an Element leaves no Snap to the Element that is gone', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, { A: { 'snapped.json': SNAPPED_SOURCE } }, 'snapped.json');

    // `from` is the box the arrow's near end is Snapped to.
    await clickScene(ui, { x: 100, y: 80 }, [], SNAPPED);
    await browser.keyboard.press('x');

    // The arrow keeps its end where it was drawn; it only stops naming the box.
    const scene = await savedScene(ui, 'snapped.json');
    expect(scene.elements.map((element) => element.id)).toEqual(['to', 'link']);
    expect(scene.elements[1]?.points).toEqual([
      { x: 160, y: 80 },
      { x: 300, y: 80, snap: 'to' },
    ]);
  });

  test('undo and redo follow every change, one step per action', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);

    // Draw, move, delete: three actions.
    await browser.keyboard.press('r');
    await drag(ui, at(PAPER), at({ x: PAPER.x + 100, y: PAPER.y + 100 }));
    await dragBy(ui, { x: PAPER.x + 50, y: PAPER.y + 50 }, 20, 0);
    await clickScene(ui, { x: 100, y: 80 });
    await browser.keyboard.press('x');
    const afterDelete = (await savedFiles(ui))['scene.json'];

    await browser.keyboard.press('Meta+z');
    expect((await savedScene(ui)).elements.map((element) => element.id)).toEqual(['a', 'b', 'rectangle-1']);
    await browser.keyboard.press('Meta+z');
    expect((await saved(ui)).get('rectangle-1')?.x).toBe(420);
    await browser.keyboard.press('Meta+z');
    expect((await savedScene(ui)).elements.map((element) => element.id)).toEqual(['a', 'b']);

    // Redo walks the same three steps back to the Scene that was saved.
    await browser.keyboard.press('Shift+Meta+z');
    expect((await saved(ui)).get('rectangle-1')?.x).toBe(420);
    await browser.keyboard.press('Shift+Meta+z');
    expect((await saved(ui)).get('rectangle-1')?.x).toBe(440);
    await browser.keyboard.press('Shift+Meta+z');
    expect((await savedFiles(ui))['scene.json']).toBe(afterDelete);
  });

  test('a burst of nudges is one undo step', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, { x: 100, y: 80 });
    await browser.keyboard.press('Shift+ArrowRight');
    await browser.keyboard.press('Shift+ArrowRight');
    await browser.keyboard.press('Shift+ArrowRight');
    expect((await saved(ui)).get('a')?.x).toBe(70);

    await browser.keyboard.press('Meta+z');
    expect((await saved(ui)).get('a')?.x).toBe(40);
  });

  test('C and Cmd+D duplicate the selection, offset and as one step', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, { x: 100, y: 80 });
    await browser.keyboard.press('c');

    const copied = await saved(ui);
    expect(copied.size).toBe(3);
    const copy = copied.get('rectangle-1');
    expect({ type: copy?.type, x: copy?.x, y: copy?.y }).toEqual({
      type: 'rectangle',
      x: 56,
      y: 56,
    });

    // Cmd+D duplicates the copy: one more Element, off the copy it came from.
    await browser.keyboard.press('Meta+d');
    const again = await saved(ui);
    expect(again.size).toBe(4);
    expect(again.get('rectangle-2')?.x).toBe(72);

    // One undo takes both duplicates back: a duplicate is one step.
    await browser.keyboard.press('Meta+z');
    expect((await saved(ui)).size).toBe(3);
    await browser.keyboard.press('Meta+z');
    expect((await savedScene(ui)).elements.map((element) => element.id)).toEqual(['a', 'b']);
  });
});

describe('copy and paste', () => {
  test('copy in one Scene and paste in another keeps the style and renames the ids', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    const other = { version: 1, title: 'Other', defaults: { roughness: 1 }, elements: [] };
    await open(ui, {
      A: { 'scene.json': SCENE_SOURCE, 'other.json': JSON.stringify(other, null, 2) },
    });

    // `b` is the styled one: a solid grey fill and a dashed stroke.
    await clickScene(ui, { x: 250, y: 110 });
    await browser.keyboard.press('Meta+c');

    await browseFolder(ui, 'A');
    await screen.getByRole('button', 'other.json').click();
    await browser.keyboard.press('Meta+v');

    const scene = await savedScene(ui, 'other.json');
    expect(scene.elements.length).toBe(1);
    const pasted = scene.elements[0];
    expect({ type: pasted?.type, x: pasted?.x, y: pasted?.y }).toEqual({
      type: 'rectangle',
      x: 216,
      y: 76,
    });
    expect(pasted?.fill).toEqual({ kind: 'solid', grey: 4 });
    expect(pasted?.stroke).toEqual({ width: 'bold', style: 'dashed' });
    expect(pasted?.tone).toBe('muted');
  });

  test('paste carries the Elements as Scene JSON text, with new ids and its Snaps between copies', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, { A: { 'scene.json': SCENE_SOURCE } });

    // A box and an arrow Snapped to it, copied off the clipboard as they are.
    const fragment = {
      version: 1,
      elements: [
        { id: 'target', type: 'rectangle', x: 400, y: 300, width: 100, height: 60 },
        {
          id: 'pointer',
          type: 'arrow',
          points: [
            { x: 380, y: 400 },
            { x: 450, y: 330, snap: 'target' },
          ],
          heads: { start: 'none', end: 'arrow' },
        },
      ],
    };
    await browser.evaluate(async (text: string) => {
      await navigator.clipboard.writeText(text);
      return true;
    }, JSON.stringify(fragment));

    await browser.keyboard.press('Meta+v');
    const scene = await savedScene(ui);
    const added = scene.elements.slice(2);
    expect(added.map((element) => element.type)).toEqual(['rectangle', 'arrow']);
    expect(added.map((element) => element.id)).toEqual(['rectangle-1', 'arrow-1']);
    // The copy is offset onto the page, and the arrow still points at the box
    // it was drawn on, by its new id.
    expect({ x: added[0]?.x, y: added[0]?.y }).toEqual({ x: 416, y: 316 });
    expect(added[1]?.points).toEqual([
      { x: 396, y: 416 },
      { x: 466, y: 346, snap: 'rectangle-1' },
    ]);
  });

  test('a paste into a Scene without the Snap target keeps both ends free', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    // An arrow that Snaps to an Element which is not being copied.
    const fragment = {
      version: 1,
      elements: [
        {
          id: 'pointer',
          type: 'arrow',
          points: [
            { x: 380, y: 400 },
            { x: 450, y: 330, snap: 'elsewhere' },
          ],
          heads: { start: 'none', end: 'arrow' },
        },
      ],
    };
    await browser.evaluate(async (text: string) => {
      await navigator.clipboard.writeText(text);
      return true;
    }, JSON.stringify(fragment));

    await browser.keyboard.press('Meta+v');
    const scene = await savedScene(ui);
    expect(scene.elements[2]?.points).toEqual([
      { x: 396, y: 416 },
      { x: 466, y: 346 },
    ]);
  });

  test('a clipboard that is not a Scene fragment pastes nothing', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await browser.evaluate(async () => {
      await navigator.clipboard.writeText('just some notes, not a Scene');
      return true;
    });
    await browser.keyboard.press('Meta+v');

    expect((await savedFiles(ui))['scene.json']).toBe(SCENE_SOURCE);
  });

  test('undo does not reach back into a Scene that was open before', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    const other = { version: 1, title: 'Other', defaults: { roughness: 1 }, elements: [] };
    const otherSource = JSON.stringify(other, null, 2);
    await open(ui, { A: { 'scene.json': SCENE_SOURCE, 'other.json': otherSource } });

    await browser.keyboard.press('r');
    await drag(ui, at(PAPER), at({ x: PAPER.x + 60, y: PAPER.y + 60 }));
    await browseFolder(ui, 'A');
    await screen.getByRole('button', 'other.json').click();

    // The history belongs to the Scene it was recorded in.
    await browser.keyboard.press('Meta+z');
    expect((await savedFiles(ui))['other.json']).toBe(otherSource);
  });

  test('a copy pastes in another tab, because the clipboard is the system one', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    await clickScene(ui, { x: 100, y: 80 });
    await browser.keyboard.press('Meta+c');

    // A second tab, with its own folder stub, and a paste typed into it.
    await browser.newTab();
    await browser.addInitScript({ path: 'tests/fake-file-system.js' });
    await app.open('/editor.html');
    await browser.evaluate((folders: Folders) => {
      const window_ = window as unknown as { __esbozoFolders: Folders; __esbozoPicks: string[] };
      window_.__esbozoFolders = folders;
      window_.__esbozoPicks = ['B'];
      return true;
    }, { B: { 'tab.json': JSON.stringify({ version: 1, title: 'Tab', defaults: {}, elements: [] }) } });
    await screen.getByRole('button', /Open folder/).click();
    await screen.getByRole('button', 'tab.json').click();
    await browser.keyboard.press('Meta+v');

    const pasted = await savedScene(ui, 'tab.json', 'B');
    expect(pasted.elements.map((element) => [element.type, element.x, element.y])).toEqual([
      ['rectangle', 56, 56],
    ]);
  });
});
