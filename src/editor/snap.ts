/**
 * Snap: the editor's side of an arrow or line end attached to an Element.
 *
 * A Snap is stored on the end itself (`points[i].snap`, an Element id) and the
 * Renderer resolves it onto the target's outline when it draws, so this module
 * never works out where an outline is: `drawnShaft` is where an end lands, and
 * a freed end is stored exactly there. That keeps one copy of the outline
 * geometry, the one the Renderer and `geometry.ts` already share.
 *
 * The rules are the Scene's own: only a rectangle, ellipse or diamond has an
 * outline to land on, and a shaft of two points cannot attach both its ends to
 * the same Element, though one with a bend between its ends can: a loop leaves
 * an Element and comes back to it. A Snap is per end, so moving the arrow it
 * belongs to frees the ends it had (`released`), rather than turning the drag
 * into a no-op.
 */
import { insideOutline } from '../geometry.js';
import { drawnShaft } from '../renderer.js';
import type { ArrowOrLineElement, Element, Point } from '../scene.js';
import { isOutlined } from '../scene.js';

/** Which end of an arrow or line: the first point, or the last. */
export const ENDS = ['start', 'end'] as const;
export type End = (typeof ENDS)[number];

/** Whether this Element has ends a Snap can be stored on. */
export function isShaft(element: Element): element is ArrowOrLineElement {
  return element.type === 'arrow' || element.type === 'line';
}

/** The end that is neither this one nor it. */
export function otherEnd(end: End): End {
  return end === 'start' ? 'end' : 'start';
}

/** The index of one end's point: the first, or the last, never a bend between them. */
function endIndex(element: ArrowOrLineElement, end: End): number {
  return end === 'start' ? 0 : element.points.length - 1;
}

/** The stored point of one end: the first point or the last, whichever end it is. */
export function endPoint(element: ArrowOrLineElement, end: End): Point {
  return element.points[endIndex(element, end)]!;
}

/** This shaft with the point at `index` replaced: every other point, bends included, is kept. */
export function withPoint(
  element: ArrowOrLineElement,
  index: number,
  point: Point,
): ArrowOrLineElement {
  const points = [...element.points];
  points[index] = point;
  return { ...element, points: points as ArrowOrLineElement['points'] };
}

/** The Element this end is attached to, or null when the end is free. */
export function attachedTo(element: ArrowOrLineElement, end: End): string | null {
  return endPoint(element, end).snap ?? null;
}

/** Whether either end of this Element is attached to an Element. */
function attached(element: Element): boolean {
  return isShaft(element) && element.points.some((point) => point.snap !== undefined);
}

/**
 * The topmost Element a point is over that an end can attach to, or null over
 * paper. Only a box-like Element is a target — a Text, an arrow and a line have
 * no outline to land on — and it is found by its outline, so a Label reaching
 * outside its box is not part of the target and the empty corner of an ellipse's
 * box is not either. `skip` is the Element an end may not attach to because the
 * arrow's other end is there already.
 */
export function targetAt(
  elements: readonly Element[],
  point: Point,
  skip: string | null = null,
): string | null {
  for (let index = elements.length - 1; index >= 0; index--) {
    const element = elements[index]!;
    if (!isOutlined(element) || element.id === skip) {
      continue;
    }
    if (insideOutline(element, point)) {
      return element.id;
    }
  }
  return null;
}

/**
 * The arrow or line with one end stored where the pointer put it: attached to
 * `target`, or free when that is null. The stored point is kept whole-pixel
 * like every other coordinate in a Scene.
 */
export function withEnd(
  element: ArrowOrLineElement,
  end: End,
  point: Point,
  target: string | null,
): ArrowOrLineElement {
  const stored: Point = {
    x: Math.round(point.x),
    y: Math.round(point.y),
    ...(target === null ? {} : { snap: target }),
  };
  return withPoint(element, endIndex(element, end), stored);
}

/**
 * The arrow or line with its attached ends freed where they draw now, and every
 * bend between them where the Scene put it. An attached end is stored on its
 * target's outline rather than where it was when it attached, so freeing it does
 * not move it.
 */
export function released(
  element: Element,
  byId: ReadonlyMap<string, Element>,
): Element {
  if (!attached(element) || !isShaft(element)) {
    return element;
  }
  const [start, end] = drawnEnds(element, byId);
  let freed = element;
  if (freed.points[0]!.snap !== undefined) {
    freed = withPoint(freed, 0, start);
  }
  const last = freed.points.length - 1;
  if (freed.points[last]!.snap !== undefined) {
    freed = withPoint(freed, last, end);
  }
  return freed;
}

/** One end freed where it draws now, the other end left as it is. */
export function freedEnd(
  element: ArrowOrLineElement,
  end: End,
  byId: ReadonlyMap<string, Element>,
): ArrowOrLineElement {
  if (!attachedTo(element, end)) {
    return element;
  }
  const [start, finish] = drawnEnds(element, byId);
  return withEnd(element, end, end === 'start' ? start : finish, null);
}

/** Both ends as the Renderer draws them, Snap resolved and stored whole-pixel. */
function drawnEnds(
  element: ArrowOrLineElement,
  byId: ReadonlyMap<string, Element>,
): [Point, Point] {
  const [start, end] = drawnShaft(element, byId);
  return [whole(start), whole(end)];
}

function whole(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
