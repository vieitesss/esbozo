/**
 * `<esbozo-editor>`: the Scene editor.
 *
 * It holds the Scene, paints it with the Renderer and edits it with the pointer
 * and the keyboard. Every change saves the Scene and its SVG back to the folder
 * it was opened from: there is no unsaved state and no prompt. Browsing another
 * folder only changes what the Scenes note lists: the open Scene keeps its own
 * `{ folder, name }` destination.
 */
import { createLayout } from '../layout.js';
import type { Block, Layout, LineGlyphs, Metrics } from '../layout.js';
import { labelAtFor } from '../geometry.js';
import {
  drawnShaft,
  elementBounds,
  elementsById,
  labelInkBounds,
  outlineBox,
  shaftLabel,
} from '../renderer.js';
import {
  canonicalElement,
  emptyScene,
  isOutlined,
  hasXmlInvalidChars,
  parseFragment,
  parseScene,
  serialiseFragment,
  serialiseScene,
} from '../scene.js';
import type { Element as SceneElement, Scene, TextElement } from '../scene.js';
import {
  DEFAULT_SCENE_FILE_NAME,
  PRIMARY_SCENE_EXTENSION,
  sceneExtension,
  sceneStem,
} from '../paths.js';
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
import type { ElementTool } from './elements.js';
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
  caretLine,
  elementsInBox,
  fittedView,
  handlePoint,
  landingOffset,
  moved,
  pickAt,
  resized,
  resizedBox,
  toScene,
  unionOf,
  zoomedAt,
} from './geometry.js';
import type { Box, Handle, Point, View } from './geometry.js';
import { History } from './history.js';
import { railArt, railMarkup } from './rail.js';
import { attachedTo, endPoint, freedEnd, isShaft, otherEnd, released, targetAt, withEnd } from './snap.js';
import type { End } from './snap.js';
import { TextSession } from './text-session.js';
import type { LineKey, TextSessionState } from './text-session.js';
import { drawnBox, drawnGlyphs } from './drawn-glyphs.js';
import { keptWords, shownWords, withWords, wordAt, wordsOf, wordsShift } from './words.js';
import type { WordsShift } from './words.js';
import { PaintCache, sceneFile } from './paint.js';
import type { SceneFiles } from './paint.js';
import type { Paint } from './paint.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DOT_SPACING = 22;
const DOT_RADIUS = 1.1;
const SELECTION_PADDING = 5;
const HANDLE_SIZE = 8;
/** How far a Snap target's highlight stands off the target's outline, in screen pixels. */
const SNAP_GROW = 4;
/** How far the mark on a selected Label's words stands off the box they paint, in screen pixels. */
const LABEL_CUE_GAP = 2;
const NUDGE = 1;
const NUDGE_WITH_SHIFT = 10;
const ZOOM_STEP = 1.2;
/** How far off the ink a click still picks an arrow or line, in screen pixels. */
const PICK_TOLERANCE = 6;
/** How far off the drawn words a press is still a press in them, in screen pixels. */
const WORDS_TOLERANCE = 8;
/** How thick the rule under a preedit is, in screen pixels. */
const PREEDIT_RULE = 1.5;
/** How far a copy, a pasted Element or a duplicate lands from what it copies, in Scene units. */
const COPY_OFFSET = { x: 16, y: 16 };
/** Nudges closer together than this are one undo step: a held arrow key is one gesture. */
const NUDGE_BURST_MS = 800;
/** Breathing room between the Style menu and the selection it must not cover. */
const MENU_GAP = 16;
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
 * The instance the keys and the clipboard belong to: the last one a person
 * clicked or focused. Two editors on one page are two editors, so a nudge in
 * one is never a nudge in the other.
 */
let active: EsbozoEditorElement | null = null;

/** How many editors this page has made: each one's Grid is a pattern of its own. */
let instances = 0;

