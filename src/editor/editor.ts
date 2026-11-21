/**
 * `<esbozo-editor>`: the Scene editor.
 *
 * It holds the Scene, paints it with the Renderer and edits it with the pointer
 * and the keyboard. Every change saves the Scene and its SVG back to the folder
 * it was opened from: there is no unsaved state and no prompt. Browsing another
 * folder only changes what the Scenes note lists: the open Scene keeps its own
 * `{ folder, name }` destination.
 */
import { elementBounds, elementsById } from '../renderer.js';
import {
  emptyScene,
  hasXmlInvalidChars,
  parseFragment,
  parseScene,
  serialiseScene,
} from '../scene.js';
import type { Element as SceneElement, Scene, TextElement } from '../scene.js';
import { PRIMARY_SCENE_EXTENSION, sceneFileNameFor, sceneStem } from '../paths.js';
import { copies, freshId, idsOf, newText, without } from './elements.js';
import { arranged, movableCount } from './arrange.js';
import type { ArrangeAct } from './arrange.js';
import { actionById, actionFor } from './actions.js';
import type { ActionHost, ActionState, ToolId } from './actions.js';
import { exportPng } from './export.js';
import { Gestures } from './gestures.js';
import { clipboardApi, copySelection, copyTo, cutSelection, pasteClipboard } from './clipboard.js';
import type { ClipboardHost } from './clipboard.js';
import { Connection } from './connection.js';
import type { FolderSource, FontSource, SaveTarget } from './connection.js';
import { Page } from './page.js';
import { CommandPalette } from './palette.js';
import { menuSignature, roughnessNote, styleNote } from './menu.js';
import { nextRoughness, styled } from './style.js';
import type { StyleKey } from './style.js';
import { canPickFolder, pickFolder } from './files.js';
import { servedFolder } from './server-folder.js';
import type { SceneFolder } from './files.js';
import { boxOf, fittedView, landingOffset, moved, zoomedAt } from './geometry.js';
import type { Point, View } from './geometry.js';
import { History } from './history.js';
import { railArt } from './rail.js';
import { SHELL } from './shell.js';
import { freedEnd, isShaft, released } from './snap.js';
import type { End } from './snap.js';
import { TextSession } from './text-session.js';
import { keptWords, withWords, wordsOf, wordsShift } from './words.js';
import type { WordsShift } from './words.js';
import { sceneFile } from './paint.js';

