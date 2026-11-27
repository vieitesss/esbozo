import { anchorOf, anchorPoint, pointOnOutline } from './geometry.js';
import { isOutlined, snapTargetId, elementsById } from './scene.js';
import { drawnGeometry } from './renderer.js';
import type { Anchor, ArrowOrLineElement, Element, OutlinedElement, Point, Scene } from './scene.js';
import { EXIT } from './exit.js';

const SIDE_PLACES: Readonly<Record<string, Anchor>> = {
  top: { x: 0.5, y: 0 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
};

const CORNER_PLACES: Readonly<Record<string, Anchor>> = {
  'top-left': { x: 0, y: 0 },
  'top-right': { x: 1, y: 0 },
  'bottom-left': { x: 0, y: 1 },
  'bottom-right': { x: 1, y: 1 },
};

const PLACE_WORDS = [...Object.keys(SIDE_PLACES), ...Object.keys(CORNER_PLACES)];

const ENDS = ['start', 'end'] as const;
type End = (typeof ENDS)[number];

type Place =
  | { readonly kind: 'none' }
  | { readonly kind: 'spot'; readonly anchor: Anchor; readonly corner: boolean };

export interface Change {
  readonly scene: Scene;
  readonly lines: readonly string[];
}

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly exitCode: number };

function refusal(message: string, exitCode: number): { ok: false; message: string; exitCode: number } {
  return { ok: false, message, exitCode };
}

export type AnchorWords =
  | { readonly all: true }
  | {
      readonly all: false;
      readonly elementId: string;
      readonly end: string;
      readonly place: string;
    };

export type AnchorEdit =
  | { readonly all: true }
  | {
      readonly all: false;
      readonly elementId: string;
      readonly end: End;
      readonly place: Place;
    };

export interface SnapWords {
  readonly elementId: string;
  readonly end: string;
  readonly target: string;
}

export interface SnapEdit {
  readonly elementId: string;
  readonly end: End;
  readonly target: string | null;
}

export function anchorEditOf(words: AnchorWords): Outcome<AnchorEdit> {
  if (words.all) {
    return { ok: true, value: { all: true } };
  }
  const end = parseEnd(words.end);
  if (end === null) {
    return refusal(endMessage(words.end), EXIT.usage);
  }
  const parsed = parsePlace(words.place);
  if (!parsed.ok) {
    return parsed;
  }
  return {
    ok: true,
    value: { all: false, elementId: words.elementId, end, place: parsed.value },
  };
}

export function snapEditOf(words: SnapWords): Outcome<SnapEdit> {
  const end = parseEnd(words.end);
  if (end === null) {
    return refusal(endMessage(words.end), EXIT.usage);
  }
  return {
    ok: true,
    value: { elementId: words.elementId, end, target: words.target === 'off' ? null : words.target },
  };
}

function parseEnd(word: string): End | null {
  return ENDS.find((candidate) => candidate === word) ?? null;
}

function endMessage(word: string): string {
  return `an end is start or end, got ${JSON.stringify(word)}`;
}

function parsePlace(word: string): Outcome<Place> {
  if (word === 'none') {
    return { ok: true, value: { kind: 'none' } };
  }
  const side = SIDE_PLACES[word];
  if (side !== undefined) {
    return { ok: true, value: { kind: 'spot', anchor: side, corner: false } };
  }
  const corner = CORNER_PLACES[word];
  if (corner !== undefined) {
    return { ok: true, value: { kind: 'spot', anchor: corner, corner: true } };
  }
  const anchor = pairOfFractions(word);
  if (anchor === null) {
    return refusal(
      `a place is ${PLACE_WORDS.join(', ')}, a pair of fractions "fx,fy", or none,` +
        ` got ${JSON.stringify(word)}`,
      EXIT.usage,
    );
  }
  for (const [axis, value] of [
    ['x', anchor.x],
    ['y', anchor.y],
  ] as const) {
    if (!(value >= 0 && value <= 1)) {
      return refusal(`anchor ${axis} must be between 0 and 1, got ${value}`, EXIT.invalidScene);
    }
  }
  return { ok: true, value: { kind: 'spot', anchor, corner: false } };
}

function pairOfFractions(word: string): Anchor | null {
  const parts = word.split(',');
  if (parts.length !== 2) {
    return null;
  }
  const [x, y] = parts.map((part) => (/^-?\d+(?:\.\d+)?$/.test(part) ? Number(part) : Number.NaN));
  return x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y) ? null : { x, y };
}

export function anchorScene(scene: Scene, edit: AnchorEdit): Outcome<Change> {
  return edit.all ? freezeEnds(scene) : placeEnd(scene, edit);
}

function placeEnd(scene: Scene, request: AnchorEdit & { all: false }): Outcome<Change> {
  const found = findShaft(scene, request.elementId);
  if (!found.ok) {
    return found;
  }
  const element = found.value;
  const index = endIndex(element, request.end);
  const point = element.points[index]!;
  const target = snappedTarget(scene, element, request.end);
  if (!target.ok) {
    return target;
  }
  const anchor =
    request.place.kind === 'none' ? undefined : placeOn(request.place, target.value);
  const stored =
    anchor === undefined ? withoutAnchor(point) : drawnAt(point, target.value, anchor);
  return {
    ok: true,
    value: {
      scene: withPoint(scene, element, index, stored),
      lines: [changedLine(element.id, request.end, stored)],
    },
  };
}

