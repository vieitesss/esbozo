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
 * Every cell asserts the same five things, so a cell is a row and an exit and
 * nothing else:
 *
 *   1. the press is a gesture in flight — a pointer the page holds, a band it
 *      paints, a field it opened — not a page that never started one;
 *   2. the saved Scene file bytes are the documented ones — a gesture nobody
 *      finished is never a Scene, whatever ended it;
 *   3. the pointer the gesture took is the browser's again, read before the hand
 *      lets go of anything the exit left in it;
 *   4. no gesture mode is left: no mode pill and no gesture cursor;
 *   5. the next press starts a fresh gesture, from the Scene the file holds.
 *
 * A gesture that is not a Scene edit answers for itself, because its exit is
 * not what ends it: the pan is the page's, and it ends with the key or the
 * button the hand took it with, and a Text session's words are the session's,
 * so an exit may land them or throw them away. `ends` is where such a row says
 * what those cells are instead, and every other cell is the five above.
 *
 * Input is a person's: the rail, the pointer, the keys. The three exits no key or
 * pointer can perform — the window really losing the focus, a page really
 * hidden, and a host really detaching the element — are the documented ones,
 * and the page world is only reached for the browser's own pointer-capture
 * state and for the cursor it shows.
 */
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  SCENE,
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
import type { Folders, Point, SavedScene, Ui, View } from './helpers.ts';
import { blurPage, cancelTouch, cursorAt, livePage, touchCarry } from './cdp.ts';
import { command, palette } from './editor-shared.ts';
import { shot } from './pixels.ts';
import type { Centre, Rect } from './pixels.ts';

/**
 * A free arrow through one sharp bend, on the bare paper beneath both boxes and
 * clear of every other row's press: its last point is an end handle, its middle
 * point a bend handle, and the words it is written about a Label to drag. The
 * Label sits 20px to the side of its second run, inside the box the arrow's own
 * points make, so it moves no Element's bounds and no row's fitted view.
 */
const BENT = {
  id: 'bent',
  type: 'arrow',
  points: [
    { x: 60, y: 240 },
    { x: 140, y: 300, corner: 'sharp' },
    { x: 220, y: 240 },
  ],
  heads: { start: 'none', end: 'arrow' },
  label: 'moving',
  labelAt: { t: 0.75, offset: 20 },
};

/** `SCENE` with the arrow: the one Scene every row presses in. */
const ARROWED = { ...SCENE, elements: [...SCENE.elements, BENT] };
const SCENE_SOURCE = JSON.stringify(ARROWED, null, 2);

/** A second Scene of the same three Elements, so a switch is a different file. */
const SECOND_SOURCE = JSON.stringify({ ...ARROWED, title: 'Second' }, null, 2);

const FOLDERS: Folders = { A: { 'scene.json': SCENE_SOURCE, 'second.json': SECOND_SOURCE } };

/**
 * The view the arrowed Scene lands in, worked out as `helpers.ts` works `VIEW`
 * out: opening a Scene fits it, so the arrow's 140px of extra height takes the
 * pan from 300 to the fitted 231 and leaves the zoom at 1.
 */
const VIEW: View = { zoom: 1, panX: 470, panY: 231 };

/** Where the pointer rests between gestures: bare paper, clear of any handle. */
const IDLE: Point = at({ x: 300, y: 380 }, VIEW);

/** How many pointer moves carry a gesture, as `tests/helpers.ts` drags one. */
const MOVES = 5;

/**
 * The pointer a press is taken with: the mouse, or the touch the browser cancels
 * for real. A gesture a mouse is the only hand for says so and keeps the mouse.
 */
type Pointer = 'mouse' | 'touch';

/** @returns where the pointer was left, still down: half a gesture. */
async function carry(
  ui: Ui,
  from: Point,
  to: Point,
  button: 'left' | 'middle' = 'left',
  pointer: Pointer = 'mouse',
): Promise<Point> {
  if (pointer === 'touch') {
    // The one pointer the browser itself cancels: carried as a finger carries,
    // so the cancel an exit sends ends the gesture a finger really took.
    await touchCarry(from, to, MOVES);
    await settle(ui);
    return to;
  }
  // e2e's fixture presses the primary button only, so the middle press a pan is
  // taken with is the page's own mouse, as `tests/helpers.ts` drags one.
  const mouse = button === 'middle' ? livePage().mouse : ui.browser.mouse;
  await mouse.move(from.x, from.y);
  if (button === 'middle') await mouse.down({ button });
  else await mouse.down();
  for (let step = 1; step <= MOVES; step += 1) {
    const share = step / MOVES;
    await mouse.move(from.x + (to.x - from.x) * share, from.y + (to.y - from.y) * share);
  }
  await settle(ui);
  return to;
}

/**
 * Whether the page still holds a pointer: the capture a gesture took. The id is
 * the browser's own — a mouse is 1, and a touch starts past it — so every id a
 * run can hand out is asked, and a gesture taken with a finger is not reported
 * as one the page let go of.
 */
async function pointerHeld(ui: Ui): Promise<boolean> {
  return ui.browser.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('*'));
    for (let id = 1; id <= 8; id += 1) {
      if (elements.some((element) => element.hasPointerCapture(id))) {
        return true;
      }
    }
    return false;
  });
}

/**
 * The saved folder, byte for byte, once the page has settled: the Scene the
 * press found, or that Scene with the words a session landed, which is the one
 * commit an exit is allowed to make.
 */
