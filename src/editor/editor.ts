/**
 * `<esbozo-editor>`: the Scene editor.
 *
 * It holds the Scene, paints it with the Renderer and edits it with the pointer
 * and the keyboard. Every change saves the Scene and its SVG back to the folder
 * it was opened from: there is no unsaved state and no prompt. Browsing another
 * folder only changes what the Scenes note lists: the open Scene keeps its own
 * `{ folder, name }` destination.
 */
import { createLayout, fontSizePx } from '../layout.js';
import type { Layout, Metrics } from '../layout.js';
import { elementBounds, elementsById, outlineBox, renderScene } from '../renderer.js';
import {
  emptyScene,
  isOutlined,
  parseFragment,
  parseScene,
  serialiseFragment,
  serialiseScene,
} from '../scene.js';
import type { Element as SceneElement, Scene } from '../scene.js';
import { sceneStem } from '../paths.js';
import {
  copies,
  drawn,
  drawnAtClick,
  freshId,
  idsOf,
  isClick,
  newText,
  without,
} from './elements.js';
import type { DrawingTool } from './elements.js';
import { arranged, movableCount } from './arrange.js';
import type { ArrangeAct } from './arrange.js';
import { actionById, actionFor } from './actions.js';
import type { ActionHost, ActionState, ToolId } from './actions.js';
import { exportPng } from './export.js';
import { CommandPalette } from './palette.js';
import { menuSignature, roughnessNote, styleNote } from './menu.js';
import { nextRoughness, styled } from './style.js';
import type { StyleKey } from './style.js';
import { canPickFolder, pickFolder } from './files.js';
import { servedFolder } from './server-folder.js';
import type { SceneFolder } from './files.js';
import {
  HANDLES,
  boxBetween,
  boxOf,
  clearedView,
  elementAt,
  elementsInBox,
  fittedView,
  handlePoint,
  landingOffset,
  moved,
  resized,
  resizedBox,
  toPage,
  toScene,
  zoomedAt,
} from './geometry.js';
import type { Box, Handle, Point, View } from './geometry.js';
import { History } from './history.js';
import { railArt, railMarkup } from './rail.js';
import { TextSession } from './text-session.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DOT_SPACING = 22;
const DOT_RADIUS = 1.1;
const SELECTION_PADDING = 5;
const HANDLE_SIZE = 8;
const NUDGE = 1;
const NUDGE_WITH_SHIFT = 10;
const ZOOM_STEP = 1.2;
/** How far off the ink a click still picks an arrow or line, in screen pixels. */
const PICK_TOLERANCE = 6;
/** How far a copy, a pasted Element or a duplicate lands from what it copies, in Scene units. */
const COPY_OFFSET = { x: 16, y: 16 };
/** Nudges closer together than this are one undo step: a held arrow key is one gesture. */
const NUDGE_BURST_MS = 800;
/** Breathing room between the Style menu and the selection it must not cover. */
const MENU_GAP = 16;

/**
 * The instance the keys and the clipboard belong to: the last one a person
 * clicked or focused. Two editors on one page are two editors, so a nudge in
 * one is never a nudge in the other.
 */
let active: EsbozoEditorElement | null = null;

/** How many editors this page has made: each one's Grid is a pattern of its own. */
let instances = 0;

/** Where the open Scene saves: the folder and the name it was opened from. */
interface SaveTarget {
  readonly folder: SceneFolder;
  readonly name: string;
}

/**
 * A gesture in flight. A gesture that changes the Scene keeps its result here,
 * not in the Scene: the press, the moves and the release are one action, and
 * only the release settles it into the Scene the history and autosave see.
 */
type Drag =
  | { kind: 'pan'; fromScreen: Point; start: View }
  | {
      kind: 'move';
      from: Point;
      origins: Map<string, SceneElement>;
      /** The Elements as the pointer has moved them, by id. */
      shown: Map<string, SceneElement>;
    }
  | { kind: 'resize'; id: string; handle: Handle; origin: Box; from: Point; shown: SceneElement }
  | {
      kind: 'draw';
      tool: Exclude<DrawingTool, 'text'>;
      id: string;
      from: Point;
      to: Point;
      /** What the drag has drawn so far: a preview, not an Element of the Scene yet. */
      preview: SceneElement;
    }
  | { kind: 'text'; at: Point }
  | { kind: 'box'; from: Point; to: Point; additive: boolean };

const SHELL = `
<svg class="canvas" xmlns="${SVG_NS}" aria-label="Scene canvas" tabindex="0">
  <defs>
    <pattern width="${DOT_SPACING}" height="${DOT_SPACING}" patternUnits="userSpaceOnUse">
      <circle class="dot" cx="1" cy="1" r="${DOT_RADIUS}"></circle>
    </pattern>
  </defs>
  <g class="grid" aria-hidden="true">
    <rect class="grid-rect" x="-100000" y="-100000" width="200000" height="200000"></rect>
  </g>
  <g class="viewport">
    <g class="painted"></g>
    <g class="overlay"></g>
  </g>
</svg>
<nav class="rail" aria-label="Tools"><svg class="rail-art" aria-hidden="true"></svg>${railMarkup()}</nav>
<footer class="status">
  <button type="button" data-act="open">Open folder…</button>
  <button type="button" data-act="grid" aria-pressed="true">Grid</button>
  <button type="button" data-act="roughness" title="Scene default roughness for new Elements"></button>
  <span class="zoom">100%</span>
  <span class="where"></span>
  <span class="mode"></span>
  <span class="saved" role="status" data-state="idle"></span>
  <span class="hint">Space pan · wheel zoom · ⌘ +/− · G Grid · Q commands</span>
</footer>
<div class="palette" role="dialog" aria-label="Commands" hidden>
  <input
    type="text"
    aria-label="Command"
    placeholder="Type an action"
    spellcheck="false"
    autocomplete="off"
  />
  <ul role="listbox" aria-label="Actions"></ul>
  <p class="palette-nothing" hidden>No action by that name.</p>
</div>
<div class="style-note" role="dialog" aria-label="Style" hidden></div>
<div class="note" role="dialog" aria-label="Scene files" hidden>
  <div class="note-head"><b>Scenes</b><span class="folder"></span></div>
  <ul class="files"></ul>
  <form class="new">
    <input name="name" placeholder="new-scene.json" aria-label="New Scene name" spellcheck="false" autocomplete="off" />
    <button type="submit">New</button>
  </form>
</div>
`;

