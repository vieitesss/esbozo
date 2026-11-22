/**
 * Seam 2: every way a gesture can end without a release, as one table.
 *
 * A gesture owns a lifecycle — a press, a preview, a saved Scene — and each way
 * it can be taken away is a column here: the browser cancels the pointer, the
 * window loses the focus, the page is hidden, Escape answers, another Scene
 * comes into the page, the folder refuses a write, or the host takes the
 * element off the page. `CODING_STANDARDS.md` "Clean teardown" is the contract;
 * this suite is where a new gesture adds a row and a new exit adds a column.
 *
 * Every cell asserts the same four things, so a cell is a row and an exit and
 * nothing else:
 *
 *   1. the saved Scene file bytes are unchanged — a gesture nobody finished is
 *      never a Scene, whatever ended it;
 *   2. the pointer the gesture took is the browser's again;
 *   3. no gesture mode is left: no mode pill and no gesture cursor;
 *   4. the next press starts a fresh gesture, from the Scene the file holds.
 *
 * Input is a person's: the rail, the pointer, the keys. The two exits no key or
 * pointer can perform — the window really losing the focus, and a host really
 * detaching the element — are the documented ones, and the page world is only
 * reached for the browser's own pointer-capture state and for the cursor it
 * shows.
 */
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  SCENE,
  VIEW,
  at,
  clickScene,
  drag,
  holdWrites,
  openEditor,
  refuseWrite,
  savedFiles,
  savedScene,
  settle,
} from './helpers.ts';
import type { Folders, Point, SavedScene, Ui } from './helpers.ts';
import { blurPage, cursorAt } from './cdp.ts';
import { SCENE_SOURCE } from './editor-shared.ts';

/** A second Scene of the same two boxes, so a switch is a different file. */
const SECOND_SOURCE = JSON.stringify({ ...SCENE, title: 'Second' }, null, 2);

const FOLDERS: Folders = { A: { 'scene.json': SCENE_SOURCE, 'second.json': SECOND_SOURCE } };

/** Where the pointer rests between gestures: bare paper, clear of any handle. */
const IDLE: Point = at({ x: 300, y: 380 }, VIEW);

/** How many pointer moves carry a gesture, as `tests/helpers.ts` drags one. */
const MOVES = 5;

/** @returns where the pointer was left, still down: half a gesture. */
async function carry(ui: Ui, from: Point, to: Point): Promise<Point> {
  await ui.browser.mouse.move(from.x, from.y);
  await ui.browser.mouse.down();
  for (let step = 1; step <= MOVES; step += 1) {
    const share = step / MOVES;
    await ui.browser.mouse.move(from.x + (to.x - from.x) * share, from.y + (to.y - from.y) * share);
  }
  await settle(ui);
  return to;
}

/** Whether the page still holds any pointer: the capture a gesture took. */
async function pointerHeld(ui: Ui): Promise<boolean> {
  return ui.browser.evaluate(() =>
    Array.from(document.querySelectorAll('*')).some((element) => element.hasPointerCapture(1)),
  );
}

/** The saved folder, byte for byte, once the page has settled. */
async function expectSameFiles(ui: Ui, before: Record<string, string>): Promise<void> {
  await settle(ui);
  expect(await savedFiles(ui)).toEqual(before);
}

/** One gesture kind, and what a landed gesture of that kind leaves behind. */
interface Gesture {
  readonly name: string;
  /** Put the page in the state the gesture starts from. */
  readonly arm: (ui: Ui) => Promise<void>;
  /** Press and carry, leaving the pointer down. */
  readonly press: (ui: Ui) => Promise<Point>;
  /** The same gesture, all the way to the release that lands it. */
  readonly again: (ui: Ui) => Promise<void>;
  /** What that landed gesture saves, so the next press is proved fresh. */
  readonly proves: (scene: SavedScene) => void;
}

/** A Rectangle drawn on the bare paper right of both boxes. */
const DRAWN = { from: at({ x: 320, y: 200 }, VIEW), to: at({ x: 420, y: 280 }, VIEW) };
/** `a`, pressed in the middle and carried to the same offset every time. */
const MOVED = { from: at({ x: 100, y: 80 }, VIEW), to: at({ x: 160, y: 140 }, VIEW) };