async function expectFiles(
  ui: Ui,
  before: Record<string, string>,
  saved: 'same' | 'words',
): Promise<void> {
  await settle(ui);
  const got = await savedFiles(ui);
  if (saved === 'same') {
    expect(got).toEqual(before);
    return;
  }
  // A commit writes the Scene and the ink the page draws for it: the Scene is
  // the one the words make, byte for byte, the ink is the one file a folder that
  // had none may gain, and every other file it held is untouched.
  const notInk = ([name]: [string, string]) => name !== 'scene.json' && name !== 'scene.svg';
  expect(got['scene.json']).toBe(TYPED_SOURCE);
  expect(Object.keys(got).filter((name) => !(name in before) && name !== 'scene.svg')).toEqual([]);
  expect(Object.keys(before).filter((name) => !(name in got))).toEqual([]);
  expect(Object.fromEntries(Object.entries(got).filter(notInk))).toEqual(
    Object.fromEntries(Object.entries(before).filter(notInk)),
  );
}

/**
 * Bare paper inside the box a sweep from `BOXED` draws, and the same-sized patch
 * of paper beside it: the band tints the paper between them, so the two read the
 * same when no band is drawn and differ while one is. Both are clear of every
 * Element in the Scene.
 */
const BANDED: Rect = { x: 636, y: 300, width: 24, height: 40 };
const BESIDE: Rect = { x: 830, y: 300, width: 24, height: 40 };

/** The patch of page a corner-to-corner box covers. */
const patch = (from: Point, to: Point): Rect => ({
  x: from.x,
  y: from.y,
  width: to.x - from.x,
  height: to.y - from.y,
});

/**
 * A patch of paper the draw preview's top edge crosses while the box is being
 * swept, and the same-sized patch above it that no ink reaches: the two read the
 * same when the page shows no preview, and differ while one is drawn.
 */
const PREVIEW: Rect = patch(at({ x: 340, y: 196 }, VIEW), at({ x: 400, y: 204 }, VIEW));
const ABOVE_PREVIEW: Rect = patch(at({ x: 340, y: 150 }, VIEW), at({ x: 400, y: 158 }, VIEW));

/** How much darker the preview leaves the paper it crosses: 0 with no preview drawn. */
async function previewTint(ui: Ui): Promise<number> {
  const image = await shot(ui);
  return image.meanLuminance(ABOVE_PREVIEW) - image.meanLuminance(PREVIEW);
}

/** How much darker the sweep band leaves the paper: 0 with no band on the page. */
async function bandTint(ui: Ui): Promise<number> {
  const image = await shot(ui);
  return image.meanLuminance(BESIDE) - image.meanLuminance(BANDED);
}

/**
 * The mark a press rides, proved by the cursor the page shows at it: a mark a
 * gesture takes is one the page advertises a grab on, so the cursor stands where
 * the pointer carried the mark and no longer where the press armed it. A press
 * that started nothing leaves the two the other way round — the mark armed, and
 * bare paper where it should have gone.
 */
const rode =
  (from: Point, home: Point, cursor: string) =>
  async (ui: Ui): Promise<void> => {
    await holdsPointer(ui);
    expect(await cursorAt(home)).toBe(cursor);
    expect(await cursorAt(from)).not.toBe(cursor);
  };

/** The marks the five rows carry, where the armed page draws them, in page pixels. */
const SE_AT_REST: Point = at({ x: 160, y: 120 }, VIEW);
const END_AT_REST: Point = at({ x: 220, y: 240 }, VIEW);
const BEND_AT_REST: Point = at({ x: 140, y: 300 }, VIEW);
/** `a`'s bottom-right handle once the move has carried the box: the same corner. */
const SE_MOVED: Point = at({ x: 220, y: 180 }, VIEW);
/** The mark the cursor is read on at each place, as the page's own styles name it. */
const CORNER = 'nwse-resize';
const GRAB = 'move';

/** The press took the pointer: the gesture is in flight, not a page that started nothing. */
const holdsPointer = async (ui: Ui): Promise<void> => {
  expect(await pointerHeld(ui)).toBe(true);
};

/** A pan in flight: the pointer held, and the status bar naming it. */
const panning = async (ui: Ui): Promise<void> => {
  await holdsPointer(ui);
  await expect(ui.screen.getByText('Panning')).toBeVisible();
};

/** A sweep in flight: the pointer held, and the band tinting the paper it encloses. */
const boxSweeping = async (ui: Ui): Promise<void> => {
  await holdsPointer(ui);
  expect(await bandTint(ui)).toBeGreaterThan(0.02);
};

/** No band is left behind: the paper it tinted is the paper beside it again. */
const noBand = async (ui: Ui): Promise<void> => {
  expect(Math.abs(await bandTint(ui))).toBeLessThan(0.01);
};

/**
 * A cell a gesture answers for itself, because its exit is not what ends it: the
 * pan is the page's and is still in the hand the key or the button holds, and a
 * Text session's words are the session's, so an exit may land them or throw them
 * away. The row says what the page still shows, how the hand then lets go, and
 * whether words landed in the Scene — the row's `shows` proves those, because
 * only the row knows which words they are.
 */
interface Ending {
  /** What the page must show of the gesture once the exit is over, read before the hand lets go. */
  readonly shows: (ui: Ui) => Promise<void>;
  /** The hand lets go of what the exit left in it, and what that documents follows here. */
  readonly letGo: (ui: Ui) => Promise<void>;
  /**
   * The cursor the exit leaves once the hand has let go: the armed tool's own
   * where the gesture did not take it, and the page's idle one where it did.
   */
  readonly cursor: 'armed' | 'idle';
  /** The Scene file the folder holds at the exit, once the hand has let go. */
  readonly files: 'same' | 'words';
}