export class EsbozoEditorElement extends HTMLElement {
  /**
   * The page's font, measured: every Text and Label is placed with it. It is
   * empty until the page's font arrives, and nothing is drawn with it before
   * then: the element starts drawing once it has the measurement.
   */
  #layout: Layout = unmeasured();
  /** The family that font is drawn as, which an exported SVG is resolved in. */
  #family = 'Kalam';
  /** The page's font, as the page gets it: one measurement per element. */
  readonly #fonts: FontSource;
  /** Where a folder of Scenes comes from: `ez serve`'s, or the page's own. */
  #folder: FolderSource;
  /**
   * Which connection the element is on: every attribute change makes a new one,
   * and an answer for an older number is dropped, never drawn.
   */
  #generation = 0;
  /** The Scene this connection opened, once one is open: where its writes go. */
  #target: SaveTarget | null = null;
  /** True once the page's font is measured and the editor is drawing. */
  #ready = false;
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
  /** True once a save was refused with `403`: this page may not write any more. */
  #refused = false;
  #scene: Scene = emptyScene();
  #selected: string[] = [];
  #tool: ToolId = 'select';
  #history = new History(serialiseScene(this.#scene));
  /** When the last nudge landed, so a burst of them folds into one undo step. */
  #nudgedAt = 0;
  #view: View = { zoom: 1, panX: 0, panY: 0 };
  #grid = true;
  /** The folder the Scenes note lists. Browsing it never moves the save target. */
  #browsed: SceneFolder | null = null;
  /** True when the page is served by `ez serve`, so its folder needs no picker. */
  #served = false;
  #drag: Drag | null = null;
  #spaceDown = false;
  /** The writes in order; the number each answers with is whether it landed. */
  #saveQueue: Promise<unknown> = Promise.resolve();
  #paintQueued = false;
  #paintedFor: string | null = null;
  /** The selection the Style menu was built for, so a rebuild only happens on a change. */
  #menuFor: string | null = null;

  #canvas!: SVGSVGElement;
  #viewport!: SVGGElement;
  #painted!: SVGGElement;
  #overlay!: SVGGElement;
  #gridRect!: SVGRectElement;
  #dots!: SVGPatternElement;
  #rail!: HTMLElement;
  #railArt!: SVGSVGElement;
  /** The in-place input a new Text is typed into, while it is open. */
  #text: TextSession | null = null;
  #note!: HTMLElement;
  #files!: HTMLUListElement;
  #newScene!: HTMLFormElement;
  #zoomLabel!: HTMLElement;
  #whereLabel!: HTMLElement;
  #modeLabel!: HTMLElement;
  #savedLabel!: HTMLElement;
  #menu!: HTMLElement;
  #roughButton!: HTMLButtonElement;
  #palette!: CommandPalette;

  /**
   * What the action registry may ask of the editor, and the one place an action
   * becomes a change: the palette and the keys both run through here.
   */
  readonly #host: ActionHost = {
    pickTool: (tool) => this.#setTool(tool),
    deleteSelection: () => this.#deleteSelected(),
    duplicateSelection: () => this.#duplicate(),
    copySelection: () => this.#copySelection(),
    cutSelection: () => this.#cutSelection(),
    paste: () => this.#pasteClipboard(),
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
    openFolder: () => void (this.#served ? this.#showNote() : this.#openFolder()),
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
  }

  connectedCallback(): void {
    if (this.#canvas !== undefined) {
      // Back on the page: the listeners left with it the last time, and an
      // editor that never got as far as drawing tries its connection again.
      if (this.#ready) {
        this.#listen();
      } else {
        void this.#connect(++this.#generation);
      }
      return;
    }
    this.innerHTML = SHELL;
    this.#canvas = this.querySelector('.canvas')!;
    this.#viewport = this.querySelector('.viewport')!;
    this.#painted = this.querySelector('.painted')!;
    this.#overlay = this.querySelector('.overlay')!;
    this.#gridRect = this.querySelector('.grid-rect')!;
    this.#dots = this.querySelector('.canvas pattern')!;
    this.#rail = this.querySelector('.rail')!;
    this.#railArt = this.querySelector('.rail-art')!;
    this.#note = this.querySelector('.note')!;
    this.#files = this.querySelector('.files')!;
    this.#newScene = this.querySelector('.new')!;
    this.#zoomLabel = this.querySelector('.zoom')!;
    this.#whereLabel = this.querySelector('.where')!;
    this.#modeLabel = this.querySelector('.mode')!;
    this.#savedLabel = this.querySelector('.saved')!;
    this.#menu = this.querySelector('.style-note')!;
    this.#roughButton = this.querySelector('[data-act="roughness"]')!;
    this.#palette = new CommandPalette({
      root: this.querySelector('.palette')!,
      state: () => this.#actionState(),
      run: (action) => void action.run(this.#host),
      // The palette is a detour, not a place: shutting it puts the person back
      // on the canvas, where the keys and the pointer already belong.
      closed: () => this.#canvas.focus(),
    });

