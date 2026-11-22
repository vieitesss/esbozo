/**
 * The editing maths behind the editor: boxes, hit testing, moves, resizes, the
 * caret's line and the viewport transform. Pure functions over plain values, so
 * the same code serves the pointer handlers and the tests.
 *
 * Where an Element is comes from the Renderer (`elementBounds`, `pageBounds`),
 * so the editor and a drawn page can never disagree. An arrow or line is picked
 * by how far the pointer is from the shaft it draws, not by the box around it: a
 * diagonal arrow's empty corner is bare canvas. Box-select still works on boxes,
 * because a box sweeps up only what it encloses.
 */
import { alongSegment } from '../geometry.js';
import type { ShaftPath } from '../geometry.js';
import {
  elementBounds,
  elementsById,
  wordsInkBounds,
  pageBounds,
  renderElement,
  shaftInk,
  shaftLabel,
  strokeWidthOf,
} from '../renderer.js';
import type { HeadInk, ShaftInk } from '../renderer.js';
import type { Layout } from '../layout.js';
import { MIN_SIZE, isOutlined } from '../scene.js';
import type { Element, Scene } from '../scene.js';
import { isShaft } from './snap.js';

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

/** A pointer's place on the page, in the browser's own pixels. */
export interface Pointer {
  readonly clientX: number;
  readonly clientY: number;
}

