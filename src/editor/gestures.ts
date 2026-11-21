/**
 * The pointer's state machine: every gesture the canvas understands, as one
 * piece of state and the four events that move it.
 *
 * A press takes the pointer, and what it may become is decided once, on the
 * press: a pan (Space or the middle button), a draw with the armed tool, a
 * resize or a dragged end off a handle, a Label carried off its words, a move, a
 * sweep, or nothing but a click. The moves reshape a *preview*; only the release
 * settles it into the Scene, as one history step and one write. So half a
 * gesture is never a Scene, and an exit that is not a release — `pointercancel`,
 * a window blur, a hidden page, a Scene switch, write access that ends — drops
 * the preview and leaves the Scene exactly as it was.
 *
 * The click is the other half of the machine. A press that never left the
 * click's own slop is a click, two of them in a row and close enough together
 * are a double-click, and the words a double-click opens are the ones the
 * *first* click found: selecting what it landed on may dock the note and carry
 * the view, so the second click does not see what the person aimed at. Nothing
 * else may pair — a drag, a key, a wheel zoom or a Shift each start a new
 * sequence — and a press on the note is answered here too, because docking the
 * note can put it under the very click that is opening words.
 *
 * Where the words are on the page is not the pointer's business: `wordsOffset`,
 * `wordsNearest` and `typedOffset` are asked of the page, which laid the glyphs
 * out. Nothing here draws or measures; it decides, and hands the decision to the
 * editor.
 */
import { elementsById, drawnShaft, outlineBox } from '../renderer.js';
import { canonicalElement, isOutlined } from '../scene.js';
import type { Element as SceneElement, Scene } from '../scene.js';
import type { Layout } from '../layout.js';
import { labelAtFor } from '../geometry.js';
import { boxBetween, elementsInBox, moved, pickAt, resized, resizedBox } from './geometry.js';
import type { Box, Handle, Point, Pointer, View } from './geometry.js';
import type { ToolId } from './actions.js';
import { drawn, drawnAtClick, freshId, idsOf, isClick } from './elements.js';
import type { ElementTool } from './elements.js';
import type { Page } from './page.js';
import { attachedTo, endPoint, isShaft, otherEnd, released, targetAt, withEnd } from './snap.js';
import type { End } from './snap.js';
import type { TextSession } from './text-session.js';
import { wordAt } from './words.js';

/** How far off the ink a click still picks an arrow or line, in screen pixels. */
const PICK_TOLERANCE = 6;
/** How long, and how near, a second click is still the same double-click. */
const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_SLOP = 4;

/**
 * Whether a pointer is still within the click's own slop of where it landed: the
 * line between a click and a drag, and the only threshold a gesture reads.
 */
function withinSlop(from: Point, at: Point): boolean {
  return (
    Math.abs(at.x - from.x) <= DOUBLE_CLICK_SLOP && Math.abs(at.y - from.y) <= DOUBLE_CLICK_SLOP
  );
}

/**
 * A gesture in flight. A gesture that changes the Scene keeps its result here,
 * not in the Scene: the press, the moves and the release are one action, and
 * only the release settles it into the Scene the history and autosave see.
 */
export type Drag =
  | { kind: 'pan'; fromScreen: Point; start: View }
  | {
      kind: 'move';
      from: Point;
      origins: Map<string, SceneElement>;
      /** The Elements as the pointer has moved them, by id. */
      shown: Map<string, SceneElement>;
      /** How far the pointer has carried them: what the painted groups are moved by. */
      by: Point;
    }
  | { kind: 'resize'; id: string; handle: Handle; origin: Box; from: Point; shown: SceneElement }
  | {
      kind: 'draw';
      tool: Exclude<ElementTool, 'text'>;
      id: string;
      from: Point;
      /** What the drag has drawn so far: a preview, not an Element of the Scene yet. */
      preview: SceneElement;
      /** The Element the dragged end would attach to, or null over paper. */
      target: string | null;
    }
  | {
      kind: 'end';
      id: string;
      which: End;
      from: Point;
      /** Where the end draws now: a Snapped end is picked up on its outline. */
      origin: Point;
      /** The Element this end would attach to, or null over paper. */
      target: string | null;
      /** Whether the handle has moved at all during the gesture. */
      moved: boolean;
      shown: SceneElement;
    }
  | { kind: 'text'; at: Point }
  | {
      kind: 'label';
      id: string;
      /** The drawn shaft the Label rides, as the press found it. */
      shaft: { start: Point; end: Point };
      /** Where the press landed on the page: the click's own slop is measured from here. */
      from: Point;
      /** How far off the words' middle the press landed: the words keep that hold. */
      grab: Point;
      /** Whether the words have moved: until then the Scene is the Scene as it was. */
      moved: boolean;
      /** The Element as the drag shows its Label placed. */
      shown: SceneElement;
    }
  | {
      kind: 'words';
      /** Where the selection is anchored, as an offset into the field's words. */
      from: number;
    }
  | { kind: 'box'; from: Point; to: Point; additive: boolean };

