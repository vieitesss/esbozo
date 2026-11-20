/**
 * Scene: the schema, its parsing and its serialising.
 *
 * A Scene is a JSON object. `version` is the schema version, `title` is the
 * accessible name used in the SVG, `defaults` holds Scene-wide style, and
 * `elements` holds an ordered Element list whose order is layer order.
 *
 * {
 *   "version": 1,
 *   "title": "Two boxes",                           // optional
 *   "defaults": {                                   // every field optional
 *     "roughness": 1,
 *     "stroke": { "width": "bold", "style": "solid" },
 *     "fill": { "kind": "hachure", "grey": 2 },
 *     "tone": "ink",
 *     "corners": "sharp",
 *     "fontSize": "M",
 *     "textAlign": "left"
 *   },
 *   "elements": [
 *     {
 *       "id": "a",                                  // required, stable
 *       "type": "rectangle",                        // or ellipse, diamond
 *       "x": 40, "y": 40, "width": 120, "height": 80,
 *       "roughness": 1,                             // 0 architect, 1 artist, 2 cartoonist
 *       "seed": 1234,                               // optional: defaults to the id hash
 *       "stroke": { "width": "bold", "style": "solid" },
 *       "fill": { "kind": "hachure", "grey": 2 },   // kind: none | solid | hachure | cross-hatch
 *       "tone": "ink",                              // ink | muted
 *       "corners": "sharp",                         // sharp | round, rectangles only
 *       "fontSize": "M",                            // S | M | L | XL, Labels later (#4)
 *       "textAlign": "left"                         // left | center | right, Labels later (#4)
 *     },
 *     {
 *       "id": "b",
 *       "type": "arrow",                            // or line
 *       "points": [                                 // exactly two ends
 *         { "x": 40, "y": 40 },
 *         { "x": 200, "y": 140, "snap": "a" }        // Snap target: an Element id
 *       ],
 *       "heads": { "start": "none", "end": "arrow" } // none | arrow | dot | bar
 *     },
 *     {
 *       "id": "c",
 *       "type": "text",
 *       "x": 40, "y": 200,
 *       "content": "Free-standing Text",            // newlines are line breaks
 *       "fontSize": "L",
 *       "textAlign": "left"
 *     }
 *   ]
 * }
 *
 * Parse returns either a Scene or the problems with the Element that caused
 * them. Every parsed Scene is fully resolved: each Element carries its own
 * roughness, seed and style, so later stages never re-read the defaults. A
 * Snap target must exist and must be a rectangle, ellipse or diamond; its end
 * is resolved by the Renderer, because that needs the whole Scene.
 *
 * Roughness, stroke, fill, tone and corners draw; Text draws with tone, font
 * size and text alignment, and Labels take those over from #4. Fill and corners
 * apply to closed outlines: an arrow or line is a stroke, so it has no fill and
 * no corners.
 *
 * Geometry is rounded to whole pixels in one place, `canonicalScene`: parsing,
 * serialising, hashing and drawing all go through it, so a Scene mutated in
 * memory (the editor assigns `x = 40.2`) saves, hashes and draws as the Scene
 * that reopens. Characters XML cannot represent are rejected here, because the
 * title and the Text content end up in the SVG.
 */
import { sha256, sha256Hex } from './sha256.js';

const SCENE_VERSION = 1;

const STROKE_WIDTHS = ['thin', 'bold', 'extra'] as const;
export type StrokeWidth = (typeof STROKE_WIDTHS)[number];

const STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type StrokeStyle = (typeof STROKE_STYLES)[number];

/** `none` draws no fill. `hachure` and `cross-hatch` are hand-drawn lines (Rough.js), `solid` is a flat wash. */
const FILL_KINDS = ['none', 'solid', 'hachure', 'cross-hatch'] as const;
export type FillKind = (typeof FILL_KINDS)[number];

/** Colours are never spelled out: they come from the host's CSS variables. */
const TONES = ['ink', 'muted'] as const;
export type Tone = (typeof TONES)[number];

const CORNERS = ['sharp', 'round'] as const;
export type Corners = (typeof CORNERS)[number];

const FONT_SIZES = ['S', 'M', 'L', 'XL'] as const;
export type FontSize = (typeof FONT_SIZES)[number];

const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

const HEADS = ['none', 'arrow', 'dot', 'bar'] as const;
export type Head = (typeof HEADS)[number];

