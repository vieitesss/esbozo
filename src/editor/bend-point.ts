/**
 * The bend point: the point of a Shaft between its ends, the edits that move,
 * pull out, turn and remove one, the one rule that decides a removal, the marks
 * a lone Shaft shows to reach one, and the one reader of the press that lands on
 * one.
 *
 * A Shaft is the drawn path of an arrow or line between its two ends, and the
 * points it turns by in between are bend points: a person drags one by its
 * handle, pulls a new one out of a segment's dot, and removes one by
 * double-clicking it or from its own menu. A mark stands on each — a `bend`
 * handle where a point is, a dot on each segment's middle — and names the point
 * it stands for by `data-point` and the Shaft by `data-element`.
 *
 * This module says which marks a lone Shaft shows, in the Scene's own
 * coordinates, and names them: the page turns each into a node where the view
 * puts it, and nothing else writes or reads those attributes. Everything that
 * reads a press back from those marks asks this module too, so the one rule
 * that makes a point a bend point — it lies between the ends, and an end never
 * is one — is written once.
 */
import type { ArrowOrLineElement, Corner, Point, Scene } from '../scene.js';
import { cornerOf, shaftDots } from '../geometry.js';
import type { ShaftPath } from '../geometry.js';
import { isShaft, withPoint } from './snap.js';

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

/**
 * Whether two Bends name the same point: the same Shaft's same point, whichever
 * gestures or frames hold them. A press that took no point names no point.
 */
export function sameBend(
  one: Bend | null | undefined,
  other: Bend | null | undefined,
): boolean {
  return (
    one !== null &&
    one !== undefined &&
    other !== null &&
    other !== undefined &&
    one.id === other.id &&
    one.index === other.index
  );
}

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

/**
 * The one bend point the selection holds, and the lifetime it has. A press picks
 * it; a change of the selection, a removal, another Scene and a page that may
 * only read let it go; and the delete press that spends it leaves a held key
 * nothing to do, so the key does not walk on from the point to the shaft behind
 * it. Every one of those is decided here, so no index outlives the point it named.
 */
export class PickedBend {
  #held: Bend | null = null;
  /** Whether the delete press in hand already spent the point it found. */
  #spent = false;

  /** The point the selection holds, or null where it holds none. */
  get bend(): Bend | null {
    return this.#held;
  }

  /** Pick the point a press took, or let go of the one picked before it. */
  pick(bend: Bend | null): void {
    this.#held = bend;
  }

  /**
   * Let go of the point: the selection changed, the point went, the Scene
   * switched, or the page may only read.
   */
  letGo(): void {
    this.#held = null;
  }

  /**
   * Whether this delete press runs: a held key whose press is already spent runs
   * nothing, so it does not go on to the shaft the point is a part of. Only a new
   * press of a delete key is one, so a key pressed inside the hold is not.
   */
  pressDelete(repeated: boolean): boolean {
    if (repeated && this.#spent) {
      return false;
    }
    this.#spent = false;
    return true;
  }

  /**
   * The point this delete press removes, spending the press whether the point may
   * go or not: the shaft behind it answers only to a press of its own. A press
   * that finds no point spends nothing, so a held key stays spent even when a
   * palette Delete runs inside its hold.
   */
  spend(): Bend | null {
    if (this.#held !== null) {
      this.#spent = true;
    }
    return this.#held;
  }
}

/**
 * The arrow or line with the bend at `index` stored where the pointer put it:
 * whole-pixel like every other coordinate in a Scene, its own `corner` kept,
 * and no Snap. A Snap is an end's, so a bend dropped over an Element does not
 * take one, and the ends it sits between keep the ones they have.
 */
export function withBend(
  element: ArrowOrLineElement,
  index: number,
  point: Point,
): ArrowOrLineElement {
  const corner = element.points[index]?.corner;
  const stored: Point = {
    x: Math.round(point.x),
    y: Math.round(point.y),
    ...(corner === undefined ? {} : { corner }),
  };
  return withPoint(element, index, stored);
}

/**
 * The arrow or line with a new bend inserted at `index`, stored where the dot
 * stood: whole-pixel like every other coordinate, no `corner` of its own so it
 * turns by the Element's, and no Snap — a point pulled out of a shaft's ink is
 * a bend and only a bend, even over an Element an end would attach to. The ends
 * either side of it, and every other point, are the Scene's own.
 */
export function withInsertedBend(
  element: ArrowOrLineElement,
  index: number,
  point: Point,
): ArrowOrLineElement {
  const points = [...element.points];
  points.splice(index, 0, { x: Math.round(point.x), y: Math.round(point.y) });
  return { ...element, points: points as ArrowOrLineElement['points'] };
}

/**
 * Whether the bend at an interior index may go: the one rule a removal keeps,
 * asked by the editor before it removes a point and by the point menu before it
 * offers the row, so a point the menu shows as disabled is exactly a point the
 * key cannot remove. A removal that would leave a two-point shaft with both ends
 * Snapped to one Element takes nothing, because the Scene has no such shaft: two
 * ends on one outline have no direction to aim along, and the point between them
 * is what gave it one. Only a three-point Shaft can become that two-point loop,
 * so the count and the two ends are the whole rule.
 */
export function mayRemove(shaft: ArrowOrLineElement): boolean {
  const points = shaft.points;
  const start = points[0]!;
  const end = points[points.length - 1]!;
  return !(points.length === 3 && start.snap !== undefined && start.snap === end.snap);
}

/**
 * The shaft with the bend at `index` gone: every other point keeps its place, its
 * `corner` and its Snap, and so does the Element its corners. Only a point
 * `mayRemove` allows goes, so the caller asks that first.
 */
