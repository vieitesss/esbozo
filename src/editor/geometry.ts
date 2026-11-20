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

/** The box an Element covers, as the Renderer draws it. */
export function boxOfElement(element: Element, byId: ReadonlyMap<string, Element>): Box {
  return elementBounds(element, byId);
}

/** The box around every given Element, or null when there is none. */
export function boxOf(elements: readonly Element[], byId: ReadonlyMap<string, Element>): Box | null {
  if (elements.length === 0) {
    return null;
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const element of elements) {
    const box = boxOfElement(element, byId);
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
    const box = boxOfElement(element, byId);
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
  const along =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((point.x - from.x) * across + (point.y - from.y) * down) / lengthSquared));
  const nearest = { x: from.x + across * along, y: from.y + down * along };
  return Math.hypot(point.x - nearest.x, point.y - nearest.y);
}

/** Every Element the box fully encloses: a box sweeps up only what is inside it. */
export function elementsInBox(elements: readonly Element[], box: Box): Element[] {
  const byId = elementsById(elements);
  return elements.filter((element) => {
    const other = boxOfElement(element, byId);
    return (
      other.x >= box.x &&
      other.y >= box.y &&
      other.x + other.width <= box.x + box.width &&
      other.y + other.height <= box.y + box.height
    );
  });
}

/** An Element moved by a delta: box-like ones by their origin, arrows and lines by both ends. */
export function moved(element: Element, dx: number, dy: number): Element {
  if (element.type === 'arrow' || element.type === 'line') {
    const [start, end] = element.points;
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
): View {
  const box = pageBounds(scene);
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
