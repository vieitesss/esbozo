import { emptyScene, parseFragment, parseScene, serialiseScene } from '../scene.js';
import type { Corner, Element as SceneElement, Scene } from '../scene.js';
import { PRIMARY_SCENE_EXTENSION, sceneFileNameFor, sceneStem } from '../paths.js';
import { isClick, replaced, selectedFrom } from './elements.js';
import { movableCount } from './arrange.js';
import type { ArrangeAct } from './arrange.js';
import { deleted, detached, duplicated, nudged, pasted, rearranged, restyled } from './edits.js';
import type { Edited, Landing } from './edits.js';
import { actionById, actionFor } from './actions.js';
import type { ActionHost, ActionState, ToolId } from './actions.js';
import type { PngExport } from './export.js';
import { Gestures } from './gestures.js';
import { mayRemove, PickedBend, shaftIn, withCorner, withoutBend } from './bend-point.js';
import type { Bend } from './bend-point.js';
import { clipboardApi, copySelection, copyTo, cutSelection, pasteClipboard } from './clipboard.js';
import type { ClipboardHost } from './clipboard.js';
import { Connection } from './connection.js';
import type { FolderSource, FontSource, SaveTarget, SavedState } from './connection.js';
import { Page } from './page.js';
import type { Shown } from './page.js';
import { Notes } from './notes.js';
import { CommandPalette } from './palette.js';
import { PointMenu } from './point-menu.js';
import { menuSignature, styleNote } from './menu.js';
import { nextRoughness, roughnessLabel } from './style.js';
import type { StyleKey } from './style.js';
import { canPickFolder } from './files.js';
import {
  dockBox,
  dockOnFrame,
  fittedView,
  leftDockEdge,
  nearestDock,
  placedDock,
  railFrame,
  zoomedAt,
} from './geometry.js';
import type { Box, Point, RailDock, RailFrame, RailOutline, RailSide, View } from './geometry.js';
import { History } from './history.js';
import { railArt } from './rail.js';
import { readRailSide, writeRailSide } from './rail-preference.js';
import { SHELL } from './shell.js';
import { anchoredEnds, isShaft } from './snap.js';
import type { End } from './snap.js';
import { Typing } from './typing.js';
import { sceneFile } from './paint.js';

const NUDGE = 1;
const NUDGE_WITH_SHIFT = 10;
const ZOOM_STEP = 1.2;
/** Nudges closer together than this are one undo step: a held arrow key is one gesture. */
const NUDGE_BURST_MS = 800;
/**
 * How far the rail's pencil outline hangs outside the rail's own box on every
 * side, which the rail's measured box cannot say: `rail-art` in the sheet is
 * drawn `-7px` out, and `rail.ts` draws it in a box `2 × 7` bigger.
 */
const RAIL_OUTLINE = 7;

/** The frame's four sides: each dock a drag draws is one of them. */
const DOCK_SIDES: readonly RailSide[] = ['top', 'bottom', 'left', 'right'];

/**
 * The instance the keys and the clipboard belong to: the last one a person
 * clicked or focused. Two editors on one page are two editors, so a nudge in
 * one is never a nudge in the other.
 */
let active: EsbozoEditorElement | null = null;

/**
 * A press on the rail that may still become a drag of it: the pointer the press
 * belongs to, where it landed and where it is now, and the frame measured when it
 * landed (D3), which is what a release docks against.
 */
interface RailDrag extends MeasuredFrame {
  readonly pointer: number;
  readonly from: Point;
  at: Point;
  /** Whether the pointer has left the click's slop: past it, the press is a drag. */
  moved: boolean;
  /** The side whose dock the drag is showing, or null until it has shown one (D6). */
  near: RailSide | null;
}

/**
 * The frame a rail hangs on, measured when it was pressed: the diagram's frame in
 * the editor's own pixels, and the room the editor had when it was measured.
 */
interface MeasuredFrame {
  readonly frame: Box;
  readonly editor: { readonly width: number; readonly height: number };
}

/** How many editors this page has made: each one's Grid is a pattern of its own. */
let instances = 0;


class EsbozoEditorElement extends HTMLElement {
  /** The page's font, the Scenes folder and the writes: every answer that comes late. */
  #connection!: Connection;
  /**
   * Where the rail hangs now, in screen pixels: the strip's own left edge and the
   * middle of the side it is on, as the last clamp left it, or null until the page
   * has measured a frame. This is the one answer to where the rail is; nothing
   * measures the frame again to ask it (D5).
   */
  #railDock: RailDock | null = null;
  /**
   * Whether the frame itself left no room for the rail beside it, as the last
   * measure found it (D2). A resize clears the rail from the frame's own dock
   * without measuring the frame, so the stop the frame asked for travels with it.
   */
  #railHeld = false;
  /**
   * The side of the frame the rail is docked on: the side the page kept for its
   * next editor, or the top when it kept none, until a palette move takes it
   * elsewhere (D10, I8).
   */
  #railSide: RailSide = 'top';
  /**
   * The press on the rail that may become a drag of it, from the press to the
   * release: the one drag the rail has at a time (D6).
   */
  #railDrag: RailDrag | null = null;
  /**
   * Whether the release just committed a drag, so the click that follows it is
   * the drag's and picks no tool. The next press clears it.
   */
  #railDragged = false;
  /**
   * The pointer a called-off press left down still owes the rail the click its
   * release sends, or null. That click lands on the tile the press landed on and
   * picks no tool: the person called the press off. The debt is that pointer's
   * alone, so another pointer's click, or a key's, still picks its own tool, and a
   * fresh press by the same pointer pays it (D6, D7).
   */
  #railClickOwed: number | null = null;
  /**
   * The dock the frame asked for before the status corners moved the strip in, as an
   * offset from the editor's middle: what a corner that shrinks gives back, and what a
   * corner that grows is cleared from (O2).
   */
  #frameOffset: Point | null = null;
  /**
   * Whether a status corner changed size while a press held the strip, so the
   * placement it asks for waits for that press to end rather than moving the
   * strip out from under the pointer (D6, O2).
   */
  #railWaiting = false;
  /**
   * The boxes the strip is drawn from and measured against, watched: its own, so an
   * editor the page gave no box draws the outline as soon as it has one (D11, #64),
   * and the status bar's corners, which are as wide and as tall as the words they
   * hold — a Scene's name, the mode the page is in and the answer a folder gave
   * (O2).
   */
  /**
   * True once the strip was drawn in a box this editor had, which is the only box the
   * frame around the diagram is measured in: an editor the page gave no box has none
   * to measure, and nothing drawn with one (#64).
   */
  #drawn = false;
  readonly #boxWatch = new ResizeObserver(() => this.#onBoxResize());
  /** True once the editor's listeners are on the page. */
  #wired = false;
  /**
   * True while the focus is inside the element. An embedded editor only takes
   * the keys and the clipboard then: the page around it is someone else's, and
   * Space and the arrows are the page's until a person clicks into the editor.
   */
  #focused = false;
  /** True for an embedded editor, whose keys are its own only while it has the focus. */
  #ownsKeysWhenFocused = false;
  /** Whether this page can export a PNG: a PNG is the page's, and the bundle has none. */
  #pngExport: ((request: PngExport) => Promise<void>) | undefined;
  #scene: Scene = emptyScene();
  #selected: string[] = [];
  /** The one bend point the selection holds, and the presses that take it. */
  #picked = new PickedBend();
  #tool: ToolId = 'select';
  #history = new History(serialiseScene(this.#scene));
  /** When the last nudge landed, so a burst of them folds into one undo step. */
  #nudgedAt = 0;
  #grid = true;
  /** The pointer's state machine: every gesture, and what an exit has to drop. */
  #gestures!: Gestures;
  /** The page's frame: the view, the drawings and the overlay that marks them. */
  #page!: Page;
  /** The selection the Style menu was built for, so a rebuild only happens on a change. */
  #menuFor: string | null = null;
  #board!: HTMLElement;
  #canvas!: SVGSVGElement;
  #rail!: HTMLElement;
  #railArt!: SVGSVGElement;
  /** The four docks a drag of the rail draws, and the layer that shows them together. */
  #docks!: HTMLElement;
  /** The words being typed: the field, the Element it grows and the step to its glyphs. */
  #typing!: Typing;
  #note!: HTMLElement;
  #files!: HTMLUListElement;
  #newScene!: HTMLFormElement;
  #whereLabel!: HTMLElement;
  #modeLabel!: HTMLElement;
  /** What this page may do with the Scene: it may only read one, or it may write it. */
  #readOnly = false;
  #savedLabel!: HTMLElement;
  #menu!: HTMLElement;
  #roughButton!: HTMLButtonElement;
  /** The notes the page opens over the Scene, and which of them is on top. */
  #notes!: Notes;
  /** The note a secondary press on a bend point opens, and the one row it holds. */
  #pointMenu!: PointMenu;

