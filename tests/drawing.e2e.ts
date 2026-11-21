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
const EMPTY_SOURCE = JSON.stringify(
  { version: 1, title: 'Empty', defaults: {}, elements: [] },
  null,
  2,
);

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

  test('a drawn Element takes the Scene defaults, not the editor latest look', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    // An empty Scene whose defaults are all written out, so this judges
    // inheritance rather than the Scene's own fallbacks. The page is the empty
    // page, so the view is known here.
    const ROUGH_SCENE = {
      version: 1,
      title: 'Rough',
      defaults: {
        roughness: 0,
        stroke: { width: 'extra', style: 'dotted' },
        fill: { kind: 'none' },
        tone: 'muted',
        corners: 'round',
        fontSize: 'L',
        textAlign: 'right',
      },
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
      stroke: drawn?.stroke,
      fill: drawn?.fill,
      tone: drawn?.tone,
    }).toEqual({
      type: 'diamond',
      x: 40,
      y: 40,
      roughness: 0,
      stroke: { width: 'extra', style: 'dotted' },
      fill: { kind: 'none', grey: 2 },
      tone: 'muted',
    });
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

  test('Space pan ends even when the release never arrives', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(ui);

    // Space goes down, then the page loses the focus: the release happens in
    // another window and never reaches this one.
    await browser.keyboard.press('r');
    await browser.keyboard.down('Space');
    await browser.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      return true;
    });
    await drag(ui, at(PAPER), at({ x: PAPER.x + 100, y: PAPER.y + 100 }));
    await browser.keyboard.up('Space');

    // The tool drew instead of panning, so the pan is over.
    expect((await savedScene(ui)).elements.length).toBe(3);
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

  test('a Text the Scene cannot hold is refused, and nothing is written', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    // U+0001 cannot go in the SVG, so the Scene's own parser refuses it.
    await browser.keyboard.press('t');
    await clickScene(ui, { x: 420, y: 300 });
    const input = screen.getByRole('textbox', { name: 'Text' });
    await input.fill('above\u0001below');
    await input.press('Escape');

    // The refusal is visible, and the Scene on disk was never touched.
    await expect(screen.getByRole('status')).toContainText('XML');
    expect((await savedFiles(ui))['scene.json']).toBe(SCENE_SOURCE);
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

    // Draw, move, delete: three actions. The Element's id is the Scene's to
    // choose, so it is read back from the Scene rather than assumed.
    await browser.keyboard.press('r');
    await drag(ui, at(PAPER), at({ x: PAPER.x + 100, y: PAPER.y + 100 }));
    const drawnId = (await savedScene(ui)).elements[2]?.id ?? '';
    expect(drawnId.length).toBeGreaterThan(0);
    await dragBy(ui, { x: PAPER.x + 50, y: PAPER.y + 50 }, 20, 0);
    await clickScene(ui, { x: 100, y: 80 });
    await browser.keyboard.press('x');
    const afterDelete = (await savedFiles(ui))['scene.json'];

    await browser.keyboard.press('Meta+z');
    expect((await savedScene(ui)).elements.map((element) => element.id)).toEqual([
      'a',
      'b',
      drawnId,
    ]);
    await browser.keyboard.press('Meta+z');
    expect((await saved(ui)).get(drawnId)?.x).toBe(420);
    await browser.keyboard.press('Meta+z');
    expect((await savedScene(ui)).elements.map((element) => element.id)).toEqual(['a', 'b']);

    // Redo walks the same three steps back to the Scene that was saved.
    await browser.keyboard.press('Shift+Meta+z');
    expect((await saved(ui)).get(drawnId)?.x).toBe(420);
    await browser.keyboard.press('Shift+Meta+z');
    expect((await saved(ui)).get(drawnId)?.x).toBe(440);
    await browser.keyboard.press('Shift+Meta+z');
    expect((await savedFiles(ui))['scene.json']).toBe(afterDelete);
  });

  test('a shortcut pressed mid-drag waits for the pointer: one Element, one undo step', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    // A rectangle dragged with C pressed halfway: nothing may commit off the
    // half-drawn box, and the duplicate waits for the release.
    const from = at(PAPER);
    await browser.keyboard.press('r');
    await browser.mouse.move(from.x, from.y);
    await browser.mouse.down();
    await browser.mouse.move(from.x + 40, from.y + 40);
    await browser.keyboard.press('c');
    await browser.mouse.move(from.x + 120, from.y + 100);
    await browser.mouse.up();

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

    // One gesture is one step: a single undo takes the whole drag back.
    await browser.keyboard.press('Meta+z');
    expect((await savedScene(ui)).elements.map((element) => element.id)).toEqual(['a', 'b']);
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
    const copyId = [...copied.keys()].find((id) => id !== 'a' && id !== 'b') ?? '';
    expect({ type: copied.get(copyId)?.type, x: copied.get(copyId)?.x, y: copied.get(copyId)?.y }).toEqual({
      type: 'rectangle',
      x: 56,
      y: 56,
    });

    // Cmd+D duplicates the copy: one more Element, off the copy it came from.
    await browser.keyboard.press('Meta+d');
    const again = await saved(ui);
    expect(again.size).toBe(4);
    const secondId = [...again.keys()].find((id) => !copied.has(id)) ?? '';
    expect(again.get(secondId)?.x).toBe(72);

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
    // The pasted Elements are named fresh: not by the fragment's ids, and not by
    // any id this Scene already uses.
    const pastedIds = added.map((element) => element.id);
    expect(new Set(pastedIds).size).toBe(2);
    expect(pastedIds.includes('target') || pastedIds.includes('pointer')).toBe(false);
    expect(scene.elements.slice(0, 2).some((element) => pastedIds.includes(element.id))).toBe(false);
    // The copy is offset onto the page, and the arrow still points at the box
    // it was drawn on, by the box copy's new id.
    expect({ x: added[0]?.x, y: added[0]?.y }).toEqual({ x: 416, y: 316 });
    expect(added[1]?.points).toEqual([
      { x: 396, y: 416 },
      { x: 466, y: 346, snap: pastedIds[0] },
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

  test('a fragment of another version, or a bare array, is not a fragment', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);
    const box = { id: 'stray', type: 'rectangle', x: 400, y: 300, width: 60, height: 40 };

    // Scene rejects version 42, so the fragment does; a bare array is not a
    // fragment at all. Neither paste may touch the Scene.
    for (const text of [JSON.stringify({ version: 42, elements: [box] }), JSON.stringify([box])]) {
      await browser.evaluate(async (payload: string) => {
        await navigator.clipboard.writeText(payload);
        return true;
      }, text);
      await browser.keyboard.press('Meta+v');
    }

    expect((await savedFiles(ui))['scene.json']).toBe(SCENE_SOURCE);
  });

  test('a versionless fragment pastes, with ids fresh against its own ids', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui);

    // `rectangle-1` and `stray` are not in this Scene: the paste must avoid
    // the ids it carries as well as the ones the Scene already uses.
    const fragment = {
      elements: [
        { id: 'rectangle-1', type: 'rectangle', x: 400, y: 300, width: 60, height: 40 },
        { id: 'stray', type: 'ellipse', x: 500, y: 300, width: 60, height: 40 },
      ],
    };
    await browser.evaluate(async (text: string) => {
      await navigator.clipboard.writeText(text);
      return true;
    }, JSON.stringify(fragment));

    await browser.keyboard.press('Meta+v');
    const scene = await savedScene(ui);
    const added = scene.elements.slice(2);
    expect(added.length).toBe(2);
    const ids = added.map((element) => element.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.includes('rectangle-1')).toBe(false);
    expect(ids.includes('stray')).toBe(false);
    expect(scene.elements.slice(0, 2).map((element) => element.id)).toEqual(['a', 'b']);
  });

  test('a fragment from off the page pastes where it can be seen', async ({
    app,
    browser,
    screen,
  }) => {
    const ui = { app, browser, screen };
    await open(ui, { A: { 'empty.json': EMPTY_SOURCE } }, 'empty.json');

    // Copied thousands of Scene units away: the +16 nudge would land it off
    // the page, so it is centred on the view instead. The empty page is fitted
    // 1:1 and centred at Scene (0, 0), so the middle of the view is (160, 120).
    const fragment = {
      version: 1,
      elements: [{ id: 'far', type: 'rectangle', x: 5000, y: 5000, width: 100, height: 60 }],
    };
    await browser.evaluate(async (text: string) => {
      await navigator.clipboard.writeText(text);
      return true;
    }, JSON.stringify(fragment));

    await browser.keyboard.press('Meta+v');
    const scene = await savedScene(ui, 'empty.json');
    expect(scene.elements.length).toBe(1);
    expect({ x: scene.elements[0]?.x, y: scene.elements[0]?.y }).toEqual({ x: 110, y: 90 });
  });

  test('copying only a Snapped arrow carries both ends free', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await open(
      ui,
      { A: { 'snapped.json': SNAPPED_SOURCE, 'other.json': EMPTY_SOURCE } },
      'snapped.json',
    );

    // `link` Snaps to two boxes it is copied without, so the fragment it
    // becomes has to parse on its own: a fragment with a Snap to a missing
    // target is not a Scene.
    await clickScene(ui, { x: 230, y: 80 }, [], SNAPPED);
    await browser.keyboard.press('Meta+c');
    await browseFolder(ui, 'A');
    await screen.getByRole('button', 'other.json').click();
    await browser.keyboard.press('Meta+v');

    const scene = await savedScene(ui, 'other.json');
    expect(scene.elements.length).toBe(1);
    expect(scene.elements[0]?.points).toEqual([
      { x: 176, y: 96 },
      { x: 316, y: 96 },
    ]);
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
