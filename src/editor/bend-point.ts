/**
 * The bend point: the point of a Shaft between its ends, the marks a lone Shaft
 * shows to reach one, and the one reader of the press that lands on one.
 *
 * A Shaft is the drawn path of an arrow or line between its two ends, and the
 * points it turns by in between are bend points: a person drags one by its
 * handle, pulls a new one out of a segment's dot, and removes one by
 * double-clicking it or from its own menu. The page writes a mark on each — a
 * `bend` handle where a point is, a dot on each segment's middle — and both
 * name the point they stand for by `data-point` and the Shaft by
 * `data-element`.
 *
 * This module says which marks a lone Shaft shows, in the Scene's own
 * coordinates, and names them: the page turns each into a node where the view
 * puts it, and nothing else writes or reads those attributes. Everything that
 * reads a press back from those marks asks this module too, so the one rule
 * that makes a point a bend point — it lies between the ends, and an end never
 * is one — is written once.
 */
import type { ArrowOrLineElement, Corner, Point, Scene } from '../scene.js';
import { cornerOf } from '../geometry.js';
import { isShaft } from './snap.js';

/**
 * One bend point of a Shaft, as the selection holds it: the arrow or line it is
 * a point of, and which point of it. A point is never held by its index alone,
 * because a Scene that loses one point renumbers the ones after it.
 */
export interface Bend {
  readonly id: string;
  readonly index: number;
}

/** The Shaft a page mark names, as the caller holds it. */
export type ShaftOf = (id: string) => ArrowOrLineElement | null;

/** A mark read back: the Shaft a press landed on, and the bend point it names. */
export interface PressedBend {
  readonly shaft: ArrowOrLineElement;
  readonly bend: Bend;
}

/** The Shaft in this Scene an id names, or null where no arrow or line is one. */
export function shaftIn(scene: Scene, id: string): ArrowOrLineElement | null {
  const element = scene.elements.find((candidate) => candidate.id === id);
  return element !== undefined && isShaft(element) ? element : null;
}

/** A bend point a lone Shaft shows a handle for, in the Scene's own coordinates. */
export interface BendPoint {
  /** The `points` index it is stored at: the index the mark it becomes names. */
  readonly index: number;
  readonly at: Point;
  /** The corner it turns by: its own, or the Shaft's where it writes none. */
  readonly corner: Corner;
}

/**
 * The bend points a lone Shaft shows a handle for, in drawing order: every point
 * it turns by between its ends, and never an end.
 */
export function bendPoints(shaft: ArrowOrLineElement): BendPoint[] {
  const bends: BendPoint[] = [];
  for (let index = 1; index < shaft.points.length - 1; index += 1) {
    const at = shaft.points[index]!;
    bends.push({ index, at, corner: cornerOf(at, shaft.corners) });
  }
  return bends;
}

/**
 * The dots a lone Shaft shows, in the Scene's own coordinates: one halfway along
 * each segment of its drawn ink, naming the `points` index a pull there inserts
 * at.
 */
export { shaftDots as segmentDots } from '../geometry.js';

/**
 * The bend point a press on a handle names, or null where it landed anywhere
 * else, or on a handle the Shaft no longer draws a point for.
 */
export function bendFromHandle(target: EventTarget | null, shaftOf: ShaftOf): PressedBend | null {
  return bendMarked(markAt(target, '[data-handle="bend"]'), shaftOf, false);
}

/**
 * The bend point a press on a segment's dot would pull out, or null where it
 * landed anywhere else: the dot stands on the segment the pull splits, and the
 * point it names is the one an insert there makes.
 */
export function bendFromDot(target: EventTarget | null, shaftOf: ShaftOf): PressedBend | null {
  return bendMarked(markAt(target, '[data-dot]'), shaftOf, true);
}

/** The mark a press landed inside of, or null where it landed on anything else. */
function markAt(target: EventTarget | null, mark: string): Element | null {
  return target instanceof Element ? target.closest(mark) : null;
}

/**
 * The point a mark names, or null where it names none: a pulled point is not a
 * point of the Shaft yet, so the Shaft counts the one the pull adds.
 */
function bendMarked(mark: Element | null, shaftOf: ShaftOf, pulled: boolean): PressedBend | null {
  if (mark === null) {
    return null;
  }
  const id = mark.getAttribute('data-element');
  const shaft = id === null ? null : shaftOf(id);
  if (shaft === null) {
    return null;
  }
  const point = mark.getAttribute('data-point');
  const index = point === null ? Number.NaN : Number(point);
  const count = shaft.points.length + (pulled ? 1 : 0);
  return isBendPoint(count, index) ? { shaft, bend: { id: shaft.id, index } } : null;
}

/** Whether `index` is a point of a Shaft of `count` points between its ends. */
function isBendPoint(count: number, index: number): boolean {
  return Number.isInteger(index) && index >= 1 && index <= count - 2;
}