/**
 * Roughness is a whole number, with three named looks: 0 architect, 1 artist
 * and 2 cartoonist. The number keeps the Scene short and lets the editor step
 * through the looks; the names live in the docs and the Style menu.
 */
const ROUGHNESS_MIN = 0;
const ROUGHNESS_MAX = 2;

const ELEMENT_TYPES = ['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'text'] as const;

/** The Element types with an outline a Snap can land on. */
const OUTLINED_TYPES = ['rectangle', 'ellipse', 'diamond'] as const;

/** Whether an Element has an outline: only those can be Snap targets. */
export function isOutlined(element: Element): element is OutlinedElement {
  return (OUTLINED_TYPES as readonly string[]).includes(element.type);
}

/** The seven-grey ladder runs from paper (0) to ink (6). */
const GREY_MIN = 0;
const GREY_MAX = 6;

export interface Stroke {
  width: StrokeWidth;
  style: StrokeStyle;
}

export interface Fill {
  kind: FillKind;
  /** Grey step on the seven-grey ladder: 0 is paper, 6 is ink. */
  grey: number;
}

/** The arrow head drawn at each end. Defaults: start none, end arrow for an arrow, both none for a line. */
export interface Heads {
  start: Head;
  end: Head;
}

/** One end of an arrow or line. `snap` is the id of the Element outline it is drawn on. */
export interface Point {
  x: number;
  y: number;
  snap?: string;
}

export interface ElementStyle {
  roughness: number;
  stroke: Stroke;
  fill: Fill;
  tone: Tone;
  corners: Corners;
  /** For Text now, for Labels from #4. */
  fontSize: FontSize;
  /** For Text now, for Labels from #4. */
  textAlign: TextAlign;
}

interface ElementBase extends ElementStyle {
  id: string;
  seed: number;
}

export interface RectangleElement extends ElementBase {
  type: 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EllipseElement extends ElementBase {
  type: 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiamondElement extends ElementBase {
  type: 'diamond';
  x: number;
  y: number;
  width: number;
  height: number;
}

export type OutlinedElement = RectangleElement | EllipseElement | DiamondElement;

interface ArrowOrLineBase extends ElementBase {
  points: [Point, Point];
  heads: Heads;
}

export interface ArrowElement extends ArrowOrLineBase {
  type: 'arrow';
}

export interface LineElement extends ArrowOrLineBase {
  type: 'line';
}

export type ArrowOrLineElement = ArrowElement | LineElement;

export interface TextElement extends ElementBase {
  type: 'text';
  x: number;
  y: number;
  content: string;
}

export type Element = OutlinedElement | ArrowOrLineElement | TextElement;

/** Scene-wide style; every field of it has a default. */
export type SceneStyle = ElementStyle;

export interface Scene {
  version: typeof SCENE_VERSION;
  title: string;
  defaults: SceneStyle;
  elements: Element[];
}

interface Problem {
  /** The Element the problem belongs to, or null when it belongs to the Scene. */
  elementId: string | null;
  message: string;
}

type ParseResult =
  | { ok: true; scene: Scene }
  | { ok: false; problems: Problem[] };

const DEFAULT_STYLE: SceneStyle = {
  roughness: 1,
  stroke: { width: 'bold', style: 'solid' },
  fill: { kind: 'hachure', grey: 2 },
  tone: 'ink',
  corners: 'sharp',
  fontSize: 'M',
  textAlign: 'left',
};

const DEFAULT_TITLE = 'Scene';

const MAX_SEED = 2 ** 31 - 1;

const SCENE_KEYS = ['version', 'title', 'defaults', 'elements'] as const;
const DEFAULTS_KEYS = [
  'roughness',
  'stroke',
  'fill',
  'tone',
  'corners',
  'fontSize',
  'textAlign',
] as const;
const ELEMENT_STYLE_KEYS = [
  'roughness',
  'seed',
  'stroke',
  'fill',
  'tone',
  'corners',
  'fontSize',
  'textAlign',
] as const;
const OUTLINED_ELEMENT_KEYS = ['id', 'type', 'x', 'y', 'width', 'height', ...ELEMENT_STYLE_KEYS] as const;
const ARROW_OR_LINE_ELEMENT_KEYS = ['id', 'type', 'points', 'heads', ...ELEMENT_STYLE_KEYS] as const;
const TEXT_ELEMENT_KEYS = ['id', 'type', 'x', 'y', 'content', ...ELEMENT_STYLE_KEYS] as const;
const ALL_ELEMENT_KEYS = [
  ...new Set([...OUTLINED_ELEMENT_KEYS, ...ARROW_OR_LINE_ELEMENT_KEYS, ...TEXT_ELEMENT_KEYS]),
];
const STROKE_KEYS = ['width', 'style'] as const;
const FILL_KEYS = ['kind', 'grey'] as const;
const POINT_KEYS = ['x', 'y', 'snap'] as const;
const HEADS_KEYS = ['start', 'end'] as const;

/** Whole-pixel coordinates keep Scene diffs clean and the SVG small. */
function wholePixels(value: number): number {
  const rounded = Math.round(value);
  // No negative zero: it serialises as `0` but is a different number in memory.
  return rounded === 0 ? 0 : rounded;
}

/**
 * The Scene as it is saved, hashed and drawn: its geometry rounded to whole
 * pixels, and nothing else changed. Parsed Scenes are canonical already; a
 * Scene the editor mutates is not, so the one rounding rule (`wholePixels`) is
 * applied here and nowhere else. The argument is never modified: the editor
 * keeps the values it assigned.
 */
export function canonicalScene(scene: Scene): Scene {
  return {
    version: scene.version,
    title: scene.title,
    defaults: scene.defaults,
    elements: scene.elements.map(canonicalElement),
  };
}

function canonicalElement(element: Element): Element {
  if (element.type === 'arrow' || element.type === 'line') {
    const [start, end] = element.points;
    return { ...element, points: [wholePoint(start), wholePoint(end)] };
  }
  if (element.type === 'text') {
    return { ...element, x: wholePixels(element.x), y: wholePixels(element.y) };
  }
  return {
    ...element,
    x: wholePixels(element.x),
    y: wholePixels(element.y),
    width: wholePixels(element.width),
    height: wholePixels(element.height),
  };
}

function wholePoint(point: Point): Point {
  return { ...point, x: wholePixels(point.x), y: wholePixels(point.y) };
}

/**
 * Deterministic default seed for an Element that carries none: the same id
 * always draws the same way, and it is never 0 (Rough.js reads 0 as "pick one
 * at random").
 */
function seedForId(id: string): number {
  const digest = sha256(new TextEncoder().encode(id));
  const first = ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
  return (first % (MAX_SEED - 1)) + 1;
}

export function parseScene(source: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return { ok: false, problems: [sceneProblem(`not valid JSON: ${(error as Error).message}`)] };
  }
  if (!isRecord(raw)) {
    return { ok: false, problems: [sceneProblem('must be a JSON object')] };
  }

  const problems: Problem[] = [];
  rejectUnknownKeys(raw, SCENE_KEYS, (unknownKey) =>
    problems.push(sceneProblem(`unknown key "${unknownKey}"`)),
  );
  if (raw.version !== SCENE_VERSION) {
    problems.push(
      sceneProblem(`version must be ${SCENE_VERSION}, got ${describe(raw.version)}`),
    );
  }

  const title = raw.title === undefined ? DEFAULT_TITLE : parseTitle(raw.title, problems);
  const defaults = parseDefaults(raw.defaults, problems);
  const elements = parseElements(raw.elements, defaults, problems);
  if (elements !== null) {
    validateSnapTargets(elements, problems);
  }

  if (problems.length > 0 || title === null || elements === null) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    scene: { version: SCENE_VERSION, title, defaults, elements },
  };
}

/**
 * Serialise a Scene with a stable key order and whole-pixel coordinates, so the
 * same Scene always hashes and diffs the same way.
 */
export function serialiseScene(scene: Scene): string {
  const canonical = canonicalScene(scene);
  const out = {
    version: canonical.version,
    title: canonical.title,
    defaults: serialiseStyle(canonical.defaults),
    elements: canonical.elements.map(serialiseElement),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** The Scene hash written into the SVG: sha256 of the serialised Scene. */
export function hashScene(scene: Scene): string {
  return sha256Hex(serialiseScene(scene));
}

function serialiseElement(element: Element): object {
  if (element.type === 'arrow' || element.type === 'line') {
    return {
      id: element.id,
      type: element.type,
      points: element.points.map((point) => ({
        x: point.x,
        y: point.y,
        ...(point.snap === undefined ? {} : { snap: point.snap }),
      })),
      heads: { start: element.heads.start, end: element.heads.end },
      seed: element.seed,
      ...serialiseStyle(element),
    };
  }
  if (element.type === 'text') {
    return {
      id: element.id,
      type: element.type,
      x: element.x,
      y: element.y,
      content: element.content,
      seed: element.seed,
      ...serialiseStyle(element),
    };
  }
  return {
    id: element.id,
    type: element.type,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    seed: element.seed,
    ...serialiseStyle(element),
  };
}

function serialiseStyle(style: SceneStyle): SceneStyle {
  return {
    roughness: style.roughness,
    stroke: { width: style.stroke.width, style: style.stroke.style },
    fill: { kind: style.fill.kind, grey: style.fill.grey },
    tone: style.tone,
    corners: style.corners,
    fontSize: style.fontSize,
    textAlign: style.textAlign,
  };
}

function parseTitle(raw: unknown, problems: Problem[]): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') {
    problems.push(sceneProblem('title must be a non-empty string'));
    return null;
  }
  if (hasXmlInvalidChars(raw)) {
    problems.push(sceneProblem('title must not contain characters XML cannot represent'));
    return null;
  }
  return raw;
}

function parseDefaults(raw: unknown, problems: Problem[]): SceneStyle {
  const report = (message: string) => problems.push(sceneProblem(message));
  const defaults = isRecord(raw) ? raw : null;
  if (defaults !== null) {
    rejectUnknownKeys(defaults, DEFAULTS_KEYS, (unknownKey) =>
      report(`defaults: unknown key "${unknownKey}"`),
    );
  } else if (raw !== undefined) {
    report('defaults must be a JSON object');
  }
  return parseStyle(defaults ?? {}, DEFAULT_STYLE, report);
}

function parseElements(
  raw: unknown,
  defaults: SceneStyle,
  problems: Problem[],
): Element[] | null {
  if (!Array.isArray(raw)) {
    problems.push(sceneProblem('elements must be a JSON array'));
    return null;
  }
  const elements: Element[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry)) {
      problems.push({
        elementId: null,
        message: `elements[${index}] must be a JSON object`,
      });
      continue;
    }
    const id = typeof entry.id === 'string' ? entry.id : null;
    if (id === null || id === '') {
      problems.push({
        elementId: null,
        message: `elements[${index}] needs a non-empty string id`,
      });
      continue;
    }
    if (seen.has(id)) {
      problems.push({ elementId: id, message: 'duplicate id' });
      continue;
    }
    seen.add(id);
    const element = parseElement(id, entry, defaults, problems);
    if (element !== null) {
      elements.push(element);
    }
  }
  return elements;
}