/** The frame that is already due: a save waits for it, so the task that asked ends first. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

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

const SHELL = `
<div class="board">
<div class="surface">
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
    </g>
    <g class="overlay"></g>
  </svg>
</div>
</div>
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
    <input name="name" placeholder="new-scene${PRIMARY_SCENE_EXTENSION}" aria-label="New Scene name" spellcheck="false" autocomplete="off" />
    <button type="submit">New</button>
  </form>
</div>
`;

class EsbozoEditorElement extends HTMLElement {
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
   * Which connection the element is on: a change of `scene` or `save` makes a
   * new one, and a read or a write that answers for an older number is dropped,
   * never drawn.
   */
  #connection = 0;
  /**
   * Which request for the page's font is the current one. It is a number of its
   * own, because a font is the drawing's, not the Scene's: a font that is slow,
   * or missing, never speaks for the Scene a connection is opening.
   */
  #fontRequest = 0;
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
  /** Whether this page can export a PNG: a PNG is the page's, and the bundle has none. */
  #pngExport = true;
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
  /** The writes in order; the number each answers with is whether it landed. */
  #saveQueue: Promise<unknown> = Promise.resolve();
  /** What the next frame owes the page: nothing yet, the words' own layer, or the whole page. */
  #paintQueued: 'none' | 'words' | 'page' = 'none';
  /**
   * Counts the Scene: every replacement of `#scene` makes a new number, and the
   * page repaints only when the number it painted is not this one. A pan, a
   * zoom or a new selection leaves the number alone, so a frame that only moved
   * the view costs no serialise at all.
   */
  #version = 0;
  /** The Scene number the page shows, gesture in flight included. */
  #paintedVersion = -1;
  /**
   * The words being typed that the last frame of the page drew. A caret that
   * moves asks for the words' layer alone, so the Scene is drawn again only when
   * the words it would draw are not the ones already on it.
   */
  #drawnWords: SceneElement | null = null;
  /** What the page shows now: the drawings, and the boxes the pointer reads. */
  #painted: Paint | null = null;
  /** The view the page was last moved to, so a frame that did not move it writes nothing. */
  #applied: View | null = null;
  /** The Element groups on the page, by id, with the key each was drawn from. */
  #groups = new Map<string, { key: string; node: SVGGElement }>();
  /** The id order the Element groups are in, so a reorder is one write. */
  #order: readonly string[] = [];
  /** The Elements a move has moved with a transform, so they can be put back. */
  #moved = new Set<string>();
  /** The Scene's own `svg`, inside `.painted`; every Element is one group under it. */
  #layer: SVGSVGElement | null = null;
  /** The drawings and the drawing of one Element at a time, kept between frames. */
  #paintables: PaintCache | null = null;
  /**
   * The measurement the Element groups on the page were drawn with. A font the
   * page names late moves the PaintCache's generation, and everything drawn
   * before it stops being the drawing this page makes.
   */
  #drawnMeasurement = -1;
  /** The selection the Style menu was built for, so a rebuild only happens on a change. */
  #menuFor: string | null = null;

  #board!: HTMLElement;
  #surface!: HTMLElement;
  #canvas!: SVGSVGElement;
  #paintedLayer!: SVGGElement;
  /**
   * The washes behind the words being typed, in the group that drew them: over
   * the Element's fill and under its glyphs, so a filled Element cannot cover
   * them and they cannot lift the ink of what was written.
   */
  #washes: SVGRectElement[] = [];
  #overlay!: SVGGElement;
  /**
   * The caret and the preedit's rule, in a layer of their own inside the overlay:
   * a caret that moves redraws these and leaves the boxes, the handles and the
   * overflow outline where the last frame put them.
   */
  #wordsLayer: SVGGElement | null = null;
  #gridRect!: SVGRectElement;
  #gridLayer!: SVGGElement;
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
    this.#pngExport = options.pngExport !== false;
  }

  connectedCallback(): void {
    if (this.#canvas !== undefined) {
      // Back on the page: the listeners left with it the last time, and an
      // editor that never got as far as drawing tries its connection again.
      if (this.#ready) {
        this.#listen();
      } else {
        void this.#connect(++this.#connection);
      }
      return;
    }
    this.innerHTML = SHELL;
    this.#board = this.querySelector('.board')!;
    this.#surface = this.querySelector('.surface')!;
    this.#canvas = this.querySelector('.canvas')!;
    this.#paintedLayer = this.querySelector('.painted')!;
    this.#overlay = this.querySelector('.overlay')!;
    this.#gridRect = this.querySelector('.grid-rect')!;
    this.#gridLayer = this.querySelector('.grid')!;
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
      // The canvas is where the keys belong, and the paper is already in
      // view: a focus that scrolls would move the Scene under the pointer.
      closed: () => this.#canvas.focus({ preventScroll: true }),
    });

    // Each instance's Grid is its own pattern: two editors on one page would
    // otherwise share the first one's dots at the first one's zoom.
    const dots = `esbozo-dots-${++instances}`;
    this.#dots.id = dots;
    this.#gridRect.setAttribute('fill', `url(#${dots})`);
    this.#showGrid();

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
    void this.#connect(++this.#connection);
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
    this.#board.addEventListener('pointerdown', this.#onPointerDown);
    this.#board.addEventListener('pointermove', this.#onPointerMove);
    this.#board.addEventListener('pointerup', this.#onPointerUp);
    this.#board.addEventListener('pointercancel', this.#onPointerCancel);
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
    this.#menu.addEventListener('click', this.#onMenuClickPress, true);
    this.#menu.addEventListener('pointerdown', this.#onMenuPress);
    document.addEventListener('keydown', this.#onKeyDown);
    document.addEventListener('keyup', this.#onKeyUp);
    // A Space held while the page loses the focus never sends its release: the
    // pan has to end here, or the pointer stays a hand on the way back.
    document.addEventListener('pointerdown', this.#onAnyPress);
    document.addEventListener('visibilitychange', this.#endGesture);
    window.addEventListener('blur', this.#endGesture);
    window.addEventListener('resize', this.#onResize);

    requestAnimationFrame(() => this.#drawRailArt());
  }

  disconnectedCallback(): void {
    this.#board?.removeEventListener('pointerdown', this.#onPointerDown);
    this.#board?.removeEventListener('pointermove', this.#onPointerMove);
    this.#board?.removeEventListener('pointerup', this.#onPointerUp);
    this.#board?.removeEventListener('pointercancel', this.#onPointerCancel);
    this.#board?.removeEventListener('wheel', this.#onWheel);
    document.removeEventListener('copy', this.#onCopy);
    document.removeEventListener('cut', this.#onCut);
    document.removeEventListener('paste', this.#onPaste);
    document.removeEventListener('keydown', this.#onKeyDown);
    document.removeEventListener('keyup', this.#onKeyUp);
    document.removeEventListener('pointerdown', this.#onAnyPress);
    document.removeEventListener('visibilitychange', this.#endGesture);
    this.#rail.removeEventListener('click', this.#onRailClick);
    this.#menu.removeEventListener('click', this.#onMenuClick);
    this.#menu.removeEventListener('click', this.#onMenuClickPress, true);
    this.#menu.removeEventListener('pointerdown', this.#onMenuPress);
    this.querySelector('.status')?.removeEventListener('click', this.#onStatusClick);
    this.#newScene.removeEventListener('submit', this.#onNewScene);
    this.#files.removeEventListener('click', this.#onFileClick);
    this.removeEventListener('pointerdown', this.#takeFocus);
    this.removeEventListener('focusin', this.#onFocusIn);
    this.removeEventListener('focusout', this.#onFocusOut);
    window.removeEventListener('resize', this.#onResize);
    window.removeEventListener('blur', this.#endGesture);
    // A page that takes the editor away takes the words with it: the field is a
    // child that left with the element, and no gesture of this pointer survives
    // the DOM it was pressed on.
    this.#endEdits();
    this.#releasePointer();
    this.#drag = null;
    this.#wired = false;
    if (active === this) {
      active = null;
    }
  }

  /**
   * Bring the element up on the attributes it names now: the page's font, then
   * the folder and the Scene it holds. The first connect runs this, and so does
   * every change of `scene` or `save`. A font already measured carries a new
   * connection at once, so a change of Scene never waits on the page's font.
   */
  async #connect(connection: number): Promise<void> {
    if (!this.#ready && !(await this.#readFont())) {
      // No measurement means nothing can be placed: the status line says why.
      return;
    }
    if (connection !== this.#connection) {
      return;
    }
    this.#showDefaultRoughness();
    this.#view = fittedView(this.#scene, this.#viewportSize(), this.#layout);
    this.#paint();
    await this.#joinFolder(connection);
  }

  /**
   * Read the page's font, and take it if it is still the font the page names. A
   * font that will not load leaves the face and the metrics that did, with the
   * reason in the status line: it is never a reason to let go of a Scene.
   */
  async #readFont(): Promise<boolean> {
    const request = ++this.#fontRequest;
    const font = await this.#fontOf();
    if (request !== this.#fontRequest) {
      // A newer request answers for this page: this one is not its font.
      return false;
    }
    if (!font.ok) {
      this.#setSaved('failed', font.problem);
      return false;
    }
    this.#adopt(font);
    return true;
  }

  /**
   * Take the measurement: the face those metrics were read from, the metrics,
   * and the editor listening and ready to draw. Nothing is painted here, so a
   * caller can fit the view first.
   */
  #adopt(font: { layout: Layout; face?: () => void }): void {
    font.face?.();
    this.#layout = font.layout;
    this.#ready = true;
    // Labels break with the measurement: what was drawn with the old one is not
    // the same drawing any more.
    this.#paintables?.measure(font.layout);
    this.#invalidate();
    this.#listen();
  }

  /** Draw the Scene in hand in the font the page names now: `font` alone, and
   * only the drawing. A font that will not load changes nothing at all. */
  async #measureFont(): Promise<void> {
    if (!(await this.#readFont())) {
      return;
    }
    this.#view = fittedView(this.#scene, this.#viewportSize(), this.#layout);
    this.#showDefaultRoughness();
    this.#paint();
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
    if (name === 'font' && this.#ready) {
      void this.#measureFont();
      return;
    }
    if (name !== 'font') {
      this.#rebuild();
    }
    void this.#connect(++this.#connection);
  }

  /**
   * Let go of the connection in hand: half a gesture, half-typed words, the tool
   * armed for the Scene it held, its selection, its history and its writes. The
   * read still on its way is dropped where it lands.
   */
  #rebuild(): void {
    this.#drag = null;
    this.#releasePointer();
    this.#endEdits();
    this.#replaceScene(emptyScene());
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
  async #joinFolder(connection: number): Promise<void> {
    let folder: SceneFolder | null;
    try {
      folder = await this.#folder(this);
    } catch (error) {
      if (connection === this.#connection) {
        this.#setSaved('failed', (error as Error).message);
      }
      return;
    }
    if (connection !== this.#connection) {
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
      if (connection === this.#connection) {
        this.#setSaved('failed', (error as Error).message);
      }
      return;
    }
    if (connection !== this.#connection) {
      return;
    }
    // A folder of Scenes opens its first; the bundle's folder holds the one
    // Scene its attributes name, so that is the one it opens.
    const first = names[0];
    if (first === undefined) {
      await this.#showNote();
      return;
    }
    await this.#openScene(first, connection);
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

  /** Let go of every edit in flight: half-typed words, the gesture in hand, and the tool. */
  #endEdits(): void {
    this.#endText();
    // Write access can end in the middle of a gesture, as a folder that answers a
    // queued save with a 403 does. Half a gesture is not a Scene any more: it is
    // dropped with the preview it painted, rather than left on a page that may
    // only read.
    if (this.#gestureHoldsScene()) {
      this.#cancelDrag();
    }
    if (this.#tool !== 'select') {
      this.#setTool('select');
    }
  }

  /**
   * Whether this page may change the Scene at all. Every Scene change asks
   * this one question, so read-only is one rule and not one per tool. An editor
   * the page has taken off is no page at all: a blur the removal causes is not a
   * person leaving the words, so nothing they were typing lands there.
   */
  #writable(): boolean {
    const target = this.#target;
    return this.isConnected && target !== null && !target.folder.readOnly && !this.#refused;
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
    connection = this.#connection,
    options: { create?: boolean } = {},
  ): Promise<void> {
    const folder = this.#browsed;
    if (folder === null) {
      this.#setSaved('failed', 'open a folder first');
      return;
    }
    await this.#saveQueue;
    if (connection !== this.#connection) {
      return;
    }
    let source: string | null;
    try {
      source = await folder.read(name);
    } catch (error) {
      if (connection !== this.#connection) {
        return;
      }
      this.#target = null;
      this.#setSaved('failed', `cannot read ${name}: ${(error as Error).message}`);
      return;
    }
    if (connection !== this.#connection) {
      return;
    }
    if (source === null) {
      // A new Scene takes its title from the file name: `flow.esbozo` opens as "flow".
      this.#load(emptyScene(sceneStem(name) || 'Scene'), { folder, name });
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
   *
   * The bytes are assembled in the frame that is already due, out of what the
   * page holds, so the task that asked for the save — a release, a key press —
   * ends before the file is built and hashed.
   */
  async #save(): Promise<void> {
    const target = this.#target;
    // The Scene this write speaks for: an edit is a new Scene, never a change
    // to the one in hand, so this stays the Scene the edit made however many
    // more land before the write is built.
    const scene = this.#scene;
    if (target === null || target.folder.readOnly || this.#refused) {
      return;
    }
    this.#setSaved('saving');
    const writing = this.#saveQueue.then(() => this.#writeScene(target, scene));
    this.#saveQueue = writing;
    if (await writing && this.#saveQueue === writing) {
      this.#setSaved('saved');
    }
  }

  /** One write of one Scene, assembled after the frame that is already due. */
  async #writeScene(target: SaveTarget, scene: Scene): Promise<boolean> {
    await nextFrame();
    const files = await this.#sceneFiles(scene);
    return this.#write(target, files.json, files.svg);
  }

  /**
   * A Scene's file and its SVG, out of the JSON and the drawings in hand. The
   * paint in flight is settled first — the frame that was about to run is this
   * one — so an edit draws each Element once and writes the same bytes
   * `ez render` writes.
   */
  #sceneFiles(scene: Scene): Promise<SceneFiles> {
    this.#drawScene();
    return (this.#paintables ??= new PaintCache(this.#layout)).files(scene);
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
    this.#showGrid();
    this.#paint();
  }

  /** The dot Grid, on or off. Its spacing is the screen's own: the view scales the paper, not the dots. */
  #showGrid(): void {
    this.#gridRect.style.display = this.#grid ? '' : 'none';
  }

  /**
   * A Scene that replaces the one in hand: another one opened, the Scene an
   * embedded element names, or the paper it lets go of. Nothing drawn for the
   * last one can speak for this one — the ids may be the same and mean something
   * else — so the drawings start empty and the page counts a new Scene.
   */
  #replaceScene(scene: Scene): void {
    this.#scene = scene;
    this.#paintables?.clear();
    this.#version++;
  }

  #load(scene: Scene, target: SaveTarget): void {
    this.#replaceScene(scene);
    this.#target = target;
    this.#selected = [];
    this.#history.reset(serialiseScene(scene));
    this.#menuFor = null;
    this.#view = fittedView(scene, this.#viewportSize(), this.#layout);
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
    const drag = this.#drag;
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

  /** The Scene as the page shows it, gesture included. */
  #shownScene(): Scene {
    const elements = this.#shownElements();
    return elements === this.#scene.elements ? this.#scene : { ...this.#scene, elements };
  }

  /** Whether a gesture that changes the Scene is in flight, so an edit waits for the pointer. */
  #gestureHoldsScene(): boolean {
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
    this.#version++;
    this.#nudgedAt = 0;
    // An undone edit may have changed a default or a Snap, so the status bar and
    // the note follow the restored Scene: a Snap the undo put back offers its
    // Detach button again.
    this.#showDefaultRoughness();
    this.#refresh();
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
   * Clipboard API — a non-secure origin — says so instead of doing nothing. The
   * clipboard answers later, so what it says speaks only for the connection that
   * asked: a page that moved on while it wrote is told nothing.
   */
  async #copySelection(): Promise<void> {
    const clipboard = clipboardApi();
    if (clipboard === null) {
      this.#setSaved('failed', 'this page cannot use the clipboard: press ⌘C');
      return;
    }
    const connection = this.#connection;
    try {
      await clipboard.writeText(serialiseFragment(this.#scene, this.#selectedElements()));
    } catch (error) {
      if (connection === this.#connection) {
        this.#setSaved('failed', `cannot copy: ${(error as Error).message}`);
      }
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
    const connection = this.#connection;
    const copied = new Set(selected.map((element) => element.id));
    const before = serialiseScene(this.#scene);
    try {
      await clipboard.writeText(serialiseFragment(this.#scene, selected));
    } catch (error) {
      if (connection === this.#connection) {
        this.#setSaved('failed', `cannot cut: ${(error as Error).message}`);
      }
      return;
    }
    if (connection !== this.#connection) {
      // Another instance of the element owns the page now: the ids are its
      // Scene's, not this one's, so nothing is deleted.
      return;
    }
    if (serialiseScene(this.#scene) !== before) {
      this.#setSaved('failed', 'the Scene changed during the cut, so nothing was deleted');
      return;
    }
    this.#remove(copied);
  }

  /**
   * Paste for a named action: the clipboard, read on the spot, with new ids.
   *
   * The clipboard is a promise, and a page can name another Scene while it is
   * still answering. So the edit belongs to the connection that asked for it: an
   * answer that arrives after the page moved on lands nowhere — no Element in
   * the Scene in hand and no word about the one it was for.
   */
  async #pasteClipboard(): Promise<void> {
    const clipboard = clipboardApi();
    if (clipboard === null) {
      this.#setSaved('failed', 'this page cannot use the clipboard: press ⌘V');
      return;
    }
    const connection = this.#connection;
    let text: string;
    try {
      text = await clipboard.readText();
    } catch (error) {
      if (connection === this.#connection) {
        this.#setSaved('failed', `cannot paste: ${(error as Error).message}`);
      }
      return;
    }
    if (connection !== this.#connection) {
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
    const file = this.#target?.name ?? `${this.#scene.title}${PRIMARY_SCENE_EXTENSION}`;
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
      png: this.#pngExport,
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
    this.#board.classList.toggle('pen', tool !== 'select' && !this.#spaceDown);
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
    if (!this.#writable()) {
      return;
    }
    const after = sceneFile(next);
    const changed = after !== sceneFile(this.#scene);
    const { select } = options;
    if (changed) {
      this.#scene = next;
      this.#version++;
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
        return elementBounds(element, byId, this.#layout);
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
    this.#clearOfMenu();
    // The view may have moved to make room for the note: the words being typed
    // travel with it, caret and all, rather than staying behind on the page.
    this.#paint();
  }

  /**
   * Pan, zoom and the Grid follow the pointer at once, because they are only
   * numbers the view layer already carries. Repainting the Scene is what costs,
   * so that waits for the next frame.
   */
  #paint(): void {
    this.#applyView();
    this.#queuedFrame('page');
  }

  /**
   * The caret, the selection or an input method's preedit moved, and nothing
   * else did: the words' own layer is drawn again, and the Scene is not asked
   * anything. A caret that walks one boundary per key repeat must not cost what
   * a Scene of three hundred Elements costs, nor scan every Label's overflow.
   */
  #paintWords(): void {
    this.#queuedFrame('words');
  }

  /**
   * One frame, asking for what the page owes it. A whole page makes an already
   * queued words frame redundant, so it takes its place; nothing downgrades one.
   */
  #queuedFrame(what: 'words' | 'page'): void {
    const queued = this.#paintQueued;
    if (queued === 'page' || queued === what) {
      return;
    }
    this.#paintQueued = what;
    if (queued !== 'none') {
      return;
    }
    requestAnimationFrame(() => {
      const owed = this.#paintQueued;
      this.#paintQueued = 'none';
      if (owed === 'page') {
        this.#drawScene();
        this.#drawOverlay();
      } else {
        this.#drawWords();
      }
    });
  }

  /** The page has to draw the Scene again: a new measurement, or a Scene to show. */
  #invalidate(): void {
    this.#paintedVersion = -1;
  }

  /**
   * A view change the person asked for — a wheel, a key zoom or a fit. It still
   * has to leave the selection clear of the note, and any zoom can put it back
   * under, so the clearance runs before the paint: no frame shows it covered.
   */
  #changedView(view: View): void {
    this.#view = view;
    // Zoom is not part of a double-click: the next press starts a new one.
    this.#press = null;
    this.#lastClick = null;
    this.#wordsClick = null;
    this.#clearOfMenu();
    this.#paint();
  }

  /**
   * Move the painted Scene: one CSS transform on the wrapper, so the drawing is
   * laid out once and a zoom is a composite. The Grid and the overlay stand in
   * screen space, counter-moved, so dots keep their size and a handle its width.
   */
  #applyView(): void {
    const { zoom, panX, panY } = this.#view;
    const applied = this.#applied;
    if (
      applied !== null &&
      applied.zoom === zoom &&
      applied.panX === panX &&
      applied.panY === panY
    ) {
      return;
    }
    this.#applied = { zoom, panX, panY };
    this.#surface.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    const screen = `scale(${1 / zoom}) translate(${-panX} ${-panY})`;
    this.#gridLayer.setAttribute('transform', screen);
    this.#overlay.setAttribute('transform', screen);
    const label = `${Math.round(zoom * 100)}%`;
    if (this.#zoomLabel.textContent !== label) {
      this.#zoomLabel.textContent = label;
    }
  }

  /**
   * Paint what the Scene shows now.
   *
   * Each Element keeps the drawing it already had while the canonical JSON it
   * was drawn from is unchanged, so a frame costs what the gesture changes: a
   * resize or a dragged end draws one Element, a move moves the groups it
   * carries, and a pan or a zoom draws nothing at all.
   */
  #drawScene(): void {
    const drag = this.#drag;
    if (drag !== null && drag.kind === 'move') {
      if (this.#paintables !== null && this.#paintables.generation !== this.#drawnMeasurement) {
        // A font landed while the pointer was down: every Label may break
        // differently, so the drawings this gesture carries are made again —
        // once, here, before the transforms go back on. A move frame that
        // changed no measurement draws nothing, as before.
        this.#drawElements(this.#scene.elements);
      }
      this.#moveGroups(drag);
      this.#followSnaps(drag);
      if (drag.shown.size > 0) {
        // A preview is not the Scene: the frame after the gesture has to draw
        // what the Scene holds, however the gesture ended — a release that
        // changed nothing, a cancelled pointer or a lost focus included.
        this.#paintedVersion = -1;
      }
      return;
    }
    const shown = this.#shownElements();
    const settled = shown === this.#scene.elements;
    if (settled && this.#paintedVersion === this.#version) {
      return;
    }
    this.#drawElements(shown);
    this.#paintedVersion = settled ? this.#version : -1;
  }

  /** One frame of the page: a group redrawn for each Element whose drawing changed. */
  #drawElements(shown: readonly SceneElement[]): void {
    const paintables = (this.#paintables ??= new PaintCache(this.#layout));
    // The words drawn for an emptied Label are its empty line, the slot the
    // next letter would go in: only the Element being typed in is drawn with
    // them. An Element nobody is editing keeps the words the Scene holds, so an
    // unlabeled arrow draws no words — and no paper for them either.
    const typing = this.#editing?.id;
    const paint = paintables.paint(
      typing === undefined
        ? shown
        : shown.map((element) => (element.id === typing ? shownWords(element) : element)),
    );
    this.#painted = paint;
    this.#drawnWords = this.#editing?.element ?? this.#draft;
    this.#drawnMeasurement = paintables.generation;
    // A group moved by a drag carries a transform the Scene never holds: every
    // group starts a frame where its Element is.
    for (const id of this.#moved) {
      this.#groups.get(id)?.node.removeAttribute('transform');
    }
    this.#moved.clear();

    const layer = this.#layerOf();
    const groups = new Map<string, { key: string; node: SVGGElement }>();
    for (const id of paint.order) {
      const painted = paint.elements.get(id)!;
      const held = this.#groups.get(id);
      if (held !== undefined && held.key === painted.key) {
        groups.set(id, held);
        continue;
      }
      // New or changed: one Element's SVG, parsed on its own, in the group the
      // pointer moves and the overlay measures.
      const node = groupOf(id, painted.svg);
      if (held === undefined) {
        layer.append(node);
      } else {
        held.node.replaceWith(node);
      }
      groups.set(id, { key: painted.key, node });
    }
    this.#groups = groups;
    // Stacking is the Scene's order and nothing else: what a frame reused, and
    // which of the reused groups were replaced in place, says nothing about
    // which Element is drawn on top. One comparison, one write when it changed.
    const order = paint.order;
    if (order.length !== this.#order.length || order.some((id, index) => this.#order[index] !== id)) {
      layer.replaceChildren(...order.map((id) => groups.get(id)!.node));
    }
    this.#order = order;
  }

  /** The Scene's own `svg` inside `.painted`, made once, so each Element is one group under it. */
  #layerOf(): SVGSVGElement {
    if (this.#layer === null) {
      const layer = document.createElementNS(SVG_NS, 'svg');
      layer.setAttribute('overflow', 'visible');
      // The drawing's colours and face are CSS variables, as in the saved SVG:
      // a theme change is a repaint the page already knows how to do.
      layer.setAttribute('font-family', 'var(--font-hand)');
      this.#paintedLayer.append(layer);
      this.#layer = layer;
    }
    return this.#layer;
  }

  /**
   * A move in flight: the groups the pointer carries are moved by a transform,
   * so the gesture draws nothing at all. The release settles the Scene, and the
   * painting that follows draws the moved Elements where they landed.
   */
  #moveGroups(drag: Extract<Drag, { kind: 'move' }>): void {
    const moved = new Set<string>();
    for (const id of drag.shown.keys()) {
      const group = this.#groups.get(id);
      if (group === undefined) {
        continue;
      }
      group.node.setAttribute('transform', `translate(${drag.by.x} ${drag.by.y})`);
      moved.add(id);
    }
    for (const id of this.#moved) {
      if (!moved.has(id)) {
        this.#groups.get(id)?.node.removeAttribute('transform');
      }
    }
    this.#moved = moved;
  }

  /**
   * The ends that ride what a move carries: an arrow or line the drag does not
   * hold, but whose end is Snapped to an Element it does, is drawn again against
   * the Scene as the drag shows it. So a shaft follows its target under the
   * pointer instead of waiting for the release, and only those shafts are drawn:
   * everything else keeps the drawing it already had.
   *
   * The drawing it makes is keyed on the preview geometry, so the frame the
   * gesture ends on draws it again — or keeps it, when the release left the
   * Scene exactly as it was.
   */
  #followSnaps(drag: Extract<Drag, { kind: 'move' }>): void {
    if (drag.shown.size === 0) {
      return;
    }
    const byId = new Map<string, SceneElement>();
    for (const element of this.#scene.elements) {
      byId.set(element.id, drag.shown.get(element.id) ?? element);
    }
    const paintables = (this.#paintables ??= new PaintCache(this.#layout));
    for (const element of this.#scene.elements) {
      if (drag.shown.has(element.id) || !isShaft(element)) {
        continue;
      }
      if (!element.points.some((point) => point.snap !== undefined && drag.shown.has(point.snap))) {
        continue;
      }
      const held = this.#groups.get(element.id);
      if (held === undefined) {
        continue;
      }
      const painted = paintables.element(element, byId);
      if (painted.key === held.key) {
        continue;
      }
      const node = groupOf(element.id, painted.svg);
      held.node.replaceWith(node);
      this.#groups.set(element.id, { key: painted.key, node });
    }
  }

  /**
   * The overlay draws in screen pixels, on a group counter-moved against the
   * view: a handle stays eight pixels at every zoom, and the boxes it marks are
   * read from what the page painted rather than measured again.
   */
  #drawOverlay(): void {
    const overlay = this.#overlay;
    // The words' own layer is the one thing a frame of its own may keep: it is
    // put back by `#drawWords`, and it is nobody else's.
    overlay.replaceChildren();
    this.#wordsLayer = null;
    // A Label that does not fit its Element is outlined in red, on the rule
    // `ez check` reports: one function, so the page and the CLI cannot disagree.
    for (const element of this.#shownElements()) {
      if (this.#layout.overflow(element) === null) {
        continue;
      }
      const words = this.#layout.label(element);
      if (words !== null) {
        this.#appendRect(overlay, { ...this.#pageBox(words), class: 'overflow' });
      }
    }
    const drag = this.#drag;
    const boxes: Box[] = [];
    for (const id of this.#selected) {
      const box = this.#shownBounds(id);
      if (box !== null) {
        boxes.push(this.#pageBox(box));
      }
    }
    const box = unionOf(boxes);
    const first = this.#selected[0];
    if (box !== null) {
      this.#appendRect(overlay, {
        x: box.x - SELECTION_PADDING,
        y: box.y - SELECTION_PADDING,
        width: box.width + SELECTION_PADDING * 2,
        height: box.height + SELECTION_PADDING * 2,
        class: 'selection',
      });
      if (this.#selected.length === 1 && first !== undefined) {
        this.#drawHandles(overlay, first);
        this.#drawLabelCue(overlay, first);
      }
    }
    if (drag !== null && drag.kind === 'box') {
      this.#appendRect(overlay, { ...this.#pageBox(boxBetween(drag.from, drag.to)), class: 'sweep' });
    }
    if (drag !== null && (drag.kind === 'draw' || drag.kind === 'end') && drag.target !== null) {
      const target = this.#scene.elements.find((element) => element.id === drag.target);
      if (target !== undefined && isOutlined(target)) {
        // The Element the dragged end would attach to, so a drop is no surprise.
        const outline = this.#pageBox(outlineBox(target));
        this.#appendRect(overlay, {
          x: outline.x - SNAP_GROW,
          y: outline.y - SNAP_GROW,
          width: outline.width + SNAP_GROW * 2,
          height: outline.height + SNAP_GROW * 2,
          class: 'snap',
        });
      }
    }
    this.#drawWords();
  }

  /**
   * The caret, the selection and an input method's preedit, drawn where the
   * Renderer put the glyphs. The page is the only ink, so the field's own caret
   * and highlight are never on screen; it is moved over the caret instead, which
   * is where a browser opens the candidate window of an input method.
   *
   * The washes go in the layer under the glyphs, in Scene coordinates, so the
   * ink inside them keeps its own colour; the caret and the preedit's rule go in
   * the overlay, in screen pixels, so they keep their width at every zoom.
   */
  #drawWords(): void {
    this.#wordsLayer?.remove();
    this.#wordsLayer = null;
    this.#clearWash();
    const text = this.#text;
    const block = this.#wordsBlock();
    if (text === null || block === null) {
      return;
    }
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('class', 'words');
    this.#overlay.append(layer);
    this.#wordsLayer = layer;
    const state = text.state();
    const at = (offset: number): number => this.#shift.drawn(offset);
    const glyphs = this.#wordsGlyphs(block);

    for (const box of this.#layout.selection(block, at(state.start), at(state.end), glyphs)) {
      this.#appendWash(box, 'words-selection');
    }

    const preedit = state.preedit;
    if (preedit !== null) {
      for (const box of this.#layout.selection(block, at(preedit.from), at(preedit.to), glyphs)) {
        this.#appendWash(box, 'preedit');
        const page = this.#pageBox(box);
        this.#appendRect(layer, {
          x: page.x,
          y: page.y + page.height - PREEDIT_RULE,
          width: page.width,
          height: PREEDIT_RULE,
          class: 'preedit-rule',
        });
      }
    }

    const caret = this.#layout.caret(block, at(state.caret), glyphs);
    const page = this.#pageBox({ x: caret.x, y: caret.y, width: 0, height: caret.height });
    layer.append(caretPath(page));
    text.spot(page);
  }

  /** Where an Element draws on the page now: what was painted for it, moved by a drag in flight. */
  #shownBounds(id: string): Box | null {
    const painted = this.#painted?.elements.get(id);
    if (painted === undefined) {
      return null;
    }
    const drag = this.#drag;
    if (drag !== null && drag.kind === 'move' && drag.shown.has(id)) {
      return {
        ...painted.bounds,
        x: painted.bounds.x + drag.by.x,
        y: painted.bounds.y + drag.by.y,
      };
    }
    return painted.bounds;
  }

  /** The Element as the page shows it: the gesture's own version while one is in flight. */
  #shownElement(id: string): SceneElement | undefined {
    const drag = this.#drag;
    if (drag !== null && drag.kind === 'move') {
      return drag.shown.get(id) ?? this.#painted?.byId.get(id);
    }
    return this.#painted?.byId.get(id);
  }

  /** A Scene box, in the pixels the overlay draws in. */
  #pageBox(box: Box): Box {
    const { zoom, panX, panY } = this.#view;
    return {
      x: box.x * zoom + panX,
      y: box.y * zoom + panY,
      width: box.width * zoom,
      height: box.height * zoom,
    };
  }

  /** A Scene point, in the pixels the overlay draws in. */
  #pagePoint(point: Point): Point {
    const { zoom, panX, panY } = this.#view;
    return { x: point.x * zoom + panX, y: point.y * zoom + panY };
  }

  /**
   * The drag targets of a lone selection: eight around a box's outline, or the
   * two ends of an arrow or line, where they draw — a Snapped end rides its
   * target's outline, so its handle is there too.
   */
  #drawHandles(overlay: SVGGElement, id: string): void {
    const element = this.#shownElement(id);
    if (element === undefined) {
      return;
    }
    const handles: Array<{ at: Point; name: string }> = [];
    if (isOutlined(element)) {
      const outline = this.#pageBox(outlineBox(element));
      for (const handle of HANDLES) {
        handles.push({ at: handlePoint(outline, handle), name: handle });
      }
    } else if (isShaft(element)) {
      const byId = this.#painted?.byId ?? elementsById(this.#scene.elements);
      const [start, end] = drawnShaft(element, byId);
      handles.push({ at: this.#pagePoint(start), name: 'start' }, { at: this.#pagePoint(end), name: 'end' });
    }
    for (const handle of handles) {
      const node = this.#appendRect(overlay, {
        x: handle.at.x - HANDLE_SIZE / 2,
        y: handle.at.y - HANDLE_SIZE / 2,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
        class: `handle handle-${handle.name}`,
      });
      node.setAttribute('data-handle', handle.name);
      node.setAttribute('data-element', id);
    }
  }

  /**
   * A lone shaft's Label, marked as something a press can carry. The selection's
   * own outline is the Element's, and its hands resize it; the words are taken
   * on their own, by a press on them, so the selection says which box that is.
   */
  #drawLabelCue(overlay: SVGGElement, id: string): void {
    const element = this.#shownElement(id);
    if (element === undefined || !isShaft(element)) {
      return;
    }
    const byId = this.#painted?.byId ?? elementsById(this.#scene.elements);
    const words = shaftLabel(element, byId, this.#layout);
    if (words === null) {
      return;
    }
    const box = this.#pageBox(labelInkBounds(words));
    // The dashes stand a little outside the words and are the selection's: no
    // press lands on them. The box the words paint is what a press takes, so it
    // is the one that says what a press there does.
    this.#appendRect(overlay, {
      x: box.x - LABEL_CUE_GAP,
      y: box.y - LABEL_CUE_GAP,
      width: box.width + LABEL_CUE_GAP * 2,
      height: box.height + LABEL_CUE_GAP * 2,
      class: 'label-cue',
    });
    this.#appendRect(overlay, { ...box, class: 'label-grab' });
  }

  #appendRect(
    parent: SVGGElement,
    attributes: { x: number; y: number; width: number; height: number; class: string },
  ): SVGRectElement {
    const node = this.#rect(attributes);
    parent.append(node);
    return node;
  }

  /** One rectangle of the page's own drawing, at the place it was measured. */
  #rect(attributes: {
    x: number;
    y: number;
    width: number;
    height: number;
    class: string;
  }): SVGRectElement {
    const node = document.createElementNS(SVG_NS, 'rect');
    node.setAttribute('x', String(attributes.x));
    node.setAttribute('y', String(attributes.y));
    node.setAttribute('width', String(Math.max(attributes.width, 0)));
    node.setAttribute('height', String(Math.max(attributes.height, 0)));
    node.setAttribute('class', attributes.class);
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
   * mid-drag would make the Element chase it. The rectangle is measured from
   * what the page shows, so a box grown by the words being typed is cleared too.
   */
  #clearOfMenu(): void {
    if (this.#drag !== null) {
      return;
    }
    const note = this.#noteBox();
    if (note === null) {
      return;
    }
    const canvas = this.#canvasBox();
    const shown = this.#shownElements();
    const selected = new Set(this.#selected);
    this.#view = clearedView(this.#view, {
      selection: boxOf(
        shown.filter((element) => selected.has(element.id)),
        elementsById(shown),
        this.#layout,
      ),
      note,
      left: this.#rail.getBoundingClientRect().right - canvas.left + MENU_GAP,
      gap: MENU_GAP,
    });
  }

  /** The Style note's own page box, while it is on the page. */
  #noteBox(): Box | null {
    if (this.#menu.hidden) {
      return null;
    }
    const canvas = this.#canvasBox();
    const note = this.#menu.getBoundingClientRect();
    return {
      x: note.left - canvas.left,
      y: note.top - canvas.top,
      width: note.width,
      height: note.height,
    };
  }

  // ------------------------------------------------------------------ pointer

  /**
   * The canvas box on the page, before the view moves anything: the paper the
   * Scene is drawn on — `.board` — and not the element's border box, because a
   * host may draw its own border and padding around the editor, and the view is
   * a transform *inside* the element (a transformed or framed box would fold
   * pan, zoom or the host's frame into the pointer twice).
   */
  #canvasBox(): { left: number; top: number; width: number; height: number } {
    const rect = this.#board.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width || window.innerWidth,
      height: rect.height || window.innerHeight,
    };
  }

  #viewportSize(): { width: number; height: number } {
    const box = this.#canvasBox();
    return { width: box.width, height: box.height };
  }

  #scenePoint(event: { clientX: number; clientY: number }): Point {
    const box = this.#canvasBox();
    return toScene(this.#view, event.clientX - box.left, event.clientY - box.top);
  }

  #screenPoint(event: { clientX: number; clientY: number }): Point {
    const box = this.#canvasBox();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    if (this.#text !== null && event.button === 0) {
      // A press inside the words being typed moves their caret: it is the
      // words', not the canvas's, and the page keeps the focus in the field.
      const offset = this.#wordsOffset(this.#scenePoint(event));
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
      this.#press = null;
      this.#lastClick = null;
      this.#wordsClick = null;
      this.#text.finish();
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
      this.#drag = { kind: 'pan', fromScreen: this.#screenPoint(event), start: { ...this.#view } };
      this.#board.classList.add('panning');
      return;
    }
    const tool = this.#tool;
    if (tool !== 'select') {
      this.#press = null;
      this.#startDrawing(tool, this.#scenePoint(event));
      return;
    }
    // A read-only page still selects, sweeps and pans; it just cannot change
    // the Scene, so a press never starts a drag that would.
    const editing = this.#writable();
    const handle = editing ? (target?.closest('[data-handle]') ?? null) : null;
    if (handle !== null) {
      this.#press = null;
      const id = handle.getAttribute('data-element') ?? '';
      const which = handle.getAttribute('data-handle');
      const element = this.#scene.elements.find((candidate) => candidate.id === id);
      if (element !== undefined && isShaft(element) && (which === 'start' || which === 'end')) {
        const [start, end] = drawnShaft(element, elementsById(this.#scene.elements));
        const origin = which === 'start' ? start : end;
        this.#drag = {
          kind: 'end',
          id,
          which,
          from: this.#scenePoint(event),
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
          from: this.#scenePoint(event),
          shown: element,
        };
        return;
      }
    }

    const point = this.#scenePoint(event);
    const reach = PICK_TOLERANCE / this.#view.zoom;
    // One picker, in layer order: a higher Element's ink answers first, and a
    // shaft's Label answers before the shaft it is written about.
    const pick = pickAt(this.#scene.elements, point, reach, this.#layout);
    // A double-click opens the words under its *first* click: selecting what it
    // landed on can dock the note and pan the view, so what the second click
    // sees is not what the person aimed at. The press is recorded before any of
    // that, with a shaft's Label ink counting as words a person can click.
    this.#press = {
      id: pick?.element.id ?? null,
      at: this.#screenPoint(event),
      time: event.timeStamp,
      shift: event.shiftKey,
    };
    if (pick === null) {
      if (!event.shiftKey) {
        this.#selected = [];
      }
      this.#drag = { kind: 'box', from: point, to: point, additive: event.shiftKey };
      this.#refresh();
      return;
    }

    this.#selectForPress(pick.element.id, event.shiftKey);
    if (editing) {
      const label = pick.label;
      if (label !== null && isShaft(pick.element)) {
        // The words are taken by the hold the press took, and placed from it:
        // a press on them never moves the shaft they are written about.
        const [start, end] = drawnShaft(pick.element, elementsById(this.#scene.elements));
        this.#drag = {
          kind: 'label',
          id: pick.element.id,
          shaft: { start, end },
          from: this.#screenPoint(event),
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
        const byId = elementsById(this.#scene.elements);
        const origins = new Map(
          this.#selectedElements().map((element) => [element.id, released(element, byId)]),
        );
        this.#drag = { kind: 'move', from: point, origins, shown: new Map(), by: { x: 0, y: 0 } };
      }
    }
    this.#refresh();
  };

  /**
   * A press on an Element: it becomes the selection, or Shift adds it to the
   * selection or takes it back out. A press on what is already selected keeps
   * the selection the gesture will carry.
   */
  #selectForPress(id: string, shift: boolean): void {
    if (shift) {
      this.#selected = this.#selected.includes(id)
        ? this.#selected.filter((selected) => selected !== id)
        : [...this.#selected, id];
    } else if (!this.#selected.includes(id)) {
      this.#selected = [id];
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
    const id = freshId(tool, idsOf(this.#scene.elements));
    this.#selected = [id];
    this.#drag = {
      kind: 'draw',
      tool,
      id,
      from: point,
      preview: drawn(tool, point, point, id, this.#scene.defaults),
      target: null,
    };
    this.#paint();
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
    const element = this.#scene.elements.find((candidate) => candidate.id === id);
    const other = element !== undefined && isShaft(element) ? attachedTo(element, otherEnd(end)) : null;
    return targetAt(this.#scene.elements, point, other);
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
      ? drawnAtClick(drag.tool, drag.from, drag.id, this.#scene.defaults)
      : drawn(drag.tool, drag.from, at, drag.id, this.#scene.defaults);
    this.#setTool('select');
    if (placed === null) {
      this.#selected = [];
      this.#refresh();
      return;
    }
    const settled = isShaft(placed)
      ? withEnd(placed, 'end', endPoint(placed, 'end'), this.#attachTarget(drag.id, 'end', at, skipSnap))
      : placed;
    this.#applyScene(
      { ...this.#scene, elements: [...this.#scene.elements, settled] },
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
    const element = this.#scene.elements.find((candidate) => candidate.id === drag.id);
    if (!drag.moved || element === undefined || !isShaft(element)) {
      // The gesture painted a preview and maybe a highlight; a Scene it did not
      // change must not leave either of them on the page.
      this.#refresh();
      return;
    }
    const { to, target } = this.#resolveEnd(drag, at, skipSnap);
    this.#applyScene({
      ...this.#scene,
      elements: this.#scene.elements.map((candidate) =>
        candidate.id === drag.id ? withEnd(element, drag.which, to, target) : candidate,
      ),
    });
  }

  /** A Text is placed: the words are typed where the Text will sit. */
  #openTextInput(at: Point): void {
    // A page that may not write has nowhere to put a Text, however the gesture
    // that placed it began: the refusal may have landed while the button was
    // still down. One gate, asked at the moment the field would open.
    if (!this.#writable()) {
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
      moved: () => this.#paintWords(),
      line: (key, state) => this.#wordsLine(key, state),
      commit: (words) => this.#commitText(words),
      ended: () => this.#endText(),
    });
    this.#paint();
  }

  /**
   * Open the in-place editor on an Element's words. The page draws them at once,
   * where they will save, and the caret sits on those glyphs; nothing of the
   * Scene changes until the words are committed.
   */
  #openWords(element: SceneElement): void {
    // A page with nowhere to save the words opens none, by either way in: one
    // gate, on the one question every Scene change asks.
    if (!this.#writable()) {
      return;
    }
    this.#setTool('select');
    this.#selected = [element.id];
    // The page paints the Element with the room its words need from the first
    // frame, not from the first keystroke, so the words are in one place.
    this.#editing = {
      id: element.id,
      element: withWords(element, wordsOf(element), this.#layout),
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
      moved: () => this.#paintWords(),
      line: (key, state) => this.#wordsLine(key, state),
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
      this.#editing = { id: element.id, element: withWords(element, kept, this.#layout) };
      this.#shift = wordsShift(words, kept);
      // The grown Element is what the note must not cover.
      this.#clearOfMenu();
    } else if (this.#editing !== null) {
      // The page refuses these words and goes on drawing the ones it has: the
      // step is measured through them all the same, so a character the Scene
      // cannot hold is one more offset in the field and no glyph under the caret.
      this.#shift = wordsShift(words, wordsOf(this.#editing.element));
    }
    this.#paint();
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
    this.#paint();
  }

  /**
   * The Block the page is drawing for the words being typed: the Renderer's own
   * placement of the Element the ink came from, canonical geometry included, so
   * the caret sits on the glyphs and nowhere else. An emptied Label keeps its
   * empty line here, the slot the words would start on, or they would have no
   * place for a caret at all.
   */
  #wordsBlock(): Block | null {
    const element = this.#editing?.element ?? this.#draft;
    if (element === null) {
      return null;
    }
    // The frame the words belong to is drawn before they are asked about: the
    // block is the drawn one, and the drawn Element is the canonical one. A
    // frame that already drew these very words is that frame, and a caret that
    // moved asks for no Scene at all.
    if (this.#drawnWords !== element) {
      this.#drawScene();
    }
    // The Block is the one the drawing placed: a caret that moved is drawn on
    // the words without measuring them again.
    return this.#painted?.elements.get(element.id)?.words ?? null;
  }

  /**
   * Where the drawn glyphs of the words being typed are, as the SVG that draws
   * them laid them out. The call to `#wordsBlock` has drawn the frame they
   * belong to, so the group asked here is the one holding their ink.
   */
  #wordsGlyphs(words: Block): LineGlyphs {
    return drawnGlyphs(this.#wordsGroup(), words);
  }

  /** The group the page drew the words being typed in: where their wash goes. */
  #wordsGroup(): SVGGElement | null {
    const id = this.#editing?.id ?? this.#draft?.id;
    return id === undefined ? null : (this.#groups.get(id)?.node ?? null);
  }

  /**
   * The wash behind a run of the words being typed, put into the Element's own
   * drawing: above the fill it was painted with and under the glyphs, which are
   * the last thing that drawing holds.
   */
  #appendWash(box: Box, name: 'words-selection' | 'preedit'): void {
    const group = this.#wordsGroup();
    if (group === null) {
      return;
    }
    const wash = this.#rect({ ...box, class: name });
    const glyph = [...group.children].find((child) => child.tagName.toLowerCase() === 'text');
    group.insertBefore(wash, glyph ?? null);
    this.#washes.push(wash);
  }

  /** Nothing of a frame before is left behind: the washes go with the caret that replaced them. */
  #clearWash(): void {
    for (const wash of this.#washes) {
      wash.remove();
    }
    this.#washes = [];
  }

  /**
   * Where Up, Down, Home and End put the caret in the words being typed: the
   * drawn line above or below at the same column, or the start or end of the
   * line the caret is on — which is the line's first or last boundary, at
   * whichever end the words begin and stop.
   */
  #wordsLine(key: LineKey, state: TextSessionState): number | null {
    const block = this.#wordsBlock();
    if (block === null) {
      return null;
    }
    const glyphs = this.#wordsGlyphs(block);
    const caret = this.#layout.caret(block, this.#shift.drawn(state.caret), glyphs);
    const middle = caret.y + caret.height / 2;
    const { boundaries: xs } = glyphs(block.lines[caret.line]!);
    // The lines are the Layout's own boxes, one line height each: half a line
    // above or below the caret's middle is the middle of its neighbour. Home
    // and End ask from the line's own first and last glyph boundary, so which
    // end of the line each is cannot depend on the direction the words run in.
    const point =
      key === 'up'
        ? { x: caret.x, y: caret.y - caret.height / 2 }
        : key === 'down'
          ? { x: caret.x, y: caret.y + caret.height * 1.5 }
          : key === 'home'
            ? { x: xs[0]!, y: middle }
            : { x: xs[xs.length - 1]!, y: middle };
    return this.#shift.typed(this.#layout.offsetAt(block, point, glyphs));
  }

  /**
   * Where a press lands in the words being typed: the drawn offset of the glyph
   * boundary nearest the pointer, or null when the press is off the words.
   */
  #wordsOffset(point: Point): number | null {
    const block = this.#wordsBlock();
    if (block === null) {
      return null;
    }
    const glyphs = this.#wordsGlyphs(block);
    // The words reach as far as their glyphs: a fallback font draws them in a
    // width of its own, and a press on the paper beyond them is no press on them.
    const words = drawnBox(block, glyphs);
    const reach = WORDS_TOLERANCE / this.#view.zoom;
    const inside =
      point.x >= words.x - reach &&
      point.x <= words.x + words.width + reach &&
      point.y >= words.y - reach &&
      point.y <= words.y + words.height + reach;
    return inside ? this.#layout.offsetAt(block, point, glyphs) : null;
  }

  /** The nearest glyph boundary of the words, wherever the pointer went: a drag carries the caret. */
  #wordsNearest(point: Point): number | null {
    const block = this.#wordsBlock();
    if (block === null) {
      return null;
    }
    return this.#layout.offsetAt(block, point, this.#wordsGlyphs(block));
  }

  /** An offset among the drawn glyphs, read back into the field's own words. */
  #typedOffset(drawn: number): number {
    return this.#shift.typed(drawn);
  }

  /**
   * A press inside the words being typed. One press puts the caret at the glyph
   * under the pointer; a second one in the same place selects the word there;
   * and dragging the pointer carries the other end of the selection with it.
   */
  #pressWords(event: PointerEvent, offset: number): void {
    const text = this.#text;
    if (text === null) {
      return;
    }
    const press: Press = {
      id: null,
      at: this.#screenPoint(event),
      time: event.timeStamp,
      shift: event.shiftKey,
    };
    const previous = this.#wordsClick;
    // Shift makes a press the extension of a selection, so it is never half of
    // a double-click: no sequence is owed to it, and none survives it.
    this.#wordsClick = press.shift ? null : press;
    const at = this.#typedOffset(offset);
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
    this.#wordsClick = null;
    this.#shift = wordsShift('', '');
    text?.discard();
    this.#paint();
  }

  /** The Scene these words would make, with this Element's words replaced. */
  #wordsScene(element: SceneElement, words: string): SceneElement[] {
    if (words === '' && element.type === 'text') {
      return without(this.#scene.elements, new Set([element.id]));
    }
    return this.#scene.elements.map((candidate) =>
      candidate.id === element.id ? withWords(candidate, words, this.#layout) : candidate,
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
      this.#paint();
      return;
    }
    this.#applyScene(verdict.scene, { select: selected });
  }

  #onPointerMove = (event: PointerEvent): void => {
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
      const point = this.#screenPoint(event);
      this.#view = {
        zoom: drag.start.zoom,
        panX: drag.start.panX + (point.x - drag.fromScreen.x),
        panY: drag.start.panY + (point.y - drag.fromScreen.y),
      };
      // The words follow the page they are drawn on, caret and all.
      this.#paint();
      return;
    }

    const point = this.#scenePoint(event);
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
      const offset = this.#wordsNearest(point);
      if (offset !== null) {
        const to = this.#typedOffset(offset);
        // A gesture that selected something is a drag, however little the
        // pointer moved: two pixels across a glyph boundary is a letter taken,
        // and the click that follows it starts a new sequence instead of
        // taking the word around it.
        if (to !== drag.from) {
          this.#wordsClick = null;
        }
        this.#text?.select(drag.from, to);
      }
      return;
    }
    if (drag.kind === 'box') {
      drag.to = point;
      this.#paint();
      return;
    }
    if (drag.kind === 'draw') {
      const target = isShaft(drag.preview)
        ? this.#attachTarget(drag.id, 'end', point, event.altKey)
        : null;
      drag.target = target;
      const preview = drawn(drag.tool, drag.from, point, drag.id, this.#scene.defaults);
      drag.preview = isShaft(preview) ? withEnd(preview, 'end', point, target) : preview;
      this.#paint();
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
      if (withinSlop(drag.from, this.#screenPoint(event))) {
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
      this.#paint();
      return;
    }
    const dx = point.x - drag.from.x;
    const dy = point.y - drag.from.y;
    if (drag.kind === 'end') {
      const element = this.#scene.elements.find((candidate) => candidate.id === drag.id);
      if (element === undefined || !isShaft(element)) {
        return;
      }
      // A Snapped end is picked up where it draws, so dragging it a pixel moves
      // it a pixel rather than jumping back to the point it was attached from.
      const { to, target } = this.#resolveEnd(drag, point, event.altKey);
      drag.moved = drag.moved || dx !== 0 || dy !== 0;
      drag.target = target;
      drag.shown = withEnd(element, drag.which, to, target);
      this.#paint();
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
    this.#board.classList.remove('panning');
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
            : this.#scene.elements.find((element) => element.id === first.id);
        if (opening !== undefined) {
          event.preventDefault();
          this.#drag = null;
          this.#openWords(opening);
          return;
        }
      }
    }

    if (drag.kind === 'text') {
      this.#drag = null;
      this.#openTextInput(drag.at);
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
      this.#applyScene({
        ...this.#scene,
        elements: this.#scene.elements.map((element) =>
          element.id === drag.id && isShaft(element) && labelAt !== undefined
            ? { ...element, labelAt }
            : element,
        ),
      });
      return;
    }
    if (drag.kind === 'draw') {
      this.#drag = null;
      this.#finishDrawing(drag, this.#scenePoint(event), event.altKey);
      return;
    }
    if (drag.kind === 'end') {
      this.#drag = null;
      this.#settleEnd(drag, this.#scenePoint(event), event.altKey);
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
      const settled = this.#shownScene();
      this.#drag = null;
      // The whole gesture is one history step, and the note may make room for
      // where the selection ended up.
      this.#applyScene(settled);
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
  #onPointerCancel = (): void => {
    this.#releasePointer();
    this.#cancelDrag();
  };

  /**
   * The page lost the focus, or was hidden: no pointer of this gesture will
   * ever come up here. A Space pan ends, a press that started no drag lets go of
   * the pointer it took, and half a drag is dropped with the preview it painted —
   * the same page a cancelled pointer leaves, so the frame that follows draws the
   * Scene as it is held.
   */
  #endGesture = (): void => {
    this.#endSpacePan();
    if (this.#drag !== null) {
      this.#cancelDrag();
      return;
    }
    // A press that started no drag still took the pointer — a read-only page
    // selects and moves nothing — and no pointer of this gesture comes up here
    // either. The capture goes with the press, or the page keeps a pointer for a
    // click nobody will make.
    this.#releasePointer();
    this.#press = null;
  };

  /** Drop the gesture in flight: the Scene keeps what it had, and the page shows that. */
  #cancelDrag(): void {
    const drag = this.#drag;
    this.#drag = null;
    this.#releasePointer();
    this.#press = null;
    this.#lastClick = null;
    this.#wordsClick = null;
    this.#board.classList.remove('panning');
    if (drag !== null && drag.kind === 'draw') {
      // The preview drew under an id the Scene never took.
      this.#selected = [];
    }
    this.#refresh();
  }

  /** Whether a pointer move is still within the press that started it. */
  #near(press: Press, event: { clientX: number; clientY: number }): boolean {
    return withinSlop(press.at, this.#screenPoint(event));
  }

  /**
   * Take the pointer for the gesture that is starting. A pointer the browser has
   * already let go cannot be captured, and the gesture still ends on the release
   * it gets, so a capture that is no longer there is not a failure.
   */
  #capture(event: PointerEvent): void {
    this.#releasePointer();
    try {
      this.#board.setPointerCapture(event.pointerId);
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
      if (this.#board.hasPointerCapture(id)) {
        this.#board.releasePointerCapture(id);
      }
    } catch {
      // The pointer was already the browser's: no capture left to let go of.
    }
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
  #onAnyPress = (event: PointerEvent): void => {
    // A press the note answered itself never reaches here, so anything that does
    // is a new gesture: no click is owed to the press that opened the words.
    this.#cancelledClick = false;
    const text = this.#text;
    // Any button, not the left one only: a middle or a right press takes the
    // focus off the field just the same, and Chromium confirms a preedit into it
    // as it goes. A press on the canvas is the board's own (a pan keeps the
    // words), so only a press elsewhere ends the session.
    if (text !== null && !this.#canvas.contains(event.target as Node | null)) {
      text.finish();
    }
    if (!this.#canvas.contains(event.target as Node | null)) {
      this.#lastClick = null;
    }
  };

  #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const point = this.#screenPoint(event);
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
    this.#changedView(zoomedAt(this.#view, factor, point.x, point.y));
  };

  /**
   * A press on the docked note. The note is there only because the first click of
   * a double-click selected something, and docking it can put it right where the
   * second click lands. The words that open are still the ones the first click
   * found, and the press makes no pick of its own: cancelling it takes the
   * compatibility click with it.
   */
  #onMenuPress = (event: PointerEvent): void => {
    const first = this.#lastClick;
    if (first === null || event.button !== 0) {
      return;
    }
    const press: Press = {
      id: null,
      at: this.#screenPoint(event),
      time: event.timeStamp,
      shift: event.shiftKey,
    };
    if (!this.#isDoubleClick(first, press)) {
      return;
    }
    this.#lastClick = null;
    const opening =
      first.id === null ? undefined : this.#scene.elements.find((element) => element.id === first.id);
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
    this.#openWords(opening);
  };

  /**
   * The click the press that opened the words owes the note: run nothing. Any
   * other click is the note's, because a press of its own reaches the document
   * first and clears the debt.
   */
  #onMenuClickPress = (event: MouseEvent): void => {
    if (!this.#cancelledClick) {
      return;
    }
    this.#cancelledClick = false;
    // A click the keyboard made (`detail` 0: Enter or Space on a row) is not the
    // press's own. The person asked for it after the press, so it runs, and the
    // press owes the note nothing any more.
    if (event.detail === 0 || !this.#menu.contains(event.target as Node | null)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

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

  // ----------------------------------------------------------------- keyboard

  #onKeyDown = (event: KeyboardEvent): void => {
    // A key between two clicks means the person is typing, not double-clicking.
    this.#lastClick = null;
    this.#wordsClick = null;
    if (active !== this || !this.#takesKeys(event.target)) {
      return;
    }
    if (event.key === ' ' || event.code === 'Space') {
      if (!this.#spaceDown) {
        this.#spaceDown = true;
        this.#board.classList.add('hand');
        this.#board.classList.remove('pen');
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
    if (event.key === 'Escape' && this.#drag !== null && this.#drag.kind === 'label') {
      // Half a Label is not a Scene: Escape drops the words back to the place the
      // Scene holds, and the release that follows settles nothing. It answers
      // here, before the gesture that holds the Scene, because that guard is
      // about edits — and an Escape is what keeps one from landing.
      event.preventDefault();
      this.#cancelDrag();
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
      this.#releasePointer();
      this.#board.classList.remove('panning');
    }
    if (!this.#spaceDown) {
      return;
    }
    this.#spaceDown = false;
    this.#board.classList.remove('hand');
    this.#board.classList.toggle('pen', this.#tool !== 'select');
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
    const name = normaliseSceneName(input.value);
    // Asked for by name, so it is a Scene now: Scene and SVG are written at
    // once, as the served and picked-folder editors always have.
    void this.#openScene(name, this.#connection, { create: true });
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
 * The caret on the page, as the drawing gives it: the line and the stroke its
 * slot takes, made into the one path the overlay holds.
 */
function caretPath(slot: Box): SVGPathElement {
  const line = caretLine(slot);
  const node = document.createElementNS(SVG_NS, 'path');
  node.setAttribute('class', 'caret');
  node.setAttribute('stroke-width', String(line.stroke));
  node.setAttribute('d', line.path);
  return node;
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
 * One Element's drawing as the group the page holds: the unit a move moves with
 * a transform, and the unit a redraw replaces. The Renderer writes the same
 * nodes into the saved SVG, so what the page shows is the file it saves.
 */
function groupOf(id: string, svg: string): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('data-element', id);
  const parsed = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}">${svg}</svg>`,
    'image/svg+xml',
  );
  for (const child of Array.from(parsed.documentElement.childNodes)) {
    group.append(document.importNode(child, true));
  }
  return group;
}

function normaliseSceneName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return DEFAULT_SCENE_FILE_NAME;
  }
  // A typed extension is kept as typed, `.json` included; a bare name takes the
  // primary one.
  return sceneExtension(trimmed) === null ? `${trimmed}${PRIMARY_SCENE_EXTENSION}` : trimmed;
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