    // Each instance's Grid is its own pattern: two editors on one page would
    // otherwise share the first one's dots at the first one's zoom.
    const dots = `esbozo-dots-${++instances}`;
    this.#dots.id = dots;
    this.#gridRect.setAttribute('fill', `url(#${dots})`);

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
    void this.#connect(++this.#generation);
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
    this.#canvas.addEventListener('pointerdown', this.#onPointerDown);
    this.#canvas.addEventListener('pointermove', this.#onPointerMove);
    this.#canvas.addEventListener('pointerup', this.#onPointerUp);
    this.#canvas.addEventListener('pointercancel', this.#onPointerCancel);
    this.#canvas.addEventListener('wheel', this.#onWheel, { passive: false });
    this.#canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.#rail.addEventListener('click', this.#onRailClick);
    this.querySelector('.status')!.addEventListener('click', this.#onStatusClick);
    document.addEventListener('copy', this.#onCopy);
    document.addEventListener('cut', this.#onCut);
    document.addEventListener('paste', this.#onPaste);
    this.#newScene.addEventListener('submit', this.#onNewScene);
    this.#files.addEventListener('click', this.#onFileClick);
    this.#menu.addEventListener('click', this.#onMenuClick);
    document.addEventListener('keydown', this.#onKeyDown);
    document.addEventListener('keyup', this.#onKeyUp);
    // A Space held while the page loses the focus never sends its release: the
    // pan has to end here, or the pointer stays a hand on the way back.
    document.addEventListener('visibilitychange', this.#endSpacePan);
    window.addEventListener('blur', this.#endSpacePan);
    window.addEventListener('resize', this.#onResize);

    requestAnimationFrame(() => this.#drawRailArt());
  }

  disconnectedCallback(): void {
    this.#canvas?.removeEventListener('pointerdown', this.#onPointerDown);
    this.#canvas?.removeEventListener('pointermove', this.#onPointerMove);
    this.#canvas?.removeEventListener('pointerup', this.#onPointerUp);
    this.#canvas?.removeEventListener('pointercancel', this.#onPointerCancel);
    this.#canvas?.removeEventListener('wheel', this.#onWheel);
    document.removeEventListener('copy', this.#onCopy);
    document.removeEventListener('cut', this.#onCut);
    document.removeEventListener('paste', this.#onPaste);
    document.removeEventListener('keydown', this.#onKeyDown);
    document.removeEventListener('keyup', this.#onKeyUp);
    document.removeEventListener('visibilitychange', this.#endSpacePan);
    this.#rail.removeEventListener('click', this.#onRailClick);
    this.querySelector('.status')?.removeEventListener('click', this.#onStatusClick);
    this.#newScene.removeEventListener('submit', this.#onNewScene);
    this.#files.removeEventListener('click', this.#onFileClick);
    this.removeEventListener('pointerdown', this.#takeFocus);
    this.removeEventListener('focusin', this.#onFocusIn);
    this.removeEventListener('focusout', this.#onFocusOut);
    window.removeEventListener('resize', this.#onResize);
    window.removeEventListener('blur', this.#endSpacePan);
    this.#wired = false;
    if (active === this) {
      active = null;
    }
  }

  /**
   * Bring the element up on the attributes it names now: read the page's font,
   * then join the folder and open the Scene it holds. The first connect runs
   * this, and so does every change of `scene` or `save`.
   */
  async #connect(generation: number): Promise<void> {
    const font = await this.#fontOf();
    if (generation !== this.#generation) {
      return;
    }
    if (!font.ok) {
      this.#setSaved('failed', font.problem);
      return;
    }
    // The face and the metrics read from it are installed together, so a font
    // that arrived late never draws words it did not measure.
    font.face?.();
    this.#layout = font.layout;
    this.#ready = true;
    this.#listen();
    this.#showDefaultRoughness();
    this.#paintedFor = null;
    this.#view = fittedView(this.#scene, this.#viewportSize(), this.#layout);
    this.#paint();
    await this.#joinFolder(generation);
  }

  /** Read the page's font again and draw the Scene in hand in it: a font that
   * will not load leaves the face and the metrics that did. */
  async #measureFont(generation: number): Promise<void> {
    const font = await this.#fontOf();
    if (generation !== this.#generation) {
      return;
    }
    if (!font.ok) {
      this.#setSaved('failed', font.problem);
      return;
    }
    font.face?.();
    this.#layout = font.layout;
    this.#paintedFor = null;
    this.#view = fittedView(this.#scene, this.#viewportSize(), this.#layout);
    this.#paint();
    if (this.#target === null) {
      // The font changed before the Scene it names was open, so this connection
      // is still on its way, and this is the font it gets.
      await this.#joinFolder(generation);
    }
  }

  /** The page's font, with a source that will not answer reported as the problem it is. */
  async #fontOf(): Promise<PageFont> {
    try {
      return await this.#fonts(this);
    } catch (error) {
      return { ok: false, problem: (error as Error).message };
    }
  }

  /**
   * An attribute changed under a running editor. `font` is only the font, and
   * the Scene in hand stays. `scene` and `save` are another instance of the
   * element, so the connection in hand is dropped first.
   */
  attributeChangedCallback(name: string): void {
    const generation = ++this.#generation;
    if (this.#canvas === undefined) {
      // Attributes written before the element was connected: nothing to drop,
      // and `connectedCallback` brings it up on them.
      return;
    }
    if (name === 'font' && this.#ready) {
      void this.#measureFont(generation);
      return;
    }
    if (name !== 'font') {
      this.#rebuild();
    }
    void this.#connect(generation);
  }

  /**
   * Let go of the connection in hand: half a gesture, half-typed words, the tool
   * armed for the Scene it held, its selection, its history and its writes. The
   * read still on its way is dropped where it lands.
   */
  #rebuild(): void {
    this.#drag = null;
    this.#endEdits();
    this.#scene = emptyScene();
    this.#selected = [];
    this.#target = null;
    this.#browsed = null;
    this.#refused = false;
    this.#history.reset(serialiseScene(this.#scene));
    this.#saveQueue = Promise.resolve();
    this.#menu.hidden = true;
    this.#note.hidden = true;
    this.#whereLabel.textContent = '';
    this.#setSaved('idle');
    this.#paint();
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
      this.#endSpacePan();
    }
  };

  /**
   * Join the folder the page hands this element: `ez serve`'s, or the single
   * Scene its attributes name. It lists what it holds and opens the first. A
   * static page gets `null` and keeps its Open folder button.
   */
  async #joinFolder(generation: number): Promise<void> {
    let folder: SceneFolder | null;
    try {
      folder = await this.#folder(this);
    } catch (error) {
      if (generation === this.#generation) {
        this.#setSaved('failed', (error as Error).message);
      }
      return;
    }
    if (generation !== this.#generation) {
      return;
    }
    if (folder === null) {
      // A page with no folder to join keeps its picker, and has nothing to open.
      return;
    }
    this.#served = true;
    this.#browsed = folder;
    this.querySelector('[data-act="open"]')!.textContent = 'Scenes';
    this.#showMode(folder);
    let names: string[];
    try {
      names = await folder.listScenes();
    } catch (error) {
      if (generation === this.#generation) {
        this.#setSaved('failed', (error as Error).message);
      }
      return;
    }
    if (generation !== this.#generation) {
      return;
    }
    // A folder of Scenes opens its first; the bundle's folder holds the one
    // Scene its attributes name, so that is the one it opens.
    const first = names[0];
    if (first === undefined) {
      await this.#showNote();
      return;
    }
    await this.#openScene(first, generation);
  }

  /** The status bar's word for what this page may do with the Scene. */
  #showMode(folder: SceneFolder): void {
    const readOnly = folder.readOnly || this.#refused;
    this.#modeLabel.textContent = readOnly ? 'read-only' : '';
    this.#newScene.hidden = readOnly;
    if (readOnly) {
      // Write access just ended: nothing stays armed that could change a Scene
      // this page may only read.
      this.#endEdits();
    }
  }

  /** Let go of every edit in flight: half-typed words, and the tool in hand. */
  #endEdits(): void {
    this.#text?.cancel();
    this.#text = null;
    if (this.#tool !== 'select') {
      this.#setTool('select');
    }
  }

  /**
   * Whether this page may change the Scene at all. Every Scene change asks
   * this one question, so read-only is one rule and not one per tool.
   */
  #writable(): boolean {
    const target = this.#target;
    return target !== null && !target.folder.readOnly && !this.#refused;
  }

  /** Ask for a folder and list the Scenes in it, without moving the save target. */
  async #openFolder(): Promise<void> {
    try {
      const folder = await pickFolder();
      if (folder === null) {
        return;
      }
      this.#browsed = folder;
      await this.#showNote();
    } catch (error) {
      this.#setSaved('failed', (error as Error).message);
    }
  }

  /**
   * Open a Scene by name. Writes the current Scene already queued land first,
   * so a reopen reads the edit it just made instead of the bytes before it. A
   * file that is not there is a Scene nobody has drawn yet: it opens empty and
   * says so, and the first edit is what writes it — unless a person asked for
   * it by name, which makes it a Scene there and then. A Scene that will not
   * load leaves nothing writable, so a failed open is never a write.
   *
   * A read is bound to the connection that asked for it: an answer for a Scene
   * the page has moved away from is dropped, not drawn.
   */
  async #openScene(
    name: string,
    generation = this.#generation,
    options: { create?: boolean } = {},
  ): Promise<void> {
    const folder = this.#browsed;
    if (folder === null) {
      this.#setSaved('failed', 'open a folder first');
      return;
    }
    await this.#saveQueue;
    if (generation !== this.#generation) {
      return;
    }
    let source: string | null;
    try {
      source = await folder.read(name);
    } catch (error) {
      if (generation !== this.#generation) {
        return;
      }
      this.#target = null;
      this.#setSaved('failed', `cannot read ${name}: ${(error as Error).message}`);
      return;
    }
    if (generation !== this.#generation) {
      return;
    }
    if (source === null) {
      this.#load(emptyScene(stemOf(name)), { folder, name });
      if (options.create === true) {
        // A person asked for this name, so it is a Scene now, SVG and all. Only
        // a 404 the page did not ask for waits for its first edit.
        await this.#save();
        return;
      }
      this.#setSaved('new');
      return;
    }
    const parsed = parseScene(source);
    if (!parsed.ok) {
      const first = parsed.problems[0];
      const where = first === undefined ? '' : first.elementId === null ? '' : `${first.elementId}: `;
      const message = first === undefined ? 'invalid Scene' : `${where}${first.message}`;
      this.#target = null;
      this.#setSaved('failed', `${name}: ${message}`);
      return;
    }
    this.#load(parsed.scene, { folder, name });
    // A read-only folder saved nothing: the status bar says only that.
    this.#setSaved(folder.readOnly ? 'idle' : 'saved');
  }

  /**
   * Write the Scene and the SVG beside it, to the Scene they were made for.
   *
   * The destination is fixed here, when the write is queued: a `save` or a
   * `scene` that changes afterwards is another connection, and a write already
   * queued is a person's edit to *this* Scene, so it goes where it was made and
   * never to a URL the page names later. Writes land in order, and the status
   * says `saved` only for the newest one, so it never claims a Scene that a
   * newer edit has overtaken.
   */
  async #save(): Promise<void> {
    const target = this.#target;
    if (target === null || target.folder.readOnly || this.#refused) {
      // Nothing is open, or this page may only read: nothing is sent.
      return;
    }
    const sceneSource = serialiseScene(this.#scene);
    const svgSource = renderScene(this.#scene, this.#layout);
    this.#setSaved('saving');
    const writing = this.#saveQueue.then(() => this.#write(target, sceneSource, svgSource));
    this.#saveQueue = writing;
    if (await writing && this.#saveQueue === writing) {
      this.#setSaved('saved');
    }
  }

  /**
   * One write, to the Scene it was queued for. Its answer speaks for this page
   * only: the destination has to be the Scene in hand now, or it is an old
   * connection's answer and changes nothing — no `403` made read-only here, no
   * words about a Scene the page has moved away from.
   */
  async #write(target: SaveTarget, sceneSource: string, svgSource: string): Promise<boolean> {
    if (this.#refused || target.folder.readOnly) {
      // A refusal, or write access that ended, stops the writes already queued
      // behind it: a page that may only read does not ask again per edit.
      return false;
    }
    try {
      await target.folder.write(target.name, sceneSource, svgSource);
      return true;
    } catch (error) {
      if (this.#target !== target) {
        return false;
      }
      if ((error as { status?: unknown }).status === 403) {
        // The server says this page may only read: it stops writing, and stops
        // every edit, rather than trying again per change.
        this.#refused = true;
        this.#showMode(target.folder);
      }
      this.#setSaved('failed', (error as Error).message);
      return false;
    }
  }

  /** Toggle the dot Grid, as `G` does. */
  #toggleGrid(): void {
    this.#grid = !this.#grid;
    this.querySelector('[data-act="grid"]')!.setAttribute('aria-pressed', String(this.#grid));
    this.#paint();
  }

  #load(scene: Scene, target: SaveTarget): void {
    this.#scene = scene;
    this.#target = target;
    this.#selected = [];
    this.#paintedFor = null;
    this.#history.reset(serialiseScene(scene));
    this.#menuFor = null;
    this.#view = fittedView(scene, this.#viewportSize(), this.#layout);
    this.#whereLabel.textContent = `${target.folder.name} / ${target.name}`;
    this.#note.hidden = true;
    // Another Scene: the tool in hand and the words half-typed into the last
    // one belong to that one, not this.
    this.#endEdits();
    this.#refresh();
  }

  #selectedElements(): SceneElement[] {
    const selected = new Set(this.#selected);
    return this.#shownElements().filter((element) => selected.has(element.id));
  }

  /**
   * The Scene as the page shows it: committed Elements plus the gesture in
   * flight. Never the Scene that is saved, so half a drag can never be a step.
   */
  #shownElements(): SceneElement[] {
    const drag = this.#drag;
    if (drag === null) {
      return this.#scene.elements;
    }
    if (drag.kind === 'draw') {
      return [...this.#scene.elements, drag.preview];
    }
    if (drag.kind === 'move') {
      return this.#scene.elements.map((element) => drag.shown.get(element.id) ?? element);
    }
    if (drag.kind === 'resize') {
      return this.#scene.elements.map((element) => (element.id === drag.id ? drag.shown : element));
    }
    return this.#scene.elements;
  }

  /** The Scene as the page shows it, gesture included. */
  #shownScene(): Scene {
    const elements = this.#shownElements();
    return elements === this.#scene.elements ? this.#scene : { ...this.#scene, elements };
  }

  /** Whether a gesture that changes the Scene is in flight, so an edit waits for the pointer. */
  #gestureHoldsScene(): boolean {
    const drag = this.#drag;
    return drag !== null && (drag.kind === 'draw' || drag.kind === 'move' || drag.kind === 'resize');
  }

  /**
   * One history step, with the autosave every change gets. A change that left
   * the Scene as it was records nothing and writes nothing, so a plain click on
   * an Element never touches the disk.
   */
  #record(amend = false): void {
    const after = serialiseScene(this.#scene);
    const changed = amend ? this.#history.amend(after) : this.#history.record(after);
    if (!amend) {
      this.#nudgedAt = 0;
    }
    if (changed) {
      void this.#save();
    }
  }

  /**
   * A Scene taken back from the history is the Scene to save, so undo autosaves
   * too. The read-only gate comes before the step is taken, so a page that may
   * only read never consumes a step it cannot show.
   */
  #restore(step: () => string | null): void {
    if (!this.#writable()) {
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
    this.#paintedFor = null;
    this.#nudgedAt = 0;
    this.#paint();
    void this.#save();
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
    if (active !== this || !this.#takesKeys(event.target) || this.#gestureHoldsScene()) {
      return;
    }
    if (this.#copyTo(event.clipboardData)) {
      event.preventDefault();
    }
  };

  /** The selected Elements as the text a clipboard event carries, or false when there is none. */
  #copyTo(data: DataTransfer | null): boolean {
    const selected = this.#selectedElements();
    if (selected.length === 0 || data === null) {
      return false;
    }
    data.setData('text/plain', serialiseFragment(this.#scene, selected));
    return true;
  }

  /** Paste Scene JSON text from the clipboard, with new ids, offset off what is here. */
  #onPaste = (event: ClipboardEvent): void => {
    if (active !== this || !this.#takesKeys(event.target) || this.#gestureHoldsScene()) {
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
    if (active !== this || !this.#takesKeys(event.target) || this.#gestureHoldsScene()) {
      return;
    }
    if (this.#copyTo(event.clipboardData)) {
      event.preventDefault();
      this.#deleteSelected();
    }
  };

  /**
   * Copy for a named action: the palette has no copy event to carry the data,
   * so it writes the same Scene text the event would. A page without the async
   * Clipboard API — a non-secure origin — says so instead of doing nothing.
   */
  async #copySelection(): Promise<void> {
    const clipboard = clipboardApi();
    if (clipboard === null) {
      this.#setSaved('failed', 'this page cannot use the clipboard: press ⌘C');
      return;
    }
    try {
      await clipboard.writeText(serialiseFragment(this.#scene, this.#selectedElements()));
    } catch (error) {
      this.#setSaved('failed', `cannot copy: ${(error as Error).message}`);
    }
  }

  /**
   * Cut for a named action: the same text Copy writes, then the one delete
   * step. The write is awaited, and the page keeps taking edits while it runs,
   * so what may be deleted is decided after it lands: exactly the ids that were
   * copied, and none of them when the Scene is no longer the one they came from.
   */
  async #cutSelection(): Promise<void> {
    const clipboard = clipboardApi();
    if (clipboard === null) {
      this.#setSaved('failed', 'this page cannot use the clipboard: press ⌘X');
      return;
    }
    const selected = this.#selectedElements();
    if (selected.length === 0) {
      return;
    }
    const copied = new Set(selected.map((element) => element.id));
    const before = serialiseScene(this.#scene);
    try {
      await clipboard.writeText(serialiseFragment(this.#scene, selected));
    } catch (error) {
      this.#setSaved('failed', `cannot cut: ${(error as Error).message}`);
      return;
    }
    if (serialiseScene(this.#scene) !== before) {
      this.#setSaved('failed', 'the Scene changed during the cut, so nothing was deleted');
      return;
    }
    this.#remove(copied);
  }

  /** Paste for a named action: the clipboard, read on the spot, with new ids. */
  async #pasteClipboard(): Promise<void> {
    const clipboard = clipboardApi();
    if (clipboard === null) {
      this.#setSaved('failed', 'this page cannot use the clipboard: press ⌘V');
      return;
    }
    let text: string;
    try {
      text = await clipboard.readText();
    } catch (error) {
      this.#setSaved('failed', `cannot paste: ${(error as Error).message}`);
      return;
    }
    this.#insertCopies(parseFragment(text, this.#scene.defaults) ?? []);
  }

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
    const file = this.#target?.name ?? `${this.#scene.title}.json`;
    try {
      await exportPng({
        scene: this.#scene,
        theme,
        layout: this.#layout,
        family: this.#family,
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
      folder: this.#served || canPickFolder(),
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
    const box = boxOf(elements, byId, this.#layout);
    const offset =
      box === null
        ? COPY_OFFSET
        : landingOffset(box, this.#view, this.#viewportSize(), COPY_OFFSET);
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
    if (tool !== 'select' && !this.#writable()) {
      return;
    }
    this.#tool = tool;
    this.#canvas.classList.toggle('pen', tool !== 'select' && !this.#spaceDown);
    for (const button of this.#rail.querySelectorAll('[data-tool]')) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-tool') === tool));
    }
    if (tool !== 'select') {
      // Handles and a dashed selection box under the pencil only get in the way.
      this.#selected = [];
    }
    this.#paint();
  }

  /**
   * The one way a Scene change lands: the changed Scene replaces the current
   * one, the page repaints and the edit autosaves as a single write and a
   * single history step. A change that leaves the Scene as it was writes
   * nothing.
   *
   * Read-only refuses here, before the Scene is touched, so no tool has to
   * remember the rule: every edit in this file — a draw, a drag, a nudge, a
   * paste, a style pick, an Arrange move — arrives through this call, and none
   * of them can change a page that may only read.
   */
  #applyScene(
    next: Scene,
    options: { amend?: boolean; select?: readonly string[]; room?: boolean } = {},
  ): void {
    if (!this.#writable()) {
      return;
    }
    const changed = serialiseScene(next) !== serialiseScene(this.#scene);
    const { select } = options;
    if (changed) {
      this.#scene = next;
    }
    if (select !== undefined) {
      this.#selected = [...select];
    }
    // A gesture that put the selection where a person meant it may leave the
    // viewing room in the note's way, so the view makes room; a drawn or pasted
    // Element leaves the view where the person put the pointer.
    if (options.room === true) {
      this.#refresh();
    } else {
      this.#paint();
    }
    if (changed) {
      this.#record(options.amend === true);
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
    }, { room: true });
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
        return elementBounds(element, byId, this.#layout);
      }),
    }, { room: true });
  }

  // ------------------------------------------------------------------ painting

  /**
   * A change of selection or of what the selection holds: the note follows it,
   * the view makes room for the note, and the page repaints. Both happen outside
   * the paint, so a redraw can never move the view under the pointer.
   */
  #refresh(): void {
    this.#syncMenu();
    this.#clearOfMenu();
    this.#paint();
  }

  /**
   * Pan, zoom and the Grid follow the pointer at once, because they are only
   * numbers the view group already carries. Repainting the Scene is what costs,
   * so that waits for the next frame.
   */
  #paint(): void {
    this.#applyView();
    if (this.#paintQueued) {
      return;
    }
    this.#paintQueued = true;
    requestAnimationFrame(() => {
      this.#paintQueued = false;
      this.#drawScene();
      this.#drawOverlay();
    });
  }

  /**
   * A view change the person asked for — a wheel, a key zoom or a fit. It still
   * has to leave the selection clear of the note, and any zoom can put it back
   * under, so the clearance runs before the paint: no frame shows it covered.
   */
  #changedView(view: View): void {
    this.#view = view;
    this.#clearOfMenu();
    this.#paint();
  }

  #applyView(): void {
    const { zoom, panX, panY } = this.#view;
    this.#viewport.setAttribute('transform', `translate(${panX} ${panY}) scale(${zoom})`);
    this.#zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    this.#drawGrid();
  }

  /** The dot Grid stays the same size on screen at every zoom. */
  #drawGrid(): void {
    this.#gridRect.style.display = this.#grid ? '' : 'none';
    this.#dots.setAttribute('width', String(DOT_SPACING / this.#view.zoom));
    this.#dots.setAttribute('height', String(DOT_SPACING / this.#view.zoom));
    this.#dots.firstElementChild?.setAttribute('r', String(DOT_RADIUS / this.#view.zoom));
  }

  /**
   * Paint the Scene with the Renderer. Its SVG nests inside the viewport, so the
   * Scene keeps the exact look `ez render` gives it, and the elements stay in
   * Scene coordinates while the viewport pans and zooms.
   */
  #drawScene(): void {
    const shown = this.#shownScene();
    const key = serialiseScene(shown);
    if (key === this.#paintedFor) {
      return;
    }
    this.#paintedFor = key;
    const document_ = new DOMParser().parseFromString(
      renderScene(shown, this.#layout),
      'image/svg+xml',
    );
    const root = document_.documentElement;
    if (root.nodeName !== 'svg') {
      throw new Error('the Renderer did not return an SVG document');
    }
    const page = viewBoxOf(root);
    root.setAttribute('x', String(page.x));
    root.setAttribute('y', String(page.y));
    root.setAttribute('width', String(page.width));
    root.setAttribute('height', String(page.height));
    root.setAttribute('overflow', 'visible');
    this.#painted.replaceChildren(document.importNode(root, true));
  }

  #drawOverlay(): void {
    const overlay = this.#overlay;
    overlay.replaceChildren();
    const selected = this.#selectedElements();
    const first = selected[0];
    const box = boxOf(selected, elementsById(this.#shownElements()), this.#layout);
    if (box !== null) {
      const padding = SELECTION_PADDING / this.#view.zoom;
      this.#appendRect(overlay, {
        x: box.x - padding,
        y: box.y - padding,
        width: box.width + padding * 2,
        height: box.height + padding * 2,
        class: 'selection',
      });
      if (selected.length === 1 && first !== undefined && isOutlined(first)) {
        // The handles ride the outline, not the ink: a Label that overflows its
        // Element draws outside the box a resize is allowed to move.
        const outline = outlineBox(first);
        for (const handle of HANDLES) {
          const point = handlePoint(outline, handle);
          const size = HANDLE_SIZE / this.#view.zoom;
          const node = this.#appendRect(overlay, {
            x: point.x - size / 2,
            y: point.y - size / 2,
            width: size,
            height: size,
            class: `handle handle-${handle}`,
          });
          node.setAttribute('data-handle', handle);
          node.setAttribute('data-element', first.id);
        }
      }
    }
    const drag = this.#drag;
    if (drag !== null && drag.kind === 'box') {
      const swept = boxBetween(drag.from, drag.to);
      this.#appendRect(overlay, { ...swept, class: 'sweep' });
    }
  }

  #appendRect(
    parent: SVGGElement,
    attributes: { x: number; y: number; width: number; height: number; class: string },
  ): SVGRectElement {
    const node = document.createElementNS(SVG_NS, 'rect');
    node.setAttribute('x', String(attributes.x));
    node.setAttribute('y', String(attributes.y));
    node.setAttribute('width', String(Math.max(attributes.width, 0)));
    node.setAttribute('height', String(Math.max(attributes.height, 0)));
    node.setAttribute('class', attributes.class);
    node.setAttribute('vector-effect', 'non-scaling-stroke');
    parent.append(node);
    return node;
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

  /**
   * The note is docked to the right edge and must never sit on what it edits.
   * One rectangle policy does it: the view pans left just far enough, and zooms
   * out just far enough when a pan cannot clear a wide selection. Panning waits
   * for the end of a drag, because moving the view out from under the pointer
   * mid-drag would make the Element chase it.
   */
  #clearOfMenu(): void {
    if (this.#drag !== null || this.#menu.hidden) {
      return;
    }
    const canvas = this.#canvas.getBoundingClientRect();
    const note = this.#menu.getBoundingClientRect();
    const selected = this.#selectedElements();
    this.#view = clearedView(this.#view, {
      selection: boxOf(selected, elementsById(this.#scene.elements), this.#layout),
      note: {
        x: note.left - canvas.left,
        y: note.top - canvas.top,
        width: note.width,
        height: note.height,
      },
      left: this.#rail.getBoundingClientRect().right - canvas.left + MENU_GAP,
      gap: MENU_GAP,
    });
  }

  // ------------------------------------------------------------------ pointer

  #viewportSize(): { width: number; height: number } {
    const rect = this.#canvas.getBoundingClientRect();
    return { width: rect.width || window.innerWidth, height: rect.height || window.innerHeight };
  }

  #scenePoint(event: { clientX: number; clientY: number }): Point {
    const rect = this.#canvas.getBoundingClientRect();
    return toScene(this.#view, event.clientX - rect.left, event.clientY - rect.top);
  }

  #screenPoint(event: { clientX: number; clientY: number }): Point {
    const rect = this.#canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    if (this.#text !== null) {
      // The click that takes the focus off the words commits them, and goes no
      // further: it is not also a click on the canvas.
      this.#text.finish();
      return;
    }
    this.#canvas.setPointerCapture(event.pointerId);
    const target = event.target as Element | null;
    if (this.#spaceDown || event.button === 1) {
      this.#drag = { kind: 'pan', fromScreen: this.#screenPoint(event), start: { ...this.#view } };
      this.#canvas.classList.add('panning');
      return;
    }
    const tool = this.#tool;
    if (tool !== 'select') {
      this.#startDrawing(tool, this.#scenePoint(event));
      return;
    }
    // A read-only page still selects, sweeps and pans; it just cannot change
    // the Scene, so a press never starts a drag that would.
    const editing = this.#writable();
    const handle = editing ? (target?.closest('[data-handle]') ?? null) : null;
    if (handle !== null) {
      const id = handle.getAttribute('data-element') ?? '';
      const element = this.#scene.elements.find((candidate) => candidate.id === id);
      if (element !== undefined && isOutlined(element)) {
        this.#drag = {
          kind: 'resize',
          id,
          handle: handle.getAttribute('data-handle') as Handle,
          origin: outlineBox(element),
          from: this.#scenePoint(event),
          shown: element,
        };
        return;
      }
    }