/** What a press found: the Element it took, and the words when it landed on a shaft's Label. */
interface Pick {
  readonly element: Element;
  /** The box a shaft's Label paints, when the press landed on those words rather than on ink. */
  readonly label: Box | null;
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
 * The topmost thing a press takes: list order is layer order, so a higher
 * Element's ink answers before a lower Element's Label, and a Label answers
 * before the shaft it is written about — its words are words a person can press
 * wherever they sit, over their own shaft included.
 *
 * An arrow or line is picked by the ink it draws — every straight run and every
 * curve of its shaft, and each head on its ends — `tolerance` Scene units off
 * it, so the empty chord between two ends is bare canvas; a Label by the box its
 * paper paints, glyph overhang included; every other Element by its box, grown
 * by the ink a rough outline draws outside it, and then by `tolerance` too.
 *
 * For outlined Elements and Text, read the ink box from the page's drawing
 * when available. Without a drawing to reuse, ask the Renderer for the same box.
 *
 * Ink answers before the tolerance does. A press on the border an Element draws
 * is that Element's, even when a higher layer's empty halo reaches it; the halo
 * only answers a press that found no ink.
 */
export function pickAt(
  elements: readonly Element[],
  point: Point,
  tolerance: number,
  layout: Layout,
  ink?: (element: Element) => Box | null,
): Pick | null {
  const byId = elementsById(elements);
  const inkOf = (element: Element): Box =>
    ink?.(element) ?? renderElement(element, byId, layout).ink;
  let halo: Pick | null = null;
  for (let index = elements.length - 1; index >= 0; index--) {
    const element = elements[index]!;
    if (element.type === 'arrow' || element.type === 'line') {
      const label = shaftLabel(element, byId, layout);
      if (label !== null) {
        const box = wordsInkBounds(label);
        if (holds(box, point)) {
          return { element, label: box };
        }
      }
      const reach = Math.max(tolerance, strokeWidthOf(element) / 2);
      if (holdsInk(shaftInk(element, byId), point, reach)) {
        return { element, label: null };
      }
      continue;
    }
    // An outlined Element's ink strays outside its box and a Text's glyphs hang
    // past its own: both are the Element, and the tolerance is added on top.
    const box = inkOf(element);
    if (holds(box, point)) {
      return { element, label: null };
    }
    if (halo === null && holds(grownBy(box, tolerance), point)) {
      halo = { element, label: null };
    }
  }
  return halo;
}

/** The topmost Element under a point, the words of a shaft's Label counting as its own. */
export function elementAt(
  elements: readonly Element[],
  point: Point,
  tolerance: number,
  layout: Layout,
): Element | null {
  return pickAt(elements, point, tolerance, layout)?.element ?? null;
}

/** A box grown by `reach` on every side, or the box itself when it has none. */
function grownBy(box: Box, reach: number): Box {
  if (reach === 0) {
    return box;
  }
  return {
    x: box.x - reach,
    y: box.y - reach,
    width: box.width + reach * 2,
    height: box.height + reach * 2,
  };
}

/** Whether a point is inside a box. */
function holds(box: Box, point: Point): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/** How far a point is from the segment `from`-`to`. */
function distanceToSegment(point: Point, from: Point, to: Point): number {
  const along = alongSegment(from, to, point);
  const nearest = { x: from.x + (to.x - from.x) * along, y: from.y + (to.y - from.y) * along };
  return Math.hypot(point.x - nearest.x, point.y - nearest.y);
}

/** The four control points of a cubic curve: the ink lies inside the box they make. */
type Cubic = readonly [Point, Point, Point, Point];

/**
 * The box a curve is halved down to before a press is read as landing on its
 * ink, in Scene units. Small enough that a hand's own tolerance never notices,
 * and large enough that a long curve is walked in a few dozen boxes.
 */
const CURVE_CELL = 0.5;

/**
 * Whether a point lands on the ink a shaft draws, within `reach` of it: along
 * every straight run and every curve of the shaft, or on a head drawn at one of
 * its ends. The chord between two ends is no part of it — a bent shaft leaves
 * the space under its bend bare.
 */
function holdsInk(ink: ShaftInk, point: Point, reach: number): boolean {
  return (
    ink.path.pieces.some((piece) => pieceIsNear(piece, point, reach)) ||
    ink.heads.some((head) => distanceToHead(head, point) <= reach)
  );
}

/** Whether one piece of a drawn shaft passes within `reach` of a point. */
function pieceIsNear(
  piece: ShaftPath['pieces'][number],
  point: Point,
  reach: number,
): boolean {
  if (piece.kind === 'straight') {
    return distanceToSegment(point, piece.from, piece.to) <= reach;
  }
  return curveIsNear([piece.from, piece.control1, piece.control2, piece.to], point, reach);
}

/**
 * Whether a curve passes within `reach` of a point. The ink stays inside the box
 * its control points make, so a box further off than the reach holds nothing a
 * press could take and is dropped whole; what is left is halved until a box
 * small enough to read as the ink itself passes.
 */
function curveIsNear(curve: Cubic, point: Point, reach: number): boolean {
  const box = controlBox(curve);
  if (boxDistance(box, point) > reach) {
    return false;
  }
  if (box.width <= CURVE_CELL && box.height <= CURVE_CELL) {
    return true;
  }
  const [left, right] = halvesOf(curve);
  return curveIsNear(left, point, reach) || curveIsNear(right, point, reach);
}

/** The box around a curve's control points: every point of its ink is inside it. */
function controlBox([from, control1, control2, to]: Cubic): Box {
  const left = Math.min(from.x, control1.x, control2.x, to.x);
  const top = Math.min(from.y, control1.y, control2.y, to.y);
  const right = Math.max(from.x, control1.x, control2.x, to.x);
  const bottom = Math.max(from.y, control1.y, control2.y, to.y);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** How far a box sits from a point, or 0 when the point is inside it. */
function boxDistance(box: Box, point: Point): number {
  const across = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const down = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return Math.hypot(across, down);
}

/** The two halves of a curve, split at its own middle. */
function halvesOf([from, control1, control2, to]: Cubic): [Cubic, Cubic] {
  const first = middleOf(from, control1);
  const second = middleOf(control1, control2);
  const third = middleOf(control2, to);
  const before = middleOf(first, second);
  const after = middleOf(second, third);
  const middle = middleOf(before, after);
  return [
    [from, first, before, middle],
    [middle, after, third, to],
  ];
}

/** The point half way between two. */
function middleOf(from: Point, to: Point): Point {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

/** How far a point sits from one head's ink: nothing inside a filled head. */
function distanceToHead(head: HeadInk, point: Point): number {
  if (head.kind === 'arrow') {
    const [a, b, c] = head.triangle;
    if (insideTriangle([a, b, c], point)) {
      return 0;
    }
    return Math.min(
      distanceToSegment(point, a, b),
      distanceToSegment(point, b, c),
      distanceToSegment(point, c, a),
    );
  }
  if (head.kind === 'dot') {
    const { centre, radius } = head;
    return Math.max(0, Math.hypot(point.x - centre.x, point.y - centre.y) - radius);
  }
  const [from, to] = head.through;
  return distanceToSegment(point, from, to);
}

/** Whether a point is inside a triangle, whichever way its corners run. */
function insideTriangle([a, b, c]: readonly [Point, Point, Point], point: Point): boolean {
  const side = (from: Point, to: Point): number =>
    (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
  const first = side(a, b);
  const second = side(b, c);
  const third = side(c, a);
  return (
    (first >= 0 && second >= 0 && third >= 0) || (first <= 0 && second <= 0 && third <= 0)
  );
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
 * by every point they draw through — both ends and each bend between them, so a
 * bent shaft keeps its shape rather than being straightened. An end attached to
 * an Element follows that Element, so a move frees it first (`released`,
 * `snap.ts`) and the end carries on from where it drew; what is left for this
 * function is translation.
 */
export function moved(element: Element, dx: number, dy: number): Element {
  if (isShaft(element)) {
    const [start, second, ...bends] = element.points;
    const along = (point: (typeof element.points)[number]): Point => ({
      ...point,
      x: point.x + dx,
      y: point.y + dy,
    });
    return { ...element, points: [along(start), along(second), ...bends.map(along)] };
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

/** How wide the caret's stroke is on a line of words at 100%, in screen pixels. */
const CARET_WIDTH = 2;

/** How far the caret wanders either side of its slot, in screen pixels. */
const CARET_WOBBLE = 0.6;

/**
 * The caret as the page draws it: one hand-drawn line down the slot the next
 * letter goes in, in the same ink as the Elements around it. It wanders by under
 * a screen pixel either way, the way a drawn line does, and it is one path, so a
 * blink costs a CSS rule and no drawing at all.
 *
 * A zoom small enough — the clearance that keeps a wide selection clear of the
 * note goes well under the page's own floor — leaves a slot narrower than the
 * stroke, and a stroke that wide would put its round caps outside the slot and
 * turn the path upward. So the stroke narrows with the slot: the caps close on
 * the slot's own edges, and the line runs down and stays inside it at every
 * zoom.
 */
export function caretLine(slot: Box): { stroke: number; path: string } {
  const stroke = Math.min(CARET_WIDTH, slot.height / 2);
  const top = slot.y + stroke / 2;
  const bottom = slot.y + slot.height - stroke / 2;
  const across = (wander: number): number => slot.x + CARET_WOBBLE * wander;
  const down = (share: number): number => top + (bottom - top) * share;
  return {
    stroke,
    path:
      `M${across(-0.5)} ${top}` +
      `C${across(0.7)} ${down(0.25)}, ${across(-0.4)} ${down(0.35)}, ${across(0.3)} ${down(0.5)}` +
      `C${across(0.9)} ${down(0.65)}, ${across(-0.2)} ${down(0.8)}, ${across(0.1)} ${bottom}`,
  };
}

/** Pan and zoom, in the units the canvas uses. */
export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;

/**
 * The smallest a selection may cover on the page, in screen pixels: a bare
 * shaft has no width and no height of its own, yet its ink is there to be seen.
 */
const SELECTION_FOOTPRINT = 12;

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function toScene(view: View, screenX: number, screenY: number): Point {
  return {
    x: (screenX - view.panX) / view.zoom,
    y: (screenY - view.panY) / view.zoom,
  };
}

/**
 * A Scene point, in the pixels the page draws in: the inverse of `toScene`, and
 * the one mapping every screen-space drawing and measurement goes through.
 */
export function toScreen(view: View, point: Point): Point {
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

/**
 * Zoom keeping the Scene point under the pointer where it is. The manual range
 * stops a person losing the page, but the clearance may already have fitted a
 * wide selection below it, so a zoom request never raises the zoom: from below
 * the floor it can still zoom in, and it does not jump out when asked to zoom
 * out.
 */
export function zoomedAt(view: View, factor: number, screenX: number, screenY: number): View {
  const zoom = Math.max(
    Math.min(ZOOM_MAX, view.zoom * factor),
    Math.min(ZOOM_MIN, view.zoom),
  );
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

/**
 * The frame the tool rail docks on: the diagram as shown on screen, at least
 * the minimum size, cut to the editor's box, and the top dock's rail on it.
 */
export interface RailFrame {
  /** The diagram's frame on screen: what a dock sits outside of. */
  readonly frame: Box;
  /**
   * The top dock: the rail's own box turns about `x` and its top edge is `y`,
   * so the pencil outline that hangs outside it clears the frame by the gap.
   */
  readonly dock: Point;
}

/**
 * The pencil outline the rail wears, as the rail box cannot measure it: the
 * strip is wider and taller than the box it turns about.
 */
export interface RailOutline {
  /** How tall the outline is, in screen pixels. */
  readonly height: number;
  /** How far the outline hangs outside the rail's box, above and below it. */
  readonly overhang: number;
}

/** The smallest frame a diagram gets on screen (D2). */
const FRAME_MIN_WIDTH = 960;
const FRAME_MIN_HEIGHT = 600;

/** The gap between the frame's top side and the rail's pencil outline: the note's own (I2). */
const RAIL_GAP = 16;

/** How far inside the editor's top edge the rail stops when the frame leaves no room above it (D2). */
const RAIL_INSET = 15;

/**
 * The frame around a Scene's diagram, and where the top dock's rail sits on it.
 *
 * The frame is the diagram as the page shows it — the union of its Elements'
 * bounds, without the page's own padding — grown to at least the minimum size
 * about its centre and then cut to the editor's box. An empty Scene, and one
 * with nothing of that frame left on screen, is framed at the minimum size
 * around the editor's middle (D2, I1).
 *
 * The dock is centred on the frame's top side with the outline one gap above
 * it. Where the frame's top leaves no room for that, the rail stops just inside
 * the editor's top edge instead, over the paper (D2).
 */
export function railFrame(
  scene: Scene,
  view: View,
  viewport: { width: number; height: number },
  outline: RailOutline,
  layout: Layout,
): RailFrame {
  const editor: Box = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const diagram = boxOf(scene.elements, elementsById(scene.elements), layout);
  const shown = diagram === null ? null : grown(onScreen(diagram, view));
  const frame = (shown === null ? null : cutTo(shown, editor)) ?? emptyFrame(editor);
  const above = frame.y - RAIL_GAP - outline.height;
  return {
    frame,
    dock: {
      x: frame.x + frame.width / 2,
      y: above < 0 ? RAIL_INSET : above + outline.overhang,
    },
  };
}

/** A box grown about its own centre to at least the frame's minimum size. */
function grown(box: Box): Box {
  const width = Math.max(box.width, FRAME_MIN_WIDTH);
  const height = Math.max(box.height, FRAME_MIN_HEIGHT);
  return {
    x: box.x - (width - box.width) / 2,
    y: box.y - (height - box.height) / 2,
    width,
    height,
  };
}

/** A Scene box, in the pixels the page draws in. */
function onScreen(box: Box, view: View): Box {
  return { ...toScreen(view, box), width: box.width * view.zoom, height: box.height * view.zoom };
}

/** What of a box the editor's own box leaves, or null when it leaves nothing. */
function cutTo(box: Box, editor: Box): Box | null {
  const left = Math.max(box.x, editor.x);
  const top = Math.max(box.y, editor.y);
  const right = Math.min(box.x + box.width, editor.x + editor.width);
  const bottom = Math.min(box.y + box.height, editor.y + editor.height);
  if (right <= left || bottom <= top) {
    return null;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The empty Scene's frame: the minimum size about the editor's middle, inside its box. */
function emptyFrame(editor: Box): Box {
  const width = Math.min(FRAME_MIN_WIDTH, editor.width);
  const height = Math.min(FRAME_MIN_HEIGHT, editor.height);
  return {
    x: editor.x + (editor.width - width) / 2,
    y: editor.y + (editor.height - height) / 2,
    width,
    height,
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
  /** The leftmost the selection may sit on the page, in screen units: the editor's own left edge, with its gap. */
  left: number;
  /** Breathing room between the selection and the note. */
  gap: number;
}

/**
 * The view that keeps the selection out from under the docked Style menu.
 *
 * One rectangle policy, run when the selection, what it holds, or the window
 * changes: when the selection's box on screen and the note's box share any
 * area, the view pans left just far enough to clear the note by `gap`, and the
 * selection's left edge still clears what `left` allows. When panning cannot do it,
 * because the selection is wider than the room the note leaves, the view zooms
 * out just far enough for the whole selection to sit in that room, keeping its
 * middle where it was vertically. That zoom is the clearance's own, so it may go
 * below the manual floor rather than leave the selection clipped. All of it is a
 * view change: the Scene is never touched.
 */
export function clearedView(view: View, room: Clearance): View {
  const { selection, note, gap } = room;
  if (selection === null) {
    return view;
  }
  const shown = footprintOf(selection, view);
  const corner = toScreen(view, shown);
  const box: Box = {
    x: corner.x,
    y: corner.y,
    width: shown.width * view.zoom,
    height: shown.height * view.zoom,
  };
  if (!overlaps(box, note)) {
    return view;
  }
  const shift = box.x + box.width + gap - note.x;
  if (shift <= 0) {
    return view;
  }
  if (box.x - shift >= room.left) {
    return { ...view, panX: view.panX - shift };
  }
  const free = note.x - gap - room.left;
  if (free <= 0) {
    return view;
  }
  const zoom = Math.min(view.zoom, free / shown.width);
  if (zoom >= view.zoom) {
    return view;
  }
  // The selection keeps its middle where the eye left it, and its right edge
  // stops a gap short of the note, so the whole of it is on the page.
  const middle = box.y + box.height / 2;
  return {
    zoom,
    panX: note.x - gap - (shown.x + shown.width) * zoom,
    panY: middle - (shown.y + shown.height / 2) * zoom,
  };
}

/**
 * The box the page shows for a selection, in Scene units: a selection with no
 * width or height of its own — a vertical or horizontal shaft — still has ink on
 * the page, so it gets at least a footprint, grown around its middle.
 */
function footprintOf(selection: Box, view: View): Box {
  const width = Math.max(selection.width, SELECTION_FOOTPRINT / view.zoom);
  const height = Math.max(selection.height, SELECTION_FOOTPRINT / view.zoom);
  return {
    x: selection.x - (width - selection.width) / 2,
    y: selection.y - (height - selection.height) / 2,
    width,
    height,
  };
}
