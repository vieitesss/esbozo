/**
 * The Scene edits `ez anchor` and `ez snap` make, and the words they take.
 *
 * Arguments, files and exit codes belong to whoever runs a command: `src/cli.ts`
 * in Node, and `cmd/ez` through the core bundle. So this module knows only a
 * Scene — which end a word names, the fractions a place means, the point an
 * Anchor draws at, and the one line a person reads — and carries no Node API,
 * because the bundle runs these same edits inside goja.
 */
import { anchorOf, anchorPoint, pointOnOutline } from './geometry.js';
import { isOutlined, snapTargetId, elementsById } from './scene.js';
import { drawnGeometry } from './renderer.js';
import type { Anchor, ArrowOrLineElement, Element, OutlinedElement, Point, Scene } from './scene.js';
import { EXIT } from './exit.js';

/*
 * An Anchor names a place on a Snap target's box, so the names below exist on
 * the command line only: the Scene always stores fractions, and a person who
 * wants a corner of a rounded box or of an ellipse gets the point where the box
 * corner's line to the centre meets the outline, because those shapes have no
 * corner where their box has one.
 */

/**
 * The places an Anchor takes on the command line: names for the middle of a
 * side, the middle of the box, and its four corners. A Scene never holds a name,
 * only the fractions these stand for.
 */
const SIDE_PLACES: Readonly<Record<string, Anchor>> = {
  top: { x: 0.5, y: 0 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
};

/** A name for a corner of the box, as fractions of it. */
const CORNER_PLACES: Readonly<Record<string, Anchor>> = {
  'top-left': { x: 0, y: 0 },
  'top-right': { x: 1, y: 0 },
  'bottom-left': { x: 0, y: 1 },
  'bottom-right': { x: 1, y: 1 },
};

/** Every place a person can name, in the order the help lists them. */
const PLACE_WORDS = [...Object.keys(SIDE_PLACES), ...Object.keys(CORNER_PLACES)];

/** Which end of an arrow or line a command names: its first point, or its last. */
const ENDS = ['start', 'end'] as const;
type End = (typeof ENDS)[number];

/**
 * What a command says to anchor an end at, before the target's outline is known:
 * a place on the box, a corner of it, or no Anchor at all.
 */
type Place =
  | { readonly kind: 'none' }
  | { readonly kind: 'spot'; readonly anchor: Anchor; readonly corner: boolean };

/** What a command made of a Scene: the Scene to save, and the lines a person reads. */
export interface Change {
  readonly scene: Scene;
  readonly lines: readonly string[];
}

/** A command's answer: what it made, or the message and exit code it refused with. */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly exitCode: number };

export function refusal(message: string, exitCode: number): { ok: false; message: string; exitCode: number } {
  return { ok: false, message, exitCode };
}

/**
 * What one `ez anchor` run says before the Scene is read: every unanchored end,
 * or one end and the place to put its Anchor at.
 */
export type AnchorWords =
  | { readonly all: true }
  | {
      readonly all: false;
      readonly elementId: string;
      readonly end: string;
      readonly place: string;
    };

/** One end anchored at a named place, or with its Anchor dropped. */
export type AnchorEdit =
  | { readonly all: true }
  | {
      readonly all: false;
      readonly elementId: string;
      readonly end: End;
      readonly place: Place;
    };

/** What one `ez snap` run says: one end, and the Element to attach it to or `off`. */
export interface SnapWords {
  readonly elementId: string;
  readonly end: string;
  /** The Element to attach to, or `off`: an end that remembers no Snap. */
  readonly target: string;
}

/** One end attached to an Element, or written free with `off`. */
export interface SnapEdit {
  readonly elementId: string;
  readonly end: End;
  /** The Element to attach to, or null for `off`: an end that remembers no Snap. */
  readonly target: string | null;
}

/** The edit `ez anchor`'s words ask for, or the message they are refused with. */
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

/** The edit `ez snap`'s words ask for, or the message they are refused with. */
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

/** The end a word names, or null where it names none. */
function parseEnd(word: string): End | null {
  return ENDS.find((candidate) => candidate === word) ?? null;
}

/** Why a word is no end: a Shaft has a start and an end, and nothing between. */
function endMessage(word: string): string {
  return `an end is start or end, got ${JSON.stringify(word)}`;
}

/** The place a word names: a name, a pair of fractions, or `none`. */
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
  // A fraction outside the box is the one thing `ez check` refuses about an Anchor.
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

/** A pair of fractions written `fx,fy`, or null where the word is not one. */
function pairOfFractions(word: string): Anchor | null {
  const parts = word.split(',');
  if (parts.length !== 2) {
    return null;
  }
  const [x, y] = parts.map((part) => (/^-?\d+(?:\.\d+)?$/.test(part) ? Number(part) : Number.NaN));
  return x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y) ? null : { x, y };
}

/** The Scene with the edit one `ez anchor` run asked for. */
export function anchorScene(scene: Scene, edit: AnchorEdit): Outcome<Change> {
  return edit.all ? freezeEnds(scene) : placeEnd(scene, edit);
}

/** The Scene with one end anchored at a named place, or its Anchor dropped. */
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

/**
 * The Scene with the edit one `ez snap` run asked for: one end attached to an
 * Element, or written free with `off`.
 */
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
    // The same place the editor's drop takes: the outline point nearest the spot
    // the end is drawn at now, not the target's centre.
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

/**
 * Every Snapped end that carries no Anchor, given the Anchor of the spot it
 * draws at today, so freezing it moves no ink.
 */
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

/**
 * Both ends a Shaft draws, each Snap resolved onto its target's outline: the
 * Renderer answers them canonically, so a Snap frozen here reads the very ends
 * the page draws.
 */
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

/** The arrow or line an id names, or why the Scene has no such Shaft. */
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

/** The outlined Element an end Snaps to, or why it can hold no Anchor. */
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

/** Where an end sits among its Shaft's points: the first one, or the last. */
function endIndex(element: ArrowOrLineElement, end: End): number {
  return end === 'start' ? 0 : element.points.length - 1;
}

/** The Anchor a named place means on this outline: fractions the Renderer draws there. */
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

/** The end stored where its Anchor draws it, so the file's numbers read true. */
function drawnAt(point: Point, target: OutlinedElement, anchor: Anchor): Point {
  const drawn = anchorPoint(target, anchor);
  return { ...point, x: drawn.x, y: drawn.y, anchor };
}

/** The same point with no Anchor: the Renderer aims the end again. */
function withoutAnchor(point: Point): Point {
  const cleared = { ...point };
  delete cleared.anchor;
  return cleared;
}

/** The Scene with one of a Shaft's points replaced. */
function withPoint(scene: Scene, element: ArrowOrLineElement, index: number, point: Point): Scene {
  const points = element.points.map((candidate, at) => (at === index ? point : candidate));
  const changed = { ...element, points } as ArrowOrLineElement;
  return {
    ...scene,
    elements: scene.elements.map((candidate) => (candidate.id === element.id ? changed : candidate)),
  };
}

/** The one line a command prints about the end it changed. */
function changedLine(id: string, end: End, point: Point): string {
  const snap = typeof point.snap === 'string' ? point.snap : 'off';
  const anchor =
    point.anchor === undefined ? '' : `, anchor {x: ${point.anchor.x}, y: ${point.anchor.y}}`;
  return `${id} ${end}: snap ${snap}${anchor}`;
}