/**
 * A Snap end is drawn on its target's outline, so the target must exist and
 * must be a rectangle, ellipse or diamond. The problem names the arrow or line,
 * not the target: the Scene's own Element is what the author has to fix.
 */
function validateSnapTargets(elements: Element[], problems: Problem[]): void {
  const byId = new Map(elements.map((element) => [element.id, element]));
  for (const element of elements) {
    if (element.type !== 'arrow' && element.type !== 'line') {
      continue;
    }
    for (const point of element.points) {
      if (point.snap === undefined) {
        continue;
      }
      const target = byId.get(point.snap);
      if (target === undefined) {
        problems.push({
          elementId: element.id,
          message: `snap target "${point.snap}" does not exist`,
        });
      } else if (!isOutlined(target)) {
        problems.push({
          elementId: element.id,
          message: `snap target "${point.snap}" must be a rectangle, ellipse or diamond`,
        });
      }
    }
  }
}

function parseElement(
  id: string,
  raw: Record<string, unknown>,
  defaults: SceneStyle,
  problems: Problem[],
): Element | null {
  const before = problems.length;
  const report = (message: string) => problems.push({ elementId: id, message });

  const type = ELEMENT_TYPES.find((candidate) => candidate === raw.type) ?? null;
  if (type === null) {
    report(`type must be one of ${ELEMENT_TYPES.join(', ')}, got ${describe(raw.type)}`);
  }
  rejectUnknownKeys(raw, elementKeys(type), (unknownKey) => report(`unknown key "${unknownKey}"`));

  const style = parseStyle(raw, defaults, report);
  const seedValue =
    raw.seed === undefined
      ? seedForId(id)
      : parseIntInRange(raw.seed, 'seed', 1, MAX_SEED, report);
  const seed = seedValue ?? seedForId(id);

  let element: Element | null = null;
  if (type === 'text') {
    element = {
      id,
      type,
      x: parseWholePixels(raw.x, 'x', report) ?? 0,
      y: parseWholePixels(raw.y, 'y', report) ?? 0,
      content: parseTextContent(raw.content, report) ?? '',
      seed,
      ...style,
    };
  } else if (type === 'arrow' || type === 'line') {
    const points = parsePoints(raw.points, report);
    const heads = parseHeads(raw.heads, type, report);
    if (points !== null) {
      element = { id, type, points, heads, seed, ...style };
    }
  } else if (type !== null) {
    const geometry = parseOutlinedGeometry(raw, report);
    if (geometry !== null) {
      element = { id, type, ...geometry, seed, ...style };
    }
  }

  return problems.length === before ? element : null;
}