/** One gesture kind, and what a landed gesture of that kind leaves behind. */
interface Gesture {
  readonly name: string;
  /** Put the page in the state the gesture starts from. */
  readonly arm: (ui: Ui) => Promise<void>;
  /** Press and carry with `pointer`, leaving it down. */
  readonly press: (ui: Ui, pointer: Pointer) => Promise<Point>;
  /** The same gesture, all the way to the release that lands it. */
  readonly again: (ui: Ui) => Promise<void>;
  /** What that landed gesture saves, so the next press is proved fresh. */
  readonly proves: (scene: SavedScene) => void;
  /**
   * What the press left on the page that proves it is a gesture in flight, read
   * before the exit: a pointer held, a band painted, a field opened, a mark the
   * press carried. Without it a cell is a page that never started the gesture and
   * an exit that ended nothing.
   */
  readonly started: (ui: Ui) => Promise<void>;
  /**
   * What the exit has to have left of the gesture, read before the hand lets go:
   * the preview, the band and the pointer the exit took.
   */
  readonly cleared?: (ui: Ui) => Promise<void>;
  /**
   * What the hand letting go must not settle, read after the release and before
   * the next press: a release that belongs to no gesture changes nothing.
   */
  readonly released?: (ui: Ui) => Promise<void>;
  /** The one hand this gesture is taken with, where a mouse is the only one for it. */
  readonly pointer?: 'mouse';
  /**
   * The cells this gesture's own contract answers differently, because the exit
   * does not end it. A cell not named here is over when its exit is over, which
   * is every Scene edit's contract.
   */
  readonly ends?: ReadonlyArray<readonly [Exit, Ending]>;
  /** Let go of the key or the button this gesture is taken with, where an exit left it down. */
  readonly release?: (ui: Ui) => Promise<void>;
  /**
   * The write a refused save is waiting on, where this gesture's own landing
   * writes nothing at all: a pan is the page's, so the folder has to be told to
   * refuse somebody else's write. The default is the row's own landed gesture.
   */
  readonly primes?: (ui: Ui) => Promise<void>;
}

/** A page state a row starts from: the Select tool the page opens on needs no arming. */
const noop = async (): Promise<void> => undefined;

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
  readonly drive: (ui: Ui, to: Point, pointer: Pointer) => Promise<void>;
  /**
   * The pointer the gesture is taken with for this exit, where the exit needs
   * one the mouse cannot be: the browser cancels a touch, and no mouse is.
   */
  readonly pointer?: Pointer;
  /**
   * Whether the tool the press armed is still in the hand once the exit is over:
   * the cursor is then the tool's own, and Select's where the exit is over the
   * gesture and puts the page back on Select.
   */
  readonly keepsTool: boolean;
  /** The Scene the checked press lands in: the one the page holds after the exit. */
  readonly scene: string;
  /** Whether the exit leaves the page able to save a press at all. */
  readonly fresh: 'lands' | 'refused';
}

const editorPage = (ui: Ui) => openEditor(ui, FOLDERS, 'scene.json');

/**
 * The browser takes the gesture over, as a touch that became a scroll does: a
 * cancellation, not a release. Chromium cancels a touch it takes over, so the
 * press is a finger's and the cancel is the browser's own — a mouse has no
 * cancel in the protocol, and an event a test dispatches is untrusted.
 *
 * A middle-button pan is the one row a finger cannot take, and no protocol
 * command cancels a mouse: that cell keeps a real middle press and dispatches
 * the event the browser would have sent. A Text session is the other: a finger
 * tap does open the field, and the same tap's mouse press takes the focus off it
 * before a word can be typed, so the row types its words off a mouse press and
 * dispatches the cancel too (see the report).
 */
const POINTERCANCEL: Exit = {
  name: 'a pointercancel',
  open: editorPage,
  before: noop,
  pointer: 'touch',
  drive: async (ui, to, pointer) => {
    if (pointer === 'touch') {
      await cancelTouch();
      await settle(ui);
      return;
    }
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
    await settle(ui);
  },
  keepsTool: true,
  scene: 'scene.json',
  fresh: 'lands',
};

/** The person picks another window: the focus really leaves the page. */
const BLUR: Exit = {
  name: 'a window blur',
  open: editorPage,
  before: noop,
  // No event a test dispatches is believed, because the browser's own pointer
  // state would stay as it was.
  drive: async () => {
    await blurPage();
  },
  keepsTool: true,
  scene: 'scene.json',
  fresh: 'lands',
};

/**
 * The page goes out of sight: the tab behind another one. A headless Chromium
 * keeps every page visible — `Page.setWebLifecycleState` freezes without hiding
 * it and a second target brought to front hides nothing — so there is no real
 * hide to send, and this exit keeps the event a hidden page would get. The
 * window keeps the focus, so this cell can never pass on what a blur leaves.
 */
const HIDDEN: Exit = {
  name: 'the page being hidden',
  open: editorPage,
  before: noop,
  drive: async (ui) => {
    await ui.browser.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      try {
        document.dispatchEvent(new Event('visibilitychange'));
      } finally {
        // The page a person looks at again: only the exit's own listener sees it
        // hidden, and the press after it runs on a page on screen.
        delete (document as unknown as { visibilityState?: string }).visibilityState;
      }
      return true;
    });
    await settle(ui);
    // The focus never left the page: what this cell proves is a hidden page, and
    // a blurred one is the row above.
    expect(await ui.browser.evaluate(() => document.hasFocus())).toBe(true);
  },
  keepsTool: true,
  scene: 'scene.json',
  fresh: 'lands',
};

/** The key a person answers a page with. */
const ESCAPE: Exit = {
  name: 'Escape',
  open: editorPage,
  before: noop,
  drive: async (ui) => {
    await ui.browser.keyboard.press('Escape');
  },
  // An Escape in the middle of a Scene edit drops the gesture and keeps the tool
  // the press armed: it is the edit it answers, not the tool.
  keepsTool: true,
  scene: 'scene.json',
  fresh: 'lands',
};