  /**
   * What the clipboard commands may ask of the editor: the Scene, its selection,
   * the Scene their answer speaks for, and the one way it becomes an edit.
   */
  readonly #clipboard: ClipboardHost = {
    scene: () => this.#scene,
    selected: () => this.#selectedElements(),
    token: () => this.#connection.token,
    target: () => this.#connection.target,
    insert: (elements) => this.#insertCopies(elements),
    remove: (ids) => this.#remove(ids),
    status: (detail) => this.#setSaved('failed', detail),
  };

  /**
   * What the action registry may ask of the editor, and the one place an action
   * becomes a change: the palette and the keys both run through here.
   */
  readonly #host: ActionHost = {
    pickTool: (tool) => this.#setTool(tool),
    deleteSelection: () => this.#deleteSelected(),
    duplicateSelection: () => this.#duplicate(),
    copySelection: () => copySelection(this.#clipboard),
    cutSelection: () => cutSelection(this.#clipboard),
    paste: () => pasteClipboard(this.#clipboard),
    undo: () => this.#restore(() => this.#history.undo()),
    redo: () => this.#restore(() => this.#history.redo()),
    arrange: (act) => this.#arrangeSelection(act),
    toggleGrid: () => this.#toggleGrid(),
    toggleTheme: () => this.#toggleTheme(),
    stepDefaultRoughness: () => this.#stepDefaultRoughness(),
    openPalette: () => this.#notes.show('commands'),
    exportPng: (theme) => this.#exportPng(theme),
    zoomIn: () => this.#zoomBy(ZOOM_STEP),
    zoomOut: () => this.#zoomBy(1 / ZOOM_STEP),
    zoomToFit: () => this.#zoomToFit(),
    resetZoom: () => this.#resetZoom(),
    dockRail: (side) => this.#dockRail(side),
    openFolder: () => void (this.#connection.served ? this.#showNote() : this.#connection.pick()),
  };

  /** The attributes that configure a running element, and reload it when they change. */
  static get observedAttributes(): string[] {
    return ['scene', 'save', 'font'];
  }

  constructor(fonts: FontSource, folder: FolderSource, options: EditorOptions = {}) {
    super();
    this.#fonts = fonts;
    this.#folder = folder;
    this.#ownsKeysWhenFocused = options.focusInside === true;
    this.#pngExport = options.exportPng;
  }

  /** The page's font, as the page gets it: one measurement per element. */
  readonly #fonts: FontSource;
  /** Where a folder of Scenes comes from: `ez serve`'s, or the page's own. */
  readonly #folder: FolderSource;

  connectedCallback(): void {
    if (this.#canvas !== undefined) {
      // Back on the page: the listeners left with it the last time, and an
      // editor that never got as far as drawing tries its connection again.
      this.#listen();
      if (!this.#connection.ready) {
        void this.#connection.connect();
      }
      return;
    }
    this.innerHTML = SHELL;
    this.#board = this.querySelector('.board')!;
    this.#canvas = this.querySelector('.canvas')!;
    const gridRect = this.querySelector<SVGRectElement>('.grid-rect')!;
    const pattern = this.querySelector<SVGPatternElement>('.canvas pattern')!;
    this.#rail = this.querySelector('.rail')!;
    // Nothing in the strip is a press or a focus until it has a dock to hang on:
    // `inert` is what a host's rule about what is inside the strip cannot undo, so
    // an undocked tile takes no press whatever the page says about its glyphs
    // (#62). `#hangRail` lifts it with the dock.
    this.#rail.inert = true;
    this.#railArt = this.querySelector('.rail-art')!;
    this.#docks = this.querySelector('.docks')!;
    // The side this origin's editor was last moved to is read once, here, before
    // the frame is measured for the first time: the first placement is already on
    // that side, and a move made in another tab is waited for, not followed (D10).
    this.#railSide = readRailSide();
    this.#rail.dataset['side'] = this.#railSide;
    this.#note = this.querySelector('.note')!;
    this.#files = this.querySelector('.files')!;
    this.#newScene = this.querySelector('.new')!;
    this.#whereLabel = this.querySelector('.where')!;
    this.#modeLabel = this.querySelector('.mode')!;
    this.#savedLabel = this.querySelector('.saved')!;
    this.#menu = this.querySelector('.style-note')!;
    this.#roughButton = this.querySelector('[data-act="roughness"]')!;
    // The three notes are one stack: the palette asks for every action by name,
    // the sheet names the keys, and the Scenes note lists the folder. Whichever
    // a person asked for last is on top, and answers Escape and the press
    // outside it; the stack hands the focus back to the canvas when it shuts.
    const sheet = this.querySelector<HTMLElement>('.shortcuts')!;
    const helpButton = this.querySelector<HTMLButtonElement>('[data-act="shortcuts"]')!;
    const paletteRoot = this.querySelector<HTMLElement>('.palette')!;
    this.#notes = new Notes({ inside: this, canvas: this.#canvas });
    const palette = new CommandPalette({
      root: paletteRoot,
      state: () => this.#actionState(),
      run: (action) => void action.run(this.#host),
      // The palette shuts the way the stack shuts any note, so the keys and the
      // focus come back to the canvas with it.
      shut: () => this.#notes.shut('commands'),
      // Escape is the stack's too: the note on top shuts, and the field never
      // chooses for a note the person opened over it.
      escape: () => this.#notes.shut(),
    });
    this.#notes.add('commands', {
      root: paletteRoot,
      keys: 'all',
      holds: (target) => palette.holds(target),
      shown: () => palette.reveal(),
      shut: () => palette.conceal(),
    });
    this.#notes.add('shortcuts', {
      root: sheet,
      keys: 'escape',
      opener: () => helpButton,
      shown: () => helpButton.setAttribute('aria-expanded', 'true'),
      shut: () => helpButton.setAttribute('aria-expanded', 'false'),
    });
    this.#notes.add('scenes', {
      root: this.#note,
      keys: 'escape',
      // The status line's button lists the folder, so a press on it while the
      // note is open re-lists it rather than shutting it and opening it again.
      opener: () => this.querySelector('[data-act="open"]'),
    });
    // The point menu is the other note the pointer opens: a secondary press on a
    // bend handle, held to the one removal the keys and the palette use. It is a
    // note of the stack's like the others, so what shows, shuts and holds the keys
    // for it is the stack, and nothing of it outlives this page.
    const pointMenuRoot = this.querySelector<HTMLElement>('.point-menu')!;
    this.#pointMenu = new PointMenu({
      root: pointMenuRoot,
      inside: this,
      canvas: this.#canvas,
      canOpen: () => this.#connection.writable() && this.#typing.text() === null,
      shaft: (id) => shaftIn(this.#scene, id),
      selectBend: (bend) => {
        this.#picked.pick(bend);
        this.#refresh();
      },
      switchCorner: (bend, corner) => this.#switchCorner(bend, corner),
      remove: (bend) => this.#removeBend(bend),
      shut: () => this.#notes.shut('point'),
    });
    this.#notes.add('point', {
      root: pointMenuRoot,
      keys: 'all',
      press: (event) => this.#pointMenu.press(event),
      shown: () => this.#pointMenu.reveal(),
      shut: () => this.#pointMenu.conceal(),
    });

    // Each instance's Grid is its own pattern: two editors on one page would
    // otherwise share the first one's dots at the first one's zoom.
    const dots = `esbozo-dots-${++instances}`;
    pattern.id = dots;
    gridRect.setAttribute('fill', `url(#${dots})`);

    // The words being typed are built first: the page draws them and the pointer
    // opens them, so both read what is already there. Committed words land
    // through the same history and save path as other Scene edits. The page,
    // Connection and Gestures are built later, and asked for when needed.
    this.#typing = new Typing({
      field: this,
      page: () => this.#page,
      scene: () => this.#scene,
      layout: () => this.#connection.layout,
      writable: () => this.#connection.writable(),
      useSelectTool: () => this.#setTool('select'),
      selectElement: (id) => {
        this.#selectElements([id]);
        this.#refresh();
      },
      refused: (problem) => this.#setSaved('failed', problem),
      applyScene: (next, select) => this.#applyScene(next, { select }),
      forgetWordClick: () => this.#gestures.forgetWordClick(),
    });

    // The page's frame is told what the page may show, and asked for it. It owns
    // the view, the drawings kept between frames and the overlay that marks them.
    this.#page = new Page(
      {
        board: this.#board,
        surface: this.querySelector('.surface')!,
        grid: this.querySelector('.grid')!,
        gridRect,
        overlay: this.querySelector('.overlay')!,
        zoom: this.querySelector('.zoom')!,
        painted: this.querySelector('.painted')!,
        note: this.#menu,
      },
      {
        layout: () => this.#connection.layout,
        scene: () => this.#scene,
        shown: () => this.#shown(),
        selected: () => this.#selected,
        bend: () => this.#picked.bend,
        drag: () => this.#gestures.drag,
        railEdge: () => this.#railEdge(),
        writable: () => this.#connection.writable(),
        typing: this.#typing,
      },
    );

    // The connection is the page's font, its folder and its writes: every answer
    // it gets is late, and every one of them is bound to the token that asked.
    this.#connection = new Connection(this.#fonts, this.#folder, {
      element: this,
      show: (scene, target, status) => this.#load(scene, target, status),
      forget: () => this.#forget(),
      start: () => this.#start(),
      mode: (readOnly) => this.#showMode(readOnly),
      measure: () => this.#measure(),
      status: (state, detail) => this.#setSaved(state, detail),
      note: () => this.#showNote(),
      served: () => {
        this.querySelector('[data-act="open"]')!.textContent = 'Scenes';
      },
      files: (scene) => this.#page.files(scene),
    });

    // The pointer's machine is told what the page holds, and asked for the one
    // thing a gesture may change: a Scene that lands as a step and a write.
    this.#gestures = new Gestures({
      board: this.#board,
      canvas: this.#canvas,
      menu: this.#menu,
      scene: () => this.#scene,
      layout: () => this.#connection.layout,
      page: this.#page,
      selected: () => this.#selected,
      select: (ids) => {
        this.#selectElements(ids);
      },
      selectBend: (bend) => {
        this.#picked.pick(bend);
      },
      removeBend: (bend) => this.#removeBend(bend),
      tool: () => this.#tool,
      setTool: (tool) => this.#setTool(tool),
      writable: () => this.#connection.writable(),
      typing: this.#typing,
      applyScene: (next, options) => this.#applyScene(next, options),
      refresh: () => this.#refresh(),
      showPanning: () => this.#showPill(),
    });

    // Nothing draws or asks the folder for a Scene until every module holds the
    // ones it needs: the wiring is done, and starts here.
    this.#page.viewport.showGrid(this.#grid);

    if (this.#ownsKeysWhenFocused) {
      // An embedded editor is one box on someone else's page: a click into it
      // is what makes its keys its own, and the host keeps Space and the arrows
      // until then.
      this.setAttribute('tabindex', '0');
    } else {
      // A standalone editor owns the keys from the start; an embedded editor
      // must first take focus.
      active ??= this;
    }

    // A press is the editor's and the keys it offers are its own from the moment
    // it is on the page: the wiring is done here, before a font is asked for, so
    // a measurement still on its way leaves nobody pressing into an editor that
    // answers nothing (#63).
    this.#listen();

    // Nothing can be placed without the font's measurement, so the editor waits
    // for it and says so in the status line when the page has none to give.
    void this.#connection.connect();
  }

  /** Wire the editor to the page, once it has a measurement to draw with. */
  #listen(): void {
    if (this.#wired) {
      return;
    }
    this.#wired = true;
    // The keys and the clipboard go to the instance a person touched last.
    this.addEventListener('pointerdown', this.#takeFocus);
    this.addEventListener('focusin', this.#onFocusIn);
    this.addEventListener('focusout', this.#onFocusOut);
    this.#board.addEventListener('pointerdown', this.#onPaperDown);
    this.#board.addEventListener('pointermove', this.#gestures.move);
    this.#board.addEventListener('pointerup', this.#gestures.up);
    this.#board.addEventListener('pointercancel', this.#gestures.cancel);
    this.#board.addEventListener('wheel', this.#onWheel, { passive: false });
    this.#canvas.addEventListener('contextmenu', this.#onContextMenu);
    this.#rail.addEventListener('pointerdown', this.#onRailDown);
    this.#rail.addEventListener('click', this.#onRailClick);
    this.querySelector('.status')!.addEventListener('click', this.#onStatusClick);
    for (const corner of this.#statusCorners()) {
      this.#boxWatch.observe(corner);
    }
    this.#boxWatch.observe(this.#rail);
    document.addEventListener('copy', this.#onCopy);
    document.addEventListener('cut', this.#onCut);
    document.addEventListener('paste', this.#onPaste);
    this.#newScene.addEventListener('submit', this.#onNewScene);
    this.#files.addEventListener('click', this.#onFileClick);
    this.#menu.addEventListener('click', this.#onMenuClick);
    // Before the note runs a row: the click the press that opened the words
    // already has is consumed here, not applied.
    this.#menu.addEventListener('click', this.#gestures.menuClickPress, true);
    this.#menu.addEventListener('pointerdown', this.#gestures.menuPress);
    document.addEventListener('keydown', this.#onKeyDown);
    document.addEventListener('keyup', this.#onKeyUp);
    // A Space held while the page loses the focus never sends its release: the
    // pan has to end here, or the pointer stays a hand on the way back.
    document.addEventListener('pointerdown', this.#gestures.anyPress);
    // The stack's press is on the bubble path, so a note it shuts still lets
    // the press land where it was aimed.
    this.#notes.listen();
    // Every hold of the board ends out of sight, and the rail's drag beside it.
    document.addEventListener('visibilitychange', this.#onInterrupt);
    window.addEventListener('blur', this.#onInterrupt);
    window.addEventListener('resize', this.#onResize);

    requestAnimationFrame(() => this.#drawRailArt());
  }

  disconnectedCallback(): void {
    this.#board?.removeEventListener('pointerdown', this.#onPaperDown);
    this.#board?.removeEventListener('pointermove', this.#gestures.move);
    this.#board?.removeEventListener('pointerup', this.#gestures.up);
    this.#board?.removeEventListener('pointercancel', this.#gestures.cancel);
    this.#board?.removeEventListener('wheel', this.#onWheel);
    this.#canvas?.removeEventListener('contextmenu', this.#onContextMenu);
    document.removeEventListener('copy', this.#onCopy);
    document.removeEventListener('cut', this.#onCut);
    document.removeEventListener('paste', this.#onPaste);
    document.removeEventListener('keydown', this.#onKeyDown);
    document.removeEventListener('keyup', this.#onKeyUp);
    document.removeEventListener('pointerdown', this.#gestures.anyPress);
    this.#notes.unlisten();
    document.removeEventListener('visibilitychange', this.#onInterrupt);
    this.#rail.removeEventListener('pointerdown', this.#onRailDown);
    this.#rail.removeEventListener('click', this.#onRailClick);
    this.#menu.removeEventListener('click', this.#onMenuClick);
    this.#menu.removeEventListener('click', this.#gestures.menuClickPress, true);
    this.#menu.removeEventListener('pointerdown', this.#gestures.menuPress);
    this.querySelector('.status')?.removeEventListener('click', this.#onStatusClick);
    this.#newScene.removeEventListener('submit', this.#onNewScene);
    this.#files.removeEventListener('click', this.#onFileClick);
    this.removeEventListener('pointerdown', this.#takeFocus);
    this.removeEventListener('focusin', this.#onFocusIn);
    this.removeEventListener('focusout', this.#onFocusOut);
    window.removeEventListener('resize', this.#onResize);
    window.removeEventListener('blur', this.#onInterrupt);
    // A page that takes the editor away takes the words with it: the field is a
    // child that left with the element, and no gesture of this pointer survives
    // the DOM it was pressed on — the pan is the page's, and it goes too.
    this.#endEdits();
    this.#endRailDrag();
    this.#boxWatch.disconnect();
    this.#gestures.endSpacePan();
    this.#gestures.drop();
    this.#wired = false;
    if (active === this) {
      active = null;
    }
  }

  /**
   * An attribute changed under a running editor. `font` is only the font: the
   * Scene in hand stays, the font it is drawn in changes, and neither a slow font
   * nor a missing one says anything about the Scene a connection is opening.
   * `scene` and `save` are another instance of the element, so the connection in
   * hand is dropped first.
   */
  attributeChangedCallback(name: string): void {
    if (this.#canvas === undefined) {
      // Attributes written before the element was connected: nothing to drop,
      // and `connectedCallback` brings it up on them.
      return;
    }
    if (name === 'font' && this.#connection.ready) {
      void this.#connection.remeasure();
      return;
    }
    if (name !== 'font') {
      // Another instance of the element: the connection in hand goes with it,
      // and `forget` is what that hands back to the page.
      this.#connection.reset();
    }
    void this.#connection.connect();
  }

  /**
   * Let go of the Scene the connection in hand opened: half a gesture,
   * half-typed words, the tool armed for it, its selection and its history.
   */
  #forget(): void {
    this.#gestures.drop();
    this.#endEdits();
    // A drag of the rail measured the Scene that is leaving, so its release
    // docks nothing: the frame it would have docked against is gone with it.
    this.#endRailDrag();
    // No Scene in the hand is no frame to hang the rail on either.
    this.#frameOffset = null;
    this.#railDock = null;
    this.#railHeld = false;
    // No Scene to hold in the hand either: the pan and the word it named go
    // with the Scene the page let go of.
    this.#gestures.endSpacePan();
    this.#replaceScene(emptyScene());
    this.#selectElements([]);
    this.#history.reset(serialiseScene(this.#scene));
    this.#menu.hidden = true;
    // The Scenes the notes named are not this page's any more: they leave with
    // it, and the focus is nobody's to move.
    this.#notes.clear();
    this.#whereLabel.textContent = '';
    this.#setSaved('idle');
    this.#page.paint();
  }

  /** A connection has a Scene to start on: its defaults, a fitted view, one frame. */
  #start(): void {
    this.#showDefaultRoughness();
    this.#page.viewport.view = fittedView(
      this.#scene,
      this.#page.viewport.size(),
      this.#connection.layout,
    );
    this.#placeRail();
    this.#page.paint();
  }

  /** A measurement arrived: nothing drawn with the last one is this page's drawing any more. */
  #measure(): void {
    this.#page.measure();
    this.#listen();
  }

  /** The instance a person last touched holds the keys and the clipboard. */
  #takeFocus = (): void => {
    active = this;
    if (this.#ownsKeysWhenFocused && !this.#focused) {
      // An embedded editor's keys are its own while the focus is inside it, so
      // the click that reaches for it is what puts the focus there. The page
      // keeps its scroll: the pointer is already where it pointed.
      this.focus({ preventScroll: true });
    }
  };

  /** The focus came inside the editor: its keys are its own while it stays. */
  #onFocusIn = (): void => {
    this.#focused = true;
    active = this;
  };

  /** The focus left the editor: the host page's keys are the host's again. */
  #onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget as Node | null;
    this.#focused = next !== null && this.contains(next);
    if (this.#ownsKeysWhenFocused && !this.#focused) {
      // A Space held on the way out never sends its release here, and the host
      // page's keys are the host's again. A page that is nothing but the editor
      // keeps the pan it started until its own window loses focus.
      this.#gestures.endSpacePan();
    }
  };

  /** What this page may do with the Scene, and the pill that says what it is doing. */
  #showMode(readOnly: boolean): void {
    this.#readOnly = readOnly;
    this.#newScene.hidden = this.#readOnly;
    if (this.#readOnly) {
      // Write access just ended: nothing stays armed that could change a Scene
      // this page may only read.
      this.#endEdits();
    }
    this.#showPill();
  }

  /**
   * The one owner of the mode pill: the pan in the hand is what the page is doing
   * now, and `read-only` is what it may not do either way. A pan names itself
   * while it lasts, and hands the pill back to the other word when it ends.
   */
  #showPill(): void {
    const text = this.#gestures.panning ? 'Panning' : this.#readOnly ? 'read-only' : '';
    if (this.#modeLabel.textContent !== text) {
      this.#modeLabel.textContent = text;
    }
  }

  /**
   * Let go of every edit in flight: half-typed words, the Scene-editing gesture
   * in hand, and the tool.
   *
   * The pan is not an edit. It changes the view and never the Scene, so it stays
   * in the hand it was taken with until the key or the button comes up, or the
   * page loses the Scene it is holding (see the callers below).
   */
  #endEdits(): void {
    this.#typing.end();
    // Write access can end in the middle of a gesture, as a folder that answers a
    // queued save with a 403 does. Half a gesture is not a Scene any more: it is
    // dropped with the preview it painted, rather than left on a page that may
    // only read. A sweep holds the pointer as a Scene edit does, so it goes too:
    // its band is the old page's, and a release here would settle it on the new
    // one.
    if (this.#gestures.holdsScene() || this.#gestures.sweeping()) {
      this.#gestures.cancel();
    }
    // The point a press picked waits for the key that removes it: a page that may
    // only read, and another Scene, hold none of it.
    this.#picked.letGo();
    this.#notes.clear('point');
    if (this.#tool !== 'select') {
      this.#setTool('select');
    }
  }

  /** Toggle the dot Grid, as `G` does. Its spacing is the screen's own: the view scales the paper, not the dots. */
  #toggleGrid(): void {
    this.#grid = !this.#grid;
    this.querySelector('[data-act="grid"]')!.setAttribute('aria-pressed', String(this.#grid));
    this.#page.viewport.showGrid(this.#grid);
    this.#page.paint();
  }

  /** A Scene switch or reset starts the new Scene with an empty drawing cache. */
  #replaceScene(scene: Scene): void {
    this.#scene = scene;
    this.#page.resetDrawings();
  }

  #load(scene: Scene, target: SaveTarget, status: SavedState): void {
    this.#replaceScene(scene);
    this.#selectElements([]);
    this.#history.reset(serialiseScene(scene));
    this.#menuFor = null;
    this.#page.viewport.view = fittedView(scene, this.#page.viewport.size(), this.#connection.layout);
    // The name and the status this open leaves are set before the frame is
    // measured: a narrow editor's top dock is moved in clear of this corner, and
    // the corner is as wide and as tall as these words (O2).
    this.#whereLabel.textContent = `${target.folder.name} / ${target.name}`;
    this.#notes.clear('scenes');
    this.#setSaved(status);
    this.#placeRail();
    // Another Scene: the tool in hand and the words half-typed into the last
    // one belong to that one, not this, and the note shows its defaults. A Space
    // press holds the page in the hand, and another Scene is another page, so
    // the pan goes with it, and with the word it was naming in the status bar.
    this.#endEdits();
    this.#gestures.endSpacePan();
    this.#showDefaultRoughness();
    this.#refresh();
  }

  #selectedElements(): SceneElement[] {
    return selectedFrom(this.#shown().elements, this.#selected);
  }

  /**
   * The one owner of the selection: the Elements it holds, and the bend point it
   * may hold with one of them. A change of the selection lets the point go, so a
   * point outlives no selection and its index outlives no point.
   */
  #selectElements(ids: readonly string[]): void {
    this.#selected = [...ids];
    this.#picked.letGo();
    // The menu was opened for the selection the press found: another one is
    // another point, or none at all.
    this.#notes.shut('point');
  }

  /**
   * The Scene as the page shows it, and whether it is still a preview of it:
   * committed Elements plus the gesture in flight and the words being typed.
   * Never the Scene that is saved, so half a drag or half a Label can never be a
   * step. The words of a Label or a Text being edited are drawn by the Renderer
   * like any others: the canvas is the one place that shows what saving would
   * render.
   */
  #shown(): Shown {
    // The gesture says what it shows when one is in the way: no gesture at all
    // leaves the Scene under the words a session may be holding half-written.
    const shown = this.#gestures.shownByDrag();
    if (shown !== null) {
      return shown;
    }
    // A page with a session open draws the words it holds half-written, so it is
    // not settled even when the Scene's Elements are the ones it shows.
    const words = this.#typing.preview(this.#scene.elements);
    return words === null
      ? { settled: true, elements: this.#scene.elements }
      : { settled: false, elements: words };
  }

  /**
   * One history step, with the autosave every change gets. A change that left
   * the Scene as it was records nothing and writes nothing, so a plain click on
   * an Element never touches the disk.
   */
  #record(amend = false, after = sceneFile(this.#scene)): void {
    const changed = amend ? this.#history.amend(after) : this.#history.record(after);
    if (!amend) {
      this.#nudgedAt = 0;
    }
    if (changed) {
      void this.#connection.save(this.#scene);
    }
  }

  /**
   * A Scene taken back from the history is the Scene to save, so undo autosaves
   * too. The read-only gate comes before the step is taken, so a page that may
   * only read never consumes a step it cannot show.
   */
  #restore(step: () => string | null): void {
    if (!this.#connection.writable()) {
      return;
    }
    const source = step();
    if (source === null) {
      return;
    }
    const parsed = parseScene(source);
    if (!parsed.ok) {
      return;
    }
    this.#scene = parsed.scene;
    this.#selectElements(
      this.#selected.filter((id) => this.#scene.elements.some((element) => element.id === id)),
    );
    this.#nudgedAt = 0;
    // An undone edit may have changed a default or a Snap, so the status bar and
    // the note follow the restored Scene: a Snap the undo put back offers its
    // Detach button again.
    this.#showDefaultRoughness();
    this.#refresh();
    void this.#connection.save(this.#scene);
  }

  /**
   * Delete what the selection holds: the bend point a press picked, or else the
   * selected Elements, as one step. A Snap to a deleted target is dropped.
   */
  #deleteSelected(): void {
    const bend = this.#picked.spend();
    if (bend !== null) {
      this.#removeBend(bend);
      return;
    }
    this.#remove(new Set(this.#selected));
  }

  /**
   * Switch the one bend point a press holds to `corner`: the point's own corner,
   * written where it differs from the Element's own and left out where it is the
   * same. Every other point keeps its place, its `corner` and its Snap, and the
   * Element keeps its `corners`; the point stays the selection's, so the handle
   * it draws is already the shape the switch made.
   */
  #switchCorner(bend: Bend, corner: Corner): void {
    const scene = this.#scene;
    const element = scene.elements.find((candidate) => candidate.id === bend.id);
    if (element === undefined || !isShaft(element)) {
      this.#refresh();
      return;
    }
    const switched = withCorner(element, bend.index, corner);
    this.#applyScene({ ...scene, elements: replaced(scene.elements, new Set([bend.id]), () => switched) });
  }

  /**
   * Remove the one bend point a press holds: the removal the key, the palette and
   * the double-click share. Every other point keeps its place, its `corner` and
   * its Snap, and a removal that would leave a two-point self-loop removes
   * nothing at all — the shaft stays, the point stays and no byte is written. The
   * shaft keeps the selection; the point does not.
   */
  #removeBend(bend: Bend): void {
    const scene = this.#scene;
    const element = scene.elements.find((candidate) => candidate.id === bend.id);
    // The one removal rule, asked here as the point menu asks it: a point the
    // menu shows as disabled is exactly a point this cannot remove.
    if (element === undefined || !isShaft(element) || !mayRemove(element)) {
      this.#refresh();
      return;
    }
    this.#picked.letGo();
    const removed = withoutBend(element, bend.index);
    this.#applyScene({ ...scene, elements: replaced(scene.elements, new Set([bend.id]), () => removed) });
  }

  /**
   * Delete the Elements with these ids, as one step. Only the ids given go: a
   * cut that copied one Element deletes that Element, whatever the selection
   * has become while the clipboard took the copy.
   */
  #remove(ids: ReadonlySet<string>): void {
    this.#land(deleted(this.#scene, this.#selected, ids));
  }

  /** Duplicate the selected Elements: Paste of what Copy would write. */
  #duplicate(): void {
    this.#land(duplicated(this.#scene, this.#selectedElements(), this.#landing()));
  }

  /**
   * Copy the selected Elements as Scene JSON text. The clipboard event carries
   * the data, so a copy is one synchronous step of a key press rather than a
   * promise racing the paste that follows it.
   */
  #onCopy = (event: ClipboardEvent): void => {
    if (active !== this || !this.#takesClipboard(event.target) || this.#gestures.holdsScene()) {
      return;
    }
    if (copyTo(event.clipboardData, this.#scene, this.#selectedElements())) {
      event.preventDefault();
    }
  };

  /** Paste Scene JSON text from the clipboard, with new ids, offset off what is here. */
  #onPaste = (event: ClipboardEvent): void => {
    if (active !== this || !this.#takesClipboard(event.target) || this.#gestures.holdsScene()) {
      return;
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    this.#insertCopies(parseFragment(text, this.#scene.defaults) ?? []);
    event.preventDefault();
  };

  /**
   * Whether a key is this editor's to answer: not a field a person is typing in,
   * and, for an embedded editor, only while the focus is inside it.
   */
  #takesKeys(target: EventTarget | null): boolean {
    if (this.#inField(target)) {
      return false;
    }
    return !this.#ownsKeysWhenFocused || this.#focused;
  }

  /**
   * Whether the clipboard is this editor's to answer: never while a note holds
   * every key, and otherwise exactly where a key is answered.
   */
  #takesClipboard(target: EventTarget | null): boolean {
    return !this.#notes.holding() && this.#takesKeys(target);
  }

  /** Cut is a copy the page also deletes: one event carries the text, one step edits. */
  #onCut = (event: ClipboardEvent): void => {
    if (active !== this || !this.#takesClipboard(event.target) || this.#gestures.holdsScene()) {
      return;
    }
    const selected = this.#selectedElements();
    if (copyTo(event.clipboardData, this.#scene, selected)) {
      event.preventDefault();
      // Cut removes exactly what it copied: the point a press holds is a place on
      // the shaft, never an Element the clipboard carries off.
      this.#remove(new Set(selected.map((element) => element.id)));
    }
  };

  /**
   * The page owns light and dark, so the action asks it to switch, the way its
   * own button does: the editor never writes the theme's variables itself.
   */
  #toggleTheme(): void {
    document.dispatchEvent(new CustomEvent('esbozo:toggle-theme'));
  }

  /** The Scene as a PNG, light or dark, downloaded beside the name the Scene saves under. */
  async #exportPng(theme: 'light' | 'dark'): Promise<void> {
    const exportPng = this.#pngExport;
    if (exportPng === undefined) {
      return;
    }
    // The file name the Scene saves under, and the one a too-large page tells a
    // person to hand to the CLI.
    const file = this.#connection.target?.name ?? `${this.#scene.title}${PRIMARY_SCENE_EXTENSION}`;
    try {
      await exportPng({
        scene: this.#scene,
        theme,
        layout: this.#connection.layout,
        family: this.#connection.family,
        name: sceneStem(file) || this.#scene.title,
        file,
      });
    } catch (error) {
      this.#setSaved('failed', (error as Error).message);
    }
  }

  /** What the actions may look at: the selection, the history, the clipboard and the folder the page has. */
  #actionState(): ActionState {
    const selected = this.#selectedElements();
    return {
      selected: selected.length,
      movable: movableCount(selected),
      canUndo: this.#history.canUndo,
      canRedo: this.#history.canRedo,
      clipboard: clipboardApi() !== null,
      png: this.#pngExport !== undefined,
      folder: this.#connection.served || canPickFolder(),
    };
  }

  /** Whether a key or a clipboard event belongs to a field a person is typing in. */
  #inField(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    return (
      element !== null &&
      (element.isContentEditable || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA')
    );
  }

  /** Adds copies of the given Elements as one step, selected, so a paste can be moved at once. */
  #insertCopies(elements: readonly SceneElement[]): void {
    this.#land(pasted(this.#scene, elements, this.#landing()));
  }

  /** What a paste or a duplicate needs of the page to land where a person can see it. */
  #landing(): Landing {
    return {
      layout: this.#connection.layout,
      view: this.#page.viewport.view,
      viewport: this.#page.viewport.size(),
    };
  }

  /**
   * Put a tool in hand: the rail marks it, and only a drawing tool shows the
   * pencil. A drawing tool changes the Scene, so a read-only page stays on
   * Select however the tool was asked for — rail, letter or number.
   */
  #setTool(tool: ToolId): void {
    if (tool !== 'select' && !this.#connection.writable()) {
      return;
    }
    this.#tool = tool;
    this.#board.classList.toggle('pen', tool !== 'select' && !this.#gestures.spaceDown);
    for (const button of this.#rail.querySelectorAll('[data-tool]')) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-tool') === tool));
    }
    if (tool !== 'select') {
      // Handles and a dashed selection box under the pencil only get in the way.
      this.#selectElements([]);
    }
    this.#page.paint();
  }

  /**
   * The one way a Scene change lands: the changed Scene replaces the current
   * one, the page repaints and the edit autosaves as a single write and a
   * single history step. A change that leaves the Scene as it was writes
   * nothing, but the page still follows, so a gesture that ends where it began
   * leaves no preview or highlight behind.
   *
   * Read-only refuses here, before the Scene is touched, so no tool has to
   * remember the rule: every edit in this file — a draw, a drag, a nudge, a
   * paste, a style pick, an Arrange move, a Snap end — arrives through this
   * call, and none of them can change a page that may only read.
   */
  #applyScene(
    next: Scene,
    options: { amend?: boolean; select?: readonly string[] } = {},
  ): void {
    if (!this.#connection.writable()) {
      return;
    }
    // An Anchored end is stored where its Anchor draws it, so a target that moved
    // or resized does not leave the ends that hold it behind. Every edit lands
    // here, and a plain click changes nothing: one pass with the Scene it
    // replaces, not a rule each gesture remembers.
    const settled: Scene = {
      ...next,
      elements: anchoredEnds(next.elements, this.#scene.elements),
    };
    const after = sceneFile(settled);
    const changed = after !== sceneFile(this.#scene);
    const { select } = options;
    if (changed) {
      this.#scene = settled;
    }
    if (select !== undefined) {
      this.#selectElements(select);
    }
    // The note follows the Scene, room and all: a Snap row that ended where it
    // began is not left behind, and a change that moved the selection wakes the
    // view that keeps the note off it. A drag in flight is left alone by
    // `Page.clearOfNote`, so nothing moves under the pointer.
    this.#refresh();
    if (changed) {
      this.#record(options.amend === true, after);
    }
  }

  /**
   * Land one Scene edit the edits module made: the Scene it returns and the
   * selection that comes with it, so no caller filters or extends a selection
   * itself. An edit that asked for nothing lands nothing, and one whose
   * selection is `null` leaves the selection — and the bend point a press may
   * hold — exactly where it is.
   */
  #land(edit: Edited | null, amend = false): void {
    if (edit === null) {
      return;
    }
    const { selection } = edit;
    this.#applyScene(edit.scene, selection === null ? { amend } : { amend, select: selection });
  }

  /** Change the selected Elements' style, every pick arriving here. */
  #styleSelection(key: StyleKey, value: string): void {
    this.#land(restyled(this.#scene, this.#selected, key, value));
  }

  /**
   * Reorder, align or spread the selected Elements. The rule and every bound it
   * measures belong to the edit.
   */
  #arrangeSelection(act: ArrangeAct): void {
    this.#land(rearranged(this.#scene, this.#selected, act, this.#connection.layout));
  }

  // ------------------------------------------------------------------ painting

  /**
   * A change of selection or of what the selection holds: the note follows it,
   * the view makes room for the note, and the page repaints. Both happen outside
   * the paint, so a redraw can never move the view under the pointer.
   */
  #refresh(): void {
    this.#syncMenu();
    this.#page.clearOfNote();
    // The view may have moved to make room for the note: the words being typed
    // travel with it, caret and all, rather than staying behind on the page.
    this.#page.paint();
  }


  /**
   * A view change the person asked for — a wheel, a key zoom or a fit. It still
   * has to leave the selection clear of the note, and any zoom can put it back
   * under, so the clearance runs before the paint: no frame shows it covered.
   */
  #changedView(view: View): void {
    this.#page.viewport.view = view;
    // A zoom carries the page away from the pointer the menu was placed by, so
    // the menu goes with the place it was opened on.
    this.#notes.shut('point');
    // Zoom is not part of a double-click: the next press starts a new one.
    this.#gestures.forgetClicks();
    this.#page.clearOfNote();
    this.#page.paint();
  }

  /**
   * A box the strip is drawn from, or measured clear of, changed size. The strip's
   * own box is the drawing's: an editor the page gave no box — a host that starts it
   * off the page and shows it later (#64) — has nothing to measure an outline
   * against, and the box it comes back with is drawn here at once, with no resize of
   * the window to ask for it.
   *
   * A status corner changed size: the rail was measured against it as it was then,
   * and one that grows over the strip takes the press of the nearest tile (O2). The
   * strip is measured again on its own side — a dragged strip too, which keeps its
   * side and its place along it — and a corner that shrinks gives the room back.
   *
   * A press on the strip keeps it under the pointer, and asks for the placement when
   * that press ends (D6, O2).
   */
  #onBoxResize = (): void => {
    // Whether the strip had a box to be drawn from before this: an editor the page
    // gave no box draws nothing, so the first box it is given is the first measure of
    // the frame the strip hangs from, and that measure is taken here — a reveal is no
    // resize of an editor in use, and nobody is asked to resize a window to see the
    // rail (#64).
    const measured = this.#drawn;
    this.#drawRailArt();
    if (!measured) {
      this.#placeRail();
      return;
    }
    if (this.#railDrag !== null) {
      this.#railWaiting = true;
      // A corner changes the place a dock is drawn in clear of it, so a mark a
      // held drag has on the page follows the corner it clears (D6, O2).
      this.#redrawDocks();
      return;
    }
    this.#hangRail();
  };

  #drawRailArt(): void {
    const width = this.#rail.offsetWidth + RAIL_OUTLINE * 2;
    const height = this.#rail.offsetHeight + RAIL_OUTLINE * 2;
    if (width <= 14 || height <= 14) {
      // No box to draw from: nothing of this editor is measured, so the place the
      // strip asks for is measured again in the first box it is given (#64).
      this.#drawn = false;
      return;
    }
    this.#drawn = true;
    this.#railArt.setAttribute('width', String(width));
    this.#railArt.setAttribute('height', String(height));
    this.#railArt.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.#railArt.innerHTML = railArt(width, height);
  }

  /**
   * Draw the four places the rail would hang from the frame the press measured, and
   * mark the one a release would take (D6).
   *
   * The frame is the one the press found, but the place each of its docks hangs in
   * is the place a release there takes now: the editor may have been resized and a
   * corner may have grown under the press, so the marks follow them (D3, O2). The
   * mark is what moves with the pointer; the outlines move with the editor.
   */
  #showDocks(drag: RailDrag): void {
    const near = nearestDock(drag.frame, drag.at);
    drag.near = near;
    if (this.#docks.hidden) {
      this.#drawDocks(drag);
      this.#docks.hidden = false;
    }
    for (const side of DOCK_SIDES) {
      const mark = this.#dockMark(side);
      if (side === near) {
        mark.dataset['near'] = '';
      } else {
        delete mark.dataset['near'];
      }
    }
  }

  /**
   * The four docks' outlines, drawn where a release on that side puts the strip as
   * the editor stands: the same placement the release hangs it by (D6).
   *
   * The corners and the editor are read once, before anything is written: a drag
   * redraws these on every resize, and a read between two marks' styles would lay
   * the page out again for each of the four.
   */
  #drawDocks(drag: RailDrag): void {
    const outlines = this.#outlineEachWay();
    const chrome = this.#statusChrome();
    const size = this.#page.viewport.size();
    for (const side of DOCK_SIDES) {
      const lying = side === 'top' || side === 'bottom';
      const outline = lying ? outlines.lying : outlines.standing;
      // The frame's own dock carried along with the editor's middle to the size it
      // has now (D3, I7), then cleared of the corners and clamped inside it (O2,
      // D2): the place a release on this side hangs the strip.
      const frameDock = dockOnFrame(drag.frame, drag.editor, side, outline);
      const carried = this.#pointOf(this.#offsetOf(frameDock.dock, drag.editor), size);
      const placed = placedDock(
        { dock: carried, stopped: frameDock.stopped },
        side,
        outline,
        chrome,
        size,
      );
      const box = dockBox(placed, side, outline);
      const mark = this.#dockMark(side);
      mark.setAttribute('width', String(box.width));
      mark.setAttribute('height', String(box.height));
      mark.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
      mark.style.left = `${box.x}px`;
      mark.style.top = `${box.y}px`;
      mark.innerHTML = railArt(box.width, box.height);
    }
  }

  /** Draw a held drag's four docks again, wherever the editor and its corners have carried them (D6, O2). */
  #redrawDocks(): void {
    const drag = this.#railDrag;
    if (drag === null || this.#docks.hidden) {
      return;
    }
    this.#drawDocks(drag);
  }

  /** The mark that stands for one side of the frame: the markup names it, so no list has to. */
  #dockMark(side: RailSide): SVGSVGElement {
    return this.#docks.querySelector<SVGSVGElement>(`.dock[data-side="${side}"]`)!;
  }

  /** Take the four docks off the page: nothing a drag drew outlives the drag. */
  #hideDocks(): void {
    this.#docks.hidden = true;
  }

  /**
   * The outline the rail wears lying along the top and standing up the left, the
   * two orientations a dock can have: a dock is drawn in its own, and the strip is
   * not the same size both ways. The one this editor is not docked on is measured
   * on the strip itself — its side is switched, read and switched back before
   * anything can be painted, so the rail is never seen in an orientation it is not
   * docked on.
   */
  #outlineEachWay(): { lying: RailOutline; standing: RailOutline } {
    const kept = this.#railSide;
    const lying = kept === 'top' || kept === 'bottom';
    const here = this.#outline();
    this.#rail.dataset['side'] = lying ? 'left' : 'top';
    const there = this.#outline();
    this.#rail.dataset['side'] = kept;
    return lying ? { lying: here, standing: there } : { lying: there, standing: here };
  }

  /**
   * Hang the rail on the frame around the diagram, measured when the Scene
   * opens, when the palette docks it, or when a drag presses it: the side's
   * outline a gap outside the frame, or the strip just inside the editor's edge
   * when the frame leaves no room for that. A drag passes the frame it measured at
   * its press (D3), so a zoom or a pan under the drag moves the diagram the rest
   * of the way without changing where the release docks. It measures the view and
   * never moves it: the rail floats over the paper.
   */
  #placeRail(pressed?: MeasuredFrame): void {
    // The measure is made, so no press is still owed one: a press that ends as a
    // drag docks on the frame it measured instead (D3, O2).
    this.#railWaiting = false;
    const size = pressed?.editor ?? this.#page.viewport.size();
    const frameDock =
      pressed === undefined
        ? this.#dockOn(this.#railSide)
        : dockOnFrame(pressed.frame, pressed.editor, this.#railSide, this.#outline());
    // The frame's own dock is what a corner that shrinks gives back and what a
    // resize carries, so the strip hangs from the place it asked for, cleared of
    // the corners there are now, and clamped inside the editor (D3, I7, O2).
    this.#railHeld = frameDock.stopped;
    this.#frameOffset = this.#offsetOf(frameDock.dock, size);
    this.#hangRail();
  }

  /**
   * Hang the strip on the dock the frame's own dock names, as the editor and its
   * corners stand now: carried along with the editor's middle and pulled inside
   * when the carry would take it out, and moved in clear of the status corners
   * (O2, D3). The frame is not measured again: a pan or a zoom has moved the
   * diagram, and neither moves the rail. A dock no corner meets is that dock, so a
   * corner that shrinks gives the room back.
   */
  #hangRail(): void {
    const offset = this.#frameOffset;
    if (offset === null) {
      return;
    }
    const size = this.#page.viewport.size();
    const placed = placedDock(
      { dock: this.#pointOf(offset, size), stopped: this.#railHeld },
      this.#railSide,
      this.#outline(),
      this.#statusChrome(),
      size,
    );
    // The place it already hangs on: written again, the same two numbers are a
    // style change with nothing to paint, and a corner that grows without reaching
    // the strip must leave it where it stands (O2).
    const before = this.#railDock;
    this.#railDock = placed;
    if (
      before !== null &&
      before.dock.x === placed.dock.x &&
      before.dock.y === placed.dock.y &&
      this.#rail.dataset['placed'] === ''
    ) {
      return;
    }
    this.#rail.style.setProperty('--rail-left', `${placed.dock.x}px`);
    this.#rail.style.setProperty('--rail-top', `${placed.dock.y}px`);
    // Measured and placed, so the strip has a side to hang on and the page may
    // show it: an unplaced one stays out of sight rather than wait at the place
    // the stylesheet falls back to, which is no side it was docked on (D11).
    this.#rail.inert = false;
    this.#rail.dataset['placed'] = '';
  }

  /** The point an offset from the editor's middle names, at the size the editor has now. */
  #pointOf(offset: Point, size: { width: number; height: number }): Point {
    return { x: size.width / 2 + offset.x, y: size.height / 2 + offset.y };
  }

  /** An editor point as the offset a resize carries: from the editor's middle (D3, I7). */
  #offsetOf(at: Point, size: { width: number; height: number }): Point {
    return { x: at.x - size.width / 2, y: at.y - size.height / 2 };
  }

  /** The frame around the diagram as the page shows it now, and this side's dock on it. */
  #dockOn(side: RailSide): RailFrame {
    return railFrame(
      this.#scene,
      this.#page.viewport.view,
      this.#page.viewport.size(),
      side,
      this.#outline(),
      this.#connection.layout,
    );
  }

  /**
   * The status chrome the rail has to clear, in the editor's own pixels: the
   * corners' boxes, which the page draws above the rail and whose buttons take a
   * press first (O2). It is read from the page because the corners are as wide as
   * the words they hold — a Scene's name, the mode the page is in — so the rail is
   * measured against what a corner is now, never against a number. A corner the
   * page leaves empty has no box and takes nothing.
   */
  #statusChrome(): Box[] {
    const page = this.#page.viewport.box();
    return this.#statusCorners()
      .map((corner) => corner.getBoundingClientRect())
      .map((corner) => ({
        x: corner.left - page.left,
        y: corner.top - page.top,
        width: corner.width,
        height: corner.height,
      }))
      .filter((corner) => corner.width > 0 && corner.height > 0);
  }

  /** The bars the status bar is drawn in, one per corner: what the rail clears and the page resizes. */
  #statusCorners(): HTMLElement[] {
    return [...this.querySelectorAll<HTMLElement>('.status > div')];
  }

  /**
   * Dock the rail on one of the frame's four sides: the side it lies along, or
   * stands up, is the side's own. The palette's move measures the frame every
   * time, even for the side already in use (I4), and a drag's release docks on the
   * frame measured at its own press instead (D3). Either way the Scene is never
   * touched: a move is the page's chrome, so it works in a read-only Scene and
   * records no step (D9).
   */
  #dockRail(side: RailSide, pressed?: MeasuredFrame): void {
    this.#railSide = side;
    this.#rail.dataset['side'] = side;
    // Laying the strip along another edge is another size, so the outline is
    // drawn again for the shape it now covers. The frame itself is the one the
    // press measured (D3), so a drag reuses it and never measures one here.
    this.#drawRailArt();
    this.#placeRail(pressed);
    // The move is committed here, so this is where the side is kept for the next
    // editor, the side already in use included (I4): the Scene stays untouched
    // (D9), and a cancelled drag never reaches this point (I6).
    writeRailSide(side);
  }

  /** The pencil outline the rail wears, measured around the strip it hangs on. */
  #outline(): RailOutline {
    return {
      width: this.#rail.offsetWidth + RAIL_OUTLINE * 2,
      height: this.#rail.offsetHeight + RAIL_OUTLINE * 2,
      overhang: RAIL_OUTLINE,
    };
  }

  /**
   * Where a left dock's own outline reaches, or null when the rail hangs
   * anywhere else: read from where the rail hangs and what stopped it there,
   * never measured again, so the view moves for the note alone (D5).
   */
  #railEdge(): number | null {
    const rail = this.#railDock;
    return rail === null ? null : leftDockEdge(rail, this.#outline(), this.#railSide);
  }

  // ------------------------------------------------------------------- menu

  /**
   * The Style menu is there only with a selection. Its markup is rebuilt only
   * when a field the note renders changes, so a drag that moves or resizes the
   * selection leaves the note alone, and a pick is read back from the same note.
   */
  #syncMenu(): void {
    const selected = this.#selectedElements();
    this.#menu.hidden = selected.length === 0;
    if (selected.length === 0) {
      this.#menuFor = null;
      return;
    }
    const signature = menuSignature(selected);
    if (signature !== this.#menuFor) {
      this.#menuFor = signature;
      this.#menu.innerHTML = styleNote(selected);
    }
  }

  // ----------------------------------------------------------------- keyboard

  #onKeyDown = (event: KeyboardEvent): void => {
    // A key between two clicks means the person is typing, not double-clicking.
    this.#gestures.forgetClicks();
    if (active !== this || !this.#takesKeys(event.target)) {
      return;
    }
    if (event.key === ' ' || event.code === 'Space') {
      this.#gestures.holdSpace();
      event.preventDefault();
      return;
    }
    const note = this.#notes.answerKey(event);
    if (note === 'shut') {
      // The note on top answers Escape, and the note alone: it takes nothing of
      // the Scene with it, so what a person selected stays selected.
      event.preventDefault();
      this.#notes.shut();
      return;
    }
    if (note === 'hold') {
      // A key the note holds with the focus off its own field is still the
      // note's, not the Scene's.
      return;
    }
    if (event.key === 'Escape' && this.#railDrag !== null) {
      // A drag of the rail is the page's chrome, and its Escape is the drag's
      // alone: the strip goes back where it hung and the Scene keeps the tool
      // and the selection it had (D7, I6). Without this the Escape below would
      // drop the selection as well, which is the drag's to keep.
      event.preventDefault();
      this.#callOffRailDrag();
      return;
    }
    if (event.key === 'Escape' && this.#gestures.placing()) {
      // A shaft being placed is finished, not dropped: Escape ends the place at
      // the last point it put down, as Enter does, and the preview segment goes
      // with it. Half a shaft that was never a shaft — one point, or two on one
      // spot — leaves the Scene as it was.
      event.preventDefault();
      this.#gestures.finishPlacing();
      return;
    }
    if (event.key === 'Enter' && this.#gestures.placing()) {
      event.preventDefault();
      this.#gestures.finishPlacing();
      return;
    }
    if (event.key === 'Escape' && (this.#gestures.holdsScene() || this.#gestures.sweeping())) {
      // Half a Scene edit is not a Scene: Escape drops what the gesture drew back
      // to the place the Scene holds, and the release that follows it settles
      // nothing. It answers here, before the gesture that holds the Scene,
      // because that guard is about edits — and an Escape is what keeps one from
      // landing. A sweep holds the pointer and no Scene at all: Escape drops its
      // band and leaves the selection as it is, so the release settles nothing
      // there either. Every other drag keeps the behaviour it has: Escape is
      // ignored while the pointer is down, and the release settles the gesture. A
      // place is the one edit that is not a drag: Escape finishes it, above.
      event.preventDefault();
      this.#gestures.cancel();
      return;
    }
    if (this.#gestures.holdsScene()) {
      // Half a drag is not a Scene: an edit waits for the pointer to come up.
      return;
    }
    if (event.key === 'Escape') {
      this.#selectElements([]);
      this.#setTool('select');
      this.#refresh();
      return;
    }
    // Enter on a single selection edits its words, as a double-click does. A
    // button the focus sits on keeps its own Enter.
    if (
      event.key === 'Enter' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      (event.target as Element | null)?.closest('button') == null
    ) {
      const selected = this.#selectedElements();
      const only = selected.length === 1 ? selected[0] : undefined;
      if (only !== undefined) {
        event.preventDefault();
        this.#typing.openWords(only);
        return;
      }
    }
    // Every tool and every action answers to the registry's keys, so the rail,
    // the palette and the keyboard offer one list rather than three.
    const action = actionFor(event);
    if (action !== null) {
      event.preventDefault();
      // A held delete key whose press already spent its point runs nothing: only
      // a new press frees the shaft.
      if (action.id === 'delete' && !this.#picked.pressDelete(event.repeat)) {
        return;
      }
      void action.run(this.#host);
      return;
    }
    if (event.key.startsWith('Arrow') && !event.metaKey && !event.ctrlKey) {
      const step = event.shiftKey ? NUDGE_WITH_SHIFT : NUDGE;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      if (dx !== 0 || dy !== 0) {
        event.preventDefault();
        this.#nudge(dx, dy);
      }
      return;
    }
  };

  #onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const point = this.#page.viewport.screenPoint(event);
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
    this.#changedView(zoomedAt(this.#page.viewport.view, factor, point.x, point.y));
  };

  #onKeyUp = (event: KeyboardEvent): void => {
    if (active !== this) {
      return;
    }
    if (event.key === ' ' || event.code === 'Space') {
      this.#gestures.endSpacePan();
    }
  };

  #onResize = (): void => {
    this.#drawRailArt();
    // The window changed shape, so the rail keeps the dock the frame asked for,
    // as an offset from the middle of what the editor draws in, and a resize is
    // measured again for the room the status leaves: both the corners and the
    // editor are the size they have now, and growing back restores the dock (D3,
    // I7, O2). A held drag's marks move with them, so the mark stays the place a
    // release takes (D6).
    this.#hangRail();
    this.#redrawDocks();
    // The window changed, so the room the note leaves has too.
    this.#refresh();
  };

  #nudge(dx: number, dy: number): void {
    // A nudge that cannot move what is selected records and saves nothing, and
    // a burst of them is one step: the same undo takes the whole nudge back.
    const amend = Date.now() - this.#nudgedAt < NUDGE_BURST_MS;
    const edit = nudged(this.#scene, this.#selected, dx, dy);
    if (edit === null) {
      return;
    }
    this.#land(edit, amend);
    this.#nudgedAt = Date.now();
  }

  #zoomBy(factor: number): void {
    const size = this.#page.viewport.size();
    this.#changedView(zoomedAt(this.#page.viewport.view, factor, size.width / 2, size.height / 2));
  }

  /** Fit the page the Renderer draws into the window, the view an open Scene starts in. */
  #zoomToFit(): void {
    const view = fittedView(this.#scene, this.#page.viewport.size(), this.#connection.layout);
    // A fit draws the page one way only, whatever view it replaces, so this is
    // where the rail's frame is measured again (D3, criterion 5). The fitted view
    // is the one it is measured from, and it is set before the note's clearance
    // reads the dock, so the fit's own view never depends on where the rail was.
    this.#page.viewport.view = view;
    this.#placeRail();
    this.#changedView(view);
  }

  /** One pixel per Scene unit, around the middle of the window: the plain view. */
  #resetZoom(): void {
    const size = this.#page.viewport.size();
    this.#changedView(zoomedAt(this.#page.viewport.view, 1 / this.#page.viewport.view.zoom, size.width / 2, size.height / 2));
  }

  // ----------------------------------------------------------------------- UI

  /**
   * A press on the paper, unless a drag of the rail already has the gesture. A
   * rail drag is one pointer's, and the board hears the browser's other contacts
   * — a pinch that spans the strip and the paper — so a press that lands under it
   * must not draw, pick or save (D9, criterion 10). The contact is refused rather
   * than the drag cancelled: the finger that pressed the rail keeps its release,
   * and a drag's cancellation stays 29h's.
   *
   * Refused, not merely unanswered: `Gestures` hears this pointer's move, release
   * and cancel like any other's, and a press it never took is no half of a
   * gesture, so those must settle nothing. Leaving the release to `Gestures.up`
   * would settle whatever gesture is active at this contact's coordinates — a
   * mouse's Rectangle, finishing it early where the finger happened to land.
   */
  #onPaperDown = (event: PointerEvent): void => {
    if (this.#railDrag !== null) {
      this.#gestures.refuse(event.pointerId);
      return;
    }
    this.#gestures.down(event);
  };

  #onRailClick = (event: MouseEvent): void => {
    if (this.#railDragged) {
      // The click a committed drag's release also sends: it has already docked,
      // and it picks no tool (D6).
      this.#railDragged = false;
      return;
    }
    if (event instanceof PointerEvent && event.pointerId === this.#railClickOwed && event.detail !== 0) {
      // The click a called-off press's release sends lands on the tile it pressed:
      // it is that pointer's own, and picks no tool. A click the keys made (`detail`
      // 0: Enter or Space on a tile) belongs to no pointer: the person asked for it
      // after the cancel, so it runs and the debt waits for the pointer that owes it.
      this.#railClickOwed = null;
      return;
    }
    const button = (event.target as Element | null)?.closest('[data-tool]') as HTMLElement | null;
    const tool = button?.dataset['tool'];
    if (tool !== undefined) {
      this.#setTool(tool as ToolId);
    }
  };

  /**
   * A press on the rail — a tile or the padding around it, with any pointer —
   * starts a drag that may end as the click it has always been (D6). The frame
   * is measured here, while the press is under the pointer, because a release
   * docks against the frame the drag started on (D3).
   */
  #onRailDown = (event: PointerEvent): void => {
    // A press by the pointer a called-off one left down is a press of its own, so
    // the debt that pointer owes is paid here and its release picks as any press
    // does. Another pointer's press pays nothing: the debt is not its own.
    if (this.#railClickOwed === event.pointerId) {
      this.#railClickOwed = null;
    }
    // One drag at a time, and the primary button's: a second pointer, or the
    // right button, does nothing to a drag already in flight.
    if (this.#railDrag !== null || event.button !== 0 || !event.isPrimary) {
      return;
    }
    this.#railDragged = false;
    // The frame is measured from the editor's own corner, so the pointer is read
    // there too: a press in an editor the host set somewhere else in the page is
    // the same place in the frame whether the page moved it or not.
    const at = this.#page.viewport.screenPoint(event);
    const editor = this.#page.viewport.size();
    this.#railDrag = {
      pointer: event.pointerId,
      from: at,
      at,
      moved: false,
      near: null,
      frame: this.#dockOn(this.#railSide).frame,
      editor,
    };
    // The drag's own moves and release: the rail may be left far behind, so they
    // cannot be the rail's listeners. The press itself stays the button's, which
    // is what keeps a press under the slop the click that picks the tool.
    window.addEventListener('pointermove', this.#onRailMove);
    window.addEventListener('pointerup', this.#onRailUp);
    window.addEventListener('pointercancel', this.#onRailCancel);
  };

  #onRailMove = (event: PointerEvent): void => {
    const drag = this.#railDrag;
    if (drag === null || event.pointerId !== drag.pointer) {
      return;
    }
    drag.at = this.#page.viewport.screenPoint(event);
    if (!drag.moved) {
      if (isClick(drag.from, drag.at)) {
        return;
      }
      // Past the click's slop this is a drag of the rail. The capture is taken
      // here rather than on the press so that a press which never leaves the slop
      // keeps its own click on the tile it landed on, and so that a release far
      // from the rail still arrives.
      drag.moved = true;
      this.#rail.setPointerCapture(event.pointerId);
    }
    // A drag shows the four places it may end in, and moves the highlight to the
    // one this pointer would take (D6). Under the slop nothing is drawn.
    this.#showDocks(drag);
  };

  /**
   * The release of a press on the rail: under the slop the button's own click
   * picks the tool, and past it the rail docks on the side its mark showed,
   * through the one move the palette uses too (D6, D10).
   *
   * The release is the place the drag is read at for the slop, and Chromium can let
   * the button go where no move ever went: a press that showed no mark has no side
   * for its release to take, so that one reads the side the release point is nearest.
   */
  #onRailUp = (event: PointerEvent): void => {
    const drag = this.#railDrag;
    if (drag === null || event.pointerId !== drag.pointer) {
      return;
    }
    drag.at = this.#page.viewport.screenPoint(event);
    this.#endRailDrag();
    if (!drag.moved && isClick(drag.from, drag.at)) {
      // The press that stayed a click picks its tile, and the placement a corner
      // asked for while it was held runs now (O2).
      this.#settleRail();
      return;
    }
    this.#railDragged = true;
    this.#dockRail(drag.near ?? nearestDock(drag.frame, drag.at), drag);
  };

  #onRailCancel = (event: PointerEvent): void => {
    if (this.#railDrag?.pointer === event.pointerId) {
      // The press is called off, so the strip goes back where it hung (D7, I6), and
      // the placement a corner asked for while the press held it runs now (O2).
      this.#callOffRailDrag();
      this.#settleRail();
    }
  };

  /**
   * A drag the page calls off — Escape, a window that lost the focus, a hidden
   * tab, a cancelled pointer — puts the rail back where it hung and stores
   * nothing (D7, I6). The side and the frame a drag was measured against are the
   * ones the press found, so re-hanging the strip from them is the whole undo of
   * it. The pointer is still in the person's hand, though, and what it sends
   * before it comes up is the called-off press's: the board refuses its moves and
   * its release, so it settles no gesture at the place it lands, and the click its
   * release sends to a tile picks no tool. A fresh press works as any press does.
   */
  #callOffRailDrag(): void {
    const drag = this.#railDrag;
    if (drag === null) {
      return;
    }
    this.#endRailDrag();
    this.#gestures.refuse(drag.pointer);
    this.#railClickOwed = drag.pointer;
    this.#hangRail();
  }

  /**
   * The page lost the focus, or went out of sight: no pointer of this editor will
   * ever come up here. Every hold of the board ends, and a drag of the rail — the
   * page's chrome, not a gesture of the board's — is called off beside it, so a
   * release that lands in another window docks nothing (D7, I6).
   */
  #onInterrupt = (): void => {
    this.#gestures.release();
    this.#callOffRailDrag();
  };

  /** The placement a press held back, made now that no press holds the strip (O2). */
  #settleRail(): void {
    if (this.#railWaiting) {
      this.#hangRail();
    }
  }

  /**
   * Drop the press on the rail, its capture, the listeners it put on the page and
   * the docks it drew.
   */
  #endRailDrag(): void {
    const drag = this.#railDrag;
    if (drag === null) {
      return;
    }
    this.#railDrag = null;
    window.removeEventListener('pointermove', this.#onRailMove);
    window.removeEventListener('pointerup', this.#onRailUp);
    window.removeEventListener('pointercancel', this.#onRailCancel);
    if (this.#rail.hasPointerCapture(drag.pointer)) {
      this.#rail.releasePointerCapture(drag.pointer);
    }
    // Every way a drag ends — the release, Escape, a lost focus, a hidden tab, a
    // cancelled pointer, a Scene leaving — takes the four docks with it (D7, I6).
    this.#hideDocks();
  }

  #onStatusClick = (event: Event): void => {
    const action = ((event.target as Element | null)?.closest('[data-act]') as HTMLElement | null)
      ?.dataset['act'];
    if (action === 'open') {
      // A served page has its folder already, so the button lists its Scenes.
      void (this.#connection.served ? this.#showNote() : this.#connection.pick());
    } else if (action === 'grid') {
      this.#toggleGrid();
    } else if (action === 'roughness') {
      this.#stepDefaultRoughness();
    } else if (action === 'shortcuts') {
      this.#notes.toggle('shortcuts');
    }
  };

  /**
   * The Scene-wide default roughness, which new Elements take. It sits in the
   * status bar rather than in the Style menu, because the menu is only there
   * with a selection and this default is set with nothing selected. One click
   * is one autosaved edit, like every other Scene change.
   */
  #stepDefaultRoughness(): void {
    const roughness = nextRoughness(this.#scene.defaults.roughness);
    this.#applyScene({ ...this.#scene, defaults: { ...this.#scene.defaults, roughness } });
    this.#showDefaultRoughness();
  }

  #showDefaultRoughness(): void {
    const value = roughnessLabel(this.#scene.defaults.roughness);
    this.#roughButton.innerHTML = `rough <b>${value}</b>`;
  }

  #onMenuClick = (event: Event): void => {
    const button = (event.target as Element | null)?.closest('[data-style],[data-act]') as HTMLElement | null;
    if (button === null) {
      return;
    }
    const style = button.dataset['style'] as StyleKey | undefined;
    if (style !== undefined) {
      this.#styleSelection(style, button.dataset['value'] ?? '');
      return;
    }
    const act = button.dataset['act'] ?? '';
    if (act === 'detach-start' || act === 'detach-end') {
      // A Snap row names the end it frees, so it is the note's own button
      // rather than one of the registry's actions.
      this.#detachEnd(act === 'detach-start' ? 'start' : 'end');
      return;
    }
    // An arrange button is a registry action with the same name and the same
    // rule, so the menu and the palette can never disagree about it.
    const action = actionById(act);
    if (action !== null) {
      void action.run(this.#host);
    }
  };

  /** Free one end of the selected arrow or line where it draws, as one step. */
  #detachEnd(end: End): void {
    this.#land(detached(this.#scene, this.#selectedElements(), end));
  }

  #onNewScene = (event: Event): void => {
    event.preventDefault();
    const input = this.#newScene.querySelector('input')!;
    const name = sceneFileNameFor(input.value);
    // Asked for by name, so it is a Scene now: Scene and SVG are written at
    // once, as the served and picked-folder editors always have.
    void this.#connection.open(name, { create: true });
  };

  #onFileClick = (event: Event): void => {
    const button = (event.target as Element | null)?.closest('[data-file]') as HTMLElement | null;
    const name = button?.dataset['file'];
    if (name !== undefined) {
      void this.#connection.open(name);
    }
  };

  /**
   * List the browsed folder's Scenes in the note. A name already typed in the
   * New form is left alone: a refresh of what the folder holds must not throw
   * away what the person is in the middle of naming.
   */
  async #showNote(): Promise<void> {
    const folder = this.#connection.browsed;
    if (folder === null) {
      return;
    }
    // The listing is a read, and a read answers late: the note it is for may be
    // shut while the folder answers.
    const ask = this.#notes.ask('scenes');
    this.#note.querySelector('.folder')!.textContent = folder.name;
    let names: string[];
    try {
      names = await folder.listScenes();
    } catch (error) {
      if (this.#notes.wants(ask)) {
        // A failure for a read the note no longer wants is as stale as a list
        // it would not paint: the status line speaks for the Scene in hand.
        this.#setSaved('failed', (error as Error).message);
      }
      return;
    }
    if (!this.#notes.wants(ask)) {
      // The person put the note away while the folder was answering: its answer
      // is not news, and neither the list it read nor the note is painted.
      return;
    }
    this.#files.replaceChildren(
      ...names.map((name) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-file', name);
        button.textContent = name;
        item.append(button);
        return item;
      }),
    );
    if (names.length === 0) {
      const item = document.createElement('li');
      item.className = 'empty';
      item.textContent = 'no Scenes here yet';
      this.#files.append(item);
    }
    this.#notes.show('scenes');
  }

  #setSaved(state: SavedState, detail = ''): void {
    this.#savedLabel.dataset['state'] = state;
    this.#savedLabel.textContent =
      state === 'failed'
        ? detail
        : state === 'saving'
          ? 'saving…'
          : state === 'saved'
            ? 'saved'
            : state === 'new'
              ? 'new Scene'
              : '';
  }
}

