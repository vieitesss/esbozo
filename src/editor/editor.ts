import { emptyScene, parseFragment, parseScene, serialiseScene } from '../scene.js';
import type { Corner, Element as SceneElement, Scene } from '../scene.js';
import { PRIMARY_SCENE_EXTENSION, sceneFileNameFor, sceneStem } from '../paths.js';
import { replaced, selectedFrom } from './elements.js';
import { movableCount } from './arrange.js';
import type { ArrangeAct } from './arrange.js';
import {
  deleted,
  duplicated,
  edited,
  nudged,
  pasted,
  rearranged,
  restyled,
  switched,
} from './edits.js';
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
import { fittedView, zoomedAt } from './geometry.js';
import type { View } from './geometry.js';
import { History } from './history.js';
import { mountRail } from './rail.js';
import type { MountedRail } from './rail.js';
import { SHELL } from './shell.js';
import { isShaft, snapOn } from './snap.js';
import type { End } from './snap.js';
import { Typing } from './typing.js';
import { sceneFile } from './paint.js';

const NUDGE = 1;
const NUDGE_WITH_SHIFT = 10;
const ZOOM_STEP = 1.2;
/** Nudges closer together than this are one undo step: a held arrow key is one gesture. */
const NUDGE_BURST_MS = 800;

/**
 * The instance the keys and the clipboard belong to: the last one a person
 * clicked or focused. Two editors on one page are two editors, so a nudge in
 * one is never a nudge in the other.
 */
let active: EsbozoEditorElement | null = null;

/** How many editors this page has made: each one's Grid is a pattern of its own. */
let instances = 0;