function elementKeys(type: Element['type'] | null): readonly string[] {
  if (type === 'text') {
    return TEXT_ELEMENT_KEYS;
  }
  if (type === 'arrow' || type === 'line') {
    return ARROW_OR_LINE_ELEMENT_KEYS;
  }
  if (type === null) {
    return ALL_ELEMENT_KEYS;
  }
  return OUTLINED_ELEMENT_KEYS;
}

function parseOutlinedGeometry(
  raw: Record<string, unknown>,
  report: (message: string) => void,
): { x: number; y: number; width: number; height: number } | null {
  const geometry = {
    x: parseWholePixels(raw.x, 'x', report),
    y: parseWholePixels(raw.y, 'y', report),
    width: parseWholePixels(raw.width, 'width', report),
    height: parseWholePixels(raw.height, 'height', report),
  };
  let ok = true;
  for (const [field, value] of Object.entries(geometry)) {
    if (value === null) {
      ok = false;
    } else if (field === 'width' || field === 'height') {
      if (value < 1) {
        report(`${field} must be at least 1 pixel, got ${value}`);
        ok = false;
      }
    }
  }
  if (!ok) {
    return null;
  }
  return geometry as { x: number; y: number; width: number; height: number };
}

function parseTextContent(raw: unknown, report: (message: string) => void): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') {
    report(`content must be a non-empty string, got ${describe(raw)}`);
    return null;
  }
  if (hasXmlInvalidChars(raw)) {
    report('content must not contain characters XML cannot represent');
    return null;
  }
  return raw;
}

