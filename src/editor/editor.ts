/**
 * `<esbozo-editor>`: the Scene editor.
 *
 * It holds the Scene, paints it with the Renderer and edits it with the pointer
 * and the keyboard. Every change saves the Scene and its SVG back to the folder
 * it was opened from: there is no unsaved state and no prompt. Browsing another
 * folder only changes what the Scenes note lists: the open Scene keeps its own
 * `{ folder, name }` destination.
 */
import { elementsById, renderScene } from '../renderer.js';
import { emptyScene, isOutlined, parseScene, serialiseScene } from '../scene.js';
import type { Element as SceneElement, Scene } from '../scene.js';
import { sceneStem } from '../paths.js';
import { pickFolder } from './files.js';
import type { SceneFolder } from './files.js';
import {
  HANDLES,
  boxBetween,
  boxOf,
  boxOfElement,
  elementAt,
  elementsInBox,
  fittedView,
  handlePoint,
  moved,
  resized,
  resizedBox,
  toScene,
  zoomedAt,
} from './geometry.js';
import type { Box, Handle, Point, View } from './geometry.js';
import { railArt, railMarkup } from './rail.js';

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

/** Where the open Scene saves: the folder and the name it was opened from. */
interface SaveTarget {
  readonly folder: SceneFolder;
  readonly name: string;
}