/**
 * A press on the canvas with the Select tool, kept until the next one: what was
 * under the pointer, where and when. A double-click asks this rather than the
 * pointer a second time, because the first click's own selection can move the
 * view before the second one lands.
 */
interface Press {
  /** The Element whose words a double-click would edit, or null for bare canvas. */
  readonly id: string | null;
  /** Where on the page the press landed. */
  readonly at: Point;
  /** When, on the event's own clock. */
  readonly time: number;
  /**
   * Whether Shift was held. A Shift press adds to a selection or takes away
   * from one, and two of them in a row are two of those, never a double-click.
   */
  readonly shift: boolean;
}

/**
 * What the pointer asks of the editor, and the one place a gesture becomes a
 * change. The editor answers with what the page holds; nothing here keeps a
 * copy of the Scene, the selection or the view.
 */
interface GestureHost {
  /** The paper the pointer is captured on. */
  readonly board: HTMLElement;
  /** The canvas: a press has to be inside it to be a press on the Scene. */
  readonly canvas: SVGSVGElement;
  /** The docked Style note, which answers a second click of its own. */
  readonly menu: HTMLElement;

  /** The Scene in hand, and the measurement its Labels break with. */
  scene(): Scene;
  layout(): Layout;
  /** The page supplies pointer coordinates, painted ink and glyph positions. */
  readonly page: Pick<Page, 'ink' | 'paint' | 'viewport' | 'wordsNearest' | 'wordsOffset'>;

  selected(): readonly string[];
  select(ids: readonly string[]): void;
  tool(): ToolId;
  setTool(tool: ToolId): void;
  /** True when this page may change the Scene at all. */
  writable(): boolean;

  /** The words being typed, while a session is open. */
  text(): TextSession | null;
  /** An offset among the drawn glyphs, read back into the field's own words. */
  typedOffset(drawn: number): number;
  /** Open the words an Element holds, or place a new Text at a point. */
  openWords(element: SceneElement): void;
  openTextInput(at: Point): void;

  /** A Scene change lands, as one history step and one write. */
  applyScene(next: Scene, options?: { amend?: boolean; select?: readonly string[] }): void;
  /** The note follows the selection, the view makes room for it, the page repaints. */
  refresh(): void;
  /** The page is held in the hand, or let go of: the status bar names the pan while it lasts. */
  panning(on: boolean): void;
}

export class Gestures {
  readonly #host: GestureHost;
  #drag: Drag | null = null;
  /** The pointer the board holds, while a gesture holds it: the one thing an exit must let go. */
  #captured: number | null = null;
  /** The press in flight with the Select tool, while it is still a click. */
  #press: Press | null = null;
  /** The click before it: the first half of a double-click, until something else happens. */
  #lastClick: Press | null = null;
  /**
   * The press inside the words being typed, until the next one: a second press
   * in the same place there selects the word instead of moving the caret.
   */
  #wordsClick: Press | null = null;
  /**
   * The click the note owes the press that opened the words over it. That press
   * was cancelled, so Chromium's click is the press's own and must run nothing.
   */
  #cancelledClick = false;
  #spaceDown = false;
  /** The pointer is carrying the page: a pan drag is in flight. */
  #panDrag = false;

  constructor(host: GestureHost) {
    this.#host = host;
  }

  /** The gesture in flight, or null: what the page draws its preview from. */
  get drag(): Drag | null {
    return this.#drag;
  }

  /** Whether a gesture that changes the Scene is in flight, so an edit waits for the pointer. */
  holdsScene(): boolean {
    const drag = this.#drag;
    return (
      drag !== null &&
      (drag.kind === 'draw' ||
        drag.kind === 'move' ||
        drag.kind === 'resize' ||
        drag.kind === 'end' ||
        drag.kind === 'label')
    );
  }

  /** Whether a Space press is holding the page in the hand, so the pencil stands down. */
  get spaceDown(): boolean {
    return this.#spaceDown;
  }

  /** Nothing pairs a click any more: a drag started, a key came, a zoom moved the page. */
  forgetClicks(): void {
    this.#press = null;
    this.#lastClick = null;
    this.#wordsClick = null;
  }

  /** The words are closed, so the press that selected a word in them pairs with nothing. */
  forgetWordClick(): void {
    this.#wordsClick = null;
  }