const rect = (ui: Ui) => ui.screen.getByRole('button', { name: 'Rectangle' });
const selectA = (ui: Ui) => clickScene(ui, { x: 100, y: 80 }, [], VIEW);

const DRAW: Gesture = {
  name: 'draw',
  arm: (ui) => rect(ui).click(),
  press: (ui) => carry(ui, DRAWN.from, DRAWN.to),
  again: async (ui) => {
    await rect(ui).click();
    await drag(ui, DRAWN.from, DRAWN.to);
  },
  proves: (scene) => {
    const drawn = scene.elements[2];
    expect(scene.elements.length).toBe(3);
    expect({
      type: drawn?.type,
      x: drawn?.x,
      y: drawn?.y,
      width: drawn?.width,
      height: drawn?.height,
    }).toEqual({ type: 'rectangle', x: 320, y: 200, width: 100, height: 80 });
  },
};

const MOVE: Gesture = {
  name: 'move',
  arm: selectA,
  press: (ui) => carry(ui, MOVED.from, MOVED.to),
  again: async (ui) => {
    await selectA(ui);
    await drag(ui, MOVED.from, MOVED.to);
  },
  proves: (scene) => {
    const box = scene.elements.find((element) => element.id === 'a');
    expect({ x: box?.x, y: box?.y }).toEqual({ x: 100, y: 100 });
  },
};

/** `a`'s bottom-right handle, carried 40 right and 40 down. */
const RESIZED = { from: at({ x: 160, y: 120 }, VIEW), to: at({ x: 200, y: 160 }, VIEW) };

const RESIZE: Gesture = {
  name: 'resize',
  arm: selectA,
  press: (ui) => carry(ui, RESIZED.from, RESIZED.to),
  again: async (ui) => {
    await selectA(ui);
    await drag(ui, RESIZED.from, RESIZED.to);
  },
  proves: (scene) => {
    const box = scene.elements.find((element) => element.id === 'a');
    expect({ x: box?.x, y: box?.y, width: box?.width, height: box?.height }).toEqual({
      x: 40,
      y: 40,
      width: 160,
      height: 120,
    });
  },
};

/**
 * The page this file's detach test owns: it holds the element in a slot and
 * keeps its own hands on it, so taking it off the page is the host's doing.
 */
const CONTROLLED_HOST = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>html, body { height: 100%; margin: 0 } esbozo-editor { display: block; height: 100vh }</style>
<link rel="stylesheet" href="editor.css" />
</head>
<body>
<div class="slot"><esbozo-editor></esbozo-editor></div>
<script type="module">
  const slot = document.querySelector('.slot');
  const editor = slot.querySelector('esbozo-editor');
  window.unplug = () => {
    editor.remove();
    slot.append(editor);
  };
