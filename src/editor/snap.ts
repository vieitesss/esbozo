/**
 * Snap: the editor's side of an arrow or line end attached to an Element.
 *
 * A Snap is stored on the end itself (`points[i].snap`, an Element id) and the
 * Renderer resolves it onto the target's outline when it draws, so this module
 * never works out where an outline is: the ends `drawnGeometry` answers are where
 * an end lands, and a freed end is stored exactly there. That keeps one copy of
 * the outline geometry, the one the Renderer and `geometry.ts` already share.
 *
 * The rules are the Scene's own: only a rectangle, ellipse or diamond has an
 * outline to land on, and a shaft of two points cannot attach both its ends to
 * the same Element, though one with a bend between its ends can: a loop leaves
 * an Element and comes back to it. A Snap is per end, so dragging an end slides
 * it along the target it holds, and a move of a two-point shaft leaves its Snapped
 * ends where they draw: only a free end moves.
 */
import { anchorOf, anchorPoint, insideOutline } from '../geometry.js';
import { drawnGeometry } from '../renderer.js';
import type { Anchor, ArrowOrLineElement, Element, OutlinedElement, Point } from '../scene.js';
import { isOutlined, snapTargetId, elementsById } from '../scene.js';

/** Which end of an arrow or line: the first point, or the last. */
export const ENDS = ['start', 'end'] as const;
export type End = (typeof ENDS)[number];

/** Whether this Element has ends a Snap can be stored on. */
export function isShaft(element: Element): element is ArrowOrLineElement {
  return element.type === 'arrow' || element.type === 'line';
}

/** The end that is neither this one nor it. */
function otherEnd(end: End): End {
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

/** This shaft with one end's point replaced: the other end and every bend is kept. */
export function withEndPoint(
  element: ArrowOrLineElement,
  end: End,
  point: Point,
): ArrowOrLineElement {
  return withPoint(element, endIndex(element, end), point);
}

/** The Element this end is attached to, or null when the end is free. */
export function attachedTo(element: ArrowOrLineElement, end: End): string | null {
  return snapTargetId(endPoint(element, end));
}

/**
 * Whether one end's Snap switch is on. An end attached to an Element is on, and
 * so is a free end that writes no `snap` at all: both attach on their next drag
 * over an Element. An end that writes `"snap": false` is off, and attaches to
 * nothing until the switch turns it back on.
 */
export function snapOn(element: ArrowOrLineElement, end: End): boolean {
  return endPoint(element, end).snap !== false;
}

/**
 * The Element a two-point shaft's end may not attach to: the one its other end
 * already holds. A longer shaft may hold one Element at both ends, because the
 * bend between them is a loop.
 */
export function otherTarget(element: ArrowOrLineElement, end: End): string | null {
  return element.points.length === 2 ? attachedTo(element, otherEnd(end)) : null;
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
 *
 * An attached end also writes its Anchor, the nearest point of the target's
 * outline to the drop, so the end stays on the spot the person chose rather than
 * re-aiming at the target's centre. The stored `x`, `y` are where that Anchor
 * draws it, so the JSON reads true; `byId` is the Scene the target is found in,
 * the same one the Renderer resolves it against.
 *
 * A free end keeps the `"snap": false` its switch wrote: dragging an end whose
 * Snap is off settles it where the pointer left it and attaches it to nothing.
 */
export function withEnd(
  element: ArrowOrLineElement,
  end: End,
  point: Point,
  target: string | null,
  byId: ReadonlyMap<string, Element>,
): ArrowOrLineElement {
  const anchor = target === null ? undefined : anchorFor(byId, target, point);
  const drawn = anchor === undefined ? point : anchorPoint(targetOutline(byId, target!), anchor);
  const stored: Point = {
    x: Math.round(drawn.x),
    y: Math.round(drawn.y),
    ...(target === null
      ? snapOn(element, end)
        ? {}
        : { snap: false }
      : { snap: target }),
    ...(anchor === undefined ? {} : { anchor }),
  };
  return withEndPoint(element, end, stored);
}

/** The Anchor a drop on this target writes: the outline point nearest the drop, as fractions of the box. */
function anchorFor(
  byId: ReadonlyMap<string, Element>,
  target: string,
  point: Point,
): Anchor {
  return anchorOf(targetOutline(byId, target), point);
}

/** The outlined Element a Snap names, refusing an id the Scene cannot draw an outline for. */
function targetOutline(byId: ReadonlyMap<string, Element>, target: string): OutlinedElement {
  const found = byId.get(target);
  if (found === undefined || !isOutlined(found)) {
    throw new Error(`snap target "${target}" must be a rectangle, ellipse or diamond`);
  }
  return found;
}

/**
 * Every Anchored end stored where its Anchor draws it, so a Scene's numbers
 * follow its drawing. The editor lands this on every edit with the Scene it is
 * replacing, because a target that moved or resized leaves the ends that hold
 * it behind: one pass, not a rule each gesture remembers. Only an end whose
 * target's outline changed is rewritten, so an edit elsewhere leaves a
 * hand-written `x`, `y` where it is — the Anchor draws the end either way. An
 * end with a Snap and no Anchor keeps the point it has.
 */
export function anchoredEnds(
  elements: readonly Element[],
  before: readonly Element[],
): Element[] {
  const byId = elementsById(elements);
  const was = elementsById(before);
  return elements.map((element) => {
    if (!isShaft(element)) {
      return element;
    }
    const last = element.points.length - 1;
    let changed = false;
    const points = element.points.map((point, index) => {
      const target = snapTargetId(point);
      if ((index !== 0 && index !== last) || target === null || point.anchor === undefined) {
        return point;
      }
      const outline = targetOutline(byId, target);
      if (sameOutline(outline, was.get(target))) {
        return point;
      }
      const drawn = anchorPoint(outline, point.anchor);
      const x = Math.round(drawn.x);
      const y = Math.round(drawn.y);
      if (x === point.x && y === point.y) {
        return point;
      }
      changed = true;
      return { ...point, x, y };
    });
    return changed
      ? { ...element, points: points as ArrowOrLineElement['points'] }
      : element;
  });
}

/** Whether a target's outline is the one an Anchored end was last written against. */
function sameOutline(outline: OutlinedElement, before: Element | undefined): boolean {
  return (
    before !== undefined &&
    isOutlined(before) &&
    before.type === outline.type &&
    before.x === outline.x &&
    before.y === outline.y &&
    before.width === outline.width &&
    before.height === outline.height &&
    before.corners === outline.corners
  );
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
  return withEnd(element, end, end === 'start' ? start : finish, null, byId);
}

/** Both ends as the Renderer draws them, Snap resolved and stored whole-pixel. */
function drawnEnds(
  element: ArrowOrLineElement,
  byId: ReadonlyMap<string, Element>,
): [Point, Point] {
  const ends = drawnGeometry(element, byId).ends;
  if (ends === null) {
    throw new Error(`${element.id}: only an arrow or line draws ends`);
  }
  return [whole(ends[0]), whole(ends[1])];
}

function whole(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
