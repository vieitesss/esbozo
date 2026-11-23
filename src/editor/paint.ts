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
 * assembled from these same drawings and from each Element's own JSON.
 *
 * Assembling, not re-serialising, is what keeps a save off the task that asked
 * for it: an edit writes the blocks it already holds, and the hash of those
 * bytes comes from the platform's digest, off the task that asked for it too.
 */
import type { Box, Layout } from '../layout.js';
import { elementsById, renderElement, sceneSvg } from '../renderer.js';
import type { DrawnElement } from '../renderer.js';
import { canonicalElement, sceneJson, serialiseElementJson, snapTargetId } from '../scene.js';
import type { Element, Scene } from '../scene.js';
import { sha256HexAsync } from '../sha256.js';

/** One Element's drawing, and what it was made from. */
export interface PaintedElement extends DrawnElement {
  /** The canonical JSON of the Element and of the outlines its ends snap to. */
  readonly key: string;
  /** The Element's block in the Scene file it saves, as the serialiser writes it. */
  readonly json: string;
}

/** A Scene's file and the SVG beside it: what one save writes. */
export interface SceneFiles {
  readonly json: string;
  readonly svg: string;
}

/** What one frame of the page is made of: the drawings in Scene order. */
export interface Paint {
  readonly elements: ReadonlyMap<string, PaintedElement>;
  readonly order: readonly string[];
  /** The Element each drawing was made from, by id: its box answers for that object alone. */
  readonly drawn: ReadonlyMap<string, Element>;
  /** The Elements by id, so a Snapped end of what is shown resolves its target. */
  readonly byId: ReadonlyMap<string, Element>;
}

/**
 * The ink a press answers to, from the frame the page has already drawn: that
 * frame's own box, for the Scene it was drawn for and the very Element it drew
 * it from. Anything else is not the page's drawing of what it shows — a Scene
 * edited since (a nudge, a move, an undo, another Scene under the same ids), a
 * measurement that landed after the frame, a preview of one, or the words being
 * typed, which are drawn for the words — so a press there measures instead of
 * reading a box of a place its Element no longer has.
 */
export function paintedInk(
  paint: Paint | null,
  drawnFor: Scene | null,
  scene: Scene,
  element: Element,
): Box | null {
  if (paint === null || drawnFor !== scene || paint.drawn.get(element.id) !== element) {
    return null;
  }
  return paint.elements.get(element.id)?.ink ?? null;
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
    const id = snapTargetId(point);
    const target = id === null ? undefined : byId.get(id);
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

  /** Which measurement the drawings in hand are keyed on: a new one is a new drawing. */
  get generation(): number {
    return this.#generation;
  }
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
    return { key, json: elementJson(element), ...renderElement(element, byId, this.#layout) };
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
    // The Elements these boxes were drawn from, by id: a box answers for the
    // very object it was drawn from, and for no other that takes its place.
    const drawn = new Map<string, Element>();
    for (const element of shown) {
      drawn.set(element.id, element);
    }
    return { elements, order, byId, drawn };
  }

  /**
   * The Scene's file and the SVG beside it, out of the JSON and the drawings in
   * hand: no Element is serialised or drawn twice for one edit. The bytes are
   * `serialiseScene`'s and `renderScene`'s own — the hash is the platform's
   * digest of the file's own bytes, so it is the CLI's hash too.
   */
  async files(scene: Scene): Promise<SceneFiles> {
    const drawings = this.#drawingsFor(scene);
    const json = sceneFile(scene);
    return { json, svg: sceneSvg(scene, await sha256HexAsync(json), drawings) };
  }

  /**
   * A Scene's drawings, Element by Element, out of the ones in hand: the drawing
   * already made where the key says it is still the same, and a fresh draw of
   * the Element where it is not. Nothing is stored, so a Scene a save speaks for
   * — the one the page held a frame ago — never takes the drawings the page is
   * showing.
   */
  #drawingsFor(scene: Scene): readonly PaintedElement[] {
    const canonical = scene.elements.map(canonicalElement);
    const byId = elementsById(canonical);
    return canonical.map((element) => this.element(element, byId));
  }
}

/**
 * A Scene's file, assembled from the Element blocks already in hand: the bytes
 * `serialiseScene` writes, without serialising the Elements that did not change.
 *
 * This is the editor's own path, and it holds because a Scene is edited by
 * replacing the Elements that changed — the ones that did not are the same
 * objects, so their block in the file is the string it already was. A Scene
 * mutated in place has to go through `serialiseScene`, which reads every
 * Element it writes.
 */
export function sceneFile(scene: Scene): string {
  return sceneJson(scene, scene.elements.map((element) => elementJson(element)));
}

/**
 * The Element JSON blocks made so far, by the Element object they were made
 * from, so a frame, a history step and a save share one serialisation per
 * Element instead of one Scene apiece.
 */
const JSON_OF = new WeakMap<Element, string>();

/** One Element's block in the Scene file, made once per Element. */
function elementJson(element: Element): string {
  const held = JSON_OF.get(element);
  if (held !== undefined) {
    return held;
  }
  // The file holds whole pixels, as the drawing does: an Element the editor
  // holds mid-gesture is saved as the Element it will be.
  const json = serialiseElementJson(canonicalElement(element));
  JSON_OF.set(element, json);
  return json;
}
