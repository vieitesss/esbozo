/**
 * `<esbozo-editor>`: the Scene editor.
 *
 * It holds the Scene, paints it with the Renderer and edits it with the pointer
 * and the keyboard. Every change saves the Scene and its SVG back to the folder
 * it was opened from: there is no unsaved state and no prompt. Browsing another
 * folder only changes what the Scenes note lists: the open Scene keeps its own
 * `{ folder, name }` destination.
 */
import type { Layout } from '../layout.js';
import { elementsById, outlineBox, renderScene } from '../renderer.js';
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
  TEXT_SIZE_PX,
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
import { pickFolder } from './files.js';
import { servedFolder } from './server-folder.js';
import type { SceneFolder } from './files.js';
import {
  HANDLES,
  boxBetween,
  boxOf,
  elementAt,
  elementsInBox,
  fittedView,
  handlePoint,
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
import { toolAt, toolForLetter } from './tools.js';
import type { ToolId } from './tools.js';

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
<svg class="canvas" xmlns="${SVG_NS}" aria-label="Scene canvas">
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
  <span class="zoom">100%</span>
  <span class="where"></span>
  <span class="mode"></span>
  <span class="saved" role="status" data-state="idle"></span>
  <span class="hint">Space pan · wheel zoom · ⌘ +/− · G Grid</span>
</footer>
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
  /** The page's font, measured: every Text and Label is placed with it. */
  readonly #layout: Layout;
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

  #canvas!: SVGSVGElement;
  #viewport!: SVGGElement;
  #painted!: SVGGElement;
  #overlay!: SVGGElement;
  #gridRect!: SVGRectElement;
  #dots!: SVGPatternElement;
  #rail!: HTMLElement;
  #railArt!: SVGSVGElement;
  /** The in-place input a new Text is typed into, while it is open. */
  #textInput: HTMLTextAreaElement | null = null;
  #textAt: Point | null = null;
  #note!: HTMLElement;
  #files!: HTMLUListElement;
  #newScene!: HTMLFormElement;
  #zoomLabel!: HTMLElement;
  #whereLabel!: HTMLElement;
  #modeLabel!: HTMLElement;
  #savedLabel!: HTMLElement;

  constructor(layout: Layout) {
    super();
    this.#layout = layout;
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

    this.#canvas.addEventListener('pointerdown', this.#onPointerDown);
    this.#canvas.addEventListener('pointermove', this.#onPointerMove);
    this.#canvas.addEventListener('pointerup', this.#onPointerUp);
    this.#canvas.addEventListener('pointercancel', this.#onPointerUp);
    this.#canvas.addEventListener('wheel', this.#onWheel, { passive: false });
    this.#canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.#rail.addEventListener('click', this.#onRailClick);
    this.querySelector('.status')!.addEventListener('click', this.#onStatusClick);
    document.addEventListener('copy', this.#onCopy);
    document.addEventListener('paste', this.#onPaste);
    this.#newScene.addEventListener('submit', this.#onNewScene);
    this.#files.addEventListener('click', this.#onFileClick);
    document.addEventListener('keydown', this.#onKeyDown);
    document.addEventListener('keyup', this.#onKeyUp);
    window.addEventListener('resize', this.#onResize);

    requestAnimationFrame(() => this.#drawRailArt());
    this.#view = fittedView(this.#scene, this.#viewportSize(), this.#layout);
    this.#paint();
    void this.#joinServer();
  }

  disconnectedCallback(): void {
    document.removeEventListener('copy', this.#onCopy);
    document.removeEventListener('paste', this.#onPaste);
    document.removeEventListener('keydown', this.#onKeyDown);
    document.removeEventListener('keyup', this.#onKeyUp);
    window.removeEventListener('resize', this.#onResize);
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
    this.#view = fittedView(scene, this.#viewportSize(), this.#layout);
    this.#whereLabel.textContent = `${target.folder.name} / ${target.name}`;
    this.#note.hidden = true;
    this.#setTool('select');
    this.#paint();
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

  #undo(): void {
    this.#restore(this.#history.undo());
  }

  #redo(): void {
    this.#restore(this.#history.redo());
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
    this.#paint();
    void this.#save();
  }

  /** Delete the selected Elements, as one step. A Snap to a deleted target is dropped. */
  #deleteSelected(): void {
    const removed = new Set(this.#selected);
    if (removed.size === 0) {
      return;
    }
    this.#scene.elements = without(this.#scene.elements, removed);
    this.#selected = [];
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
    const selected = this.#selectedElements();
    if (selected.length === 0) {
      return;
    }
    event.clipboardData?.setData('text/plain', serialiseFragment(this.#scene, selected));
    event.preventDefault();
  };

  /** Paste Scene JSON text from the clipboard, with new ids, offset off what is here. */
  #onPaste = (event: ClipboardEvent): void => {
    if (this.#typing(event.target) || this.#gestureHoldsScene()) {
      return;
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    this.#insertCopies(parseFragment(text, this.#scene.defaults) ?? []);
    event.preventDefault();
  };

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
    const added = copies(elements, idsOf(this.#scene.elements), COPY_OFFSET);
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

  // ------------------------------------------------------------------ painting

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
    if (this.#textInput !== null) {
      // The click that takes the focus off the words commits them, and goes no
      // further: it is not also a click on the canvas.
      this.#commitText();
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
      const origins = new Map(this.#selectedElements().map((element) => [element.id, element]));
      this.#drag = { kind: 'move', from: point, origins, shown: new Map() };
      this.#paint();
      return;
    }

    if (!event.shiftKey) {
      this.#selected = [];
    }
    this.#drag = { kind: 'box', from: point, to: point, additive: event.shiftKey };
    this.#paint();
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
    this.#scene.elements = [...this.#scene.elements, placed];
    this.#selected = [drag.id];
    this.#paint();
    this.#record();
  }

  /**
   * A minimal in-place input for a new Text: the words are typed where they will
   * sit, in the hand font and at the size the Text draws. Enter on an empty
   * line, Escape and a click elsewhere commit; an empty input leaves nothing
   * behind. While it is open the keys are the input's, not the editor's.
   */
  #openTextInput(at: Point): void {
    this.#setTool('select');
    const page = toPage(this.#view, at);
    const input = document.createElement('textarea');
    input.className = 'text-input';
    input.setAttribute('aria-label', 'Text');
    input.rows = 1;
    input.spellcheck = false;
    input.style.left = `${page.x}px`;
    input.style.top = `${page.y}px`;
    input.style.fontSize = `${TEXT_SIZE_PX[this.#scene.defaults.fontSize] * this.#view.zoom}px`;
    input.addEventListener('keydown', this.#onTextKeyDown);
    input.addEventListener('blur', this.#onTextBlur);
    this.append(input);
    this.#textInput = input;
    this.#textAt = at;
    input.focus();
  }

  #onTextKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.#commitText();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    // Enter on an empty line is the end of the Text; anywhere else it is a
    // line break, which the textarea inserts itself.
    const input = event.currentTarget as HTMLTextAreaElement;
    const before = input.value.slice(0, input.selectionStart);
    if (before.slice(before.lastIndexOf('\n') + 1).trim() === '') {
      event.preventDefault();
      this.#commitText();
    }
  };

  #onTextBlur = (): void => {
    this.#commitText();
  };

  /**
   * Commit the open in-place input: a Text with words in it, or nothing.
   *
   * The Text goes through the Scene module's own validation before it is
   * recorded, so words a Scene file could not hold never reach disk. A refusal
   * says why in the status line and leaves the Scene exactly as it was.
   */
  #commitText(): void {
    const input = this.#textInput;
    const at = this.#textAt;
    if (input === null || at === null) {
      return;
    }
    this.#textInput = null;
    this.#textAt = null;
    const content = input.value.trim();
    input.remove();
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
      this.#paint();
      return;
    }
    if (drag.kind === 'move' || drag.kind === 'resize') {
      // The gesture is over: what the page showed becomes the Scene, as one step.
      this.#scene = this.#shownScene();
      this.#drag = null;
      this.#paint();
      this.#record();
      return;
    }
    this.#drag = null;
    this.#paint();
  };

  #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const point = this.#screenPoint(event);
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
    this.#view = zoomedAt(this.#view, factor, point.x, point.y);
    this.#paint();
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
    if (event.key === 'g' || event.key === 'G') {
      this.#toggleGrid();
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
      return;
    }
    if (this.#editShortcut(event)) {
      return;
    }
    if (event.key.startsWith('Arrow')) {
      const step = event.shiftKey ? NUDGE_WITH_SHIFT : NUDGE;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      if (dx !== 0 || dy !== 0) {
        event.preventDefault();
        this.#nudge(dx, dy);
      }
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      const letter = event.key.toLowerCase();
      if (letter === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          this.#redo();
        } else {
          this.#undo();
        }
        return;
      }
      if (letter === 'd') {
        event.preventDefault();
        this.#duplicate();
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        this.#zoomBy(ZOOM_STEP);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        this.#zoomBy(1 / ZOOM_STEP);
      } else if (event.key === '0') {
        event.preventDefault();
        this.#view = fittedView(this.#scene, this.#viewportSize(), this.#layout);
        this.#paint();
      }
    }
  };

  #onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === ' ' || event.code === 'Space') {
      this.#spaceDown = false;
      this.#canvas.classList.remove('hand');
      this.#canvas.classList.toggle('pen', this.#tool !== 'select');
    }
  };

  #onResize = (): void => {
    this.#drawRailArt();
    this.#paint();
  };

  #nudge(dx: number, dy: number): void {
    const selected = new Set(this.#selected);
    if (selected.size === 0) {
      return;
    }
    this.#scene.elements = this.#scene.elements.map((element) =>
      selected.has(element.id) ? moved(element, dx, dy) : element,
    );
    this.#paint();
    // A nudge that cannot move what is selected records and saves nothing, and
    // a burst of them is one step: the same undo takes the whole nudge back.
    const now = Date.now();
    this.#record(now - this.#nudgedAt < NUDGE_BURST_MS);
    this.#nudgedAt = now;
  }

  /**
   * The keys that edit the Scene rather than the view: a tool by its letter or
   * by its place on the rail (1–7), delete, duplicate and the history. Returns
   * whether one answered the key, so a view key never also reads it.
   */
  #editShortcut(event: KeyboardEvent): boolean {
    if (event.metaKey || event.ctrlKey) {
      return false;
    }
    if (event.key === 'x' || event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      this.#deleteSelected();
      return true;
    }
    if (event.key.toLowerCase() === 'c') {
      event.preventDefault();
      this.#duplicate();
      return true;
    }
    if (event.key >= '1' && event.key <= '7') {
      const tool = toolAt(Number(event.key));
      if (tool !== null) {
        event.preventDefault();
        this.#setTool(tool);
        return true;
      }
    }
    const tool = toolForLetter(event.key);
    if (tool !== null) {
      event.preventDefault();
      this.#setTool(tool);
      return true;
    }
    return false;
  }

  #zoomBy(factor: number): void {
    const size = this.#viewportSize();
    this.#view = zoomedAt(this.#view, factor, size.width / 2, size.height / 2);
    this.#paint();
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
    }
  };

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
export type PageFont = { ok: true; layout: Layout } | { ok: false; problem: string };

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
    const { layout } = font;
    customElements.define(
      'esbozo-editor',
      class extends EsbozoEditorElement {
        constructor() {
          super(layout);
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
