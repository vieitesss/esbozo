/**
 * The painted Scene: each Element's drawing, kept between frames.
 *
 * A frame costs what the gesture changes, not what the Scene holds. An Element
 * whose canonical JSON — and the outlines a Snapped end resolves against — is
 * the same as the one painted keeps the SVG it already has, so dragging one
 * Element in a Scene of three hundred draws one Element, and a pan or a zoom
 * draws none.
 *
 * The drawing is the Renderer's own, Element for Element: what the page shows
 * and what `ez render` writes are the same bytes, because the saved file is
 * assembled by `sceneSvg` from these same drawings.
 */
import type { Layout } from '../layout.js';
import { elementsById, renderElement, sceneSvg } from '../renderer.js';
import type { ElementDrawing } from '../renderer.js';
import { canonicalElement, canonicalScene, hashScene } from '../scene.js';
import type { Element, Scene } from '../scene.js';

/** One Element's drawing, and what it was made from. */
export interface PaintedElement extends ElementDrawing {
  /** The canonical JSON of the Element and of the outlines its ends snap to. */
  readonly key: string;
}

/** What one frame of the page is made of: the drawings in Scene order. */
export interface Paint {
  readonly elements: ReadonlyMap<string, PaintedElement>;
  readonly order: readonly string[];
  /** The Elements by id, so a Snapped end of what is shown resolves its target. */
  readonly byId: ReadonlyMap<string, Element>;
}

/**
 * Everything one Element's drawing depends on: the measurement it was made with
 * — a font decides how a Label breaks, so it is part of the drawing and not of
 * the face alone — the Element's own canonical JSON, and the canonical JSON of
 * whatever its ends snap to, because a Snap draws the end on the target's
 * outline. Anything else — a theme, a colour, the page around the drawing — is
 * a CSS variable the SVG names rather than a value it holds.
 */
function paintKey(
  generation: number,
  element: Element,
  byId: ReadonlyMap<string, Element>,
): string {
  const key = `${generation}|${JSON.stringify(element)}`;
  if (element.type !== 'arrow' && element.type !== 'line') {
    return key;
  }
  return element.points.reduce((whole, point) => {
    const target = point.snap === undefined ? undefined : byId.get(point.snap);
    return `${whole}|${target === undefined ? '' : JSON.stringify(target)}`;
  }, key);
}

/** The drawings a page shows, and the one measurement they were made with. */
export class PaintCache {
  #layout: Layout;
  /**
   * Which measurement the drawings are keyed on. The key is what the page keeps
   * a drawn group by as well, so a new font has to move it or the page would
   * hold the layout the old one broke.
   */
  #generation = 0;
  /** The last painting, by Element id: what a frame reuses. */
  #elements = new Map<string, PaintedElement>();

  constructor(layout: Layout) {
    this.#layout = layout;
  }

  /**
   * A new measurement: every Label may break differently, so nothing painted
   * with the old one is reused.
   */
  measure(layout: Layout): void {
    this.#layout = layout;
    this.#generation += 1;
    this.#elements.clear();
  }

  /**
   * A Scene that replaces the one these drawings were made for. Nothing kept
   * here can speak for it: the ids may be the same and mean something else.
   */
  clear(): void {
    this.#elements.clear();
  }

  /**
   * One canonical Element's drawing: the last one painted, when the Element and
   * the outlines it snaps to are unchanged, and a fresh draw when they are not.
   */
  element(element: Element, byId: ReadonlyMap<string, Element>): PaintedElement {
    const key = paintKey(this.#generation, element, byId);
    const painted = this.#elements.get(element.id);
    if (painted !== undefined && painted.key === key) {
      return painted;
    }
    return { key, ...renderElement(element, byId, this.#layout) };
  }

  /** The Scene as it is shown now — gesture and all — drawn Element by Element. */
  paint(shown: readonly Element[]): Paint {
    const canonical = shown.map(canonicalElement);
    const byId = elementsById(canonical);
    const elements = new Map<string, PaintedElement>();
    const order: string[] = [];
    for (const element of canonical) {
      elements.set(element.id, this.element(element, byId));
      order.push(element.id);
    }
    // Only what this Scene holds is kept: an Element that left the page is not
    // held for a return that may never come.
    this.#elements = elements;
    return { elements, order, byId };
  }

  /**
   * The SVG the Scene saves, out of the drawings the page already shows: no
   * Element is drawn twice for one edit. The bytes are `renderScene`'s own,
   * hash, page and title included.
   */
  svg(scene: Scene): string {
    const canonical = canonicalScene(scene);
    const byId = elementsById(canonical.elements);
    const drawings = canonical.elements.map((element) => this.element(element, byId));
    return sceneSvg(canonical, hashScene(canonical), drawings);
  }
}