export function withoutBend(element: ArrowOrLineElement, index: number): ArrowOrLineElement {
  const points = [...element.points];
  points.splice(index, 1);
  return { ...element, points: points as ArrowOrLineElement['points'] };
}

/**
 * The corner the bend at `index` turns by today: its own `corner`, or the
 * Element's where it writes none. Null where the Shaft draws no bend there, so a
 * caller holding a stale point has no corner to offer either way.
 */
export function cornerAt(shaft: ArrowOrLineElement, index: number): Corner | null {
  return isBendPoint(shaft.points.length, index)
    ? cornerOf(shaft.points[index], shaft.corners)
    : null;
}

/**
 * The shaft with the bend at `index` turning by `corner`: written on the point
 * where it differs from the Element's own corner, and left out where it is the
 * same, so a Scene stores only the corners it means and a toggle back to the
 * Element's own leaves no key behind. Every other point keeps its place, its
 * `corner` and its Snap, and the Element keeps its own `corners`.
 */
export function withCorner(
  element: ArrowOrLineElement,
  index: number,
  corner: Corner,
): ArrowOrLineElement {
  if (!isBendPoint(element.points.length, index)) {
    return element;
  }
  const points = element.points.map((point, at) =>
    at === index
      ? {
          x: point.x,
          y: point.y,
          ...(point.snap === undefined ? {} : { snap: point.snap }),
          ...(corner === element.corners ? {} : { corner }),
        }
      : point,
  );
  return { ...element, points: points as ArrowOrLineElement['points'] };
}

/**
 * The shaft turning by `corner` at every point: the Element's own `corners`
 * set, and every point's own `corner` dropped, so one pick resets a shaft whose
 * bend points disagreed and the Scene stores only the corner it means. Every
 * point keeps its place and its Snap, and nothing else of the Element changes.
 */
export function withShaftCorners(
  element: ArrowOrLineElement,
  corner: Corner,
): ArrowOrLineElement {
  const points = element.points.map((point) => ({
    x: point.x,
    y: point.y,
    ...(point.snap === undefined ? {} : { snap: point.snap }),
  }));
  return { ...element, corners: corner, points: points as ArrowOrLineElement['points'] };
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
 * Whether a Shaft of `count` points bends at `index`: the points between its
 * ends are bend points and the ends never are, and this is the one place that
 * rule is written.
 */
function isBendPoint(count: number, index: number): boolean {
  return Number.isInteger(index) && index >= 1 && index <= count - 2;
}

/**
 * The bend points a lone Shaft shows a handle for, in drawing order: every point
 * it turns by between its ends, and never an end.
 */
export function bendPoints(shaft: ArrowOrLineElement): BendPoint[] {
  const count = shaft.points.length;
  return shaft.points.flatMap((at, index) =>
    isBendPoint(count, index) ? [{ index, at, corner: cornerOf(at, shaft.corners) }] : [],
  );
}

/**
 * The one corner a whole Shaft turns by, or null where its bend points disagree:
 * each point's own `corner`, or the Element's where it writes none. A Shaft with
 * no bend point yet has nothing to disagree with, so it turns by the Element's
 * own `corners`.
 */
export function shaftCorner(shaft: ArrowOrLineElement): Corner | null {
  const bends = bendPoints(shaft);
  const first = bends[0];
  if (first === undefined) {
    return shaft.corners;
  }
  return bends.every((bend) => bend.corner === first.corner) ? first.corner : null;
}

/** A dot a lone Shaft shows: halfway along a segment of its ink, where a pull adds a bend point. */
export interface MarkedDot {
  /** The `points` index a pull there inserts at. */
  readonly index: number;
  /** Where it stands, in the Scene's own coordinates. */
  readonly at: Point;
}

/**
 * The dots a lone Shaft shows, in the Scene's own coordinates: one halfway along
 * every segment of its drawn ink, and none at all on a page that may not change
 * the Scene, because a mark that promises a bend out of the ink is a promise
 * only a page that can change the Scene keeps. A dot that would land on a
 * handle is left off rather than drawn where a press could never take it, so a
 * dot's middle stays `clearance` away from the ends and from every bend point.
 */
export function bendDots(
  shaft: ArrowOrLineElement,
  ink: ShaftPath,
  page: { readonly writable: boolean; readonly clearance: number },
): MarkedDot[] {
  if (!page.writable) {
    return [];
  }
  const handles = [ink.start, ink.end, ...bendPoints(shaft).map((bend) => bend.at)];
  return shaftDots(ink).filter((dot) =>
    handles.every((handle) => apart(handle, dot.at) >= page.clearance),
  );
}

/**
 * Where the dot a press names stands, in the Scene's own coordinates: the middle
 * of the segment the pull splits, which is where the point it pulls out starts.
 * Null where the ink draws no such segment.
 */
export function dotAt(ink: ShaftPath, index: number): Point | null {
  return shaftDots(ink).find((dot) => dot.index === index)?.at ?? null;
}

/** How far apart two places of the Scene are. */
function apart(one: Point, other: Point): number {
  return Math.hypot(one.x - other.x, one.y - other.y);
}

/**
 * Names a node as a bend point's handle: the `bend` handle a press reads back,
 * the point it stands for, and the Shaft that point belongs to.
 */
export function nameBendHandle(node: Element, shaft: string, index: number): void {
  node.setAttribute('data-handle', 'bend');
  node.setAttribute('data-point', String(index));
  node.setAttribute('data-element', shaft);
}

/**
 * Names a node as a segment's dot: the mark a press pulls a bend point out of,
 * the `points` index a pull there inserts at, and the Shaft it is pulled out of.
 */
export function nameDot(node: Element, shaft: string, index: number): void {
  node.setAttribute('data-dot', 'bend');
  node.setAttribute('data-point', String(index));
  node.setAttribute('data-element', shaft);
}

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