/**
 * The page's font and its folder: what a page names for one element, and what
 * `defineEditorElement` hands to the connection the element runs on.
 */
export type { FolderSource, FontSource, PageFont } from './connection.js';

/**
 * What a page configures about every element it makes: the bundle sets
 * `focusInside` and no `exportPng`, because an embedded editor is one box on
 * someone else's page: its keys and its clipboard are the page's until a person
 * clicks into it, and the page a PNG is drawn for is not there.
 */
export interface EditorOptions {
  /** True when the keys and the clipboard belong to the element only while the focus is inside it. */
  readonly focusInside?: boolean;
  /**
   * How this page draws a PNG: the exporter itself, which the page passes and
   * the bundle does not. A PNG draws its words from the font's outlines and its
   * paper and ink from the served page's palette; the bundle reads the metrics
   * alone and brings its own scoped variables, so a page without an exporter —
   * the bundle — has Export rows that say where a PNG comes from, and a page
   * with one exports as its own button does.
   */
  readonly exportPng?: (request: PngExport) => Promise<void>;
}

/**
 * Registers the element with the page's font and folder. The browser builds a
 * custom element with no arguments, so both arrive through this closure rather
 * than through the constructor call, and every page names its own: the served
 * page asks the save API, the bundle has one Scene URL. A font that will not
 * load is not a different element: it is a problem the same element says in its
 * status line.
 */
export function defineEditorElement(
  fonts: FontSource,
  folder: FolderSource,
  options: EditorOptions = {},
): void {
  if (customElements.get('esbozo-editor') !== undefined) {
    return;
  }
  customElements.define(
    'esbozo-editor',
    class extends EsbozoEditorElement {
      constructor() {
        super(fonts, folder, options);
      }
    },
  );
}