  /** A Space press: the page is held in the hand, and the pencil stands down. */
  holdSpace(): void {
    if (this.#spaceDown) {
      return;
    }
    this.#spaceDown = true;
    this.#host.board.classList.add('hand');
    this.#host.board.classList.remove('pen');
    this.#showPanning();
  }

  /**
   * The page is held in the hand while a Space press lasts or a pan drag runs.
   * The status bar says so for exactly that long.
   */
  #showPanning(): void {
    this.#host.panning(this.#spaceDown || this.#panDrag);
  }

  /** A pan drag begins: the grabbing cursor and the status bar's word follow one flag. */
  #beginPan(): void {
    this.#panDrag = true;
    this.#host.board.classList.add('panning');
    this.#showPanning();
  }

  /**
   * The pan drag is over, however it ended: the cursor is the hand's again, and
   * a Space still held keeps the word the press gave.
   */
  #endPan(): void {
    this.#panDrag = false;
    this.#host.board.classList.remove('panning');
    this.#showPanning();
  }

  /**
   * End a Space pan: the key came up, or the page lost the focus that held it.
   * A pan the pointer is still in the middle of ends here too, so a move after
   * the event cannot carry the view any further.
   */
  endSpacePan(): void {
    if (this.#drag !== null && this.#drag.kind === 'pan') {
      this.#drag = null;
      this.#releasePointer();
      this.#endPan();
    }
    if (this.#spaceDown) {
      this.#spaceDown = false;
      this.#host.board.classList.remove('hand');
      this.#host.board.classList.toggle('pen', this.#host.tool() !== 'select');
    }
    this.#showPanning();
  }

  /**
   * Let go of the pointer and discard its preview. Whether the browser or
   * the editor cancels the gesture, only a finished gesture changes the Scene.
   */
  cancel = (): void => {
    const drag = this.#drag;
    this.#drag = null;
    this.#releasePointer();
    this.#forgetPress();
    this.#endPan();
    if (drag !== null && drag.kind === 'draw') {
      // The preview drew under an id the Scene never took.
      this.#host.select([]);
    }
    this.#host.refresh();
  };

  /**
   * The page lost the focus, or was hidden: no pointer of this gesture will
   * ever come up here. A Space pan ends, a press that started no drag lets go of
   * the pointer it took, and half a drag is dropped with the preview it painted —
   * the same page a cancelled pointer leaves, so the frame that follows draws the
   * Scene as it is held.
   */
  release = (): void => {
    this.endSpacePan();
    if (this.#drag !== null) {
      this.cancel();
      return;
    }
    // A press that started no drag still took the pointer — a read-only page
    // selects and moves nothing — and no pointer of this gesture comes up here
    // either. The capture goes with the press, or the page keeps a pointer for a
    // click nobody will make.
    this.#releasePointer();
    this.#press = null;
  };

  /**
   * Let go of everything the pointer holds, without a frame of its own: a page
   * that takes the editor off its DOM, or one that moves to another Scene.
   */
  drop(): void {
    this.#drag = null;
    this.#press = null;
    this.#releasePointer();
  }

  /**
   * A press anywhere on the page, before it becomes a click: words being typed
   * are finished here, while the focus is still theirs.
   *
   * The order matters for an input method. Losing the focus confirms a preedit
   * into the field, so a blur that ended the session would keep words nobody
   * chose; finishing first drops the preedit as an unconfirmed composition.
   * A press off the canvas also starts a new click sequence, as the browser's own does.
   */
  anyPress = (event: PointerEvent): void => {
    // A press the note answered itself never reaches here, so anything that does
    // is a new gesture: no click is owed to the press that opened the words.
    this.#cancelledClick = false;
    const text = this.#host.text();
    // Any button, not the left one only: a middle or a right press takes the
    // focus off the field just the same, and Chromium confirms a preedit into it
    // as it goes. A press on the canvas is the board's own (a pan keeps the
    // words), so only a press elsewhere ends the session.
    const inside = this.#host.canvas.contains(event.target as Node | null);
    if (text !== null && !inside) {
      text.finish();
    }
    if (!inside) {
      this.#lastClick = null;
    }
  };

  down = (event: PointerEvent): void => {
    const { page } = this.#host;
    const { viewport } = page;
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    const text = this.#host.text();
    if (text !== null && event.button === 0) {
      // A press inside the words being typed moves their caret: it is the
      // words', not the canvas's, and the page keeps the focus in the field.
      const offset = page.wordsOffset(viewport.scenePoint(event));
      if (offset !== null) {
        event.preventDefault();
        this.#capture(event);
        this.#press = null;
        this.#lastClick = null;
        this.#pressWords(event, offset);
        return;
      }
      // Any other click takes the focus off the words and commits them, and
      // goes no further: it is not also a click on the canvas. A middle press is
      // a pan, which leaves the words open where they are.
      this.#forgetPress();
      text.finish();
      return;
    }
    this.#capture(event);
    const target = event.target as Element | null;
    if (this.#spaceDown || event.button === 1) {
      // A pan moves the page, not the person: the default press would take the
      // focus off the words being typed, and the blur it causes would commit
      // them. Nothing of a pan is the browser's to do.
      event.preventDefault();
      // A pan is not a click: the next press starts a fresh sequence.
      this.#press = null;
      this.#lastClick = null;
      this.#drag = {
        kind: 'pan',
        fromScreen: viewport.screenPoint(event),
        start: { ...viewport.view },
      };
      this.#beginPan();
      return;
    }
    const tool = this.#host.tool();
    if (tool !== 'select') {
      this.#press = null;
      this.#startDrawing(tool, viewport.scenePoint(event));
      return;
    }
    // A read-only page still selects, sweeps and pans; it just cannot change
    // the Scene, so a press never starts a drag that would.
    const editing = this.#host.writable();
    const handle = editing ? (target?.closest('[data-handle]') ?? null) : null;
    if (handle !== null) {
      this.#press = null;
      const id = handle.getAttribute('data-element') ?? '';
      const which = handle.getAttribute('data-handle');
      const element = this.#host.scene().elements.find((candidate) => candidate.id === id);
      if (element !== undefined && isShaft(element) && (which === 'start' || which === 'end')) {
        const [start, end] = drawnShaft(element, elementsById(this.#host.scene().elements));
        const origin = which === 'start' ? start : end;
        this.#drag = {
          kind: 'end',
          id,
          which,
          from: viewport.scenePoint(event),
          origin,
          target: null,
          moved: false,
          shown: element,
        };
        return;
      }
      if (element !== undefined && isOutlined(element)) {
        this.#drag = {
          kind: 'resize',
          id,
          handle: handle.getAttribute('data-handle') as Handle,
          origin: outlineBox(element),
          from: viewport.scenePoint(event),
          shown: element,
        };
        return;
      }
    }

    const point = viewport.scenePoint(event);
    const reach = PICK_TOLERANCE / viewport.view.zoom;
    // One picker, in layer order: a higher Element's ink answers first, and a
    // shaft's Label answers before the shaft it is written about. The boxes are
    // the ones the page painted, so no Element is drawn to find out.
    const pick = pickAt(
      this.#host.scene().elements,
      point,
      reach,
      this.#host.layout(),
      (element) => page.ink(element.id),
    );
    // A double-click opens the words under its *first* click: selecting what it
    // landed on can dock the note and pan the view, so what the second click
    // sees is not what the person aimed at. The press is recorded before any of
    // that, with a shaft's Label ink counting as words a person can click.
    this.#press = {
      id: pick?.element.id ?? null,
      at: viewport.screenPoint(event),
      time: event.timeStamp,
      shift: event.shiftKey,
    };
    if (pick === null) {
      if (!event.shiftKey) {
        this.#host.select([]);
      }
      this.#drag = { kind: 'box', from: point, to: point, additive: event.shiftKey };
      this.#host.refresh();
      return;
    }

    this.#selectForPress(pick.element.id, event.shiftKey);
    if (editing) {
      const label = pick.label;
      if (label !== null && isShaft(pick.element)) {
        // The words are taken by the hold the press took, and placed from it:
        // a press on them never moves the shaft they are written about.
        const [start, end] = drawnShaft(
          pick.element,
          elementsById(this.#host.scene().elements),
        );
        this.#drag = {
          kind: 'label',
          id: pick.element.id,
          shaft: { start, end },
          from: viewport.screenPoint(event),
          grab: {
            x: point.x - (label.x + label.width / 2),
            y: point.y - (label.y + label.height / 2),
          },
          moved: false,
          shown: pick.element,
        };
      } else {
        // A move frees the ends the selection had, where they draw now, so an
        // arrow that followed its Elements is carried rather than pinned.
        const byId = elementsById(this.#host.scene().elements);
        const origins = new Map(
          this.#selectedElements().map((element) => [element.id, released(element, byId)]),
        );
        this.#drag = { kind: 'move', from: point, origins, shown: new Map(), by: { x: 0, y: 0 } };
      }
    }
    this.#host.refresh();
  };

  move = (event: PointerEvent): void => {
    const { page } = this.#host;
    const { viewport } = page;
    // A press that carries the pointer somewhere is a drag: whatever it started
    // on, it is not the first half of a double-click any more, and neither is the
    // click before it — a drag between two clicks is not a double-click.
    const press = this.#press;
    if (press !== null && !this.#near(press, event)) {
      this.#press = null;
      this.#lastClick = null;
    }
    const drag = this.#drag;
    if (drag === null) {
      return;
    }
    if (drag.kind === 'pan') {
      const point = viewport.screenPoint(event);
      viewport.view = {
        zoom: drag.start.zoom,
        panX: drag.start.panX + (point.x - drag.fromScreen.x),
        panY: drag.start.panY + (point.y - drag.fromScreen.y),
      };
      // The words follow the page they are drawn on, caret and all.
      page.paint();
      return;
    }

    const point = viewport.scenePoint(event);
    if (drag.kind === 'words') {
      // A press that carries the pointer somewhere is a drag, not the first half
      // of a double-click: the next click starts a new sequence, wherever it
      // lands.
      const press = this.#wordsClick;
      if (press !== null && !this.#near(press, event)) {
        this.#wordsClick = null;
      }
      // A drag inside the words takes the caret with it: the other end of the
      // selection stays where the press put it, and the pointer may leave them.
      const offset = page.wordsNearest(point);
      if (offset !== null) {
        const to = this.#host.typedOffset(offset);
        // A gesture that selected something is a drag, however little the
        // pointer moved: two pixels across a glyph boundary is a letter taken,
        // and the click that follows it starts a new sequence instead of
        // taking the word around it.
        if (to !== drag.from) {
          this.#wordsClick = null;
        }
        this.#host.text()?.select(drag.from, to);
      }
      return;
    }
    if (drag.kind === 'box') {
      drag.to = point;
      page.paint();
      return;
    }
    if (drag.kind === 'draw') {
      const target = isShaft(drag.preview)
        ? this.#attachTarget(drag.id, 'end', point, event.altKey)
        : null;
      drag.target = target;
      const preview = drawn(drag.tool, drag.from, point, drag.id, this.#host.scene().defaults);
      drag.preview = isShaft(preview) ? withEnd(preview, 'end', point, target) : preview;
      page.paint();
      return;
    }
    if (drag.kind === 'text') {
      return;
    }
    if (drag.kind === 'label') {
      // One threshold, and it is the click's own: a press that has not carried
      // the pointer past the slop that separates a click from a drag has moved
      // nothing, so it neither places the words nor costs the press its half of
      // a double-click. A press that has is a drag, and pairs with nothing. The
      // slop is measured from the press itself: a wheel zoom drops the press it
      // would otherwise pair with, and that is no reason for the words to jump.
      if (withinSlop(drag.from, viewport.screenPoint(event))) {
        return;
      }
      // The words follow the pointer by the hold they were taken by, so they do
      // not jump to it. The place is the Scene's own, so what the frame shows
      // is what the release saves.
      const anchor = { x: point.x - drag.grab.x, y: point.y - drag.grab.y };
      if (isShaft(drag.shown)) {
        drag.shown = {
          ...drag.shown,
          labelAt: labelAtFor(drag.shaft, anchor, drag.shown.labelAt?.t ?? 0),
        };
        drag.moved = true;
      }
      page.paint();
      return;
    }
    const dx = point.x - drag.from.x;
    const dy = point.y - drag.from.y;
    if (drag.kind === 'end') {
      const element = this.#host.scene().elements.find((candidate) => candidate.id === drag.id);
      if (element === undefined || !isShaft(element)) {
        return;
      }
      // A Snapped end is picked up where it draws, so dragging it a pixel moves
      // it a pixel rather than jumping back to the point it was attached from.
      const { to, target } = this.#resolveEnd(drag, point, event.altKey);
      drag.moved = drag.moved || dx !== 0 || dy !== 0;
      drag.target = target;
      drag.shown = withEnd(element, drag.which, to, target);
      page.paint();
      return;
    }
    if (drag.kind === 'move') {
      if (dx === 0 && dy === 0 && drag.shown.size === 0) {
        // A press that has not moved yet settles nothing: a mere click on an
        // arrow must not free the ends it is attached by.
        return;
      }
      drag.by = { x: dx, y: dy };
      const shown = new Map<string, SceneElement>();
      for (const element of this.#host.scene().elements) {
        const origin = drag.origins.get(element.id);
        if (origin !== undefined) {
          shown.set(element.id, moved(origin, dx, dy));
        }
      }
      drag.shown = shown;
    } else {
      const element = this.#host.scene().elements.find((candidate) => candidate.id === drag.id);
      if (element === undefined) {
        return;
      }
      drag.shown = resized(element, resizedBox(drag.origin, drag.handle, dx, dy));
    }
    page.paint();
  };

  up = (event: PointerEvent): void => {
    const { viewport } = this.#host.page;
    const drag = this.#drag;
    this.#endPan();
    // The pointer comes up for this gesture or for one already ended: either way
    // it is the browser's again.
    this.#releasePointer();
    if (drag === null) {
      return;
    }

    // A press that did not move is a click. Two of them in a row are a
    // double-click, and it opens the words the *first* one found: between the
    // two the note may have made room and carried the view away with it.
    const click = this.#press;
    this.#press = null;
    if (click !== null) {
      const first = this.#lastClick;
      this.#lastClick = click;
      if (first !== null && this.#isDoubleClick(first, click)) {
        this.#lastClick = null;
        const opening =
          first.id === null
            ? undefined
            : this.#host.scene().elements.find((element) => element.id === first.id);
        if (opening !== undefined) {
          event.preventDefault();
          this.#drag = null;
          this.#host.openWords(opening);
          return;
        }
      }
    }

    if (drag.kind === 'text') {
      this.#drag = null;
      this.#host.openTextInput(drag.at);
      return;
    }
    if (drag.kind === 'words') {
      // The selection the drag made is the field's already: the release settles
      // nothing and the words stay open.
      this.#drag = null;
      return;
    }
    if (drag.kind === 'label') {
      // One step, and only the place: the words were the gesture's to move, and
      // the ends the shaft was drawn by are not. The place is rounded where the
      // Scene rounds every number, so the place the ink showed is the place the
      // file holds. A press that carried nothing leaves the Scene as it was, and
      // records no step.
      const placed = canonicalElement(drag.shown);
      const labelAt = isShaft(placed) ? placed.labelAt : undefined;
      this.#drag = null;
      this.#host.applyScene({
        ...this.#host.scene(),
        elements: this.#host
          .scene()
          .elements.map((element) =>
            element.id === drag.id && isShaft(element) && labelAt !== undefined
              ? { ...element, labelAt }
              : element,
          ),
      });
      return;
    }
    if (drag.kind === 'draw') {
      this.#drag = null;
      this.#finishDrawing(drag, viewport.scenePoint(event), event.altKey);
      return;
    }
    if (drag.kind === 'end') {
      this.#drag = null;
      this.#settleEnd(drag, viewport.scenePoint(event), event.altKey);
      return;
    }
    if (drag.kind === 'box') {
      this.#drag = null;
      const swept = boxBetween(drag.from, drag.to);
      const picked = elementsInBox(this.#host.scene().elements, swept, this.#host.layout()).map(
        (element) => element.id,
      );
      this.#host.select(drag.additive ? [...new Set([...this.#host.selected(), ...picked])] : picked);
      this.#host.refresh();
      return;
    }
    if (drag.kind === 'move' || drag.kind === 'resize') {
      // The gesture is over: what the page showed becomes the Scene, as one step.
      const settled = this.#shownScene();
      this.#drag = null;
      // The whole gesture is one history step, and the note may make room for
      // where the selection ended up.
      this.#host.applyScene(settled);
      return;
    }
    this.#drag = null;
    this.#host.refresh();
  };

  /**
   * A press on the docked note. The note is there only because the first click of
   * a double-click selected something, and docking it can put it right where the
   * second click lands. The words that open are still the ones the first click
   * found, and the press makes no pick of its own: cancelling it takes the
   * compatibility click with it.
   */
  menuPress = (event: PointerEvent): void => {
    const first = this.#lastClick;
    if (first === null || event.button !== 0) {
      return;
    }
    const press: Press = {
      id: null,
      at: this.#host.page.viewport.screenPoint(event),
      time: event.timeStamp,
      shift: event.shiftKey,
    };
    if (!this.#isDoubleClick(first, press)) {
      return;
    }
    this.#lastClick = null;
    const opening =
      first.id === null
        ? undefined
        : this.#host.scene().elements.find((element) => element.id === first.id);
    if (opening === undefined) {
      return;
    }
    // The press opened the words: it is no longer a press on the page, and the
    // editor's own outside-press handler must not finish the field it just made.
    event.preventDefault();
    event.stopPropagation();
    // Chromium still follows the press with a click on the row it landed on, and
    // cancelling a press does not take that click away. It is the press's own, so
    // the note consumes it instead of running it: a person who opened a Label by
    // double-clicking over a Style row has not also asked for that Style.
    this.#cancelledClick = true;
    this.#host.openWords(opening);
  };

  /**
   * The click the press that opened the words owes the note: run nothing. Any
   * other click is the note's, because a press of its own reaches the document
   * first and clears the debt.
   */
  menuClickPress = (event: MouseEvent): void => {
    if (!this.#cancelledClick) {
      return;
    }
    this.#cancelledClick = false;
    // A click the keyboard made (`detail` 0: Enter or Space on a row) is not the
    // press's own. The person asked for it after the press, so it runs, and the
    // press owes the note nothing any more.
    if (event.detail === 0 || !this.#host.menu.contains(event.target as Node | null)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  /**
   * A press on an Element: it becomes the selection, or Shift adds it to the
   * selection or takes it back out. A press on what is already selected keeps
   * the selection the gesture will carry.
   */
  #selectForPress(id: string, shift: boolean): void {
    const selected = this.#host.selected();
    if (shift) {
      this.#host.select(
        selected.includes(id) ? selected.filter((one) => one !== id) : [...selected, id],
      );
    } else if (!selected.includes(id)) {
      this.#host.select([id]);
    }
  }

  /**
   * A drawing tool is in hand: the press starts a preview Element, and every
   * move reshapes it until the release settles it into the Scene.
   */
  #startDrawing(tool: ElementTool, point: Point): void {
    if (tool === 'text') {
      // Opened on the release, not the press: the press's own default action
      // would take the focus straight back off the input.
      this.#drag = { kind: 'text', at: point };
      return;
    }
    const id = freshId(tool, idsOf(this.#host.scene().elements));
    this.#host.select([id]);
    this.#drag = {
      kind: 'draw',
      tool,
      id,
      from: point,
      preview: drawn(tool, point, point, id, this.#host.scene().defaults),
      target: null,
    };
    this.#host.page.paint();
  }

  /**
   * The Element the end being dragged would attach to, or null when there is
   * none. Alt held skips attaching, and the Element the other end is attached to
   * is never a target: both ends of one arrow cannot attach to the same one.
   */
  #attachTarget(id: string, end: End, point: Point, skipAttaching: boolean): string | null {
    if (skipAttaching) {
      return null;
    }
    const elements = this.#host.scene().elements;
    const element = elements.find((candidate) => candidate.id === id);
    const other = element !== undefined && isShaft(element) ? attachedTo(element, otherEnd(end)) : null;
    return targetAt(elements, point, other);
  }

  /**
   * The release settles a draw: a gesture keeps the box or stroke it swept, a
   * plain click draws the default box, and a click with a stroke tool draws
   * nothing, because a stroke with no length cannot be seen. The tool then goes
   * back to Select, so one tool draws one Element.
   *
   * What the new end attaches to is read from the release — where the pointer is
   * and whether Alt is held then — not from the last move.
   */
  #finishDrawing(drag: Extract<Drag, { kind: 'draw' }>, at: Point, skipSnap: boolean): void {
    const placed = isClick(drag.from, at)
      ? drawnAtClick(drag.tool, drag.from, drag.id, this.#host.scene().defaults)
      : drawn(drag.tool, drag.from, at, drag.id, this.#host.scene().defaults);
    this.#host.setTool('select');
    if (placed === null) {
      this.#host.select([]);
      this.#host.refresh();
      return;
    }
    const settled = isShaft(placed)
      ? withEnd(placed, 'end', endPoint(placed, 'end'), this.#attachTarget(drag.id, 'end', at, skipSnap))
      : placed;
    this.#host.applyScene(
      { ...this.#host.scene(), elements: [...this.#host.scene().elements, settled] },
      { select: [drag.id] },
    );
  }

  /**
   * Where an end being dragged goes, from one pointer sample: the pointer itself
   * picks the Element the end attaches to, so a drop inside a box attaches even
   * when the hand grabbed the handle off its centre, and the grab offset carries
   * only the endpoint. The preview and the release both come through here, so
   * the line that is shown is the line that is saved.
   */
  #resolveEnd(
    drag: Extract<Drag, { kind: 'end' }>,
    pointer: Point,
    skipSnap: boolean,
  ): { to: Point; target: string | null } {
    return {
      to: {
        x: drag.origin.x + pointer.x - drag.from.x,
        y: drag.origin.y + pointer.y - drag.from.y,
      },
      target: this.#attachTarget(drag.id, drag.which, pointer, skipSnap),
    };
  }

  /**
   * A released end handle settles where the release put it: attached to the
   * Element under that pointer, or free when Alt is held at the release. What
   * settles it is whether the handle moved during the gesture, not whether the
   * release landed elsewhere: a drag that comes back to its start is still a
   * drag, while a press and release in one place is a click on the handle and
   * changes nothing.
   */
  #settleEnd(drag: Extract<Drag, { kind: 'end' }>, at: Point, skipSnap: boolean): void {
    const element = this.#host.scene().elements.find((candidate) => candidate.id === drag.id);
    if (!drag.moved || element === undefined || !isShaft(element)) {
      // The gesture painted a preview and maybe a highlight; a Scene it did not
      // change must not leave either of them on the page.
      this.#host.refresh();
      return;
    }
    const { to, target } = this.#resolveEnd(drag, at, skipSnap);
    this.#host.applyScene({
      ...this.#host.scene(),
      elements: this.#host
        .scene()
        .elements.map((candidate) =>
          candidate.id === drag.id ? withEnd(element, drag.which, to, target) : candidate,
        ),
    });
  }

  /**
   * A press inside the words being typed. One press puts the caret at the glyph
   * under the pointer; a second one in the same place selects the word there;
   * and dragging the pointer carries the other end of the selection with it.
   */
  #pressWords(event: PointerEvent, offset: number): void {
    const text = this.#host.text();
    if (text === null) {
      return;
    }
    const press: Press = {
      id: null,
      at: this.#host.page.viewport.screenPoint(event),
      time: event.timeStamp,
      shift: event.shiftKey,
    };
    const previous = this.#wordsClick;
    // Shift makes a press the extension of a selection, so it is never half of
    // a double-click: no sequence is owed to it, and none survives it.
    this.#wordsClick = press.shift ? null : press;
    const at = this.#host.typedOffset(offset);
    if (previous !== null && this.#isDoubleClick(previous, press)) {
      this.#wordsClick = null;
      const word = wordAt(text.state().words, at);
      text.select(word.from, word.to);
      return;
    }
    const state = text.state();
    // Shift keeps the end of the selection that is not the caret: a press adds
    // to the words already chosen instead of throwing them away.
    const from = event.shiftKey ? (state.caret === state.end ? state.start : state.end) : at;
    text.select(from, at);
    this.#drag = { kind: 'words', from };
  }

  /** The Scene as the page shows it: committed Elements plus the gesture in flight. */
  #shownScene(): Scene {
    const scene = this.#host.scene();
    const drag = this.#drag;
    if (drag === null) {
      return scene;
    }
    if (drag.kind === 'move') {
      return {
        ...scene,
        elements: scene.elements.map((element) => drag.shown.get(element.id) ?? element),
      };
    }
    if (drag.kind === 'resize' || drag.kind === 'end' || (drag.kind === 'label' && drag.moved)) {
      return {
        ...scene,
        elements: scene.elements.map((element) => (element.id === drag.id ? drag.shown : element)),
      };
    }
    return scene;
  }

  /** The Elements the selection holds, as the page shows them. */
  #selectedElements(): SceneElement[] {
    const selected = new Set(this.#host.selected());
    return this.#host
      .scene()
      .elements.filter((element) => selected.has(element.id))
      .map((element) => this.#shown(element.id) ?? element);
  }

  /** One Element as the gesture shows it, while one is in flight. */
  #shown(id: string): SceneElement | undefined {
    const drag = this.#drag;
    if (drag !== null && drag.kind === 'move') {
      return drag.shown.get(id);
    }
    return undefined;
  }

  /** Whether a pointer move is still within the press that started it. */
  #near(press: Press, event: Pointer): boolean {
    return withinSlop(press.at, this.#host.page.viewport.screenPoint(event));
  }

  /**
   * Take the pointer for the gesture that is starting. A pointer the browser has
   * already let go cannot be captured, and the gesture still ends on the release
   * it gets, so a capture that is no longer there is not a failure.
   */
  #capture(event: PointerEvent): void {
    this.#releasePointer();
    try {
      this.#host.board.setPointerCapture(event.pointerId);
      this.#captured = event.pointerId;
    } catch {
      // Nothing to take: the gesture runs on the events the board still gets.
    }
  }

  /**
   * Let the pointer go. Every way a gesture can end — a release, a cancel, a key
   * coming up, the page losing its focus, a rebuild, a page that takes the
   * editor off its DOM — ends here, so no exit can leave the board holding a
   * pointer nobody will release.
   */
  #releasePointer(): void {
    const id = this.#captured;
    this.#captured = null;
    if (id === null) {
      return;
    }
    try {
      if (this.#host.board.hasPointerCapture(id)) {
        this.#host.board.releasePointerCapture(id);
      }
    } catch {
      // The pointer was already the browser's: no capture left to let go of.
    }
  }

  /** The presses a gesture leaves behind, when a new one starts in their place. */
  #forgetPress(): void {
    this.#press = null;
    this.#lastClick = null;
    this.#wordsClick = null;
  }

  /**
   * Whether a press is the second half of a double-click: near the first in
   * time and place, and no Shift on either, because a press that adds to a
   * selection is about the selection and not about the word under it.
   */
  #isDoubleClick(first: Press, second: Press): boolean {
    return (
      !first.shift &&
      !second.shift &&
      second.time - first.time <= DOUBLE_CLICK_MS &&
      Math.abs(second.at.x - first.at.x) <= DOUBLE_CLICK_SLOP &&
      Math.abs(second.at.y - first.at.y) <= DOUBLE_CLICK_SLOP
    );
  }
}