/** Another Scene, opened from the file list. */
const SCENE_SWITCH: Exit = {
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
  // Another Scene lets go of every edit in flight, and of the tool with it.
  keepsTool: false,
  scene: 'second.json',
  fresh: 'lands',
};

/** A folder that turns read-only under the page: the write it queued is answered with a 403. */
const REFUSED_SAVE: Exit = {
  name: 'a refused save',
  open: editorPage,
  // A write the folder will refuse is what the page is waiting on while the
  // gesture is in flight: a finished gesture queues it and the gate holds it,
  // and the undo puts the Scene back where this row's presses are aimed.
  before: async (ui, gesture) => {
    await holdWrites(ui, 'scene.json');
    await (gesture.primes ?? gesture.again)(ui);
    await ui.browser.keyboard.press('Meta+z');
  },
  // The gate answers the held write with a 403, as a folder served read-only
  // does: the page learns it may only read while the gesture is in flight.
  drive: async (ui) => {
    await refuseWrite(ui, 'the folder is read-only');
  },
  // A page that may only read puts every tool but Select away.
  keepsTool: false,
  scene: 'scene.json',
  fresh: 'refused',
};

/** The host takes the element off the page while the gesture is in flight. */
const DETACH: Exit = {
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
  // Taking the element off its page lets go of every edit in flight, and of the
  // tool with it.
  keepsTool: false,
  scene: 'scene.json',
  fresh: 'lands',
};

/** The columns of the table, in the order a person would try them. */
const EXITS: readonly Exit[] = [POINTERCANCEL, BLUR, HIDDEN, ESCAPE, SCENE_SWITCH, REFUSED_SAVE, DETACH];

/** A Rectangle drawn on the bare paper right of both boxes. */
const DRAWN = { from: at({ x: 320, y: 200 }, VIEW), to: at({ x: 420, y: 280 }, VIEW) };
/** `a`, pressed in the middle and carried to the same offset every time. */
const MOVED = { from: at({ x: 100, y: 80 }, VIEW), to: at({ x: 160, y: 140 }, VIEW) };

const rect = (ui: Ui) => ui.screen.getByRole('button', { name: 'Rectangle' });
const selectA = (ui: Ui) => clickScene(ui, { x: 100, y: 80 }, [], VIEW);
/** On the arrow's first run, on no Element: where a press selects the arrow. */
const selectBent = (ui: Ui) => clickScene(ui, { x: 100, y: 270 }, [], VIEW);

