/**
 * The editing maths behind the editor: boxes, hit testing, resize and the
 * viewport transform. Pure functions over plain values, so the same code serves
 * the pointer handlers and the tests.
 */
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

export const MIN_SIZE = 1;

export function boxOfElement(element: Element): Box {
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

/** The box around every given Element, or null when there is none. */
export function boxOf(elements: readonly Element[]): Box | null {
  if (elements.length === 0) {
    return null;
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const element of elements) {
    left = Math.min(left, element.x);
    top = Math.min(top, element.y);
    right = Math.max(right, element.x + element.width);
    bottom = Math.max(bottom, element.y + element.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The topmost Element under a point: list order is layer order. */
export function elementAt(elements: readonly Element[], point: Point): Element | null {
  for (let index = elements.length - 1; index >= 0; index--) {
    const element = elements[index]!;
    if (
      point.x >= element.x &&
      point.x <= element.x + element.width &&
      point.y >= element.y &&
      point.y <= element.y + element.height
    ) {
      return element;
    }
  }
  return null;
}

/** Every Element the box touches, which is what a box-select selects. */
export function elementsInBox(elements: readonly Element[], box: Box): Element[] {
  return elements.filter((element) => {
    const other = boxOfElement(element);
    return (
      other.x < box.x + box.width &&
      other.x + other.width > box.x &&
      other.y < box.y + box.height &&
      other.y + other.height > box.y
    );
  });
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

/** Move a box by a delta, without rounding: moving never snaps to the Grid. */
export function movedBox(box: Box, dx: number, dy: number): Box {
  return { ...box, x: box.x + dx, y: box.y + dy };
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

export function toScreen(view: View, point: Point): Point {
  return { x: point.x * view.zoom + view.panX, y: point.y * view.zoom + view.panY };
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

/** A view that shows the Scene's Elements centred in the viewport. */
export function fittedView(
  scene: Pick<Scene, 'elements'>,
  viewport: { width: number; height: number },
): View {
  const box = boxOf(scene.elements);
  if (box === null) {
    return { zoom: 1, panX: viewport.width / 2 - 160, panY: viewport.height / 2 - 120 };
  }
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