    const point = this.#scenePoint(event);
    const hit = elementAt(
      this.#scene.elements,
      point,
      PICK_TOLERANCE / this.#view.zoom,
      this.#layout,
    );
    if (hit !== null) {
      if (event.shiftKey) {
        this.#selected = this.#selected.includes(hit.id)
          ? this.#selected.filter((id) => id !== hit.id)
          : [...this.#selected, hit.id];
      } else if (!this.#selected.includes(hit.id)) {
        this.#selected = [hit.id];
      }
      if (editing) {
        const origins = new Map(this.#selectedElements().map((element) => [element.id, element]));
        this.#drag = { kind: 'move', from: point, origins, shown: new Map() };
      }
      this.#refresh();
      return;
    }

    if (!event.shiftKey) {
      this.#selected = [];
    }
    this.#drag = { kind: 'box', from: point, to: point, additive: event.shiftKey };
    this.#refresh();
  };

  /**
   * A drawing tool is in hand: the press starts a preview Element, and every
   * move reshapes it until the release settles it into the Scene.
   */
  #startDrawing(tool: DrawingTool, point: Point): void {
    if (tool === 'text') {
      // Opened on the release, not the press: the press's own default action
      // would take the focus straight back off the input.
      this.#drag = { kind: 'text', at: point };
      return;
    }
    const id = freshId(tool, idsOf(this.#scene.elements));
    this.#selected = [id];
    this.#drag = {
      kind: 'draw',
      tool,
      id,
      from: point,
      to: point,
      preview: drawn(tool, point, point, id, this.#scene.defaults),
    };
    this.#paint();
  }

  /**
   * The release settles a draw: a gesture keeps the box or stroke it swept, a
   * plain click draws the default box, and a click with a stroke tool draws
   * nothing, because a stroke with no length cannot be seen. The tool then goes
   * back to Select, so one tool draws one Element.
   */
  #finishDrawing(drag: Extract<Drag, { kind: 'draw' }>): void {
    const placed = isClick(drag.from, drag.to)
      ? drawnAtClick(drag.tool, drag.from, drag.id, this.#scene.defaults)
      : drag.preview;
    this.#setTool('select');
    if (placed === null) {
      this.#selected = [];
      this.#paint();
      return;
    }
    this.#applyScene(
      { ...this.#scene, elements: [...this.#scene.elements, placed] },
      { select: [drag.id] },
    );
  }

  /** A Text is placed: the words are typed where the Text will sit. */
  #openTextInput(at: Point): void {
    this.#setTool('select');
    this.#text = new TextSession({
      host: this,
      place: {
        page: toPage(this.#view, at),
        zoom: this.#view.zoom,
        fontSize: fontSizePx(this.#scene.defaults.fontSize),
      },
      commit: (content) => this.#commitText(at, content),
    });
  }

  /**
   * Commit the in-place input's words: a Text with words in them, or nothing.
   *
   * The Text goes through the Scene module's own validation before it is
   * recorded, so words a Scene file could not hold never reach disk. A refusal
   * says why in the status line and leaves the Scene exactly as it was.
   */
  #commitText(at: Point, content: string): void {
    this.#text = null;
    if (content === '') {
      return;
    }
    const element = newText(at, content, freshId('text', idsOf(this.#scene.elements)), this.#scene.defaults);
    const parsed = parseScene(
      serialiseScene({ ...this.#scene, elements: [...this.#scene.elements, element] }),
    );
    if (!parsed.ok) {
      const problem = parsed.problems[0];
      this.#setSaved('failed', problem === undefined ? 'the Scene cannot hold this Text' : problem.message);
      return;
    }
    this.#applyScene(parsed.scene, { select: [element.id] });
  }

  #onPointerMove = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (drag === null) {
      return;
    }
    if (drag.kind === 'pan') {
      const point = this.#screenPoint(event);
      this.#view = {
        zoom: drag.start.zoom,
        panX: drag.start.panX + (point.x - drag.fromScreen.x),
        panY: drag.start.panY + (point.y - drag.fromScreen.y),
      };
      this.#paint();
      return;
    }

    const point = this.#scenePoint(event);
    if (drag.kind === 'box') {
      drag.to = point;
      this.#paint();
      return;
    }
    if (drag.kind === 'draw') {
      drag.to = point;
      drag.preview = drawn(drag.tool, drag.from, point, drag.id, this.#scene.defaults);
      this.#paint();
      return;
    }
    if (drag.kind === 'text') {
      return;
    }
    const dx = point.x - drag.from.x;
    const dy = point.y - drag.from.y;
    if (drag.kind === 'move') {
      const shown = new Map<string, SceneElement>();
      for (const element of this.#scene.elements) {
        const origin = drag.origins.get(element.id);
        if (origin !== undefined) {
          shown.set(element.id, moved(origin, dx, dy));
        }
      }
      drag.shown = shown;
    } else {
      const element = this.#scene.elements.find((candidate) => candidate.id === drag.id);
      if (element === undefined) {
        return;
      }
      drag.shown = resized(element, resizedBox(drag.origin, drag.handle, dx, dy));
    }
    this.#paint();
  };

  #onPointerUp = (event: PointerEvent): void => {
    const drag = this.#drag;
    this.#canvas.classList.remove('panning');
    if (drag === null) {
      return;
    }
    if (this.#canvas.hasPointerCapture(event.pointerId)) {
      this.#canvas.releasePointerCapture(event.pointerId);
    }

    if (drag.kind === 'text') {
      this.#drag = null;
      this.#openTextInput(drag.at);
      return;
    }
    if (drag.kind === 'draw') {
      this.#drag = null;
      this.#finishDrawing(drag);
      return;
    }
    if (drag.kind === 'box') {
      this.#drag = null;
      const swept = boxBetween(drag.from, drag.to);
      const picked = elementsInBox(this.#scene.elements, swept, this.#layout).map(
        (element) => element.id,
      );
      this.#selected = drag.additive ? [...new Set([...this.#selected, ...picked])] : picked;
      this.#refresh();
      return;
    }
    if (drag.kind === 'move' || drag.kind === 'resize') {
      // The gesture is over: what the page showed becomes the Scene, as one step.
      const shown = this.#shownScene();
      this.#drag = null;
      // With the gesture settled the note may make room for where the selection
      // ended up, and the whole gesture is one history step.
      this.#applyScene(shown, { room: true });
      return;
    }
    this.#drag = null;
    this.#refresh();
  };

  /**
   * The browser took the pointer away: a touch became a scroll, or the window
   * was hidden mid-gesture. Only a finished gesture is a Scene, so nothing of
   * this one is recorded and nothing is saved; the preview it drew leaves the
   * page, and the pointer coming up later settles nothing.
   */
  #onPointerCancel = (event: PointerEvent): void => {
    const drag = this.#drag;
    this.#drag = null;
    this.#canvas.classList.remove('panning');
    if (this.#canvas.hasPointerCapture(event.pointerId)) {
      this.#canvas.releasePointerCapture(event.pointerId);
    }
    if (drag !== null && drag.kind === 'draw') {
      // The preview drew under an id the Scene never took.
      this.#selected = [];
    }
    this.#refresh();
  };

  #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const point = this.#screenPoint(event);
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
    this.#changedView(zoomedAt(this.#view, factor, point.x, point.y));
  };