type Drag =
  | { kind: 'pan'; fromScreen: Point; start: View }
  | { kind: 'move'; from: Point; origins: Map<string, SceneElement>; before: string }
  | { kind: 'resize'; id: string; handle: Handle; origin: Box; from: Point; before: string }
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
  #scene: Scene = emptyScene();
  #selected: string[] = [];
  #view: View = { zoom: 1, panX: 0, panY: 0 };
  #grid = true;
  /** The folder the Scenes note lists. Browsing it never moves the save target. */
  #browsed: SceneFolder | null = null;
  #target: SaveTarget | null = null;
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
  #note!: HTMLElement;
  #files!: HTMLUListElement;
  #newScene!: HTMLFormElement;
  #zoomLabel!: HTMLElement;
  #whereLabel!: HTMLElement;
  #savedLabel!: HTMLElement;

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
    this.#savedLabel = this.querySelector('.saved')!;

    this.#canvas.addEventListener('pointerdown', this.#onPointerDown);
    this.#canvas.addEventListener('pointermove', this.#onPointerMove);
    this.#canvas.addEventListener('pointerup', this.#onPointerUp);
    this.#canvas.addEventListener('pointercancel', this.#onPointerUp);
    this.#canvas.addEventListener('wheel', this.#onWheel, { passive: false });
    this.#canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.querySelector('.status')!.addEventListener('click', this.#onStatusClick);
    this.#newScene.addEventListener('submit', this.#onNewScene);
    this.#files.addEventListener('click', this.#onFileClick);
    document.addEventListener('keydown', this.#onKeyDown);
    document.addEventListener('keyup', this.#onKeyUp);
    window.addEventListener('resize', this.#onResize);

    requestAnimationFrame(() => this.#drawRailArt());
    this.#view = fittedView(this.#scene, this.#viewportSize());
    this.#paint();
  }

  disconnectedCallback(): void {
    document.removeEventListener('keydown', this.#onKeyDown);
    document.removeEventListener('keyup', this.#onKeyUp);
    window.removeEventListener('resize', this.#onResize);
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
    this.#setSaved('saved');
  }

  /**
   * Write the Scene and the SVG beside it, in the folder the Scene came from.
   * Writes land in order, and the status says `saved` only for the last one
   * queued, so it never claims a Scene that a newer edit has overtaken.
   */
  async #save(): Promise<void> {
    const target = this.#target;
    if (target === null) {
      return;
    }
    const sceneSource = serialiseScene(this.#scene);
    const svgSource = renderScene(this.#scene);
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
    this.#view = fittedView(scene, this.#viewportSize());
    this.#whereLabel.textContent = `${target.folder.name} / ${target.name}`;
    this.#note.hidden = true;
    this.#paint();
  }

  #selectedElements(): SceneElement[] {
    return this.#scene.elements.filter((element) => this.#selected.includes(element.id));
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
    const key = serialiseScene(this.#scene);
    if (key === this.#paintedFor) {
      return;
    }
    this.#paintedFor = key;
    const document_ = new DOMParser().parseFromString(renderScene(this.#scene), 'image/svg+xml');
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
    const box = boxOf(selected, elementsById(this.#scene.elements));
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
        for (const handle of HANDLES) {
          const point = handlePoint(box, handle);
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
    this.#canvas.setPointerCapture(event.pointerId);
    const target = event.target as Element | null;
    if (this.#spaceDown || event.button === 1) {
      this.#drag = { kind: 'pan', fromScreen: this.#screenPoint(event), start: { ...this.#view } };
      this.#canvas.classList.add('panning');
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
          origin: boxOfElement(element, elementsById(this.#scene.elements)),
          from: this.#scenePoint(event),
          before: serialiseScene(this.#scene),
        };
        return;
      }
    }

    const point = this.#scenePoint(event);
    const hit = elementAt(this.#scene.elements, point, PICK_TOLERANCE / this.#view.zoom);
    if (hit !== null) {
      if (event.shiftKey) {
        this.#selected = this.#selected.includes(hit.id)
          ? this.#selected.filter((id) => id !== hit.id)
          : [...this.#selected, hit.id];
      } else if (!this.#selected.includes(hit.id)) {
        this.#selected = [hit.id];
      }
      const origins = new Map(this.#selectedElements().map((element) => [element.id, element]));
      this.#drag = { kind: 'move', from: point, origins, before: serialiseScene(this.#scene) };
      this.#paint();
      return;
    }

    if (!event.shiftKey) {
      this.#selected = [];
    }
    this.#drag = { kind: 'box', from: point, to: point, additive: event.shiftKey };
    this.#paint();
  };

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
    const dx = point.x - drag.from.x;
    const dy = point.y - drag.from.y;
    if (drag.kind === 'move') {
      const origins = drag.origins;
      this.#scene.elements = this.#scene.elements.map((element) => {
        const origin = origins.get(element.id);
        return origin === undefined ? element : moved(origin, dx, dy);
      });
    } else {
      const element = this.#scene.elements.find((candidate) => candidate.id === drag.id);
      if (element === undefined) {
        return;
      }
      const box = resizedBox(drag.origin, drag.handle, dx, dy);
      this.#scene.elements = this.#scene.elements.map((candidate) =>
        candidate.id === drag.id ? resized(element, box) : candidate,
      );
    }
    this.#paint();
  };

  #onPointerUp = (event: PointerEvent): void => {
    const drag = this.#drag;
    this.#drag = null;
    this.#canvas.classList.remove('panning');
    if (drag === null) {
      return;
    }
    if (this.#canvas.hasPointerCapture(event.pointerId)) {
      this.#canvas.releasePointerCapture(event.pointerId);
    }

    if (drag.kind === 'box') {
      const swept = boxBetween(drag.from, drag.to);
      const picked = elementsInBox(this.#scene.elements, swept).map((element) => element.id);
      this.#selected = drag.additive ? [...new Set([...this.#selected, ...picked])] : picked;
      this.#paint();
      return;
    }
    if (drag.kind === 'move' || drag.kind === 'resize') {
      this.#paint();
      if (serialiseScene(this.#scene) !== drag.before) {
        void this.#save();
      }
      return;
    }
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
    const target = event.target as HTMLElement | null;
    if (target !== null && (target.isContentEditable || target.tagName === 'INPUT')) {
      return;
    }
    if (event.key === ' ' || event.code === 'Space') {
      if (!this.#spaceDown) {
        this.#spaceDown = true;
        this.#canvas.classList.add('hand');
      }
      event.preventDefault();
      return;
    }
    if (event.key === 'g' || event.key === 'G') {
      this.#toggleGrid();
      return;
    }
    if (event.key === 'Escape') {
      this.#note.hidden = true;
      this.#selected = [];
      this.#paint();
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
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        this.#zoomBy(ZOOM_STEP);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        this.#zoomBy(1 / ZOOM_STEP);
      } else if (event.key === '0') {
        event.preventDefault();
        this.#view = fittedView(this.#scene, this.#viewportSize());
        this.#paint();
      }
    }
  };

  #onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === ' ' || event.code === 'Space') {
      this.#spaceDown = false;
      this.#canvas.classList.remove('hand');
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
    void this.#save();
  }

  #zoomBy(factor: number): void {
    const size = this.#viewportSize();
    this.#view = zoomedAt(this.#view, factor, size.width / 2, size.height / 2);
    this.#paint();
  }

  // ----------------------------------------------------------------------- UI

  #onStatusClick = (event: Event): void => {
    const action = ((event.target as Element | null)?.closest('[data-act]') as HTMLElement | null)
      ?.dataset['act'];
    if (action === 'open') {
      void this.#openFolder();
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
    this.#newScene.querySelector('input')!.value = '';
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

export function defineEditorElement(): void {
  if (!customElements.get('esbozo-editor')) {
    customElements.define('esbozo-editor', EsbozoEditorElement);
  }
}