const DRAW: Gesture = {
  name: 'draw',
  arm: (ui) => rect(ui).click(),
  press: (ui, pointer) => carry(ui, DRAWN.from, DRAWN.to, 'left', pointer),
  // The box this draw is sweeping is drawn on the page as it is swept: the patch
  // its top edge crosses is darker than the paper above it until the gesture ends.
  started: async (ui) => {
    await holdsPointer(ui);
    expect(await previewTint(ui)).toBeGreaterThan(0.05);
  },
  cleared: async (ui) => {
    expect(Math.abs(await previewTint(ui))).toBeLessThan(0.02);
  },
  again: async (ui) => {
    await rect(ui).click();
    await drag(ui, DRAWN.from, DRAWN.to);
  },
  proves: (scene) => {
    const drawn = scene.elements[3];
    expect(scene.elements.length).toBe(4);
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
  press: (ui, pointer) => carry(ui, MOVED.from, MOVED.to, 'left', pointer),
  // The box the press took is drawn where the pointer carried it: the corner its
  // bottom-right handle stands on advertises the resize, and the corner the press
  // armed is bare paper again.
  started: rode(SE_AT_REST, SE_MOVED, CORNER),
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
  press: (ui, pointer) => carry(ui, RESIZED.from, RESIZED.to, 'left', pointer),
  // The handle the press took is drawn under the pointer it followed: the corner
  // the pointer stands on advertises the resize, and the place the press armed it
  // is bare paper again.
  started: rode(SE_AT_REST, RESIZED.to, CORNER),
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

/** The arrow's end handle, and a free point below and right of it, on no box. */
const ENDED = { from: at({ x: 220, y: 240 }, VIEW), to: at({ x: 260, y: 300 }, VIEW) };

const END_HANDLE: Gesture = {
  name: 'end handle',
  arm: selectBent,
  press: (ui, pointer) => carry(ui, ENDED.from, ENDED.to, 'left', pointer),
  // The end the press took is drawn under the pointer it followed: that point
  // advertises the grab a shaft's end is, and the place the arrow still ended at
  // is bare paper.
  started: rode(END_AT_REST, ENDED.to, GRAB),
  again: async (ui) => {
    await selectBent(ui);
    await drag(ui, ENDED.from, ENDED.to);
  },
  proves: (scene) => {
    const end = scene.elements.find((element) => element.id === 'bent')?.points?.[2];
    expect({ x: end?.x, y: end?.y }).toEqual({ x: 260, y: 300 });
  },
};

/** The arrow's bend handle, carried 40 right and 40 down. */
const BENT_MOVED = { from: at({ x: 140, y: 300 }, VIEW), to: at({ x: 180, y: 340 }, VIEW) };

const BEND_HANDLE: Gesture = {
  name: 'bend handle',
  arm: selectBent,
  press: (ui, pointer) => carry(ui, BENT_MOVED.from, BENT_MOVED.to, 'left', pointer),
  // The bend the press took is drawn under the pointer it followed: that point
  // advertises the grab a bend point is, and the place the arrow bent at is bare.
  started: rode(BEND_AT_REST, BENT_MOVED.to, GRAB),
  again: async (ui) => {
    await selectBent(ui);
    await drag(ui, BENT_MOVED.from, BENT_MOVED.to);
  },
  proves: (scene) => {
    const bend = scene.elements.find((element) => element.id === 'bent')?.points?.[1];
    expect({ x: bend?.x, y: bend?.y }).toEqual({ x: 180, y: 340 });
  },
};

/** Bare paper, and the band a sweep drawn from it encloses: both boxes, no arrow. */
const BOXED = { from: at({ x: 10, y: 10 }, VIEW), to: at({ x: 320, y: 180 }, VIEW) };

/**
 * A sweep of both boxes, with the Select tool the page opens on. A sweep saves
 * nothing of its own — what it lands is a selection — so the gesture is landed
 * by the nudge that carries what it selected: both boxes take the nudge's step,
 * which is the file's own proof that the band took them. A press on either box
 * selects that one alone, so a nudge cannot pass for a press's work.
 */
const BOX_SELECT: Gesture = {
  name: 'box select',
  arm: noop,
  press: (ui, pointer) => carry(ui, BOXED.from, BOXED.to, 'left', pointer),
  // A sweep's own proof is the band it paints, and the selection a release that
  // follows the exit must not land: a pointer held on bare paper is a press that
  // started nothing yet, and a stale band can settle as a selection.
  started: boxSweeping,
  cleared: noBand,
  released: expectNothingSelected,
  again: async (ui) => {
    await drag(ui, BOXED.from, BOXED.to);
    await ui.browser.keyboard.press('Shift+ArrowRight');
    await settle(ui);
  },
  proves: (scene) => {
    const boxes = scene.elements.filter((element) => element.id === 'a' || element.id === 'b');
    expect(boxes.map((element) => [element.id, element.x])).toEqual([
      ['a', 50],
      ['b', 210],
    ]);
  },
};

/**
 * The arrow's Label, taken by the words as they draw — their middle is Scene
 * (168,254): three quarters along the arrow's drawn path, 20px to the side of
 * its second run — and carried 32 right and 16 down. The arrow's drawn ends are
 * level, (60,240) to (220,240), so the place the drag lands reads back as the
 * point the pointer left the words' middle on.
 */
const LABEL_MOVED = { from: at({ x: 168, y: 254 }, VIEW), to: at({ x: 200, y: 270 }, VIEW) };

/**
 * The words the Label's ink paints at rest, in page pixels: a press takes them by
 * their middle, and the box they paint stands a shade right and below it. The two
 * points are inside the words the press found and inside the words it carried.
 */
const LABEL_HUNG: Point = { x: 632, y: 493.5 };
const LABEL_TAKEN: Point = { x: 664, y: 509.5 };

const LABEL_DRAG: Gesture = {
  name: 'Label drag',
  arm: noop,
  press: (ui, pointer) => carry(ui, LABEL_MOVED.from, LABEL_MOVED.to, 'left', pointer),
  // The words the press took are drawn where the pointer carried them: the paper
  // they cover there advertises the grab they are, and the place they hung is
  // bare.
  started: rode(LABEL_HUNG, LABEL_TAKEN, 'grab'),
  again: async (ui) => {
    await drag(ui, LABEL_MOVED.from, LABEL_MOVED.to);
  },
  proves: (scene) => {
    // The arrow's drawn ends are level, from (60,240) to (220,240): the place it
    // saves is the fraction along that line and the distance below it, so it
    // reads back as the point the release left the words' middle on. The words
    // are the page's measured ink, so the middle a press took is theirs, a
    // fraction of a pixel from the arrow's own anchor: half a pixel is the
    // tolerance, and a gesture that carried nothing misses by tens.
    const place = scene.elements.find((element) => element.id === 'bent')?.labelAt;
    expect(60 + (place?.t ?? 0) * 160).toBeCloseTo(200, 0);
    expect(240 - (place?.offset ?? 0)).toBeCloseTo(270, 0);
  },
};

/**
 * Where a pan takes the page, and how far it has carried it. The nudge is short
 * on purpose: the Scene fits the page, so a pan of it has to stay on the page
 * however many pans a cell has already carried.
 */
const PAN_FROM = IDLE;
const PAN_BY: Point = { x: 60, y: 40 };
const PAN_TO: Point = { x: PAN_FROM.x + PAN_BY.x, y: PAN_FROM.y + PAN_BY.y };

/**
 * The box a pan row measures the page in: wide enough for the Scene it landed in
 * and the three pans an exit can leave behind it, and holding nothing the page
 * draws of its own — the rail, the note, the status line and the mode pill are
 * all outside it.
 */
const INK: Rect = { x: 480, y: 230, width: 480, height: 440 };

/** A page point clear of every Element in every view a pan row presses in. */
const BARE: Point = { x: 200, y: 700 };

/** Where the page's ink is, in page pixels. */
async function inkCentre(ui: Ui): Promise<Centre> {
  const ink = (await shot(ui)).darkCentre(INK, 0.6);
  expect(ink.count).toBeGreaterThan(0);
  return ink;
}

/**
 * What a landed pan leaves in the file: the Scene it panned, byte for byte where
 * it found it. A pan is the page's, so it is never a write, and the next press
 * starts from the Scene the disk holds.
 */
const provesPan = (scene: SavedScene): void => {
  const at = (id: string) => {
    const element = scene.elements.find((one) => one.id === id);
    return { x: element?.x, y: element?.y };
  };
  expect([at('a'), at('b')]).toEqual([
    { x: 40, y: 40 },
    { x: 200, y: 60 },
  ]);
};

/** The middle button a pan is taken with is the page's own: the fixture presses the primary one only. */
const letMiddleGo = async (): Promise<void> => {
  await livePage().mouse.up({ button: 'middle' });
};

/** Space is the person's key, and it comes up where they let it: with their hand. */
const letSpaceGo = async (ui: Ui): Promise<void> => {
  await ui.browser.keyboard.up('Space');
  await ui.browser.mouse.up();
};

/**
 * What a pan an exit did not end still shows: the page is in the hand, the
 * pointer is still the gesture's, and the status bar names the pan. A pan is
 * never a Scene, so the file it opened as is the file it leaves, and the hand
 * lets go of the key or the button here.
 */
const panHeld = (letGo: (ui: Ui) => Promise<void>): Ending => ({
  shows: async (ui) => {
    await expect(ui.screen.getByText('Panning')).toBeVisible();
    expect(await pointerHeld(ui)).toBe(true);
    // Still in the hand: the board shows a pan's own hand, not the idle pointer.
    expect(['grab', 'grabbing']).toContain(await cursorAt(IDLE));
  },
  letGo,
  cursor: 'idle',
  files: 'same',
});

/**
 * A pan the browser took the pointer from, with the key that named it still
 * down: the drag is over and the pointer is the browser's, and the status bar
 * goes on naming the pan until the key comes up. The cell checks that before the
 * hand lets go, so a teardown that only happened during the cleanup is not
 * mistaken for one the exit made.
 */
const panCancelled = (letGo: (ui: Ui) => Promise<void>): Ending => ({
  shows: async (ui) => {
    await expect(ui.screen.getByText('Panning')).toBeVisible();
    expect(await pointerHeld(ui)).toBe(false);
    // The drag itself is over: the board shows the hand a held key shows and not
    // the grabbing one a pan in flight does. The pointer's capture cannot say so
    // — the browser drops a cancelled touch's capture whatever the page does
    // with its own record of it — so the board's own mark is what is read.
    expect(await cursorAt(IDLE)).toBe('grab');
  },
  letGo,
  cursor: 'idle',
  files: 'same',
});

/**
 * A pan the page ended by taking another Scene on: the pan is over, and the
 * pointer stays the board's until the button comes up, which is where every
 * gesture lets it go. The cell lets it go that way, and the checks read the page
 * the same as every other cell's.
 */
const panEnded = (letGo: (ui: Ui) => Promise<void>): Ending => ({
  shows: async (ui) => {
    await expect(ui.screen.getByText('Panning')).toBeHidden();
    expect(await pointerHeld(ui)).toBe(true);
  },
  letGo,
  cursor: 'idle',
  files: 'same',
});

/**
 * A pan the page ended by losing the window under it: the drag is over, the
 * pointer is the browser's again, and the status bar stops naming the pan. What
 * is still down is the key the cell held, which no window can take off the
 * keyboard, so the cell lets it go the way the person does.
 */
const panTaken = (letGo: (ui: Ui) => Promise<void>): Ending => ({
  shows: async (ui) => {
    await expect(ui.screen.getByText('Panning')).toBeHidden();
    expect(await pointerHeld(ui)).toBe(false);
  },
  letGo,
  cursor: 'idle',
  files: 'same',
});

/**
 * Land a pan on the page the exit left, without asking the view where it is: a
 * press clears whatever the last gesture left selected, and the pan then moves
 * every mark on the page by exactly the pointer's own nudge. That is what a page
 * still holding half a gesture cannot do — it would carry the page twice — and
 * the ink that is left is the ink it started with.
 */
async function landPan(ui: Ui, carryIt: (ui: Ui) => Promise<void>): Promise<void> {
  await ui.browser.mouse.move(BARE.x, BARE.y);
  await ui.browser.mouse.down();
  await ui.browser.mouse.up();
  await settle(ui);
  const before = await inkCentre(ui);
  await carryIt(ui);
  await settle(ui);
  const moved = await inkCentre(ui);
  expect(moved.x - before.x).toBeCloseTo(PAN_BY.x, 0);
  expect(moved.y - before.y).toBeCloseTo(PAN_BY.y, 0);
  // The page moved whole: the same ink, a handful of antialiased pixels apart.
  expect(Math.abs(moved.count - before.count)).toBeLessThan(20);
}

/**
 * A middle press on bare paper, carried 120 right and 100 down. The pan is the
 * page's, not a Scene edit: the button ends it, and so does the page losing the
 * Scene it was taken on — but an Escape and a refused save are neither, and the
 * pan stays in the hand the button holds.
 */
const MIDDLE_PAN: Gesture = {
  name: 'middle-drag pan',
  arm: noop,
  // A button a finger has no use for: this pan is taken with the mouse, and the
  // one exit the browser cancels it with is the event that pointer would get.
  pointer: 'mouse',
  press: (ui, pointer) => carry(ui, PAN_FROM, PAN_TO, 'middle', pointer),
  started: panning,
  ends: [
    [BLUR, panTaken(letMiddleGo)],
    [HIDDEN, panTaken(letMiddleGo)],
    [SCENE_SWITCH, panEnded(letMiddleGo)],
    [ESCAPE, panHeld(letMiddleGo)],
    [REFUSED_SAVE, panHeld(letMiddleGo)],
  ],
  release: letMiddleGo,
  primes: async (ui) => {
    await selectA(ui);
    await ui.browser.keyboard.press('Shift+ArrowRight');
    await settle(ui);
  },
  again: async (ui) => {
    await landPan(ui, async () => {
      await carry(ui, PAN_FROM, PAN_TO, 'middle');
      await letMiddleGo();
    });
  },
  proves: provesPan,
};

/**
 * The same pan by the key: Space held, and a primary press carried. A key is not
 * the page's to take either — it comes up with the person's finger — so a
 * pointercancel and an Escape leave the panned page in the hand still, and the
 * cell lets the key go the way a person does. The browser cancels a touch, so
 * this pan is carried by one; the cancel ends its drag, and Space, which no
 * cancel reaches, keeps the page in hand.
 */
const SPACE_PAN: Gesture = {
  name: 'Space pan',
  arm: async (ui) => {
    await ui.browser.keyboard.down('Space');
  },
  press: (ui, pointer) => carry(ui, PAN_FROM, PAN_TO, 'left', pointer),
  started: panning,
  ends: [
    [POINTERCANCEL, panCancelled(letSpaceGo)],
    [BLUR, panTaken(letSpaceGo)],
    [HIDDEN, panTaken(letSpaceGo)],
    [SCENE_SWITCH, panEnded(letSpaceGo)],
    [ESCAPE, panHeld(letSpaceGo)],
    [REFUSED_SAVE, panHeld(letSpaceGo)],
  ],
  release: letSpaceGo,
  primes: async (ui) => {
    await selectA(ui);
    await ui.browser.keyboard.press('Shift+ArrowRight');
    await settle(ui);
  },
  again: async (ui) => {
    await landPan(ui, async () => {
      await ui.browser.keyboard.down('Space');
      await drag(ui, PAN_FROM, PAN_TO);
      await ui.browser.keyboard.up('Space');
    });
  },
  proves: provesPan,
};

/** Where a Text session is opened, and where the next one is: bare paper, clear of every other press here. */
const TEXT_AT: Point = { x: 300, y: 400 };
const TEXT_NEXT: Point = { x: 340, y: 440 };
/** Words typed into the session an exit finds, and the words the next session lands. */
const TYPED = 'half a thought';
const LANDED = 'fresh words';

const textTool = (ui: Ui) => ui.screen.getByRole('button', { name: 'Text' });
const wordField = (ui: Ui) => ui.screen.getByRole('textbox', { name: 'Text' });

/**
 * The file the folder holds once a session's words landed: the Scene the press
 * found, with the Text the session made — its words at the point the press was,
 * with the Scene's own defaults — and no other byte moved. Written out, because
 * a commit that also carried an Element or placed the words a pixel off is not
 * the commit the exit documents.
 */
const TYPED_SOURCE = `{
  "version": 1,
  "title": "Two boxes",
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
      "id": "a",
      "type": "rectangle",
      "x": 40,
      "y": 40,
      "width": 120,
      "height": 80,
      "seed": 1251442965,
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
      "textAlign": "center"
    },
    {
      "id": "b",
      "type": "rectangle",
      "x": 200,
      "y": 60,
      "width": 100,
      "height": 100,
      "seed": 1042540567,
      "roughness": 1,
      "stroke": {
        "width": "bold",
        "style": "dashed"
      },
      "fill": {
        "kind": "solid",
        "grey": 4
      },
      "tone": "muted",
      "corners": "sharp",
      "fontSize": "M",
      "textAlign": "center"
    },
    {
      "id": "bent",
      "type": "arrow",
      "points": [
        {
          "x": 60,
          "y": 240
        },
        {
          "x": 140,
          "y": 300,
          "corner": "sharp"
        },
        {
          "x": 220,
          "y": 240
        }
      ],
      "heads": {
        "start": "none",
        "end": "arrow"
      },
      "label": "moving",
      "labelAt": {
        "t": 0.75,
        "offset": 20
      },
      "seed": 268667713,
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
      "textAlign": "center"
    },
    {
      "id": "text-1",
      "type": "text",
      "x": 300,
      "y": 400,
      "content": "half a thought",
      "seed": 1347614238,
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
      "textAlign": "left"
    }
  ]
}
`;

/** An exit that landed the words itself: the field is gone, and the file holds them. */
const WORDS_LANDED: Ending = {
  shows: async (ui) => {
    await expect(wordField(ui)).toHaveCount(0);
  },
  letGo: noop,
  cursor: 'idle',
  files: 'words',
};

/**
 * An exit that is not the session's: the words are still in the field, and the
 * Escape a person leaves them with lands them, as a click away or a blur would.
 */
const WORDS_HELD: Ending = {
  shows: async (ui) => {
    await expect(wordField(ui)).toHaveValue(TYPED);
  },
  letGo: async (ui) => {
    await wordField(ui).press('Escape');
  },
  // The session is not over, so the Text tool is still the one the press armed.
  cursor: 'idle',
  files: 'words',
};

/** An exit that threw the words away: the field is gone and the file is the one the press found. */
const WORDS_DROPPED: Ending = {
  shows: async (ui) => {
    await expect(wordField(ui)).toHaveCount(0);
  },
  letGo: noop,
  cursor: 'idle',
  files: 'same',
};

/**
 * A Text session left open on its words. A blur, an Escape or a click away lands
 * valid words as one step and one write; a page that may only read and a page
 * that takes the element off its DOM throw them away; and a pointercancel or a
 * page hidden out of sight are not the session's at all, so the field keeps them.
 *
 * The press that opens it is the mouse's even where the exit is the browser's:
 * a finger's tap on bare paper opens the field and then blurs it, because the
 * tap also sends the mouse press that takes the focus off, so no finger reaches a
 * session with words in it (see the report). The cancel this row takes is
 * therefore the event a pointer the browser does not cancel gets.
 */
const TEXT_SESSION: Gesture = {
  name: 'open Text session',
  arm: async (ui) => {
    await textTool(ui).click();
  },
  pointer: 'mouse',
  press: async (ui) => {
    await clickScene(ui, TEXT_AT, [], VIEW);
    await wordField(ui).pressSequentially(TYPED);
    await settle(ui);
    return at(TEXT_AT, VIEW);
  },
  started: async (ui) => {
    await expect(wordField(ui)).toHaveValue(TYPED);
  },
  ends: [
    [POINTERCANCEL, WORDS_HELD],
    [BLUR, WORDS_LANDED],
    [HIDDEN, WORDS_HELD],
    [ESCAPE, WORDS_LANDED],
    [SCENE_SWITCH, WORDS_LANDED],
    [REFUSED_SAVE, WORDS_DROPPED],
    [DETACH, WORDS_DROPPED],
  ],
  again: async (ui) => {
    await textTool(ui).click();
    await clickScene(ui, TEXT_NEXT, [], VIEW);
    await settle(ui);
    await wordField(ui).pressSequentially(LANDED);
    await wordField(ui).press('Escape');
    await settle(ui);
  },
  proves: (scene) => {
    const landed = scene.elements.find(
      (element) => element.type === 'text' && element.content === LANDED,
    );
    expect({ x: landed?.x, y: landed?.y }).toEqual(TEXT_NEXT);
  },
};

/**
 * Nothing is selected: the page draws no mark for a selection, and a release
 * that belongs to no gesture adds none.
 */
async function expectNothingSelected(ui: Ui): Promise<void> {
  const marks = await ui.browser.evaluate(() => document.querySelectorAll('.selection').length);
  expect(marks).toBe(0);
}

/**
 * What a page that may only read still does, proved positively: the pill says
 * so, the tool that would change the Scene is refused at the rail, and a sweep
 * still selects — the palette's own Copy row is offered only with a selection —
 * while neither the refused tool nor the sweep writes a byte.
 */
async function expectReadOnly(ui: Ui, before: Record<string, string>): Promise<void> {
  await expect(ui.screen.getByText('read-only')).toBeVisible();
  await rect(ui).click();
  await settle(ui);
  await expect(rect(ui)).toHaveAttribute('aria-pressed', 'false');
  await expect(ui.screen.getByRole('button', { name: 'Select' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await drag(ui, BOXED.from, BOXED.to);
  await settle(ui);
  await palette(ui);
  await expect(command(ui, 'Copy · ⌘C')).toBeEnabled();
  await ui.browser.keyboard.press('Escape');
  await expect(ui.screen.getByRole('dialog', { name: 'Commands' })).toBeHidden();
  await expectFiles(ui, before, 'same');
}

/** The rows of the table: every gesture a person can be in the middle of. */
for (const gesture of [
  DRAW,
  MOVE,
  RESIZE,
  END_HANDLE,
  BEND_HANDLE,
  BOX_SELECT,
  LABEL_DRAG,
  MIDDLE_PAN,
  SPACE_PAN,
  TEXT_SESSION,
]) {
  describe(`the exits a cancelled ${gesture.name} survives`, () => {
    for (const exit of EXITS) {
      test(`ends on ${exit.name}, and the next press starts fresh`, async ({ app, browser, screen }) => {
        const ui = { app, browser, screen };
        // What this gesture's own contract says the exit leaves of it, where the
        // exit is not its end.
        const ending = gesture.ends?.find(([way]) => way === exit)?.[1];
        await exit.open(ui);
        await exit.before(ui, gesture);

        // The Scene as the disk holds it, and the pointer as the idle page
        // shows it: what every check below compares against.
        const before = await savedFiles(ui);
        const idle = await cursorAt(IDLE);
        await gesture.arm(ui);
        const armed = await cursorAt(IDLE);
        const to = await gesture.press(ui, gesture.pointer ?? exit.pointer ?? 'mouse');
        await settle(ui);

        // The press is a gesture in flight — a pointer the page holds, a band it
        // paints, a mark it carried, a field it opened — and not a page that
        // never started one: an exit is only an exit if there was something there
        // to end.
        await gesture.started(ui);

        await exit.drive(ui, to, gesture.pointer ?? exit.pointer ?? 'mouse');
        await settle(ui);

        // What the exit left, read before the hand lets go of anything: an exit
        // that ends the gesture has already let the pointer go and taken its
        // preview with it, and one the row answers for itself says what it still
        // holds. A teardown that only happens on the cleanup below is not one the
        // exit made.
        if (ending !== undefined) {
          await ending.shows(ui);
        } else {
          expect(await pointerHeld(ui)).toBe(false);
          await gesture.cleared?.(ui);
        }

        // The hand lets go of what the exit left in it, as the person's does — and
        // a release that belongs to nobody settles nothing.
        if (ending !== undefined) {
          await ending.letGo(ui);
        } else if (gesture.release !== undefined) {
          await gesture.release(ui);
        } else {
          await browser.mouse.up();
        }
        await settle(ui);

        // What the hand letting go settles of its own, read here and not after the
        // next press: a release that belongs to no gesture changes nothing, and a
        // stale one that selects would be masked by the gesture that follows.
        await gesture.released?.(ui);

        // Nothing the exit left settles: the file is the documented one, the
        // pointer is the browser's again, no mode pill is left, and the cursor is
        // the one this exit leaves — the tool the press armed where the exit keeps
        // it in hand, and the page's own idle one where the gesture took it. A
        // gesture's own cursor (a pan's, a handle's) is neither.
        await expectFiles(ui, before, ending?.files ?? 'same');
        expect(await pointerHeld(ui)).toBe(false);
        await expect(screen.getByText('Panning')).toBeHidden();
        const kept = ending === undefined ? exit.keepsTool : ending.cursor === 'armed';
        expect(await cursorAt(IDLE)).toBe(kept ? armed : idle);

        // The next press is a gesture of its own. A page that may only read still
        // sweeps and selects and refuses the tool that would change it; every
        // other exit leaves a page the row's own landed gesture proves.
        if (exit.fresh === 'refused') {
          await expectReadOnly(ui, before);
        } else {
          await gesture.again(ui);
          gesture.proves(await savedScene(ui, exit.scene));
        }
      });
    }
  });
}