</script>
<script type="module" src="editor.js"></script>
</body>
</html>`;

/** One way a gesture can end, and what the checks read after it. */
interface Exit {
  readonly name: string;
  /** The page the exit needs, with its Scene open and settled. */
  readonly open: (ui: Ui) => Promise<void>;
  /** What the gesture has to leave waiting before it starts, if anything. */
  readonly before: (ui: Ui, gesture: Gesture) => Promise<void>;
  /** End the gesture `to` was carried to, the way this exit does. */
  readonly drive: (ui: Ui, to: Point) => Promise<void>;
  /** The Scene the checked press lands in: the one the page holds after the exit. */
  readonly scene: string;
  /** Whether the exit leaves the page able to save a press at all. */
  readonly fresh: 'lands' | 'refused';
}

const editorPage = (ui: Ui) => openEditor(ui, FOLDERS, 'scene.json');
const noop = async (): Promise<void> => undefined;

const EXITS: readonly Exit[] = [
  {
    name: 'a pointercancel',
    open: editorPage,
    before: noop,
    drive: async (ui, to) => {
      // The browser takes the gesture over, as a touch that became a scroll
      // does: a cancellation, not a release.
      await ui.browser.evaluate((point: { x: number; y: number }) => {
        document
          .elementFromPoint(point.x, point.y)
          ?.dispatchEvent(
            new PointerEvent('pointercancel', {
              pointerId: 1,
              clientX: point.x,
              clientY: point.y,
              bubbles: true,
            }),
          );
        return true;
      }, to);
    },
    scene: 'scene.json',
    fresh: 'lands',
  },
  {
    name: 'a window blur',
    open: editorPage,
    before: noop,
    // The focus really leaves the page, as the person picking another window
    // does: no event a test dispatches is believed, because the browser's own
    // pointer state would stay as it was.
    drive: async () => {
      await blurPage();
    },
    scene: 'scene.json',
    fresh: 'lands',
  },
  {
    name: 'the page being hidden',
    open: editorPage,
    before: noop,
    drive: async (ui) => {
      await ui.browser.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
        document.dispatchEvent(new Event('visibilitychange'));
        return true;
      });
    },
    scene: 'scene.json',
    fresh: 'lands',
  },
  {
    name: 'Escape',
    open: editorPage,
    before: noop,
    drive: async (ui) => {
      await ui.browser.keyboard.press('Escape');
    },
    scene: 'scene.json',
    fresh: 'lands',
  },
  {
    name: 'another Scene from the file list',
    open: editorPage,
    before: noop,
    // The pointer is the board's while it is captured, so the file list is
    // reached the way a person reaches it with their hands off the pointer: Tab
    // to the folder button, Enter, then Enter on the Scene's own row.
    drive: async (ui) => {
      await ui.screen.getByRole('button', /Open folder/).press('Enter');
      await ui.screen.getByRole('button', 'second.json').press('Enter');
    },
    scene: 'second.json',
    fresh: 'lands',
  },
  {
    name: 'a refused save',
    open: editorPage,
    // A write the folder will refuse is what the page is waiting on while the
    // gesture is in flight: a finished gesture queues it and the gate holds it,
    // and the undo puts the Scene back where this row's presses are aimed.
    before: async (ui, gesture) => {
      await holdWrites(ui, 'scene.json');
      await gesture.again(ui);
      await ui.browser.keyboard.press('Meta+z');
    },
    // The gate answers the held write with a 403, as a folder served read-only
    // does: the page learns it may only read while the gesture is in flight.
    drive: async (ui) => {
      await refuseWrite(ui, 'the folder is read-only');
    },
    scene: 'scene.json',
    fresh: 'refused',
  },
  {
    name: 'the host detaching the element',
    open: async (ui) => {
      await ui.browser.route('**/editor.html', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: CONTROLLED_HOST }),
      );
      await editorPage(ui);
    },
    before: noop,
    drive: async (ui) => {
      await ui.browser.evaluate(() => {
        (window as unknown as { unplug: () => void }).unplug();
        return true;
      });
    },
    scene: 'scene.json',
    fresh: 'lands',
  },
];

for (const gesture of [DRAW, MOVE, RESIZE]) {
  describe(`a ${gesture.name} the page loses`, () => {
    for (const exit of EXITS) {
      test(`ends on ${exit.name}, and the next press starts fresh`, async ({ app, browser, screen }) => {
        const ui = { app, browser, screen };
        await exit.open(ui);
        await exit.before(ui, gesture);

        // The Scene as the disk holds it, and the pointer as the idle page
        // shows it: what every check below compares against.
        const before = await savedFiles(ui);
        const idle = await cursorAt(IDLE);
        await gesture.arm(ui);
        const armed = await cursorAt(IDLE);
        const to = await gesture.press(ui);
        await settle(ui);

        await exit.drive(ui, to);
        await settle(ui);

        // The pointer is the browser's again, and nothing was saved.
        expect(await pointerHeld(ui)).toBe(false);
        await expectSameFiles(ui, before);

        // No gesture mode is left: no mode pill, and the cursor the page shows
        // with the tool in hand or with it back on Select. A gesture never has a
        // cursor of its own to leave behind.
        await expect(screen.getByText('Panning')).toBeHidden();
        expect([idle, armed]).toContain(await cursorAt(IDLE));

        // The next press is a gesture of its own, and it lands whole.
        await browser.mouse.up();
        await settle(ui);
        await gesture.again(ui);
        if (exit.fresh === 'refused') {
          // A refused save leaves the page read-only, so the press after it is
          // a gesture that changes nothing at all.
          await expectSameFiles(ui, before);
          await expect(screen.getByText('read-only')).toBeVisible();
        } else {
          gesture.proves(await savedScene(ui, exit.scene));
        }
      });
    }
  });
}