  // ----------------------------------------------------------------- keyboard

  #onKeyDown = (event: KeyboardEvent): void => {
    if (active !== this || !this.#takesKeys(event.target)) {
      // The focus is the host page's, so Space and the arrows scroll it: an
      // embedded editor takes no key a person did not give it.
      return;
    }
    if (event.key === ' ' || event.code === 'Space') {
      if (!this.#spaceDown) {
        this.#spaceDown = true;
        this.#canvas.classList.add('hand');
        this.#canvas.classList.remove('pen');
      }
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
    if (this.#gestureHoldsScene()) {
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

  #onKeyUp = (event: KeyboardEvent): void => {
    if (active !== this) {
      return;
    }
    if (event.key === ' ' || event.code === 'Space') {
      this.#endSpacePan();
    }
  };

  /**
   * End a Space pan: the key came up, or the page lost the focus that held it.
   * A pan the pointer is still in the middle of ends here too, so a move after
   * the event cannot carry the view any further.
   */
  #endSpacePan = (): void => {
    if (this.#drag !== null && this.#drag.kind === 'pan') {
      this.#drag = null;
      this.#canvas.classList.remove('panning');
    }
    if (!this.#spaceDown) {
      return;
    }
    this.#spaceDown = false;
    this.#canvas.classList.remove('hand');
    this.#canvas.classList.toggle('pen', this.#tool !== 'select');
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
    const amend = Date.now() - this.#nudgedAt < NUDGE_BURST_MS;
    this.#applyScene(
      {
        ...this.#scene,
        elements: this.#scene.elements.map((element) =>
          selected.has(element.id) ? moved(element, dx, dy) : element,
        ),
      },
      { amend, room: true },
    );
    this.#nudgedAt = Date.now();
  }

  #zoomBy(factor: number): void {
    const size = this.#viewportSize();
    this.#changedView(zoomedAt(this.#view, factor, size.width / 2, size.height / 2));
  }

  /** Fit the page the Renderer draws into the window, the view an open Scene starts in. */
  #zoomToFit(): void {
    this.#changedView(fittedView(this.#scene, this.#viewportSize(), this.#layout));
  }

  /** One pixel per Scene unit, around the middle of the window: the plain view. */
  #resetZoom(): void {
    const size = this.#viewportSize();
    this.#changedView(zoomedAt(this.#view, 1 / this.#view.zoom, size.width / 2, size.height / 2));
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
      void (this.#served ? this.#showNote() : this.#openFolder());
    } else if (action === 'grid') {
      this.#toggleGrid();
    } else if (action === 'roughness') {
      this.#stepDefaultRoughness();
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
    this.#roughButton.textContent = roughnessNote(this.#scene.defaults.roughness);
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
    // An arrange button is a registry action with the same name and the same
    // rule, so the menu and the palette can never disagree about it.
    const action = actionById(button.dataset['act'] ?? '');
    if (action !== null) {
      void action.run(this.#host);
    }
  };

  #onNewScene = (event: Event): void => {
    event.preventDefault();
    const input = this.#newScene.querySelector('input')!;
    const name = normaliseSceneName(input.value);
    // Asked for by name, so it is a Scene now: Scene and SVG are written at
    // once, as the served and picked-folder editors always have.
    void this.#openScene(name, this.#generation, { create: true });
  };

  #onFileClick = (event: Event): void => {
    const button = (event.target as Element | null)?.closest('[data-file]') as HTMLElement | null;
    const name = button?.dataset['file'];
    if (name !== undefined) {
      void this.#openScene(name);
    }
  };

  /**
   * List the browsed folder's Scenes in the note. A name already typed in the
   * New form is left alone: a refresh of what the folder holds must not throw
   * away what the person is in the middle of naming.
   */
  async #showNote(): Promise<void> {
    const folder = this.#browsed;
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
 * What measures nothing, for the moment between connecting and reading the
 * page's font. Nothing is painted with it: the element starts drawing once it
 * has the measurement it draws with.
 */