export function snapScene(scene: Scene, request: SnapEdit): Outcome<Change> {
  const found = findShaft(scene, request.elementId);
  if (!found.ok) {
    return found;
  }
  const element = found.value;
  const index = endIndex(element, request.end);
  const point = element.points[index]!;

  let stored: Point;
  if (request.target === null) {
    stored = { x: point.x, y: point.y, snap: false };
  } else {
    const target = scene.elements.find((candidate) => candidate.id === request.target);
    if (target === undefined) {
      return refusal(`no Element "${request.target}" in the Scene`, EXIT.invalidScene);
    }
    if (!isOutlined(target)) {
      return refusal(
        `snap target "${request.target}" must be a rectangle, ellipse or diamond`,
        EXIT.invalidScene,
      );
    }
    const [atStart, atEnd] = drawnEnds(element, elementsById(scene.elements));
    const anchor = anchorOf(target, request.end === 'start' ? atStart : atEnd);
    stored = { ...drawnAt(point, target, anchor), snap: request.target };
  }

  return {
    ok: true,
    value: {
      scene: withPoint(scene, element, index, stored),
      lines: [changedLine(element.id, request.end, stored)],
    },
  };
}

function freezeEnds(scene: Scene): Outcome<Change> {
  const byId = elementsById(scene.elements);
  const lines: string[] = [];
  const elements = scene.elements.map((element) => {
    if (element.type !== 'arrow' && element.type !== 'line') {
      return element;
    }
    const [atStart, atEnd] = drawnEnds(element, byId);
    const last = element.points.length - 1;
    let changed = false;
    const points = element.points.map((point, index) => {
      const end: End | null = index === 0 ? 'start' : index === last ? 'end' : null;
      if (end === null || point.anchor !== undefined) {
        return point;
      }
      const target = snapTargetId(point);
      const outline = target === null ? undefined : byId.get(target);
      if (outline === undefined || !isOutlined(outline)) {
        return point;
      }
      const stored = drawnAt(
        point,
        outline,
        anchorOf(outline, end === 'start' ? atStart : atEnd),
      );
      changed = true;
      lines.push(changedLine(element.id, end, stored));
      return stored;
    });
    return changed ? ({ ...element, points } as ArrowOrLineElement) : element;
  });
  return { ok: true, value: { scene: { ...scene, elements }, lines } };
}

function drawnEnds(
  element: ArrowOrLineElement,
  byId: ReadonlyMap<string, Element>,
): readonly [Point, Point] {
  const ends = drawnGeometry(element, byId).ends;
  if (ends === null) {
    throw new Error(`${element.id}: only an arrow or line draws ends`);
  }
  return ends;
}

function findShaft(scene: Scene, id: string): Outcome<ArrowOrLineElement> {
  const element = scene.elements.find((candidate) => candidate.id === id);
  if (element === undefined) {
    return refusal(`no Element "${id}" in the Scene`, EXIT.invalidScene);
  }
  if (element.type !== 'arrow' && element.type !== 'line') {
    return refusal(
      `"${id}" is a ${element.type}: only an arrow or a line has ends`,
      EXIT.invalidScene,
    );
  }
  return { ok: true, value: element };
}

function snappedTarget(
  scene: Scene,
  element: ArrowOrLineElement,
  end: End,
): Outcome<OutlinedElement> {
  const id = snapTargetId(element.points[endIndex(element, end)]!);
  if (id === null) {
    return refusal(
      `"${element.id} ${end}" has no Snap: give it one with ez snap`,
      EXIT.invalidScene,
    );
  }
  const target = scene.elements.find((candidate) => candidate.id === id);
  if (target === undefined || !isOutlined(target)) {
    return refusal(`snap target "${id}" must be a rectangle, ellipse or diamond`, EXIT.invalidScene);
  }
  return { ok: true, value: target };
}

function endIndex(element: ArrowOrLineElement, end: End): number {
  return end === 'start' ? 0 : element.points.length - 1;
}

function placeOn(place: Place & { kind: 'spot' }, outline: OutlinedElement): Anchor {
  if (!place.corner) {
    return place.anchor;
  }
  const corner = {
    x: outline.x + place.anchor.x * outline.width,
    y: outline.y + place.anchor.y * outline.height,
  };
  return anchorOf(outline, pointOnOutline(outline, corner));
}

function drawnAt(point: Point, target: OutlinedElement, anchor: Anchor): Point {
  const drawn = anchorPoint(target, anchor);
  return { ...point, x: drawn.x, y: drawn.y, anchor };
}

function withoutAnchor(point: Point): Point {
  const cleared = { ...point };
  delete cleared.anchor;
  return cleared;
}

function withPoint(scene: Scene, element: ArrowOrLineElement, index: number, point: Point): Scene {
  const points = element.points.map((candidate, at) => (at === index ? point : candidate));
  const changed = { ...element, points } as ArrowOrLineElement;
  return {
    ...scene,
    elements: scene.elements.map((candidate) => (candidate.id === element.id ? changed : candidate)),
  };
}

function changedLine(id: string, end: End, point: Point): string {
  const snap = typeof point.snap === 'string' ? point.snap : 'off';
  const anchor =
    point.anchor === undefined ? '' : `, anchor {x: ${point.anchor.x}, y: ${point.anchor.y}}`;
  return `${id} ${end}: snap ${snap}${anchor}`;
}
