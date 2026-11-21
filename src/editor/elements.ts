/**
 * Making and re-making Elements in the editor: what a drag draws, what a click
 * draws, what a Text with words becomes, and what a copy, a paste or a delete
 * leaves behind.
 *
 * Pure functions over Scene values. The Scene module owns what is valid (whole
 * pixels, a minimum size, a Snap target that exists); these functions produce
 * values that already obey it, and the editor decides when to call them.
 */
import { MIN_SIZE, seedForId } from '../scene.js';
import type { Element, FontSize, Point, SceneStyle, TextElement } from '../scene.js';
import { boxBetween } from './geometry.js';
import type { DrawableType, ToolId } from './tools.js';

/** The box a plain click draws with a box tool, in Scene units. */
export const DEFAULT_BOX = { width: 160, height: 100 };

/** A drag shorter than this, in Scene units, is a plain click. */
export const CLICK_SLOP = 4;

/** The tool ids that draw an Element. */
export type DrawingTool = Exclude<ToolId, 'select'>;

/** The tools that draw a box: everything but a Text, an arrow and a line. */
export type BoxTool = Exclude<DrawingTool, 'text' | 'arrow' | 'line'>;

/** The tools that draw a stroke between two ends. */
export type StrokeTool = Extract<DrawingTool, 'arrow' | 'line'>;

/**
 * Text size per named size, in Scene units. The in-place input a new Text is
 * typed into has to be the size of the Text it becomes, and the Renderer's own
 * numbers live in a private table: #4's Layout takes both over.
 */
export const TEXT_SIZE_PX: Record<FontSize, number> = { S: 14, M: 18, L: 24, XL: 32 };

export function drawable(tool: ToolId): tool is DrawingTool {
  return tool !== 'select';
}

function drawsBox(tool: DrawingTool): tool is BoxTool {
  return tool !== 'text' && tool !== 'arrow' && tool !== 'line';
}

/** A free end: a point no Element is attached to. */
function free(point: Point): Point {
  return { x: point.x, y: point.y };
}

/** A copy of the Scene's style, so a drawn Element never shares the defaults object. */
function styleFrom(defaults: SceneStyle): SceneStyle {
  return {
    roughness: defaults.roughness,
    stroke: { ...defaults.stroke },
    fill: { ...defaults.fill },
    tone: defaults.tone,
    corners: defaults.corners,
    fontSize: defaults.fontSize,
    textAlign: defaults.textAlign,
  };
}

/**
 * What a drag draws: a box from the gesture's two corners, or a stroke between
 * its two ends, carrying the Scene's defaults.
 */
export function drawn(
  tool: Exclude<DrawingTool, 'text'>,
  from: Point,
  to: Point,
  id: string,
  defaults: SceneStyle,
): Element {
  const base = { id, seed: seedForId(id), ...styleFrom(defaults) };
  if (!drawsBox(tool)) {
    return {
      ...base,
      type: tool,
      points: [free(from), free(to)],
      heads: { start: 'none', end: tool === 'arrow' ? 'arrow' : 'none' },
    };
  }
  const box = boxBetween(from, to);
  return {
    ...base,
    type: tool,
    x: box.x,
    y: box.y,
    width: Math.max(MIN_SIZE, box.width),
    height: Math.max(MIN_SIZE, box.height),
  };
}

/**
 * What a plain click draws: a box of the usual size, its top-left corner on the
 * click. A click with an arrow, a line or a Text tool draws nothing, because
 * there is no stroke to give a length.
 */
export function drawnAtClick(
  tool: DrawingTool,
  at: Point,
  id: string,
  defaults: SceneStyle,
): Element | null {
  if (!drawsBox(tool)) {
    return null;
  }
  return drawn(tool, at, { x: at.x + DEFAULT_BOX.width, y: at.y + DEFAULT_BOX.height }, id, defaults);
}

/** Whether a drag of this length is a plain click rather than a gesture. */
export function isClick(from: Point, to: Point): boolean {
  return Math.abs(to.x - from.x) < CLICK_SLOP && Math.abs(to.y - from.y) < CLICK_SLOP;
}

/** The Text a typed-in place becomes. */
export function newText(
  at: Point,
  content: string,
  id: string,
  defaults: SceneStyle,
): TextElement {
  return { id, type: 'text', x: at.x, y: at.y, content, seed: seedForId(id), ...styleFrom(defaults) };
}

/**
 * The first id of a kind that this Scene does not use: `rectangle-1`,
 * `rectangle-2`, and so on. Ids are Scene labels, so they only have to be
 * stable and unique, and a readable one makes a Scene easier to hand-edit.
 */
export function freshId(type: DrawableType, taken: ReadonlySet<string>): string {
  for (let count = 1; ; count += 1) {
    const id = `${type}-${count}`;
    if (!taken.has(id)) {
      return id;
    }
  }
}

/** The ids a Scene already uses: what a new id must avoid. */
export function idsOf(elements: readonly Element[]): Set<string> {
  return new Set(elements.map((element) => element.id));
}

/**
 * Copies of Elements for a paste or a duplicate: fresh ids, every Element moved
 * by the offset, and each Snap kept only where its target is copied too. A Snap
 * to an Element the copies do not carry is dropped, so a paste into another
 * Scene is a free-standing drawing rather than a broken one.
 */
export function copies(
  elements: readonly Element[],
  taken: ReadonlySet<string>,
  offset: Point,
): Element[] {
  const renamed = new Map<string, string>();
  const used = new Set(taken);
  for (const element of elements) {
    const id = freshId(element.type, used);
    used.add(id);
    renamed.set(element.id, id);
  }
  return elements.map((element) => {
    const id = renamed.get(element.id)!;
    if (element.type === 'arrow' || element.type === 'line') {
      const [start, end] = element.points;
      return {
        ...element,
        id,
        seed: seedForId(id),
        points: [movedPoint(start, renamed, offset), movedPoint(end, renamed, offset)],
      };
    }
    return {
      ...element,
      id,
      seed: seedForId(id),
      x: element.x + offset.x,
      y: element.y + offset.y,
    };
  });
}

function movedPoint(point: Point, renamed: ReadonlyMap<string, string>, offset: Point): Point {
  const target = point.snap === undefined ? undefined : renamed.get(point.snap);
  return {
    x: point.x + offset.x,
    y: point.y + offset.y,
    ...(target === undefined ? {} : { snap: target }),
  };
}

/**
 * The Scene without the given Elements. A Snap whose target is removed is
 * dropped, and its end stays where it was drawn: a Scene that names a missing
 * target would not parse when it is reopened.
 */
export function without(elements: readonly Element[], removed: ReadonlySet<string>): Element[] {
  return elements
    .filter((element) => !removed.has(element.id))
    .map((element) => {
      if (element.type !== 'arrow' && element.type !== 'line') {
        return element;
      }
      if (!element.points.some((point) => point.snap !== undefined && removed.has(point.snap))) {
        return element;
      }
      const [start, end] = element.points;
      return {
        ...element,
        points: [
          start.snap !== undefined && removed.has(start.snap) ? free(start) : start,
          end.snap !== undefined && removed.has(end.snap) ? free(end) : end,
        ],
      };
    });
}