const NUDGE = 1;
const NUDGE_WITH_SHIFT = 10;
const ZOOM_STEP = 1.2;
/** How far a copy, a pasted Element or a duplicate lands from what it copies, in Scene units. */
const COPY_OFFSET = { x: 16, y: 16 };
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
  #pngExport = true;
  #scene: Scene = emptyScene();
  #selected: string[] = [];
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
  #gridRect!: SVGRectElement;
  #dots!: SVGPatternElement;
  #rail!: HTMLElement;
  #railArt!: SVGSVGElement;
  /** The in-place input a Text or a Label is typed into, while it is open. */
  #text: TextSession | null = null;
  /**
   * The Element the open in-place editor is editing, as it shows it: the Scene
   * keeps what was there until the words are committed, so Escape can leave it
   * alone and a half-typed Label is never a history step.
   */
  #editing: { id: string; element: SceneElement } | null = null;
  /**
   * The Text being typed for the first time, as it will land: it is drawn on the
   * page but it is not in the Scene until the words are committed.
   */
  #draft: TextElement | null = null;
  /**
   * The step between the field's words and the drawn ones, made whenever the page
   * accepts a preview: a caret is mapped through the very words its Block was
   * drawn from, and input the page refused maps through the last it accepted.
   */
  #shift: WordsShift = wordsShift('', '');
  #note!: HTMLElement;
  #files!: HTMLUListElement;
  #newScene!: HTMLFormElement;
  #whereLabel!: HTMLElement;
  #modeLabel!: HTMLElement;
  #savedLabel!: HTMLElement;
  #menu!: HTMLElement;
  #roughButton!: HTMLButtonElement;
  #sheet!: HTMLElement;
  #helpButton!: HTMLButtonElement;
  #palette!: CommandPalette;

  /**
   * What the clipboard commands may ask of the editor: the Scene, its selection,
   * the connection their answer speaks for, and the one way it becomes an edit.
   */
  readonly #clipboard: ClipboardHost = {
    scene: () => this.#scene,
    selected: () => this.#selectedElements(),
    token: () => this.#connection.token,
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
    openPalette: () => this.#palette.show(),
    exportPng: (theme) => this.#exportPng(theme),
    zoomIn: () => this.#zoomBy(ZOOM_STEP),
    zoomOut: () => this.#zoomBy(1 / ZOOM_STEP),
    zoomToFit: () => this.#zoomToFit(),
    resetZoom: () => this.#resetZoom(),
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
    this.#pngExport = options.pngExport !== false;
  }

  /** The page's font, as the page gets it: one measurement per element. */
  readonly #fonts: FontSource;
  /** Where a folder of Scenes comes from: `ez serve`'s, or the page's own. */
  readonly #folder: FolderSource;

  connectedCallback(): void {
    if (this.#canvas !== undefined) {
      // Back on the page: the listeners left with it the last time, and an
      // editor that never got as far as drawing tries its connection again.
      if (this.#connection.ready) {
        this.#listen();
      } else {
        void this.#connection.connect();
      }
      return;
    }
    this.innerHTML = SHELL;
    this.#board = this.querySelector('.board')!;
    this.#canvas = this.querySelector('.canvas')!;
    this.#gridRect = this.querySelector('.grid-rect')!;
    this.#dots = this.querySelector('.canvas pattern')!;
    this.#rail = this.querySelector('.rail')!;
    this.#railArt = this.querySelector('.rail-art')!;
    this.#note = this.querySelector('.note')!;
    this.#files = this.querySelector('.files')!;
    this.#newScene = this.querySelector('.new')!;
    this.#whereLabel = this.querySelector('.where')!;
    this.#modeLabel = this.querySelector('.mode')!;
    this.#savedLabel = this.querySelector('.saved')!;
    this.#menu = this.querySelector('.style-note')!;
    this.#roughButton = this.querySelector('[data-act="roughness"]')!;
    this.#sheet = this.querySelector('.shortcuts')!;
    this.#helpButton = this.querySelector('[data-act="shortcuts"]')!;
    this.#palette = new CommandPalette({
      root: this.querySelector('.palette')!,
      state: () => this.#actionState(),
      run: (action) => void action.run(this.#host),
      // The palette is a detour, not a place: shutting it puts the person back
      // on the canvas, where the keys and the pointer already belong.
      // The canvas is where the keys belong, and the paper is already in
      // view: a focus that scrolls would move the Scene under the pointer.
      closed: () => this.#canvas.focus({ preventScroll: true }),
    });

    // Each instance's Grid is its own pattern: two editors on one page would
    // otherwise share the first one's dots at the first one's zoom.
    const dots = `esbozo-dots-${++instances}`;
    this.#dots.id = dots;
    this.#gridRect.setAttribute('fill', `url(#${dots})`);

    // The page's frame is told what the page may show, and asked for it. It owns
    // the view, the drawings kept between frames and the overlay that marks them.
    this.#page = new Page(
      {
        board: this.#board,
        surface: this.querySelector('.surface')!,
        grid: this.querySelector('.grid')!,
        gridRect: this.#gridRect,
        overlay: this.querySelector('.overlay')!,
        zoom: this.querySelector('.zoom')!,
        painted: this.querySelector('.painted')!,
      },
      {
        layout: () => this.#connection.layout,
        scene: () => this.#scene,
        shown: () => this.#shownElements(),
        selected: () => this.#selected,
        drag: () => this.#gestures.drag,
        editingId: () => this.#editing?.id ?? null,
        typing: () =>
          this.#text === null
            ? null
            : {
                element: (this.#editing?.element ?? this.#draft)!,
                text: this.#text,
                shift: this.#shift,
              },
      },
    );
    this.#page.viewport.showGrid(this.#grid);

    // The connection is the page's font, its folder and its writes: every answer
    // it gets is late, and every one of them is bound to the token that asked.
    this.#connection = new Connection(this.#fonts, this.#folder, {
      element: this,
      show: (scene, target) => this.#load(scene, target),
      forget: () => this.#forget(),
      start: () => this.#start(),
      mode: (folder) => this.#showMode(folder),
      measure: () => this.#measure(),
      status: (state, detail) => this.#setSaved(state, detail),
      note: () => this.#showNote(),
      pick: () => pickFolder(),
      served: (folder) => {
        this.querySelector('[data-act="open"]')!.textContent = 'Scenes';
        this.#showMode(folder);
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
      view: () => this.#page.viewport.view,
      setView: (view) => {
        this.#page.viewport.view = view;
      },
      scenePoint: (pointer) => this.#page.viewport.scenePoint(pointer),
      screenPoint: (pointer) => this.#page.viewport.screenPoint(pointer),
      selected: () => this.#selected,
      select: (ids) => {
        this.#selected = [...ids];
      },
      tool: () => this.#tool,
      setTool: (tool) => this.#setTool(tool),
      writable: () => this.#connection.writable(),
      text: () => this.#text,
      wordsOffset: (point) => this.#page.wordsOffset(point),
      wordsNearest: (point) => this.#page.wordsNearest(point),
      typedOffset: (drawn) => this.#typedOffset(drawn),
      openWords: (element) => this.#openWords(element),
      openTextInput: (at) => this.#openTextInput(at),
      applyScene: (next, options) => this.#applyScene(next, options),
      refresh: () => this.#refresh(),
      paint: () => this.#page.paint(),
      paintWords: () => this.#page.paintWords(),
      ink: (id) => this.#page.ink(id),
    });

    if (this.#ownsKeysWhenFocused) {
      // An embedded editor is one box on someone else's page: a click into it
      // is what makes its keys its own, and the host keeps Space and the arrows
      // until then.
      this.setAttribute('tabindex', '0');
    } else {
      // The served page holds nothing but the editor, so the first one on it
      // owns the keys from the start, as it always has.
      active ??= this;
    }

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
    this.#board.addEventListener('pointerdown', this.#gestures.down);
    this.#board.addEventListener('pointermove', this.#gestures.move);
    this.#board.addEventListener('pointerup', this.#gestures.up);
    this.#board.addEventListener('pointercancel', this.#gestures.cancel);
    this.#board.addEventListener('wheel', this.#onWheel, { passive: false });
    this.#canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.#rail.addEventListener('click', this.#onRailClick);
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
    // After it, so the press that shuts the sheet still reaches the page it
    // landed on: a person pressing the canvas has asked for the canvas too.
    document.addEventListener('pointerdown', this.#shutSheetOnPress);
    document.addEventListener('visibilitychange', this.#gestures.release);
    window.addEventListener('blur', this.#gestures.release);
    window.addEventListener('resize', this.#onResize);

    requestAnimationFrame(() => this.#drawRailArt());
  }

  disconnectedCallback(): void {
    this.#board?.removeEventListener('pointerdown', this.#gestures.down);
    this.#board?.removeEventListener('pointermove', this.#gestures.move);
    this.#board?.removeEventListener('pointerup', this.#gestures.up);
    this.#board?.removeEventListener('pointercancel', this.#gestures.cancel);
    this.#board?.removeEventListener('wheel', this.#onWheel);
    document.removeEventListener('copy', this.#onCopy);
    document.removeEventListener('cut', this.#onCut);
    document.removeEventListener('paste', this.#onPaste);
    document.removeEventListener('keydown', this.#onKeyDown);
    document.removeEventListener('keyup', this.#onKeyUp);
    document.removeEventListener('pointerdown', this.#gestures.anyPress);
    document.removeEventListener('pointerdown', this.#shutSheetOnPress);
    document.removeEventListener('visibilitychange', this.#gestures.release);
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
    window.removeEventListener('blur', this.#gestures.release);
    // A page that takes the editor away takes the words with it: the field is a
    // child that left with the element, and no gesture of this pointer survives
    // the DOM it was pressed on.
    this.#endEdits();
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
    this.#replaceScene(emptyScene());
    this.#selected = [];
    this.#history.reset(serialiseScene(this.#scene));
    this.#menu.hidden = true;
    this.#note.hidden = true;
    this.#showSheet(false);
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
    this.#page.paint();
  }

  /** A measurement arrived: nothing drawn with the last one is this page's drawing any more. */
  #measure(): void {
    this.#page.measure();
    this.#page.invalidate();
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
      // keeps the pan it started: its own window blur ends it, as always.
      this.#gestures.endSpacePan();
    }
  };

  /** The status bar's word for what this page may do with the Scene. */
  #showMode(folder: SceneFolder): void {
    const readOnly = folder.readOnly || this.#connection.refused;
    this.#modeLabel.textContent = readOnly ? 'read-only' : '';
    this.#newScene.hidden = readOnly;
    if (readOnly) {
      // Write access just ended: nothing stays armed that could change a Scene
      // this page may only read.
      this.#endEdits();
    }
  }

  /** Let go of every edit in flight: half-typed words, the gesture in hand, and the tool. */
  #endEdits(): void {
    this.#endText();
    // Write access can end in the middle of a gesture, as a folder that answers a
    // queued save with a 403 does. Half a gesture is not a Scene any more: it is
    // dropped with the preview it painted, rather than left on a page that may
    // only read.
    if (this.#gestures.holdsScene()) {
      this.#gestures.cancelDrag();
    }
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

  /**
   * A Scene that replaces the one in hand: another one opened, the Scene an
   * embedded element names, or the paper it lets go of. Nothing drawn for the
   * last one can speak for this one — the ids may be the same and mean something
   * else — so the drawings start empty and the page counts a new Scene.
   */
  #replaceScene(scene: Scene): void {
    this.#scene = scene;
    this.#page.clear();
    this.#page.sceneChanged();
  }

  #load(scene: Scene, target: SaveTarget): void {
    this.#replaceScene(scene);
    this.#selected = [];
    this.#history.reset(serialiseScene(scene));
    this.#menuFor = null;
    this.#page.viewport.view = fittedView(scene, this.#page.viewport.size(), this.#connection.layout);
    this.#whereLabel.textContent = `${target.folder.name} / ${target.name}`;
    this.#note.hidden = true;
    // Another Scene: the tool in hand and the words half-typed into the last
    // one belong to that one, not this, and the note shows its defaults.
    this.#endEdits();
    this.#showDefaultRoughness();
    this.#refresh();
  }

  #selectedElements(): SceneElement[] {
    const selected = new Set(this.#selected);
    return this.#shownElements().filter((element) => selected.has(element.id));
  }

  /**
   * The Scene as the page shows it: committed Elements plus the gesture in
   * flight and the words being typed. Never the Scene that is saved, so half a
   * drag or half a Label can never be a step. The words of a Label or a Text
   * being edited are drawn by the Renderer like any others: the canvas is the
   * one place that shows what saving would render.
   */
  #shownElements(): SceneElement[] {
    const drag = this.#gestures.drag;
    const editing = this.#editing;
    const draft = this.#draft;
    // A drag that only moves the pointer inside the words is still the same
    // page: a pan moves the page, and so does carrying the caret through the
    // words being typed, whose preview must stay drawn under the pointer.
    if (drag === null || drag.kind === 'pan' || drag.kind === 'words') {
      const words =
        editing === null
          ? this.#scene.elements
          : this.#scene.elements.map((element) =>
              element.id === editing.id ? editing.element : element,
            );
      return draft === null ? words : [...words, draft];
    }
    if (drag.kind === 'draw') {
      return [...this.#scene.elements, drag.preview];
    }
    if (drag.kind === 'move') {
      return this.#scene.elements.map((element) => drag.shown.get(element.id) ?? element);
    }
    if (
      drag.kind === 'resize' ||
      drag.kind === 'end' ||
      (drag.kind === 'label' && drag.moved)
    ) {
      return this.#scene.elements.map((element) => (element.id === drag.id ? drag.shown : element));
    }
    return this.#scene.elements;
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
    this.#selected = this.#selected.filter((id) =>
      this.#scene.elements.some((element) => element.id === id),
    );
    this.#page.sceneChanged();
    this.#nudgedAt = 0;
    // An undone edit may have changed a default or a Snap, so the status bar and
    // the note follow the restored Scene: a Snap the undo put back offers its
    // Detach button again.
    this.#showDefaultRoughness();
    this.#refresh();
    void this.#connection.save(this.#scene);
  }

  /** Delete the selected Elements, as one step. A Snap to a deleted target is dropped. */
  #deleteSelected(): void {
    this.#remove(new Set(this.#selected));
  }

  /**
   * Delete the Elements with these ids, as one step. Only the ids given go: a
   * cut that copied one Element deletes that Element, whatever the selection
   * has become while the clipboard took the copy.
   */
  #remove(ids: ReadonlySet<string>): void {
    if (ids.size === 0) {
      return;
    }
    this.#applyScene(
      { ...this.#scene, elements: without(this.#scene.elements, ids) },
      { select: this.#selected.filter((id) => !ids.has(id)) },
    );
  }

  /** A duplicate is a copy pasted in place, offset so the copy reads as a copy: one step. */
  #duplicate(): void {
    this.#insertCopies(this.#selectedElements());
  }

  /**
   * Copy the selected Elements as Scene JSON text. The clipboard event carries
   * the data, so a copy is one synchronous step of a key press rather than a
   * promise racing the paste that follows it.
   */
  #onCopy = (event: ClipboardEvent): void => {
    if (active !== this || !this.#takesKeys(event.target) || this.#gestures.holdsScene()) {
      return;
    }
    if (copyTo(event.clipboardData, this.#scene, this.#selectedElements())) {
      event.preventDefault();
    }
  };

  /** Paste Scene JSON text from the clipboard, with new ids, offset off what is here. */
  #onPaste = (event: ClipboardEvent): void => {
    if (active !== this || !this.#takesKeys(event.target) || this.#gestures.holdsScene()) {
      return;
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    this.#insertCopies(parseFragment(text, this.#scene.defaults) ?? []);
    event.preventDefault();
  };

  /**
   * Whether a key or a clipboard event is this editor's to answer: not a field a
   * person is typing in, and, for an embedded editor, only while the focus is
   * inside it.
   */
  #takesKeys(target: EventTarget | null): boolean {
    if (this.#typing(target)) {
      return false;
    }
    return !this.#ownsKeysWhenFocused || this.#focused;
  }

  /** Cut is a copy the page also deletes: one event carries the text, one step edits. */
  #onCut = (event: ClipboardEvent): void => {
    if (active !== this || !this.#takesKeys(event.target) || this.#gestures.holdsScene()) {
      return;
    }
    if (copyTo(event.clipboardData, this.#scene, this.#selectedElements())) {
      event.preventDefault();
      this.#deleteSelected();
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
      png: this.#pngExport,
      folder: this.#connection.served || canPickFolder(),
    };
  }

  /** Whether a key or a clipboard event belongs to a field a person is typing in. */
  #typing(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    return (
      element !== null &&
      (element.isContentEditable || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA')
    );
  }

  /** Adds copies of the given Elements as one step, selected, so a paste can be moved at once. */
  #insertCopies(elements: readonly SceneElement[]): void {
    if (elements.length === 0) {
      return;
    }
    const byId = elementsById(elements);
    const box = boxOf(elements, byId, this.#connection.layout);
    const offset =
      box === null
        ? COPY_OFFSET
        : landingOffset(box, this.#page.viewport.view, this.#page.viewport.size(), COPY_OFFSET);
    const added = copies(elements, idsOf(this.#scene.elements), offset);
    this.#applyScene(
      { ...this.#scene, elements: [...this.#scene.elements, ...added] },
      { select: added.map((element) => element.id) },
    );
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
      this.#selected = [];
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
      this.#page.sceneChanged();
    }
    if (select !== undefined) {
      this.#selected = [...select];
    }
    // The note follows the Scene, room and all: a Snap row that ended where it
    // began is not left behind, and a change that moved the selection wakes the
    // view that keeps the note off it. A drag in flight is left alone by
    // `#clearOfMenu`, so nothing moves under the pointer.
    this.#refresh();
    if (changed) {
      this.#record(options.amend === true, after);
    }
  }

  /** Change the selected Elements' style, every pick arriving here. */
  #styleSelection(key: StyleKey, value: string): void {
    const picked = new Set(this.#selected);
    this.#applyScene({
      ...this.#scene,
      elements: this.#scene.elements.map((element) =>
        picked.has(element.id) ? styled(element, key, value) : element,
      ),
    });
  }

  /**
   * Reorder, align or spread the selected Elements. Arrange asks for the bounds
   * of what it can move as it needs them, so Order measures nothing and the id
   * index is built only when something is measured at all. The bounds are the
   * Renderer's own, so an alignment lands where the drawing is rather than where
   * a stored box says: a Snapped end and a Label are measured, not guessed.
   */
  #arrangeSelection(act: ArrangeAct): void {
    const elements = this.#scene.elements;
    let byId: ReadonlyMap<string, SceneElement> | undefined;
    this.#applyScene({
      ...this.#scene,
      elements: arranged(elements, this.#selected, act, (element) => {
        byId ??= elementsById(elements);
        return elementBounds(element, byId, this.#connection.layout);
      }),
    });
  }

  // ------------------------------------------------------------------ painting

  /**
   * A change of selection or of what the selection holds: the note follows it,
   * the view makes room for the note, and the page repaints. Both happen outside
   * the paint, so a redraw can never move the view under the pointer.
   */
  #refresh(): void {
    this.#syncMenu();
    this.#page.clearOfNote(this.#menu, this.#rail);
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
    // Zoom is not part of a double-click: the next press starts a new one.
    this.#gestures.forgetClicks();
    this.#page.clearOfNote(this.#menu, this.#rail);
    this.#page.paint();
  }

  #drawRailArt(): void {
    const width = this.#rail.offsetWidth + 14;
    const height = this.#rail.offsetHeight + 14;
    if (width <= 14 || height <= 14) {
      return;
    }
    this.#railArt.setAttribute('width', String(width));
    this.#railArt.setAttribute('height', String(height));
    this.#railArt.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.#railArt.innerHTML = railArt(width, height);
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

  /** A Text is placed: the words are typed where the Text will sit. */
  #openTextInput(at: Point): void {
    // A page that may not write has nowhere to put a Text, however the gesture
    // that placed it began: the refusal may have landed while the button was
    // still down. One gate, asked at the moment the field would open.
    if (!this.#connection.writable()) {
      return;
    }
    this.#setTool('select');
    // The Text the words will make, drawn on the page as they arrive: the page
    // shows what saving would render, and the field is only the caret and the keys.
    this.#draft = newText(at, '', freshId('text', idsOf(this.#scene.elements)), this.#scene.defaults);
    this.#shift = wordsShift('', '');
    this.#text = new TextSession({
      host: this,
      name: 'Text',
      words: '',
      typed: (words) => this.#showTyped(words),
      moved: () => this.#page.paintWords(),
      line: (key, state) => this.#page.wordsLine(key, state),
      commit: (words) => this.#commitText(words),
      ended: () => this.#endText(),
    });
    this.#page.paint();
  }

  /**
   * Open the in-place editor on an Element's words. The page draws them at once,
   * where they will save, and the caret sits on those glyphs; nothing of the
   * Scene changes until the words are committed.
   */
  #openWords(element: SceneElement): void {
    // A page with nowhere to save the words opens none, by either way in: one
    // gate, on the one question every Scene change asks.
    if (!this.#connection.writable()) {
      return;
    }
    this.#setTool('select');
    this.#selected = [element.id];
    // The page paints the Element with the room its words need from the first
    // frame, not from the first keystroke, so the words are in one place.
    this.#editing = {
      id: element.id,
      element: withWords(element, wordsOf(element), this.#connection.layout),
    };
    this.#shift = wordsShift(wordsOf(element), wordsOf(element));
    // The note follows the selection, and the view makes room for it before the
    // field takes the focus: the words stay clear of the note under the caret.
    this.#refresh();
    this.#text = new TextSession({
      host: this,
      name: element.type === 'text' ? 'Text' : 'Label',
      words: wordsOf(element),
      typed: (words) => this.#showWords(element, words),
      moved: () => this.#page.paintWords(),
      line: (key, state) => this.#page.wordsLine(key, state),
      commit: (words) => this.#commitWords(element, words),
      ended: () => this.#endText(),
    });
  }

  /**
   * What the page shows while a Label or a Text is typed: the Element grown so
   * its words fit, with those words, drawn by the Renderer like any other. It is
   * a preview, not the Scene: only the commit makes it a change.
   */
  #showWords(element: SceneElement, words: string): void {
    // Words the Scene cannot hold are never drawn: the page keeps the last it
    // could, and the words that were typed are refused when they are committed.
    if (!hasXmlInvalidChars(words)) {
      // The Scene keeps the words without their outer blank lines, and the page
      // shows that: what is drawn while typing is what the commit will save.
      // Words nobody changed are no edit at all — the Element keeps them as it
      // holds them — so the page goes on drawing exactly those, and the ink does
      // not move when the session ends.
      const kept = words === wordsOf(element) ? words : keptWords(words);
      this.#editing = { id: element.id, element: withWords(element, kept, this.#connection.layout) };
      this.#shift = wordsShift(words, kept);
      // The grown Element is what the note must not cover.
      this.#page.clearOfNote(this.#menu, this.#rail);
    } else if (this.#editing !== null) {
      // The page refuses these words and goes on drawing the ones it has: the
      // step is measured through them all the same, so a character the Scene
      // cannot hold is one more offset in the field and no glyph under the caret.
      this.#shift = wordsShift(words, wordsOf(this.#editing.element));
    }
    this.#page.paint();
  }

  /** The Text being typed, with the words it has so far. */
  #showTyped(words: string): void {
    const draft = this.#draft;
    if (draft === null) {
      return;
    }
    if (!hasXmlInvalidChars(words)) {
      const kept = keptWords(words);
      this.#draft = { ...draft, content: kept };
      this.#shift = wordsShift(words, kept);
    } else {
      // Refused words are no edit: the step through them is still the step to
      // the words on the page, so the caret stays on the glyph it was typed at.
      this.#shift = wordsShift(words, draft.content);
    }
    this.#page.paint();
  }


  /** An offset among the drawn glyphs, read back into the field's own words. */
  #typedOffset(drawn: number): number {
    return this.#shift.typed(drawn);
  }

  /**
   * Commit the words typed in place: one undo step for the whole session, the
   * Element's growth included. Words nobody changed are not an edit and write
   * nothing; an emptied Label stops being one, and an emptied Text goes; words a
   * Scene could not hold are refused in the status line, and the field keeps them
   * so the person can fix them.
   */
  #commitWords(element: SceneElement, raw: string): boolean {
    // The comparison is the raw value against the words the Element held before
    // anything is trimmed: words nobody touched are the same words, whatever
    // spaces the author wrote them with.
    if (raw === wordsOf(element)) {
      return true;
    }
    // A character XML cannot hold is refused as typed, before a trim can hide
    // it; everything else the Scene checks is the words it would keep.
    const words = hasXmlInvalidChars(raw) ? raw : keptWords(raw);
    const problem = this.#problem(this.#wordsScene(element, words));
    if (problem !== null) {
      this.#setSaved('failed', problem);
      return false;
    }
    this.#land(this.#wordsScene(element, words), words === '' && element.type === 'text' ? [] : [element.id]);
    return true;
  }

  /**
   * Commit a new Text's words: a Text with words in them, or nothing. A control
   * character a person typed is refused rather than trimmed away, and words that
   * are only whitespace are no words, so they make no Text and are no problem.
   */
  #commitText(raw: string): boolean {
    const draft = this.#draft;
    if (draft === null) {
      return true;
    }
    const words = hasXmlInvalidChars(raw) ? raw : keptWords(raw);
    if (words === '') {
      return true;
    }
    const problem = this.#problem([...this.#scene.elements, { ...draft, content: words }]);
    if (problem !== null) {
      this.#setSaved('failed', problem);
      return false;
    }
    this.#land([...this.#scene.elements, { ...draft, content: words }], [draft.id]);
    return true;
  }

  /**
   * The one way a text session ends: the field goes, and so do the words it drew
   * on the page. A commit, an Escape, a click away, a blur, a lost connection and
   * a page that takes the editor off its DOM all end here, so no path can leave
   * half a session behind for the next press to trip over.
   */
  #endText(): void {
    const text = this.#text;
    this.#text = null;
    this.#editing = null;
    this.#draft = null;
    this.#gestures.forgetWordClick();
    this.#shift = wordsShift('', '');
    text?.discard();
    this.#page.paint();
  }

  /** The Scene these words would make, with this Element's words replaced. */
  #wordsScene(element: SceneElement, words: string): SceneElement[] {
    if (words === '' && element.type === 'text') {
      return without(this.#scene.elements, new Set([element.id]));
    }
    return this.#scene.elements.map((candidate) =>
      candidate.id === element.id ? withWords(candidate, words, this.#connection.layout) : candidate,
    );
  }

  /**
   * The Scene's own verdict on a Scene holding these Elements: the Scene its
   * parser reads back, or the first thing it cannot hold. Nothing is applied:
   * the caller decides whether the edit lands.
   */
  #verdict(elements: readonly SceneElement[]): { scene: Scene } | { problem: string } {
    const parsed = parseScene(serialiseScene({ ...this.#scene, elements: [...elements] }));
    if (parsed.ok) {
      return { scene: parsed.scene };
    }
    const first = parsed.problems[0];
    return { problem: first === undefined ? 'the Scene cannot hold these words' : first.message };
  }

  /** What the Scene says about these Elements: its first problem, or null when it can hold them. */
  #problem(elements: readonly SceneElement[]): string | null {
    const verdict = this.#verdict(elements);
    return 'problem' in verdict ? verdict.problem : null;
  }

  /**
   * The one way typed words land: the Scene's own verdict first, then one step
   * and one write. A refusal says why in the status line and leaves the Scene
   * exactly as it was, on the page and on disk.
   */
  #land(elements: readonly SceneElement[], selected: string[]): void {
    const verdict = this.#verdict(elements);
    if ('problem' in verdict) {
      this.#setSaved('failed', verdict.problem);
      this.#page.paint();
      return;
    }
    this.#applyScene(verdict.scene, { select: selected });
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
    if (this.#palette.open) {
      // The palette's own input takes the arrows, Enter and Escape. Any other
      // key with the focus off it still belongs to the palette, not the Scene.
      if (event.key === 'Escape') {
        event.preventDefault();
        this.#palette.close();
      }
      return;
    }
    if (!this.#sheet.hidden && event.key === 'Escape') {
      // The sheet is the topmost thing the page opened: its Escape shuts it and
      // leaves the Scene's selection where the person left it.
      event.preventDefault();
      this.#showSheet(false);
      return;
    }
    if (event.key === 'Escape' && this.#gestures.drag?.kind === 'label') {
      // Half a Label is not a Scene: Escape drops the words back to the place the
      // Scene holds, and the release that follows settles nothing. It answers
      // here, before the gesture that holds the Scene, because that guard is
      // about edits — and an Escape is what keeps one from landing.
      event.preventDefault();
      this.#gestures.cancelDrag();
      return;
    }
    if (this.#gestures.holdsScene()) {
      // Half a drag is not a Scene: an edit waits for the pointer to come up.
      return;
    }
    if (event.key === 'Escape') {
      this.#note.hidden = true;
      this.#selected = [];
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
        this.#openWords(only);
        return;
      }
    }
    // Every tool and every action answers to the registry's keys, so the rail,
    // the palette and the keyboard offer one list rather than three.
    const action = actionFor(event);
    if (action !== null) {
      event.preventDefault();
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
    // The window changed, so the room the note leaves has too.
    this.#refresh();
  };

  #nudge(dx: number, dy: number): void {
    const selected = new Set(this.#selected);
    if (selected.size === 0) {
      return;
    }
    // A nudge that cannot move what is selected records and saves nothing, and
    // a burst of them is one step: the same undo takes the whole nudge back.
    const byId = elementsById(this.#scene.elements);
    const amend = Date.now() - this.#nudgedAt < NUDGE_BURST_MS;
    this.#applyScene(
      {
        ...this.#scene,
        elements: this.#scene.elements.map((element) =>
          selected.has(element.id) ? moved(released(element, byId), dx, dy) : element,
        ),
      },
      { amend },
    );
    this.#nudgedAt = Date.now();
  }

  #zoomBy(factor: number): void {
    const size = this.#page.viewport.size();
    this.#changedView(zoomedAt(this.#page.viewport.view, factor, size.width / 2, size.height / 2));
  }

  /** Fit the page the Renderer draws into the window, the view an open Scene starts in. */
  #zoomToFit(): void {
    this.#changedView(fittedView(this.#scene, this.#page.viewport.size(), this.#connection.layout));
  }

  /** One pixel per Scene unit, around the middle of the window: the plain view. */
  #resetZoom(): void {
    const size = this.#page.viewport.size();
    this.#changedView(zoomedAt(this.#page.viewport.view, 1 / this.#page.viewport.view.zoom, size.width / 2, size.height / 2));
  }

  // ----------------------------------------------------------------------- UI

  #onRailClick = (event: Event): void => {
    const button = (event.target as Element | null)?.closest('[data-tool]') as HTMLElement | null;
    const tool = button?.dataset['tool'];
    if (tool !== undefined) {
      this.#setTool(tool as ToolId);
    }
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
      this.#showSheet(this.#sheet.hidden);
    }
  };

  /**
   * The Shortcuts sheet: a note laid over the page, open while the `?` says so.
   * It takes no keys of its own and holds no focus, so the only way it is open is
   * the button that names it, and the only ways it shuts are Escape, the button
   * again, and a press anywhere else on the page.
   */
  #showSheet(open: boolean): void {
    this.#sheet.hidden = !open;
    this.#helpButton.setAttribute('aria-expanded', String(open));
  }

  /** A press outside the sheet shuts it, and still lands where it was aimed. */
  #shutSheetOnPress = (event: PointerEvent): void => {
    if (this.#sheet.hidden) {
      return;
    }
    const target = event.target as Node | null;
    if (target !== null && (this.#sheet.contains(target) || this.#helpButton.contains(target))) {
      return;
    }
    this.#showSheet(false);
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
    this.#roughButton.innerHTML = roughnessNote(this.#scene.defaults.roughness);
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

  /**
   * Free one end of the selected arrow or line, where it draws now: the end
   * stops following its Element but does not move. One undo step, like every
   * other Scene change.
   */
  #detachEnd(end: End): void {
    const element = this.#selectedElements()[0];
    if (element === undefined || !isShaft(element)) {
      return;
    }
    const freed = freedEnd(element, end, elementsById(this.#scene.elements));
    if (freed === element) {
      return;
    }
    this.#applyScene({
      ...this.#scene,
      elements: this.#scene.elements.map((candidate) =>
        candidate.id === element.id ? freed : candidate,
      ),
    });
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
    this.#note.querySelector('.folder')!.textContent = folder.name;
    let names: string[];
    try {
      names = await folder.listScenes();
    } catch (error) {
      this.#setSaved('failed', (error as Error).message);
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
    this.#note.hidden = false;
  }

  #setSaved(state: 'idle' | 'saving' | 'saved' | 'new' | 'failed', detail = ''): void {
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
 * What a page configures about every element it makes. The bundle sets
 * `focusInside`, because an embedded editor is one box on someone else's page:
 * its keys and its clipboard are the page's until a person clicks into it, and
 * `pngExport`, because the page a PNG is drawn for is not there.
 */
export interface EditorOptions {
  /** True when the keys and the clipboard belong to the element only while the focus is inside it. */
  readonly focusInside?: boolean;
  /**
   * Whether this page can export a PNG, which it can unless it says otherwise. A
   * PNG draws its words from the font's outlines and its paper and ink from the
   * served page's palette; the bundle reads the metrics alone and brings its own
   * scoped variables, so its Export rows say where a PNG comes from.
   */
  readonly pngExport?: boolean;
}

/**
 * Registers the element with the page's font and folder. The browser builds a
 * custom element with no arguments, so both arrive through this closure rather
 * than through the constructor call. A font that will not load is not a
 * different element: it is a problem the same element says in its status line.
 */
export function defineEditorElement(
  fonts: FontSource,
  folder: FolderSource = servedFolder,
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
