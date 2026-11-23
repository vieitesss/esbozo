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
 * A gesture that is not a Scene edit answers for itself, because its exit is
 * not what ends it: the pan is the page's, and it ends with the key or the
 * button the hand took it with, and a Text session's words are the session's,
 * so an exit may land them or throw them away. `ends` is where such a row says
 * what those cells are instead, and every other cell is the four above.
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
import { blurPage, cursorAt, livePage } from './cdp.ts';
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

/** @returns where the pointer was left, still down: half a gesture. */
async function carry(
  ui: Ui,
  from: Point,
  to: Point,
  button: 'left' | 'middle' = 'left',
): Promise<Point> {
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

/**
 * A cell a gesture answers for itself, because its exit is not what ends it: the
 * pan is the page's and is still in the hand the key or the button holds, and a
 * Text session's words are the session's, so an exit may land them or throw them
 * away. The row says what the page still shows, how the hand then lets go, and
 * whether words landed in the Scene — the row's `shows` proves those, because
 * only the row knows which words they are.
 */
interface Ending {
  /** What the page must show of the gesture once the exit is over. */
  readonly shows: (ui: Ui) => Promise<void>;
  /** The hand lets go of what the exit left in it, and what that documents follows here. */
  readonly letGo: (ui: Ui) => Promise<void>;
  /** True when the exit landed words, so the disk is not the one the press found. */
  readonly landed?: boolean;
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
  readonly drive: (ui: Ui, to: Point) => Promise<void>;
  /** The Scene the checked press lands in: the one the page holds after the exit. */
  readonly scene: string;
  /** Whether the exit leaves the page able to save a press at all. */
  readonly fresh: 'lands' | 'refused';
}

const editorPage = (ui: Ui) => openEditor(ui, FOLDERS, 'scene.json');

/** The browser takes the gesture over, as a touch that became a scroll does: a cancellation, not a release. */
const POINTERCANCEL: Exit = {
  name: 'a pointercancel',
  open: editorPage,
  before: noop,
  drive: async (ui, to) => {
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
  scene: 'scene.json',
  fresh: 'lands',
};

/** The page goes out of sight: the tab behind another one. */
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
      document.dispatchEvent(new Event('visibilitychange'));
      return true;
    });
  },
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
  press: (ui) => carry(ui, DRAWN.from, DRAWN.to),
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

/** The arrow's end handle, and a free point below and right of it, on no box. */
const ENDED = { from: at({ x: 220, y: 240 }, VIEW), to: at({ x: 260, y: 300 }, VIEW) };

const END_HANDLE: Gesture = {
  name: 'end handle',
  arm: selectBent,
  press: (ui) => carry(ui, ENDED.from, ENDED.to),
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
  press: (ui) => carry(ui, BENT_MOVED.from, BENT_MOVED.to),
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
  press: (ui) => carry(ui, BOXED.from, BOXED.to),
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

const LABEL_DRAG: Gesture = {
  name: 'Label drag',
  arm: noop,
  press: (ui) => carry(ui, LABEL_MOVED.from, LABEL_MOVED.to),
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
 * What a pan an exit did not end still shows: the page is in the hand, and the
 * status bar names it. A pan is never a Scene, so the file it opened as is the
 * file it leaves, and the hand lets go of the key or the button here.
 */
const panHeld = (letGo: (ui: Ui) => Promise<void>): Ending => ({
  shows: async (ui) => {
    await expect(ui.screen.getByText('Panning')).toBeVisible();
  },
  letGo,
});

/**
 * A pan the page ended by taking another Scene on: the pan is over, and the
 * pointer stays the board's until the button comes up, which is where every
 * gesture lets it go. The cell lets it go that way, and the four checks read the
 * page the same as every other cell's.
 */
const panEnded = (letGo: (ui: Ui) => Promise<void>): Ending => ({
  shows: async (ui) => {
    await expect(ui.screen.getByText('Panning')).toBeHidden();
    expect(await pointerHeld(ui)).toBe(true);
  },
  letGo,
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
  press: (ui) => carry(ui, PAN_FROM, PAN_TO, 'middle'),
  ends: [
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
 * cell lets the key go the way a person does.
 */
const SPACE_PAN: Gesture = {
  name: 'Space pan',
  arm: async (ui) => {
    await ui.browser.keyboard.down('Space');
  },
  press: (ui) => carry(ui, PAN_FROM, PAN_TO),
  ends: [
    [POINTERCANCEL, panHeld(letSpaceGo)],
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

/** The words landed in the Scene the session was typed in: the file holds them. */
async function expectWordsLanded(ui: Ui): Promise<void> {
  const elements = (await savedScene(ui, 'scene.json')).elements;
  expect(elements.some((element) => element.type === 'text' && element.content === TYPED)).toBe(true);
}

/** An exit that landed the words itself: the field is gone, and the file holds them. */
const WORDS_LANDED: Ending = {
  shows: async (ui) => {
    await expect(wordField(ui)).toHaveCount(0);
    await expectWordsLanded(ui);
  },
  letGo: noop,
  landed: true,
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
    await expectWordsLanded(ui);
  },
  landed: true,
};

/** An exit that threw the words away: the field is gone and the file is the one the press found. */
const WORDS_DROPPED: Ending = {
  shows: async (ui) => {
    await expect(wordField(ui)).toHaveCount(0);
  },
  letGo: noop,
};

/**
 * A Text session left open on its words. A blur, an Escape or a click away lands
 * valid words as one step and one write; a page that may only read and a page
 * that takes the element off its DOM throw them away; and a pointercancel or a
 * page hidden out of sight are not the session's at all, so the field keeps them.
 */
const TEXT_SESSION: Gesture = {
  name: 'open Text session',
  arm: async (ui) => {
    await textTool(ui).click();
  },
  press: async (ui) => {
    await clickScene(ui, TEXT_AT, [], VIEW);
    await wordField(ui).pressSequentially(TYPED);
    await settle(ui);
    return at(TEXT_AT, VIEW);
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
    // A page that may only read opens no session, and the press settles nothing.
    if ((await wordField(ui).count()) === 0) {
      return;
    }
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
        const to = await gesture.press(ui);
        await settle(ui);

        await exit.drive(ui, to);
        await settle(ui);

        // What the exit left of a gesture it does not end by itself: the pan is
        // still in the hand the key or the button holds, and a Text session may
        // still hold its words. The hand then lets go of it, as the person's
        // does, and what that documents is the row's to assert.
        if (ending !== undefined) {
          await ending.shows(ui);
          await ending.letGo(ui);
          await settle(ui);
        }

        // The pointer is the browser's again, and nothing that is not the
        // documented commit of the words was saved.
        expect(await pointerHeld(ui)).toBe(false);
        if (ending?.landed !== true) {
          await expectSameFiles(ui, before);
        }

        // No gesture mode is left: no mode pill, and the cursor the page shows
        // with the tool in hand or with it back on Select. A gesture never has a
        // cursor of its own to leave behind.
        await expect(screen.getByText('Panning')).toBeHidden();
        expect([idle, armed]).toContain(await cursorAt(IDLE));

        // The next press is a gesture of its own, and it lands whole. The hand
        // lets go of the press first: a pan's key or button is the row's own,
        // and every other gesture's is the left button the fixture holds.
        if (gesture.release !== undefined) {
          await gesture.release(ui);
        } else {
          await browser.mouse.up();
        }
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
