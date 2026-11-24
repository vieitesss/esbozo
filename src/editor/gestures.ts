import { elementsById, drawnShaft, outlineBox, shaftInk } from '../renderer.js';
import { canonicalElement, isOutlined } from '../scene.js';
import type { ArrowOrLineElement, Element as SceneElement, Scene } from '../scene.js';
import type { Layout } from '../layout.js';
import { labelAtFor } from '../geometry.js';
import type { ShaftPath } from '../geometry.js';
import { boxBetween, elementsInBox, moved, pickAt, resized, resizedBox } from './geometry.js';
import type { Box, Handle, Point, Pointer, View } from './geometry.js';
import {
  bendFromDot,
  bendFromHandle,
  dotAt,
  sameBend,
  shaftIn,
  withBend,
  withInsertedBend,
} from './bend-point.js';
import type { Bend, ShaftOf } from './bend-point.js';
import type { ToolId } from './actions.js';
import { drawn, drawnAtClick, freshId, idsOf, isClick } from './elements.js';
import type { ElementTool } from './elements.js';
import type { Page, Shown } from './page.js';
import { attachedTo, endPoint, isShaft, otherEnd, targetAt, withEnd } from './snap.js';
import type { End } from './snap.js';
import type { TextSession } from './text-session.js';
import type { Typing } from './typing.js';
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
      /** Where this press landed: the click the release is measured from. */
      from: Point;
      /** What the drag has drawn so far: a preview, not an Element of the Scene yet. */
      preview: SceneElement;
      /** The Element the dragged end would attach to, or null over paper. */
      target: string | null;
      /**
       * Whether the press that started this draw held Shift, as it held it when
       * it landed: a Shift press is about the selection, so the click it places
       * as a shaft's first point is no half of a double-click either.
       */
      shift: boolean;
      /**
       * The points a place has put down, or null while the gesture is one drag.
       * A press that never left the click's own slop places the first point
       * instead of drawing a shaft between two, and the half-made shaft then
       * stays in hand between presses until it is finished.
       */
      placing: Placing | null;
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
  | {
      kind: 'bend';
      id: string;
      /** The point the handle stands on: a bend between the ends, never an end. */
      index: number;
      /**
       * Whether the press pulled this point out of a segment's dot: it is not in
       * the Scene yet, and a press that carries nothing leaves it out.
       */
      inserted: boolean;
      /** Whether the press held Shift: a Shift press is about the selection, so it picks no point. */
      shift: boolean;
      from: Point;
      /** The bend as the Scene stores it: where the pointer grabbed it, or where the dot stood. */
      origin: Point;
      /** Whether the handle has moved at all during the gesture. */
      moved: boolean;
      shown: SceneElement;
    }
  | { kind: 'text'; at: Point }
  | {
      kind: 'label';
      id: string;
      /** The drawn shaft the Label rides, as the press found it, ink and bends and all. */
      path: ShaftPath;
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
 * A shaft being placed: the points it has put down, in the Scene's own
 * coordinates, and the click that put the last one there — two clicks in a row
 * on one place are the double-click that finishes it.
 */
interface Placing {
  /** The points placed so far, whole-pixel, no Snap on any: only an end Snaps. */
  readonly points: readonly Point[];
  /**
   * Where the pointer came up for the last of them, before the Scene rounds it:
   * the Snap is read from here, as a dragged end's is read from its release.
   */
  readonly release: Point;
  /** The last placed click, until a drag or a finish breaks the pair. */
  readonly click: Press | null;
  /** Whether the last placed point was clicked with Alt: that end stays free. */
  readonly skipSnap: boolean;
}

/** A point as the Scene stores every coordinate. */
function whole(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

/** The tools that draw a shaft between points: a drag's two, and a place's many. */
function drawsStroke(tool: Exclude<ElementTool, 'text'>): tool is 'arrow' | 'line' {
  return tool === 'arrow' || tool === 'line';
}

/**
 * The Element a stroke tool drew, narrowed: an arrow or line tool draws a shaft
 * and never a box, so this cannot be another type.
 */
function strokeOf(element: SceneElement): ArrowOrLineElement {
  if (!isShaft(element)) {
    throw new Error(`a stroke tool drew a ${element.type}`);
  }
  return element;
}

/**
 * The gestures whose preview is a swap of Elements: the groups a move carries,
 * the one Element a resize or a dragged end draws, and a Label the pointer has
 * taken off its shaft. Those are shown as the pointer has made them, and only
 * those: the rest of the Scene is the Scene.
 */
type ShownDrag = Extract<Drag, { kind: 'move' | 'resize' | 'end' | 'bend' | 'label' }>;

/**
 * The Scene's Elements as the gesture in flight shows them. The ink the pointer
 * leaves and the Scene the release settles are this one projection, so a drag
 * can never show one thing and save another.
 */
function shownElements(elements: SceneElement[], drag: ShownDrag): SceneElement[] {
  if (drag.kind === 'move') {
    return elements.map((element) => drag.shown.get(element.id) ?? element);
  }
  return elements.map((element) => (element.id === drag.id ? drag.shown : element));
}

/**
 * The pointers the page's board refused, kept for the page rather than for one
 * editor: a pointer id belongs to the page, and two editors side by side see the
 * same press. A press refused in one is refused in both, so the editor beside it
 * cannot settle that press's move or release as a gesture of its own.
 */
const REFUSED = new Set<number>();

const SHOWN_KINDS: Record<ShownDrag['kind'], true> = {
  move: true,
  resize: true,
  end: true,
  bend: true,
  label: true,
};

/** Whether a drag's preview is a swap of Elements: one of `ShownDrag`'s kinds. */
function asShownDrag(drag: Drag): ShownDrag | null {
  return drag.kind in SHOWN_KINDS ? (drag as ShownDrag) : null;
}

interface Press {
  /** The Element whose words a double-click would edit, or null for bare canvas. */
  readonly id: string | null;
  /** Where on the page the press landed. */
  readonly at: Point;
  /** When, on the event's own clock. */
  readonly time: number;
  readonly shift: boolean;
  readonly bend?: Bend;
}

interface GestureHost {
  /** The paper the pointer is captured on. */
  readonly board: HTMLElement;
  /** The canvas: a press has to be inside it to be a press on the Scene. */
  readonly canvas: SVGSVGElement;
  /** The docked Style note, which answers a second click of its own. */
  readonly menu: HTMLElement;
  /** The tool rail: the page's chrome, so a press on it is no press on the board (D5). */
  readonly rail: HTMLElement;

  /** The Scene in hand, and the measurement its Labels break with. */
  scene(): Scene;
  layout(): Layout;
  /** The page supplies pointer coordinates, painted ink and glyph positions. */
  readonly page: Pick<Page, 'ink' | 'paint' | 'viewport' | 'wordsNearest' | 'wordsOffset'>;

  selected(): readonly string[];
  select(ids: readonly string[]): void;
  /** The one bend point the selection holds, set by a press and let go by the next one. */
  selectBend(bend: Bend | null): void;
  /** Remove the bend point a double-click holds, as one step: the editor's own removal. */
  removeBend(bend: Bend): void;
  tool(): ToolId;
  setTool(tool: ToolId): void;
  /** True when this page may change the Scene at all. */
  writable(): boolean;

  /** Open the field, or read and move its selection while it is open. */
  readonly typing: Pick<Typing, 'text' | 'typedOffset' | 'openWords' | 'openTextInput'>;

  /** A Scene change lands, as one history step and one write. */
  applyScene(next: Scene, options?: { amend?: boolean; select?: readonly string[] }): void;
  /** The note follows the selection, the view makes room for it, the page repaints. */
  refresh(): void;
  /** Refresh the status bar after the held Space or pan drag changes. */
  showPanning(): void;
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
  #wordsClick: Press | null = null;
  #cancelledClick = false;
  #spaceDown = false;
  /** The Shaft a page mark names, which is what makes the mark a bend point's. */
  #shaft: ShaftOf = (id) => shaftIn(this.#host.scene(), id);

  constructor(host: GestureHost) {
    this.#host = host;
  }

  /** The gesture in flight, or null: what the page draws its preview from. */
  get drag(): Drag | null {
    return this.#drag;
  }

  holdsScene(): boolean {
    const drag = this.#drag;
    return drag !== null && (drag.kind === 'draw' || asShownDrag(drag) !== null);
  }

  /** Whether a shaft is being placed by clicks, so a key may end the place it is half of. */
  placing(): boolean {
    return this.#drag !== null && this.#drag.kind === 'draw' && this.#drag.placing !== null;
  }

  sweeping(): boolean {
    return this.#drag?.kind === 'box';
  }

  shownByDrag(): Shown | null {
    const drag = this.#drag;
    if (drag === null) {
      return null;
    }
    const elements = this.#host.scene().elements;
    if (drag.kind === 'draw') {
      return { settled: false, elements: [...elements, drag.preview] };
    }
    // A pan and a caret drag carry the page under the words rather than changing
    // what it holds, so the session's own preview stays drawn.
    if (drag.kind === 'pan' || drag.kind === 'words') {
      return null;
    }
    const shown = asShownDrag(drag);
    // A Label the pointer has not carried stands where the Scene holds it, and a
    // press that has placed nothing shows that Scene too.
    if (shown === null || (shown.kind === 'label' && !shown.moved)) {
      return { settled: true, elements };
    }
    return { settled: false, elements: shownElements(elements, shown) };
  }

  /** Whether a Space press is holding the page in the hand, so the pencil stands down. */
  get spaceDown(): boolean {
    return this.#spaceDown;
  }

  /** A held Space names the pan even before the pointer starts carrying the page. */
  get panning(): boolean {
    return this.#spaceDown || this.#drag?.kind === 'pan';
  }

  forgetClicks(): void {
    this.#press = null;
    this.#lastClick = null;
    this.#wordsClick = null;
    const drag = this.#drag;
    if (drag !== null && drag.kind === 'draw' && drag.placing !== null) {
      drag.placing = { ...drag.placing, click: null };
    }
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
    this.#host.showPanning();
  }

  /** Only a pan drag grabs the cursor. A held Space alone still names the pan. */
  #showPanDrag(): void {
    this.#host.board.classList.toggle('panning', this.#drag?.kind === 'pan');
    this.#host.showPanning();
  }

  endSpacePan(): void {
    const wasPanning = this.panning;
    if (this.#drag?.kind === 'pan') {
      this.#drag = null;
    }
    if (this.#spaceDown) {
      this.#spaceDown = false;
      this.#host.board.classList.remove('hand');
      this.#host.board.classList.toggle('pen', this.#host.tool() !== 'select');
    }
    if (wasPanning) {
      this.#showPanDrag();
    }
  }

  cancel = (event?: PointerEvent): void => {
    if (event !== undefined && REFUSED.delete(event.pointerId)) {
      return;
    }
    const drag = this.#drag;
    this.#drag = null;
    this.#releasePointer();
    this.#forgetPress();
    if (drag?.kind === 'pan') {
      this.#showPanDrag();
    }
    if (drag !== null && drag.kind === 'draw') {
      // The preview drew under an id the Scene never took.
      this.#host.select([]);
    }
    this.#host.refresh();
  };

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

  drop(): void {
    const wasDraggingPan = this.#drag?.kind === 'pan';
    this.#drag = null;
    this.#press = null;
    this.#releasePointer();
    if (wasDraggingPan) {
      this.#showPanDrag();
    }
  }

  anyPress = (event: PointerEvent): void => {
    // A press the note answered itself never reaches here, so anything that does
    // is a new gesture: no click is owed to the press that opened the words.
    this.#cancelledClick = false;
    const text = this.#host.typing.text();
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
      // A press beside the canvas — a note, the page around it — is not the next
      // point of the shaft in hand: the place ends at its last point before that
      // press edits anything. The rail is the one press that is not the board's at
      // all (D5): the shaft keeps the points it has, and it is the tile's own
      // click, picking a tool, that ends the place.
      if (!this.#host.rail.contains(event.target as Node | null)) {
        this.finishPlacing();
      }
    }
  };

  /**
   * A press the board kept for itself is refused as a menu's press is: a rail
   * drag owns a pointer, so a contact that lands under it must not become half of
   * a gesture, and a press a called-off drag left down has nothing of its own to
   * settle any more. Its move, release and cancel are its own, and settling
   * another pointer's gesture at its coordinates is exactly what a refusal
   * prevents. The refusal ends where the pointer does: its next press is a press.
   */
  refuse = (pointer: number): void => {
    REFUSED.add(pointer);
  };

  down = (event: PointerEvent): void => {
    // Only a press the board takes settles on its release; a press it refuses is
    // no half of a gesture, and its release must not act as one. This press
    // answers for its own pointer alone: another pointer's refusal is not this
    // press's to keep.
    REFUSED.delete(event.pointerId);
    const { page } = this.#host;
    const { viewport } = page;
    if (event.button !== 0 && event.button !== 1) {
      REFUSED.add(event.pointerId);
      return;
    }
    // A Ctrl+left press is the secondary click macOS reads as a context menu,
    // and the point menu's: it carries no gesture, so a Ctrl+click on a handle
    // opens that point's menu instead of a press the clicks after it could pair
    // with and remove the point through.
    if (event.button === 0 && event.ctrlKey) {
      REFUSED.add(event.pointerId);
      return;
    }
    // A finger's press is followed by the browser's own mouse press, made after
    // the release: the board never asks for it, and its default action moves the
    // focus to the board — off the field a Text session opened on that release,
    // and off the words a double tap opened. Preventing the touch press is what
    // stops those compatibility events; the gesture is read from the pointer's
    // own, so nothing of it is lost.
    if (event.pointerType === 'touch') {
      event.preventDefault();
    }
    const text = this.#host.typing.text();
    if (text !== null && event.button === 0) {
      // A press inside the words being typed moves their caret: it is the
      // words', not the canvas's, and the page keeps the focus in the field.
      const offset = page.wordsOffset(viewport.scenePoint(event));
      if (offset !== null) {
        event.preventDefault();
        this.#capture(event);
        this.#press = null;
        this.#lastClick = null;
        this.#pressWords(event, text, offset);
        return;
      }
      // Any other click takes the focus off the words and commits them, and
      // goes no further: it is not also a click on the canvas. A middle press is
      // a pan, which leaves the words open where they are.
      this.#forgetPress();
      REFUSED.add(event.pointerId);
      text.finish();
      return;
    }
    this.#capture(event);
    const target = event.target as Element | null;
    if (this.#spaceDown || event.button === 1) {
      // A pan is not a point of a shaft in hand: the place ends at its last
      // point, and the page is taken in the hand after it.
      this.finishPlacing();
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
      this.#showPanDrag();
      return;
    }
    // A press that is not a pan lets go of the point the press before it picked:
    // the point belongs to one press, and only a pan keeps it in the hand.
    this.#host.selectBend(null);
    const place = this.#drag;
    if (place !== null && place.kind === 'draw' && place.placing !== null) {
      // With a shaft in hand the press carries the preview to where it lands: it
      // puts no point down itself, so a click and a drag are told apart on the
      // release, and two clicks on one place are the double-click that ends it.
      place.from = viewport.scenePoint(event);
      place.target = null;
      return;
    }
    const tool = this.#host.tool();
    if (tool !== 'select') {
      this.#press = null;
      this.#startDrawing(tool, viewport.scenePoint(event), event.shiftKey);
      return;
    }
    // A read-only page still selects, sweeps and pans; it just cannot change
    // the Scene, so a press never starts a drag that would.
    const editing = this.#host.writable();
    const handle = editing ? (target?.closest('[data-handle]') ?? null) : null;
    if (handle !== null) {
      this.#press = null;
      // A bend handle is on the Shaft itself, so the press is asked about the
      // bend before any Element is looked up: only an end or a resize handle
      // needs the Element its `data-element` names.
      const pressed = bendFromHandle(handle, this.#shaft);
      if (pressed !== null) {
        const stored = pressed.shaft.points[pressed.bend.index]!;
        // A bend handle is a mark on the shaft, and a press on it is a click
        // there: two of them on one handle are a double-click that takes the
        // point, and a single one is each of the two clicks it is half of.
        this.#press = {
          id: pressed.bend.id,
          at: viewport.screenPoint(event),
          time: event.timeStamp,
          shift: event.shiftKey,
          bend: pressed.bend,
        };
        this.#drag = {
          kind: 'bend',
          id: pressed.bend.id,
          index: pressed.bend.index,
          inserted: false,
          shift: event.shiftKey,
          from: viewport.scenePoint(event),
          origin: { x: stored.x, y: stored.y },
          moved: false,
          shown: pressed.shaft,
        };
        return;
      }
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

    if (editing && this.#pullBend(target, event)) {
      return;
    }

    const point = viewport.scenePoint(event);
    const reach = PICK_TOLERANCE / viewport.view.zoom;
    // One picker, in layer order: a higher Element's ink answers first, and a
    // shaft's Label answers before the shaft it is written about. The boxes are
    // the ones the page painted for the Scene it holds, so no Element is drawn
    // to find out.
    const pick = pickAt(
      this.#host.scene().elements,
      point,
      reach,
      this.#host.layout(),
      (element) => page.ink(element),
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
        // a press on them never moves the shaft they are written about. The ink
        // itself is what the place on the shaft is read back from, so a bent
        // shaft's words stay on the bend the drawing put them on.
        const path = shaftInk(
          pick.element,
          elementsById(this.#host.scene().elements),
        ).path;
        this.#drag = {
          kind: 'label',
          id: pick.element.id,
          path,
          from: viewport.screenPoint(event),
          grab: {
            x: point.x - (label.x + label.width / 2),
            y: point.y - (label.y + label.height / 2),
          },
          moved: false,
          shown: pick.element,
        };
      } else {
        // A move carries what follows nothing: a free end, a bend, and the box
        // an Element sits on. A Snapped end stays on its target's outline, so a
        // two-point shaft Snapped at both ends moves nothing at all.
        const origins = new Map(
          this.#selectedElements().map((element) => [element.id, element]),
        );
        this.#drag = { kind: 'move', from: point, origins, shown: new Map(), by: { x: 0, y: 0 } };
      }
    }
    this.#host.refresh();
  };

  move = (event: PointerEvent): void => {
    // A refused pointer's move is no part of a gesture: it is its own refusal,
    // and a pointer carrying a drag at the same time keeps it. Carrying it here
    // would end that pointer's click pairing and pull its drag with this one.
    if (REFUSED.has(event.pointerId)) {
      return;
    }
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
        const to = this.#host.typing.typedOffset(offset);
        // A gesture that selected something is a drag, however little the
        // pointer moved: two pixels across a glyph boundary is a letter taken,
        // and the click that follows it starts a new sequence instead of
        // taking the word around it.
        if (to !== drag.from) {
          this.#wordsClick = null;
        }
        this.#host.typing.text()?.select(drag.from, to);
      }
      return;
    }
    if (drag.kind === 'box') {
      drag.to = point;
      page.paint();
      return;
    }
    if (drag.kind === 'draw') {
      if (drag.placing !== null) {
        // Between presses the place follows the pointer: the segment reaches for
        // it, and its end Snaps the way a dragged end does — Alt skips that.
        const { preview, target } = this.#placePreview(
          drag,
          drag.placing.points,
          point,
          event.altKey,
        );
        drag.preview = preview;
        drag.target = target;
        page.paint();
        return;
      }
      const target = isShaft(drag.preview)
        ? this.#attachTarget(drag.id, 'end', point, event.altKey)
        : null;
      drag.target = target;
      const preview = drawn(drag.tool, drag.from, point, drag.id, this.#host.scene().defaults);
      drag.preview = isShaft(preview)
        ? withEnd(preview, 'end', point, target, elementsById(this.#host.scene().elements))
        : preview;
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
          labelAt: labelAtFor(drag.path, anchor, drag.shown.labelAt?.t ?? 0),
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
      drag.shown = withEnd(
        element,
        drag.which,
        to,
        target,
        elementsById(this.#host.scene().elements),
      );
      page.paint();
      return;
    }
    if (drag.kind === 'bend') {
      const base = this.#bendBase(drag);
      if (base === undefined) {
        return;
      }
      // A bend never Snaps and never carries an end: it is the one point the
      // pointer holds, rounded to whole pixels where the Scene rounds every
      // number, and every other field of the Element stays the Scene's.
      drag.moved = drag.moved || dx !== 0 || dy !== 0;
      drag.shown = withBend(base, drag.index, {
        x: drag.origin.x + dx,
        y: drag.origin.y + dy,
      });
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
    // A release without the press that started a gesture settles nothing: the
    // press was refused before it began, so it puts no point down and finishes no
    // place. It is the refused pointer's own release, and no other: a pointer
    // carrying a gesture at the same time keeps its capture, and its release is
    // still the one that settles it.
    if (REFUSED.delete(event.pointerId)) {
      return;
    }
    // The pointer comes up for this gesture or for one already ended: either way
    // it is the browser's again.
    this.#releasePointer();
    // Chromium pastes the primary selection when the middle button comes up, into
    // whatever holds the focus — the words being typed included. A middle release
    // the board gets is a pan's, even one a Space press already ended.
    if (event.button === 1) {
      event.preventDefault();
    }
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
        // A press that took a bend handle asked for that point, not for the
        // words the handle stands on: the pair removes the point or settles
        // nothing, and never opens a Label.
        const bend = first.bend;
        const opening =
          bend !== undefined || first.id === null
            ? undefined
            : this.#host.scene().elements.find((element) => element.id === first.id);
        if (bend !== undefined && sameBend(click.bend, bend)) {
          this.#drag = null;
          this.#host.removeBend(bend);
          return;
        }
        if (opening !== undefined) {
          event.preventDefault();
          this.#drag = null;
          this.#host.typing.openWords(opening);
          return;
        }
      }
    }

    if (drag.kind === 'text') {
      this.#drag = null;
      this.#host.typing.openTextInput(drag.at);
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
      if (drag.placing !== null) {
        this.#placePoint(drag, viewport.scenePoint(event), event);
        return;
      }
      this.#drag = null;
      this.#finishDrawing(drag, viewport.scenePoint(event), event);
      return;
    }
    if (drag.kind === 'end') {
      this.#drag = null;
      this.#settleEnd(drag, viewport.scenePoint(event), event.altKey);
      return;
    }
    if (drag.kind === 'bend') {
      this.#drag = null;
      this.#settleBend(drag, viewport.scenePoint(event));
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
      const shown = this.shownByDrag();
      const elements = shown === null ? this.#host.scene().elements : [...shown.elements];
      this.#drag = null;
      // The whole gesture is one history step, and the note may make room for
      // where the selection ended up.
      this.#host.applyScene({ ...this.#host.scene(), elements });
      return;
    }
    this.#drag = null;
    this.#showPanDrag();
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
    this.#host.typing.openWords(opening);
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
   * A press on a segment's dot pulls a new bend point out of the shaft: the
   * point starts where the dot stood, and the pointer carries it from there as
   * it carries a bend handle. The dot stands on the ink, so the press is also a
   * click on the shaft there — it keeps the press a double-click reads, and a
   * press that carries nothing inserts nothing.
   */
  #pullBend(target: EventTarget | null, event: PointerEvent): boolean {
    const { viewport } = this.#host.page;
    const pressed = bendFromDot(target, this.#shaft);
    if (pressed === null) {
      return false;
    }
    const byId = elementsById(this.#host.scene().elements);
    const origin = dotAt(shaftInk(pressed.shaft, byId).path, pressed.bend.index);
    if (origin === null) {
      return false;
    }
    this.#press = {
      id: pressed.bend.id,
      at: viewport.screenPoint(event),
      time: event.timeStamp,
      shift: event.shiftKey,
    };
    this.#drag = {
      kind: 'bend',
      id: pressed.bend.id,
      index: pressed.bend.index,
      inserted: true,
      shift: event.shiftKey,
      from: viewport.scenePoint(event),
      origin,
      moved: false,
      shown: pressed.shaft,
    };
    this.#host.refresh();
    return true;
  }

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
  #startDrawing(tool: ElementTool, point: Point, shift: boolean): void {
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
      shift,
      placing: null,
    };
    this.#host.page.paint();
  }

  /**
   * The Element the end being dragged would attach to, or null when there is
   * none. Alt held skips attaching, and a two-point shaft never takes the
   * Element its other end is attached to: both ends of one straight arrow
   * cannot attach to the same one. A shaft with a bend between its ends can,
   * because that is a loop, and it comes back to the Element it left.
   */
  #attachTarget(id: string, end: End, point: Point, skipAttaching: boolean): string | null {
    if (skipAttaching) {
      return null;
    }
    const elements = this.#host.scene().elements;
    const element = elements.find((candidate) => candidate.id === id);
    const other =
      element !== undefined && isShaft(element) && element.points.length === 2
        ? attachedTo(element, otherEnd(end))
        : null;
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
  #finishDrawing(drag: Extract<Drag, { kind: 'draw' }>, at: Point, event: PointerEvent): void {
    if (isClick(drag.from, at) && drawsStroke(drag.tool)) {
      // A stroke tool clicked rather than dragged places the shaft's first point:
      // the shaft stays in hand between presses until a double-click, Enter or
      // Escape ends it, so one gesture can put down as many points as a person
      // needs.
      this.#startPlacing(drag, at, event);
      return;
    }
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
      ? withEnd(
          placed,
          'end',
          endPoint(placed, 'end'),
          this.#attachTarget(drag.id, 'end', at, event.altKey),
          elementsById(this.#host.scene().elements),
        )
      : placed;
    this.#host.applyScene(
      { ...this.#host.scene(), elements: [...this.#host.scene().elements, settled] },
      { select: [drag.id] },
    );
  }

  /**
   * A stroke tool clicked rather than dragged starts a place: its first point is
   * the click, and the shaft waits in hand for the next one. Nothing of the
   * place is in the Scene yet — the preview is what the page draws until the
   * place is finished, and a place with fewer than two points never lands.
   */
  #startPlacing(drag: Extract<Drag, { kind: 'draw' }>, at: Point, event: PointerEvent): void {
    const point = whole(at);
    const { preview, target } = this.#placePreview(drag, [], at, event.altKey);
    this.#drag = {
      ...drag,
      from: at,
      preview,
      target,
      placing: {
        points: [point],
        release: at,
        // The click that started the place is half of a double-click like any
        // other: two clicks on that first point end the place, one point and all.
        // Its modifiers are the press's, not the release's: Shift let go before
        // the button came up was still held when the press landed.
        click: {
          id: null,
          at: this.#host.page.viewport.screenPoint(event),
          time: event.timeStamp,
          shift: drag.shift,
        },
        skipSnap: event.altKey,
      },
    };
    this.#host.page.paint();
  }

  /**
   * One release of a place: its click puts a point down where the pointer came
   * up, unless that click is the second half of a double-click on the place the
   * first half put down — that pair ends the place instead, so the pointer alone
   * can finish a shaft. A release that dragged puts its point down too, so a
   * segment can be pulled out rather than clicked.
   */
  #placePoint(drag: Extract<Drag, { kind: 'draw' }>, at: Point, event: PointerEvent): void {
    const placing = drag.placing;
    if (placing === null) {
      return;
    }
    const { viewport } = this.#host.page;
    const point = whole(at);
    const click = isClick(drag.from, at);
    const press: Press = {
      id: null,
      at: viewport.screenPoint(event),
      time: event.timeStamp,
      shift: event.shiftKey,
    };
    if (click && placing.click !== null && this.#isDoubleClick(placing.click, press)) {
      this.finishPlacing();
      return;
    }
    const { preview, target } = this.#placePreview(drag, placing.points, at, event.altKey);
    drag.preview = preview;
    drag.target = target;
    drag.placing = {
      points: [...placing.points, point],
      release: at,
      click: click ? press : null,
      skipSnap: event.altKey,
    };
    this.#host.page.paint();
  }

  /**
   * End the place in hand at the last point it put down: the preview segment goes
   * with it, and a place of fewer than two distinct points is not a shaft, so a
   * click that started one and stopped there leaves the Scene as it was. The
   * shaft lands as one step, selected as a drawn one is, and the tool goes back
   * to Select, so one tool draws one Element.
   */
  finishPlacing(): void {
    const drag = this.#drag;
    if (drag === null || drag.kind !== 'draw' || drag.placing === null) {
      return;
    }
    const { points, release, skipSnap } = drag.placing;
    this.#drag = null;
    this.#host.setTool('select');
    const distinct = new Set(points.map((point) => `${point.x},${point.y}`));
    if (distinct.size < 2) {
      this.#host.select([]);
      this.#host.refresh();
      return;
    }
    const end = points[points.length - 1]!;
    const settled = withEnd(
      this.#pathOf(drag.tool, points, drag.id),
      'end',
      end,
      this.#attachTarget(drag.id, 'end', release, skipSnap),
      elementsById(this.#host.scene().elements),
    );
    this.#host.applyScene(
      { ...this.#host.scene(), elements: [...this.#host.scene().elements, settled] },
      { select: [drag.id] },
    );
  }

  /**
   * What a place shows while the pointer is between points: every point it has
   * put down, and the segment reaching for the pointer. The last of them Snaps
   * the way a dragged end does, from the pointer as it is — the rounding is for
   * the point the Scene stores, never for the Element under it — and a pointer
   * still within the click's own slop of the last point reaches nowhere yet, so
   * it Snaps to nothing.
   */
  #placePreview(
    drag: Extract<Drag, { kind: 'draw' }>,
    points: readonly Point[],
    cursor: Point,
    skipSnap: boolean,
  ): { preview: SceneElement; target: string | null } {
    const last = points[points.length - 1];
    const target =
      last === undefined || isClick(last, cursor)
        ? null
        : this.#attachTarget(drag.id, 'end', cursor, skipSnap);
    const end = whole(cursor);
    const path = this.#pathOf(drag.tool, [...points, end], drag.id);
    return {
      preview: withEnd(
        path,
        'end',
        end,
        target,
        elementsById(this.#host.scene().elements),
      ),
      target,
    };
  }

  /**
   * The shaft these points draw: a stroke tool's own Element between the first
   * and the last, with every point between them inserted as a bend — no Snap and
   * no `corner` of its own, so it turns by the Element's `corners`.
   */
  #pathOf(
    tool: Exclude<ElementTool, 'text'>,
    points: readonly Point[],
    id: string,
  ): ArrowOrLineElement {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    let path = strokeOf(drawn(tool, first, last, id, this.#host.scene().defaults));
    for (let index = points.length - 2; index >= 1; index -= 1) {
      path = withInsertedBend(path, 1, points[index]!);
    }
    return path;
  }

  /**
   * Where an end being dragged goes, from one pointer sample: the pointer itself
   * picks the Element a free end attaches to, so a drop inside a box attaches
   * even when the hand grabbed the handle off its centre, and the grab offset
   * carries only the endpoint. The preview and the release both come through
   * here, so the line that is shown is the line that is saved.
   *
   * A Snapped end keeps the target it already has, whatever the pointer is over:
   * it slides along that target's outline, and no drop frees it or moves it to
   * another Element. Alt skips attaching for a free end and changes nothing for
   * one that is already Snapped.
   */
  #resolveEnd(
    drag: Extract<Drag, { kind: 'end' }>,
    pointer: Point,
    skipSnap: boolean,
  ): { to: Point; target: string | null } {
    const element = this.#host.scene().elements.find((candidate) => candidate.id === drag.id);
    const snapped =
      element !== undefined && isShaft(element) ? attachedTo(element, drag.which) : null;
    return {
      to: {
        x: drag.origin.x + pointer.x - drag.from.x,
        y: drag.origin.y + pointer.y - drag.from.y,
      },
      target: snapped ?? this.#attachTarget(drag.id, drag.which, pointer, skipSnap),
    };
  }

  /**
   * A released end handle settles where the release put it: on a Snapped end's
   * own target, slid to the outline point nearest the release, or attached to the
   * Element under that pointer for a free end, or free when Alt is held at the
   * release. What settles it is whether the handle moved during the gesture, not
   * whether the release landed elsewhere: a drag that comes back to its start is
   * still a drag, while a press and release in one place is a click on the handle
   * and changes nothing.
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
          candidate.id === drag.id
            ? withEnd(
                element,
                drag.which,
                to,
                target,
                elementsById(this.#host.scene().elements),
              )
            : candidate,
        ),
    });
  }

  /**
   * A released bend handle settles where the release put it, and only that
   * point: its corner, every other bend and both ends — Snaps included — stay
   * the Scene's. A press that did not move is a click on the handle and changes
   * nothing, while a drag that comes back to its start is still one step. Both
   * pick the point they held, unless the press pulled it out of a dot — that one
   * is the ink's — or held Shift, which is about the selection and never a pick.
   */
  #settleBend(drag: Extract<Drag, { kind: 'bend' }>, at: Point): void {
    const base = this.#bendBase(drag);
    const picked = drag.inserted || drag.shift ? null : { id: drag.id, index: drag.index };
    if (!drag.moved || base === undefined) {
      this.#host.selectBend(picked);
      this.#host.refresh();
      return;
    }
    const to = { x: drag.origin.x + at.x - drag.from.x, y: drag.origin.y + at.y - drag.from.y };
    this.#host.selectBend(picked);
    this.#host.applyScene({
      ...this.#host.scene(),
      elements: this.#host
        .scene()
        .elements.map((candidate) =>
          candidate.id === drag.id ? withBend(base, drag.index, to) : candidate,
        ),
    });
  }

  /**
   * The Element a bend drag is editing: the Scene's own, or — when the press
   * pulled the point out of a dot — that Element with the new point in place
   * where the dot stood.
   */
  #bendBase(drag: Extract<Drag, { kind: 'bend' }>): ArrowOrLineElement | undefined {
    const element = this.#host.scene().elements.find((candidate) => candidate.id === drag.id);
    if (element === undefined || !isShaft(element)) {
      return undefined;
    }
    return drag.inserted ? withInsertedBend(element, drag.index, drag.origin) : element;
  }

  /**
   * A press inside the words being typed. One press puts the caret at the glyph
   * under the pointer; a second one in the same place selects the word there;
   * and dragging the pointer carries the other end of the selection with it.
   */
  #pressWords(event: PointerEvent, text: Pick<TextSession, 'select' | 'state'>, offset: number): void {
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
    const at = this.#host.typing.typedOffset(offset);
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
   * selection is about the selection and not about the word under it. A press
   * that took a bend handle pairs with a press on that same handle and with
   * nothing else: a click on the shaft is no half of the pair that removes a
   * point, and stays a click of its own until one lands on the handle.
   */
  #isDoubleClick(first: Press, second: Press): boolean {
    const bend = first.bend;
    const taken = second.bend;
    const oneBend = bend === undefined ? taken === undefined : sameBend(taken, bend);
    return (
      oneBend &&
      !first.shift &&
      !second.shift &&
      second.time - first.time <= DOUBLE_CLICK_MS &&
      Math.abs(second.at.x - first.at.x) <= DOUBLE_CLICK_SLOP &&
      Math.abs(second.at.y - first.at.y) <= DOUBLE_CLICK_SLOP
    );
  }
}
