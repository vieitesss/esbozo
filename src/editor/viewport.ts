/**
 * The page's view of the Scene: which part of the paper is on screen, at what
 * size, and every conversion between a Scene point and a pixel of the page.
 *
 * The view is three numbers — a zoom and a pan — and nothing else. Panning and
 * zooming are one CSS transform on the `.surface` wrapper, so a zoom lays the
 * drawing out once and composites; the Grid and the overlay stand in screen
 * space and are counter-moved, so a dot keeps its size and a handle its width at
 * every zoom. `apply` writes those numbers to the page, and writes nothing when
 * they did not move, so a frame that only changed the selection costs no style
 * recalculation at all.
 *
 * The paper the Scene is drawn on is `.board`, not the element's border box: a
 * host may draw its own border and padding around the editor, and the view is a
 * transform *inside* the element. Measure the board to keep the host's border
 * and padding out of pointer coordinates.
 */
import { toScene, toScreen } from './geometry.js';
import type { Box, Point, Pointer, View } from './geometry.js';

/** The page's box, in layout pixels, with its scale from client pixels. */
interface PageBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

/** The nodes the view writes to, and the room it maps into. */
export interface ViewportParts {
  /** The paper the Scene is drawn on: what the view moves inside. */
  readonly board: HTMLElement;
  /** The wrapper the one transform is written to. */
  readonly surface: HTMLElement;
  /** The Grid's counter-moved group, which keeps a dot its own size. */
  readonly grid: SVGGElement;
  /** The Grid's rect, which `showGrid` puts on the page and takes off it. */
  readonly gridRect: SVGRectElement;
  /** The overlay's counter-moved group, which keeps a handle its own width. */
  readonly overlay: SVGGElement;
  /** The status line's zoom reading. */
  readonly zoom: HTMLElement;
}

export class Viewport {
  readonly #parts: ViewportParts;
  #view: View = { zoom: 1, panX: 0, panY: 0 };
  /** The view the page was last moved to, so a frame that did not move it writes nothing. */
  #applied: View | null = null;

  constructor(parts: ViewportParts) {
    this.#parts = parts;
  }

  /** Where the page looks, as the numbers a pan, a zoom and a fit change. */
  get view(): View {
    return this.#view;
  }

  set view(view: View) {
    this.#view = view;
  }

  /** The paper's box on the page, before the view moves anything. */
  box(): PageBox {
    const board = this.#parts.board;
    const rect = board.getBoundingClientRect();
    const layoutWidth = board.offsetWidth;
    const layoutHeight = board.offsetHeight;
    const scaleX = layoutWidth > 0 && rect.width > 0 ? rect.width / layoutWidth : 1;
    const scaleY = layoutHeight > 0 && rect.height > 0 ? rect.height / layoutHeight : 1;
    return {
      left: rect.left,
      top: rect.top,
      width: layoutWidth || rect.width || window.innerWidth,
      height: layoutHeight || rect.height || window.innerHeight,
      scaleX,
      scaleY,
    };
  }

  /** How much room the paper has, which a fitted view is measured against. */
  size(): { width: number; height: number } {
    const box = this.box();
    return { width: box.width, height: box.height };
  }

  /** A pointer's place, in the Scene's own units. */
  scenePoint(pointer: Pointer): Point {
    const { x, y } = this.screenPoint(pointer);
    return toScene(this.#view, x, y);
  }

  /** A pointer's place, in the pixels the overlay draws in. */
  screenPoint(pointer: Pointer): Point {
    const box = this.box();
    return {
      x: (pointer.clientX - box.left) / box.scaleX,
      y: (pointer.clientY - box.top) / box.scaleY,
    };
  }

  /** An element's box relative to the paper, in the pixels the overlay draws in. */
  localBox(element: Element): Box {
    const page = this.box();
    const rect = element.getBoundingClientRect();
    return {
      x: (rect.left - page.left) / page.scaleX,
      y: (rect.top - page.top) / page.scaleY,
      width: rect.width / page.scaleX,
      height: rect.height / page.scaleY,
    };
  }

  /** A Scene box, in the pixels the overlay draws in. */
  pageBox(box: Box): Box {
    const { zoom } = this.#view;
    return { ...toScreen(this.#view, box), width: box.width * zoom, height: box.height * zoom };
  }

  /** A Scene point, in the pixels the overlay draws in. */
  pagePoint(point: Point): Point {
    return toScreen(this.#view, point);
  }

  /** Move the painted Scene: one transform on the wrapper, and the counter-moves. */
  apply(): void {
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
    const { surface, grid, overlay, zoom: reading } = this.#parts;
    surface.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    const screen = `scale(${1 / zoom}) translate(${-panX} ${-panY})`;
    grid.setAttribute('transform', screen);
    overlay.setAttribute('transform', screen);
    const label = `${Math.round(zoom * 100)}%`;
    if (reading.textContent !== label) {
      reading.textContent = label;
    }
  }

  /** The dot Grid, on or off. Its spacing is the screen's own: the view scales the paper, not the dots. */
  showGrid(on: boolean): void {
    this.#parts.gridRect.style.display = on ? '' : 'none';
  }
}