function unmeasured(): Layout {
  const none: Metrics = { advance: () => 0, lineHeight: () => 0, inkCentre: () => 0 };
  return createLayout({ family: '', metrics: none });
}

/**
 * The async Clipboard API, when the page has one: a non-secure origin has none,
 * and the palette says to use the keys instead of offering a command that
 * cannot run. The cast keeps the check honest: the type says it is always there.
 */
function clipboardApi(): Clipboard | null {
  return (navigator as Navigator & { clipboard?: Clipboard }).clipboard ?? null;
}

/**
 * The page box the Renderer wrote into its SVG. Its `viewBox` is the only place
 * the page's size comes from: nothing here guesses one.
 */
function viewBoxOf(root: Element): { x: number; y: number; width: number; height: number } {
  const numbers = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const [x, y, width, height] = numbers;
  if (
    numbers.length !== 4 ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    !numbers.every(Number.isFinite)
  ) {
    throw new Error(`the Renderer's SVG has no usable viewBox: ${JSON.stringify(root.getAttribute('viewBox'))}`);
  }
  return { x, y, width, height };
}

/** A new Scene takes its title from the file name: `flow.json` opens as "flow". */
function stemOf(fileName: string): string {
  return sceneStem(fileName) || 'Scene';
}

function normaliseSceneName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return 'scene.json';
  }
  return /\.json$/i.test(trimmed) ? trimmed : `${trimmed}.json`;
}

