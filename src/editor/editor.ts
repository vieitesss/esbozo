/**
 * `<esbozo-editor>`: the Scene editor.
 *
 * It holds the Scene, paints it with the Renderer and edits it with the pointer
 * and the keyboard. Every change saves the Scene and its SVG back to the folder
 * it was opened from: there is no unsaved state and no prompt. Browsing another
 * folder only changes what the Scenes note lists: the open Scene keeps its own
 * `{ folder, name }` destination.
 */
import { fontSizePx } from '../layout.js';
import type { Layout } from '../layout.js';
import { drawnShaft, elementBounds, elementsById, outlineBox, renderScene } from '../renderer.js';
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
import { attachedTo, endPoint, freedEnd, isShaft, otherEnd, released, targetAt, withEnd } from './snap.js';
import type { End } from './snap.js';
import { TextSession } from './text-session.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DOT_SPACING = 22;
const DOT_RADIUS = 1.1;
const SELECTION_PADDING = 5;
const HANDLE_SIZE = 8;
/** How far a Snap target's highlight stands off the target's outline, in screen pixels. */
const SNAP_GROW = 4;
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
  | { kind: 'box'; from: Point; to: Point; additive: boolean };

const SHELL = `
<svg class="canvas" xmlns="${SVG_NS}" aria-label="Scene canvas" tabindex="0">
  <defs>
    <pattern id="esbozo-dots" width="${DOT_SPACING}" height="${DOT_SPACING}" patternUnits="userSpaceOnUse">
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
  /** The page's font, measured: every Text and Label is placed with it, and outlined from it. */
  readonly #layout: Layout;
  /** The family the page draws that font as, which an exported SVG is resolved in. */
  readonly #family: string;
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
  #target: SaveTarget | null = null;
  /** True when the page is served by `ez serve`, so its folder needs no picker. */
  #served = false;
  #drag: Drag | null = null;
  #spaceDown = false;
  #saveQueue: Promise<void> = Promise.resolve();
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
    undo: () => this.#restore(this.#history.undo()),
    redo: () => this.#restore(this.#history.redo()),
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

  constructor(layout: Layout, family: string) {
    super();
    this.#layout = layout;
    this.#family = family;
  }

  connectedCallback(): void {
    if (this.#canvas !== undefined) {
      return;
    }
    this.innerHTML = SHELL;
    this.#canvas = this.querySelector('.canvas')!;
    this.#viewport = this.querySelector('.viewport')!;
    this.#painted = this.querySelector('.painted')!;
    this.#overlay = this.querySelector('.overlay')!;
    this.#gridRect = this.querySelector('.grid-rect')!;
    this.#dots = this.querySelector('#esbozo-dots')!;
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
    this.#showDefaultRoughness();
    this.#view = fittedView(this.#scene, this.#viewportSize(), this.#layout);
    this.#paint();
    void this.#joinServer();
  }

  disconnectedCallback(): void {
    document.removeEventListener('copy', this.#onCopy);
    document.removeEventListener('cut', this.#onCut);
    document.removeEventListener('paste', this.#onPaste);
    document.removeEventListener('keydown', this.#onKeyDown);
    document.removeEventListener('keyup', this.#onKeyUp);
    document.removeEventListener('visibilitychange', this.#endSpacePan);
    window.removeEventListener('resize', this.#onResize);
    window.removeEventListener('blur', this.#endSpacePan);
  }

  /**
   * Join the folder `ez serve` is serving, when the page is served at all: it
   * lists the Scenes and opens the first, so a served editor needs no folder
   * picker. A static page gets `null` and keeps its Open folder button.
   */
  async #joinServer(): Promise<void> {
    let folder: SceneFolder | null;
    try {
      folder = await servedFolder();
    } catch (error) {
      this.#setSaved('failed', (error as Error).message);
      return;
    }
    if (folder === null) {
      return;
    }
    this.#served = true;
    this.#browsed = folder;
    this.querySelector('[data-act="open"]')!.textContent = 'Scenes';
    this.#modeLabel.textContent = folder.readOnly ? 'read-only' : '';
    this.#newScene.hidden = folder.readOnly;
    try {
      const [first] = await folder.listScenes();
      if (first === undefined) {
        await this.#showNote();
        return;
      }
      await this.#openScene(first);
    } catch (error) {
      this.#setSaved('failed', (error as Error).message);
    }
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
   * file that is not there opens as an empty Scene, and both files are written
   * straight away so the folder and the page agree.
   */
  async #openScene(name: string): Promise<void> {
    const folder = this.#browsed;
    if (folder === null) {
      this.#setSaved('failed', 'open a folder first');
      return;
    }
    await this.#saveQueue;
    let source: string | null;
    try {
      source = await folder.read(name);
    } catch (error) {
      this.#setSaved('failed', `cannot read ${name}: ${(error as Error).message}`);
      return;
    }
    if (source === null) {
      this.#load(emptyScene(stemOf(name)), { folder, name });
      await this.#save();
      return;
    }
    const parsed = parseScene(source);
    if (!parsed.ok) {
      const first = parsed.problems[0];
      const where = first === undefined ? '' : first.elementId === null ? '' : `${first.elementId}: `;
      const message = first === undefined ? 'invalid Scene' : `${where}${first.message}`;
      this.#setSaved('failed', `${name}: ${message}`);
      return;
    }
    this.#load(parsed.scene, { folder, name });
    // A read-only folder saved nothing: the status bar says only that.
    this.#setSaved(folder.readOnly ? 'idle' : 'saved');
  }

  /**
   * Write the Scene and the SVG beside it, in the folder the Scene came from.
   * Writes land in order, and the status says `saved` only for the last one
   * queued, so it never claims a Scene that a newer edit has overtaken.
   */
  async #save(): Promise<void> {
    const target = this.#target;
    // A read-only folder says so in the status bar; there is nothing to write.
    if (target === null || target.folder.readOnly) {
      return;
    }
    const sceneSource = serialiseScene(this.#scene);
    const svgSource = renderScene(this.#scene, this.#layout);
    this.#setSaved('saving');
    const writing = this.#saveQueue.then(async () => {
      try {
        await target.folder.write(target.name, sceneSource, svgSource);
        if (this.#saveQueue === writing) {
          this.#setSaved('saved');
        }
      } catch (error) {
        this.#setSaved('failed', (error as Error).message);
      }
    });
    this.#saveQueue = writing;
    await writing;
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
    this.#setTool('select');
    this.#showDefaultRoughness();
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
    if (drag.kind === 'end') {
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
      (drag.kind === 'draw' || drag.kind === 'move' || drag.kind === 'resize' || drag.kind === 'end')
    );
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

  /** A Scene taken back from the history is the Scene to save, so undo autosaves too. */
  #restore(source: string | null): void {
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
    this.#scene.elements = without(this.#scene.elements, ids);
    this.#selected = this.#selected.filter((id) => !ids.has(id));
    this.#paint();
    this.#record();
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
    if (this.#typing(event.target) || this.#gestureHoldsScene()) {
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
    if (this.#typing(event.target) || this.#gestureHoldsScene()) {
      return;
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    this.#insertCopies(parseFragment(text, this.#scene.defaults) ?? []);
    event.preventDefault();
  };

  /** Cut is a copy the page also deletes: one event carries the text, one step edits. */
  #onCut = (event: ClipboardEvent): void => {
    if (this.#typing(event.target) || this.#gestureHoldsScene()) {
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
    this.#scene.elements = [...this.#scene.elements, ...added];
    this.#selected = added.map((element) => element.id);
    this.#paint();
    this.#record();
  }

  /** Put a tool in hand: the rail marks it, and only a drawing tool shows the pencil. */
  #setTool(tool: ToolId): void {
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
   * The one way a style, Arrange or Snap change lands: the changed Scene
   * replaces the current one, the page repaints, and the edit is one undo step
   * and one autosaved write. A change that leaves the Scene as it was writes
   * nothing, but the page still follows, so a gesture that ends where it began
   * leaves no preview or highlight behind.
   *
   * Undo history (#7) hooks here: every style, Arrange and Snap edit passes
   * through this call, so one hook covers them all.
   */
  #applyScene(next: Scene): void {
    if (serialiseScene(next) !== serialiseScene(this.#scene)) {
      this.#scene = next;
      this.#record();
    }
    this.#refresh();
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
      if (selected.length === 1 && first !== undefined) {
        this.#drawHandles(overlay, first);
      }
    }
    const drag = this.#drag;
    if (drag !== null && drag.kind === 'box') {
      const swept = boxBetween(drag.from, drag.to);
      this.#appendRect(overlay, { ...swept, class: 'sweep' });
    }
    if (drag !== null && (drag.kind === 'draw' || drag.kind === 'end') && drag.target !== null) {
      const target = this.#scene.elements.find((element) => element.id === drag.target);
      if (target !== undefined && isOutlined(target)) {
        // The Element the dragged end would attach to, so a drop is no surprise.
        const outline = outlineBox(target);
        const grow = SNAP_GROW / this.#view.zoom;
        this.#appendRect(overlay, {
          x: outline.x - grow,
          y: outline.y - grow,
          width: outline.width + grow * 2,
          height: outline.height + grow * 2,
          class: 'snap',
        });
      }
    }
  }

  /**
   * The drag targets of a lone selection: eight around a box's outline, or the
   * two ends of an arrow or line, where they draw — a Snapped end rides its
   * target's outline, so its handle is there too.
   */
  #drawHandles(overlay: SVGGElement, element: SceneElement): void {
    const handles: Array<{ at: Point; name: string }> = [];
    if (isOutlined(element)) {
      const outline = outlineBox(element);
      for (const handle of HANDLES) {
        handles.push({ at: handlePoint(outline, handle), name: handle });
      }
    } else if (isShaft(element)) {
      const [start, end] = drawnShaft(element, elementsById(this.#shownElements()));
      handles.push({ at: start, name: 'start' }, { at: end, name: 'end' });
    }
    const size = HANDLE_SIZE / this.#view.zoom;
    for (const handle of handles) {
      const node = this.#appendRect(overlay, {
        x: handle.at.x - size / 2,
        y: handle.at.y - size / 2,
        width: size,
        height: size,
        class: `handle handle-${handle.name}`,
      });
      node.setAttribute('data-handle', handle.name);
      node.setAttribute('data-element', element.id);
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
    const handle = target?.closest('[data-handle]') ?? null;
    if (handle !== null) {
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
      // A move frees the ends the selection had, where they draw now, so an
      // arrow that followed its Elements is carried rather than pinned.
      const byId = elementsById(this.#scene.elements);
      const origins = new Map(
        this.#selectedElements().map((element) => [element.id, released(element, byId)]),
      );
      this.#drag = { kind: 'move', from: point, origins, shown: new Map() };
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
    this.#selected = [drag.id];
    this.#applyScene({ ...this.#scene, elements: [...this.#scene.elements, settled] });
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
    this.#scene = parsed.scene;
    this.#selected = [element.id];
    this.#paint();
    this.#record();
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
    if (this.#typing(event.target)) {
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
    const byId = elementsById(this.#scene.elements);
    this.#scene.elements = this.#scene.elements.map((element) =>
      selected.has(element.id) ? moved(released(element, byId), dx, dy) : element,
    );
    this.#refresh();
    // A nudge that cannot move what is selected records and saves nothing, and
    // a burst of them is one step: the same undo takes the whole nudge back.
    const now = Date.now();
    this.#record(now - this.#nudgedAt < NUDGE_BURST_MS);
    this.#nudgedAt = now;
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
    void this.#openScene(name);
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

  #setSaved(state: 'idle' | 'saving' | 'saved' | 'failed', detail = ''): void {
    this.#savedLabel.dataset['state'] = state;
    this.#savedLabel.textContent =
      state === 'failed'
        ? detail
        : state === 'saving'
          ? 'saving…'
          : state === 'saved'
            ? 'saved'
            : '';
  }
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
 * instead of showing an editor that cannot draw.
 */
export type PageFont =
  | { ok: true; layout: Layout; family: string }
  | { ok: false; problem: string };

/**
 * The page shell with no editor behind it, for a page whose font did not load.
 * It is the same shell — the tools and the status line a person sees — with the
 * problem in the status line, so the page stays usable-looking and says why it
 * is not.
 */
class UnavailableEditorElement extends HTMLElement {
  readonly #problem: string;

  constructor(problem: string) {
    super();
    this.#problem = problem;
  }

  connectedCallback(): void {
    this.innerHTML = SHELL;
    const saved = this.querySelector('.saved')!;
    saved.setAttribute('data-state', 'failed');
    saved.textContent = this.#problem;
  }
}

/**
 * Registers the element with the measurement its page draws words with. The
 * browser builds a custom element with no arguments, so the Layout arrives
 * through this closure rather than through the constructor call. A page without
 * one registers the shell alone, so a font that will not load is a visible
 * problem rather than a blank page.
 */
export function defineEditorElement(font: PageFont): void {
  if (customElements.get('esbozo-editor')) {
    return;
  }
  if (font.ok) {
    const { layout, family } = font;
    customElements.define(
      'esbozo-editor',
      class extends EsbozoEditorElement {
        constructor() {
          super(layout, family);
        }
      },
    );
    return;
  }
  const { problem } = font;
  customElements.define(
    'esbozo-editor',
    class extends UnavailableEditorElement {
      constructor() {
        super(problem);
      }
    },
  );
}