class EsbozoEditorElement extends HTMLElement {
  /** The page's font, the Scenes folder and the writes: every answer that comes late. */
  #connection!: Connection;
  /**
   * The button a held Space would activate, while a Space press is down: Space
   * gives a focused button the activation Enter does, on the release, and only
   * when the pointer never took the Space to pan the page.
   */
  #spaceButton: HTMLElement | null = null;
  /** Whether the pointer took the held Space to pan the page, which is no pick of a tile. */
  #spacePanned = false;
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
  /** The tool rail: its state, dock placement and pointer handling. */
  #rail!: MountedRail;
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
    dockRail: (side) => this.#rail.dock(side),
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
    const railEl = this.querySelector<HTMLElement>('.rail')!;
    const railArtEl = this.querySelector<SVGSVGElement>('.rail-art')!;
    const docksEl = this.querySelector<HTMLElement>('.docks')!;
    this.#rail = mountRail({
      rail: railEl,
      railArt: railArtEl,
      docks: docksEl,
      statusCorners: () => [...this.querySelectorAll<HTMLElement>('.status > div')],
      scene: () => this.#scene,
      view: () => this.#page.viewport.view,
      layout: () => this.#connection.layout,
      size: () => this.#page.viewport.size(),
      screenPoint: (event) => this.#page.viewport.screenPoint(event),
      statusChrome: () =>
        [...this.querySelectorAll<HTMLElement>('.status > div')]
          .map((corner) => this.#page.viewport.localBox(corner))
          .filter((corner) => corner.width > 0 && corner.height > 0),
      setTool: (tool) => this.#setTool(tool),
      refusePointer: (pointerId) => this.#gestures.refuse(pointerId),
    });
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
      drawn: () => this.#page.drawn(),
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
      applyScene: (next, select) => this.#land(edited(this.#scene, next.elements, select)),
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
        preview: () => this.#gestures.preview(),
        dragging: () => this.#gestures.drag !== null,
        railEdge: () => this.#rail.edge(),
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
      rail: railEl,
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
      land: (edit) => this.#land(edit),
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
    this.#rail.listen();
    this.querySelector('.status')!.addEventListener('click', this.#onStatusClick);
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
    this.#rail.unlisten();
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
    this.#rail.forget();
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
    this.#rail.place();
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
    this.#rail.place();
    // Another Scene: the tool in hand and the words half-typed into the last
    // one belong to that one, not this, and the note shows its defaults. A Space
    // press holds the page in the hand, and another Scene is another page, so
    // the pan goes with it, and with the word it was naming in the status bar.
    this.#endEdits();
    this.#gestures.endSpacePan();
    // A Space held across the switch was pressed on the last Scene's rail: the
    // tile it found is that Scene's tool, and the release is no activation here.
    this.#spaceButton = null;
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
    const shown = this.#gestures.preview();
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
    // switch on again.
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
   *
   * A tool picked while a shaft is in hand ends the place at its last point, as
   * Enter does: the points belong to the tool that started the place, so the next
   * click would put down a point of that tool's Element while the strip showed
   * another. A place of fewer than two points is no shaft and saves nothing, so a
   * pick over one point leaves the Scene as it was.
   */
  #setTool(tool: ToolId): void {
    if (this.#gestures.placing()) {
      this.#gestures.finishPlacing();
    }
    if (tool !== 'select' && !this.#connection.writable()) {
      return;
    }
    this.#tool = tool;
    this.#board.classList.toggle('pen', tool !== 'select' && !this.#gestures.spaceDown);
    this.#rail.markTool(tool);
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
    const after = sceneFile(next);
    const changed = after !== sceneFile(this.#scene);
    const { select } = options;
    if (changed) {
      this.#scene = next;
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
      // A Space the keys hand to the button the focus sits on is that button's
      // activation, as Enter is, and the release below runs it. The press is
      // still the pan's: a Space held over the paper takes it in the hand, which
      // is what a person pressing one Space expects, and a Space the pointer
      // never panned with is the button's alone.
      if (!this.#gestures.spaceDown) {
        this.#spaceButton = (event.target as Element | null)?.closest('button') ?? null;
        this.#spacePanned = false;
      }
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
    if (event.key === 'Escape' && this.#rail.escape()) {
      // A drag of the rail is the page's chrome, and its Escape is the drag's
      // alone: the strip goes back where it hung and the Scene keeps the tool
      // and the selection it had (D7, I6). Without this the Escape below would
      // drop the selection as well, which is the drag's to keep.
      event.preventDefault();
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
      const button = this.#spaceButton;
      const panned = this.#spacePanned;
      this.#spaceButton = null;
      this.#spacePanned = false;
      this.#gestures.endSpacePan();
      // A Space no pointer panned with is the focused button's own activation,
      // which the press above took the key from: a tile picks its tool as it does
      // with Enter. A press the pointer took to pan the page picked nothing, and
      // a person holding Space to carry the page is not asking for a tool. A
      // button the focus left between the press and the release is no activation
      // either: the release belongs to the control that holds the focus, as a
      // native button's Space does, so it neither follows the focus to another
      // tile nor clicks the one the press found.
      if (button !== null && !panned && button.contains(event.target as Node | null)) {
        button.click();
      }
    }
  };

  #onResize = (): void => {
    this.#rail.resize();
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
    this.#rail.place();
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
    if (this.#rail.holding()) {
      this.#gestures.refuse(event.pointerId);
      return;
    }
    // A press on the paper with Space down is the page in the hand, not a tool:
    // the Space that carried it is no activation of the button the focus sits on
    // (`#onKeyUp`).
    if (this.#gestures.spaceDown) {
      this.#spacePanned = true;
    }
    this.#gestures.down(event);
  };

  /**
   * The page lost the focus, or went out of sight: no pointer of this editor will
   * ever come up here. Every hold of the board ends, and a drag of the rail — the
   * page's chrome, not a gesture of the board's — is called off beside it, so a
   * release that lands in another window docks nothing (D7, I6).
   */
  #onInterrupt = (): void => {
    this.#gestures.release();
    this.#rail.interrupt();
    // A Space held when the page went out of sight never sends its release here,
    // so the button it would have activated is let go with it.
    this.#spaceButton = null;
    this.#spacePanned = false;
  };

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
    if (act === 'snap-start' || act === 'snap-end') {
      // A Snap row names the end its switch turns, so it is the note's own
      // control rather than one of the registry's actions.
      this.#switchSnap(act === 'snap-start' ? 'start' : 'end');
      return;
    }
    // An arrange button is a registry action with the same name and the same
    // rule, so the menu and the palette can never disagree about it.
    const action = actionById(act);
    if (action !== null) {
      void action.run(this.#host);
    }
  };

  /** Turn one end of the selected arrow or line's Snap on or off, as one step. */
  #switchSnap(end: End): void {
    const elements = this.#selectedElements();
    const element = elements[0];
    if (element === undefined || !isShaft(element)) {
      return;
    }
    // The plus note is rebuilt to say what the switch did, so a person who
    // reached it with Tab keeps the focus they had and Space flips the same end
    // back. The press is the note's own, so the note is where the focus sits.
    const held = this.#menu.contains(document.activeElement);
    this.#land(switched(this.#scene, elements, end, !snapOn(element, end)));
    if (held) {
      this.#menu.querySelector<HTMLButtonElement>(`[data-act="snap-${end}"]`)?.focus();
    }
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