/**
 * The measurement a page's editor runs on, or the reason it has none: the page
 * cannot place a Scene's words without the font's metrics, so it says so
 * instead of showing an editor that cannot draw. `face` puts the face those
 * metrics were read from into the page, called by the element that accepts the
 * measurement, so the drawing and the measuring arrive together.
 */
export type PageFont =
  | { ok: true; layout: Layout; family: string; face?: () => void }
  | { ok: false; problem: string };

/**
 * A page's measurement for one element. Consecutive elements are measured
 * separately, so two editors on one page can draw with two different fonts, and
 * a `font` attribute that changes is measured again.
 */
export type FontSource = (element: HTMLElement) => Promise<PageFont>;

/**
 * Where the editor finds a folder of Scenes when it connects. The served page
 * asks the save API (`servedFolder`); the bundle answers with the one Scene its
 * attributes name (`src/editor/scene-url.ts`). `null` means there is no folder
 * to join, so the page keeps its folder picker.
 */
export type FolderSource = (element: HTMLElement) => Promise<SceneFolder | null>;

/**
 * What a page configures about every element it makes. The bundle sets
 * `focusInside`, because an embedded editor is one box on someone else's page:
 * its keys and its clipboard are the page's until a person clicks into it.
 */
export interface EditorOptions {
  /** True when the keys and the clipboard belong to the element only while the focus is inside it. */
  readonly focusInside?: boolean;
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
