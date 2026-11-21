/**
 * The editing maths behind the editor: boxes, hit testing, moves, resizes and
 * the viewport transform. Pure functions over plain values, so the same code
 * serves the pointer handlers and the tests.
 *
 * Where an Element is comes from the Renderer (`elementBounds`, `pageBounds`),
 * so the editor and a drawn page can never disagree. An arrow or line is picked
 * by how far the pointer is from the shaft it draws, not by the box around it: a
 * diagonal arrow's empty corner is bare canvas. Box-select still works on boxes,
 * because a box sweeps up only what it encloses.
 */
import { drawnShaft, elementBounds, elementsById, pageBounds, strokeWidthOf } from '../renderer.js';
import type { Layout } from '../layout.js';
import { MIN_SIZE, isOutlined } from '../scene.js';
import type { Element, Scene } from '../scene.js';

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The eight resize handles, clockwise from the top left corner. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type Handle = (typeof HANDLES)[number];

/** The box around every given Element, or null when there is none. */
export function boxOf(
  elements: readonly Element[],
  byId: ReadonlyMap<string, Element>,
  layout: Layout,
): Box | null {
  return unionOf(elements.map((element) => elementBounds(element, byId, layout)));
}

/** The box around every given box, or null when there is none. */
export function unionOf(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) {
    return null;
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The topmost Element under a point: list order is layer order. An arrow or
 * line is picked by its drawn shaft, `tolerance` Scene units off it; every other
 * Element by its box.
 */
export function elementAt(
  elements: readonly Element[],
  point: Point,
  tolerance: number,
  layout: Layout,
): Element | null {
  const byId = elementsById(elements);
  for (let index = elements.length - 1; index >= 0; index--) {
    const element = elements[index]!;
    if (element.type === 'arrow' || element.type === 'line') {
      const [start, end] = drawnShaft(element, byId);
      const reach = Math.max(tolerance, strokeWidthOf(element) / 2);
      if (distanceToSegment(point, start, end) <= reach) {
        return element;
      }
      continue;
    }
    const box = elementBounds(element, byId, layout);
    if (
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height
    ) {
      return element;
    }
  }
  return null;
}

/** How far a point is from the segment `from`-`to`. */
function distanceToSegment(point: Point, from: Point, to: Point): number {
  const across = to.x - from.x;
  const down = to.y - from.y;
  const lengthSquared = across * across + down * down;
  const travelled = (point.x - from.x) * across + (point.y - from.y) * down;
  const along =
    lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, travelled / lengthSquared));
  const nearest = { x: from.x + across * along, y: from.y + down * along };
  return Math.hypot(point.x - nearest.x, point.y - nearest.y);
}

/** Every Element the box fully encloses: a box sweeps up only what is inside it. */
export function elementsInBox(
  elements: readonly Element[],
  box: Box,
  layout: Layout,
): Element[] {
  const byId = elementsById(elements);
  return elements.filter((element) => {
    const other = elementBounds(element, byId, layout);
    return (
      other.x >= box.x &&
      other.y >= box.y &&
      other.x + other.width <= box.x + box.width &&
      other.y + other.height <= box.y + box.height
    );
  });
}

/**
 * An Element moved by a delta: box-like ones by their origin, arrows and lines
 * by both ends. An arrow or line Snapped at both ends ignores the move: its ends
 * follow their targets, so nothing it drew would change and its stored ends must
 * not be rewritten for it. Detaching one end is a later ticket's.
 */
export function moved(element: Element, dx: number, dy: number): Element {
  if (element.type === 'arrow' || element.type === 'line') {
    const [start, end] = element.points;
    if (start.snap !== undefined && end.snap !== undefined) {
      return element;
    }
    return {
      ...element,
      points: [
        { ...start, x: start.x + dx, y: start.y + dy },
        { ...end, x: end.x + dx, y: end.y + dy },
      ],
    };
  }
  return { ...element, x: element.x + dx, y: element.y + dy };
}

/**
 * An Element resized to a box. Only an outlined Element carries a width and a
 * height; Text is measured by the Renderer and an arrow or line by its ends, so
 * resizing them is not defined yet and the handles do not appear for them.
 */
export function resized(element: Element, box: Box): Element {
  if (!isOutlined(element)) {
    return element;
  }
  return { ...element, x: box.x, y: box.y, width: box.width, height: box.height };
}