function parsePoints(
  raw: unknown,
  report: (message: string) => void,
): [Point, Point] | null {
  if (!Array.isArray(raw) || raw.length !== 2) {
    report('points must be an array of exactly two end points');
    return null;
  }
  const start = parsePoint(raw[0], 0, report);
  const end = parsePoint(raw[1], 1, report);
  return start === null || end === null ? null : [start, end];
}

function parsePoint(
  raw: unknown,
  index: number,
  report: (message: string) => void,
): Point | null {
  if (!isRecord(raw)) {
    report(`points[${index}] must be a JSON object`);
    return null;
  }
  rejectUnknownKeys(raw, POINT_KEYS, (unknownKey) => report(`unknown key "${unknownKey}"`));
  const x = parseWholePixels(raw.x, `points[${index}].x`, report);
  const y = parseWholePixels(raw.y, `points[${index}].y`, report);
  let snap: string | undefined;
  if (raw.snap !== undefined) {
    if (typeof raw.snap !== 'string' || raw.snap === '') {
      report(`points[${index}].snap must be a non-empty Element id`);
    } else {
      snap = raw.snap;
    }
  }
  return x === null || y === null ? null : { x, y, ...(snap === undefined ? {} : { snap }) };
}

function parseHeads(
  raw: unknown,
  type: 'arrow' | 'line',
  report: (message: string) => void,
): Heads {
  const fallback: Heads = { start: 'none', end: type === 'arrow' ? 'arrow' : 'none' };
  if (raw === undefined) {
    return fallback;
  }
  if (!isRecord(raw)) {
    report('heads must be a JSON object');
    return fallback;
  }
  rejectUnknownKeys(raw, HEADS_KEYS, (unknownKey) => report(`unknown key "${unknownKey}"`));
  return {
    start: parseChoice(raw.start, 'heads.start', HEADS, fallback.start, report),
    end: parseChoice(raw.end, 'heads.end', HEADS, fallback.end, report),
  };
}

function parseStyle(
  raw: Record<string, unknown>,
  fallback: SceneStyle,
  report: (message: string) => void,
): SceneStyle {
  return {
    roughness: parseRoughness(raw.roughness, fallback.roughness, report),
    stroke: parseStroke(raw.stroke, fallback.stroke, report),
    fill: parseFill(raw.fill, fallback.fill, report),
    tone: parseChoice(raw.tone, 'tone', TONES, fallback.tone, report),
    corners: parseChoice(raw.corners, 'corners', CORNERS, fallback.corners, report),
    fontSize: parseChoice(raw.fontSize, 'fontSize', FONT_SIZES, fallback.fontSize, report),
    textAlign: parseChoice(raw.textAlign, 'textAlign', TEXT_ALIGNS, fallback.textAlign, report),
  };
}

function parseRoughness(
  raw: unknown,
  fallback: number,
  report: (message: string) => void,
): number {
  if (raw === undefined) {
    return fallback;
  }
  return parseIntInRange(raw, 'roughness', ROUGHNESS_MIN, ROUGHNESS_MAX, report) ?? fallback;
}

function parseStroke(
  raw: unknown,
  fallback: Stroke,
  report: (message: string) => void,
): Stroke {
  if (!isRecord(raw)) {
    if (raw !== undefined) {
      report('stroke must be a JSON object');
    }
    return { ...fallback };
  }
  rejectUnknownKeys(raw, STROKE_KEYS, (unknownKey) => report(`unknown key "${unknownKey}"`));
  return {
    width: parseChoice(raw.width, 'stroke.width', STROKE_WIDTHS, fallback.width, report),
    style: parseChoice(raw.style, 'stroke.style', STROKE_STYLES, fallback.style, report),
  };
}

function parseFill(
  raw: unknown,
  fallback: Fill,
  report: (message: string) => void,
): Fill {
  if (!isRecord(raw)) {
    if (raw !== undefined) {
      report('fill must be a JSON object');
    }
    return { ...fallback };
  }
  rejectUnknownKeys(raw, FILL_KEYS, (unknownKey) => report(`unknown key "${unknownKey}"`));
  return {
    kind: parseChoice(raw.kind, 'fill.kind', FILL_KINDS, fallback.kind, report),
    grey:
      raw.grey === undefined
        ? fallback.grey
        : (parseIntInRange(raw.grey, 'fill.grey', GREY_MIN, GREY_MAX, report) ?? fallback.grey),
  };
}

function parseNumber(
  raw: unknown,
  field: string,
  report: (message: string) => void,
): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    report(`${field} must be a finite number, got ${describe(raw)}`);
    return null;
  }
  return raw;
}

/** Geometry is rounded to whole pixels on the way in, and `canonicalScene` rounds it for a Scene mutated in memory. */
function parseWholePixels(
  raw: unknown,
  field: string,
  report: (message: string) => void,
): number | null {
  const value = parseNumber(raw, field, report);
  return value === null ? null : wholePixels(value);
}

function parseIntInRange(
  raw: unknown,
  field: string,
  min: number,
  max: number,
  report: (message: string) => void,
): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    report(`${field} must be an integer, got ${describe(raw)}`);
    return null;
  }
  if (raw < min || raw > max) {
    report(`${field} must be between ${min} and ${max}, got ${raw}`);
    return null;
  }
  return raw;
}

function parseChoice<T extends string>(
  raw: unknown,
  field: string,
  allowed: readonly T[],
  fallback: T,
  report: (message: string) => void,
): T {
  if (raw === undefined) {
    return fallback;
  }
  if (!isOneOf(allowed, raw)) {
    report(`${field} must be one of ${allowed.join(', ')}, got ${describe(raw)}`);
    return fallback;
  }
  return raw;
}

/**
 * XML 1.0 allows tab, newline, carriage return, U+0020..U+D7FF, U+E000..U+FFFD
 * and U+10000 upward. Everything else, lone surrogates included, would make
 * the SVG unparseable. Only the title and the Text content enter the SVG, so
 * only they are checked: an Element id stays a Scene label.
 */
function hasXmlInvalidChars(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0)!;
    const allowed =
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      code >= 0x10000;
    if (!allowed) {
      return true;
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A misspelled key is a problem worth reporting: it would otherwise be ignored in silence. */
function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  onUnknownKey: (unknownKey: string) => void,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      onUnknownKey(key);
    }
  }
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function describe(value: unknown): string {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}

function sceneProblem(message: string): Problem {
  return { elementId: null, message };
}