/** The box dragged between two points, in any direction. */
export function boxBetween(from: Point, to: Point): Box {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/**
 * The box after dragging one handle by a delta. The opposite edge stays put,
 * and the box never turns inside out or below MIN_SIZE.
 */
export function resizedBox(origin: Box, handle: Handle, dx: number, dy: number): Box {
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.width;
  let bottom = origin.y + origin.height;

  if (handle.includes('w')) {
    left = Math.min(origin.x + dx, right - MIN_SIZE);
  }
  if (handle.includes('e')) {
    right = Math.max(origin.x + origin.width + dx, left + MIN_SIZE);
  }
  if (handle.includes('n')) {
    top = Math.min(origin.y + dy, bottom - MIN_SIZE);
  }
  if (handle.includes('s')) {
    bottom = Math.max(origin.y + origin.height + dy, top + MIN_SIZE);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Where a handle sits for a box: the dragging target of a resize. */
export function handlePoint(box: Box, handle: Handle): Point {
  const x = handle.includes('w')
    ? box.x
    : handle.includes('e')
      ? box.x + box.width
      : box.x + box.width / 2;
  const y = handle.includes('n')
    ? box.y
    : handle.includes('s')
      ? box.y + box.height
      : box.y + box.height / 2;
  return { x, y };
}

/** Pan and zoom, in the units the canvas uses. */
export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function toScene(view: View, screenX: number, screenY: number): Point {
  return {
    x: (screenX - view.panX) / view.zoom,
    y: (screenY - view.panY) / view.zoom,
  };
}

/** A Scene point, as the page shows it: where a pointer aiming at it lands. */
export function toPage(view: View, point: Point): Point {
  return { x: point.x * view.zoom + view.panX, y: point.y * view.zoom + view.panY };
}

/**
 * How far to move a fragment so a paste lands where a person can see it: the
 * usual nudge when the box it would place is on the page, or the middle of the
 * view when it would not be, so a copy of a Scene point far off the page — or of
 * one whose nudge carries it past the edge — does not paste out of sight.
 */
export function landingOffset(
  box: Box,
  view: View,
  viewport: { width: number; height: number },
  nudge: Point,
): Point {
  const topLeft = toScene(view, 0, 0);
  const bottomRight = toScene(view, viewport.width, viewport.height);
  // Where the nudge would put it, not where the fragment came from: a box on the
  // page can still be carried off it by the offset.
  const placed = { x: box.x + nudge.x, y: box.y + nudge.y, width: box.width, height: box.height };
  const onPage =
    placed.x < bottomRight.x &&
    placed.x + placed.width > topLeft.x &&
    placed.y < bottomRight.y &&
    placed.y + placed.height > topLeft.y;
  if (onPage) {
    return nudge;
  }
  const middle = toScene(view, viewport.width / 2, viewport.height / 2);
  return {
    x: Math.round(middle.x - (box.x + box.width / 2)),
    y: Math.round(middle.y - (box.y + box.height / 2)),
  };
}

/** Zoom keeping the Scene point under the pointer where it is. */
export function zoomedAt(view: View, factor: number, screenX: number, screenY: number): View {
  const zoom = clampZoom(view.zoom * factor);
  if (zoom === view.zoom) {
    return view;
  }
  const anchor = toScene(view, screenX, screenY);
  return {
    zoom,
    panX: screenX - anchor.x * zoom,
    panY: screenY - anchor.y * zoom,
  };
}

/** A view that shows the page the Renderer draws, centred in the viewport. */
export function fittedView(
  scene: Scene,
  viewport: { width: number; height: number },
  layout: Layout,
): View {
  const box = pageBounds(scene, layout);
  const margin = 80;
  const zoom = clampZoom(
    Math.min(
      1,
      (viewport.width - margin * 2) / Math.max(box.width, 1),
      (viewport.height - margin * 2) / Math.max(box.height, 1),
    ),
  );
  return {
    zoom,
    panX: viewport.width / 2 - (box.x + box.width / 2) * zoom,
    panY: viewport.height / 2 - (box.y + box.height / 2) * zoom,
  };
}

/** Whether two boxes share any area at all. */
function overlaps(one: Box, other: Box): boolean {
  return (
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height
  );
}

/** What the page leaves for a selection: the room beside the docked note. */
export interface Clearance {
  /** The selection's box, in Scene units, or null when nothing is selected. */
  selection: Box | null;
  /** The docked note's box on the page, in screen units. */
  note: Box;
  /** The leftmost the selection may sit on the page, in screen units: past the tools. */
  left: number;
  /** Breathing room between the selection and the note. */
  gap: number;
}

/**
 * The view that keeps the selection out from under the docked Style menu.
 *
 * One rectangle policy, run when the selection or the window changes: when the
 * selection's box on screen and the note's box share any area, the view pans
 * left just far enough to clear the note by `gap`, and the selection's left edge
 * still clears the tools. When panning cannot do it, because the selection is
 * wider than the room the note leaves, the view zooms out just far enough for the
 * whole selection to sit in that room, keeping its middle where it was
 * vertically. Both are view changes: the Scene is never touched.
 */
export function clearedView(view: View, room: Clearance): View {
  const { selection, note, gap } = room;
  if (selection === null || selection.width <= 0) {
    return view;
  }
  const shown: Box = {
    x: selection.x * view.zoom + view.panX,
    y: selection.y * view.zoom + view.panY,
    width: selection.width * view.zoom,
    height: selection.height * view.zoom,
  };
  if (!overlaps(shown, note)) {
    return view;
  }
  const shift = shown.x + shown.width + gap - note.x;
  if (shift <= 0) {
    return view;
  }
  if (shown.x - shift >= room.left) {
    return { ...view, panX: view.panX - shift };
  }
  const free = note.x - gap - room.left;
  if (free <= 0) {
    return view;
  }
  const zoom = clampZoom(Math.min(view.zoom, free / selection.width));
  if (zoom >= view.zoom) {
    return view;
  }
  // The selection keeps its middle where the eye left it, and its right edge
  // stops a gap short of the note, so the whole of it is on the page.
  const middle = shown.y + shown.height / 2;
  return {
    zoom,
    panX: note.x - gap - (selection.x + selection.width) * zoom,
    panY: middle - (selection.y + selection.height / 2) * zoom,
  };
}
