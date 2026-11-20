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
 *     "stroke": { "width": 2, "style": "solid" },
 *     "fill": { "kind": "hachure", "grey": 2 },
 *     "tone": "ink",
 *     "corners": "sharp"
 *   },
 *   "elements": [
 *     {
 *       "id": "a",                                  // required, stable
 *       "type": "rectangle",                        // required
 *       "x": 40, "y": 40, "width": 120, "height": 80,
 *       "roughness": 1,                             // optional: falls back to defaults
 *       "seed": 1234,                               // optional: defaults to the id hash
 *       "stroke": { "width": 2, "style": "solid" },
 *       "fill": { "kind": "hachure", "grey": 2 },   // kind: none | hachure | solid
 *       "tone": "ink",                              // ink | muted
 *       "corners": "sharp"
 *     }
 *   ]
 * }
 *
 * This shape is provisional until #3 (ellipses, diamonds, arrows, lines, Text,
 * Labels, Snap) settles it. It is kept wide enough to grow: style fields are
 * nested objects, every field has a default, and unknown top-level keys parse
 * into problems rather than being silently dropped.
 *
 * Parse returns either a Scene or the problems with the Element that caused
 * them. Every parsed Scene is fully resolved: each Element carries its own
 * roughness, seed and style, so later stages never re-read the defaults.
 */
import { createHash } from 'node:crypto';

export const SCENE_VERSION = 1;

export const STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type StrokeStyle = (typeof STROKE_STYLES)[number];

/** `none` draws no fill. `hachure` is hand-drawn lines (Rough.js), `solid` is a flat wash. */
export const FILL_KINDS = ['none', 'hachure', 'solid'] as const;
export type FillKind = (typeof FILL_KINDS)[number];

/** Colours are never spelled out: they come from the host's CSS variables. */
export const TONES = ['ink', 'muted'] as const;
export type Tone = (typeof TONES)[number];

export const CORNERS = ['sharp'] as const;
export type Corners = (typeof CORNERS)[number];

export const ELEMENT_TYPES = ['rectangle'] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

/** The seven-grey ladder runs from paper (0) to ink (6). */
export const GREY_MIN = 0;
export const GREY_MAX = 6;

export interface Stroke {
  width: number;
  style: StrokeStyle;
}

export interface Fill {
  kind: FillKind;
  /** Grey step on the seven-grey ladder: 0 is paper, 6 is ink. */
  grey: number;
}

export interface RectangleElement {
  id: string;
  type: 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
  roughness: number;
  seed: number;
  stroke: Stroke;
  fill: Fill;
  tone: Tone;
  corners: Corners;
}

export type Element = RectangleElement;

export interface SceneStyle {
  roughness: number;
  stroke: Stroke;
  fill: Fill;
  tone: Tone;
  corners: Corners;
}

export type SceneDefaults = SceneStyle;

export interface Scene {
  version: typeof SCENE_VERSION;
  title: string;
  defaults: SceneDefaults;
  elements: Element[];
}

export interface Problem {
  /** The Element the problem belongs to, or null when it belongs to the Scene. */
  elementId: string | null;
  message: string;
}

export type ParseResult =
  | { ok: true; scene: Scene }
  | { ok: false; problems: Problem[] };

export const DEFAULT_STYLE: SceneDefaults = {
  roughness: 1,
  stroke: { width: 2, style: 'solid' },
  fill: { kind: 'hachure', grey: 2 },
  tone: 'ink',
  corners: 'sharp',
};

export const DEFAULT_TITLE = 'Scene';

const ROUGHNESS_RANGE = [0, 5];
const MAX_SEED = 2 ** 31 - 1;

const SCENE_KEYS = ['version', 'title', 'defaults', 'elements'] as const;
const DEFAULTS_KEYS = ['roughness', 'stroke', 'fill', 'tone', 'corners'] as const;
const ELEMENT_KEYS = [
  'id',
  'type',
  'x',
  'y',
  'width',
  'height',
  'roughness',
  'seed',
  'stroke',
  'fill',
  'tone',
  'corners',
] as const;
const STROKE_KEYS = ['width', 'style'] as const;
const FILL_KEYS = ['kind', 'grey'] as const;

/** Whole-pixel coordinates keep Scene diffs clean and the SVG small. */
export function wholePixels(value: number): number {
  return Math.round(value);
}

/**
 * Deterministic default seed for an Element that carries none: the same id
 * always draws the same way, and it is never 0 (Rough.js reads 0 as "pick one
 * at random").
 */
export function seedForId(id: string): number {
  const digest = createHash('sha256').update(id).digest();
  return (digest.readUInt32BE(0) % (MAX_SEED - 1)) + 1;
}

export function parseScene(source: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return fail([sceneProblem(`not valid JSON: ${(error as Error).message}`)]);
  }
  if (!isRecord(raw)) {
    return fail([sceneProblem('must be a JSON object')]);
  }

  const problems: Problem[] = [];
  rejectUnknownKeys(raw, SCENE_KEYS, (key) =>
    problems.push(sceneProblem(`unknown key "${key}"`)),
  );
  if (raw.version !== SCENE_VERSION) {
    problems.push(
      sceneProblem(`version must be ${SCENE_VERSION}, got ${describe(raw.version)}`),
    );
  }

  const title = raw.title === undefined ? DEFAULT_TITLE : parseTitle(raw.title, problems);
  const defaults = parseDefaults(raw.defaults, problems);
  const elements = parseElements(raw.elements, defaults, problems);

  if (problems.length > 0 || title === null || elements === null) {
    return fail(problems);
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
  const out = {
    version: scene.version,
    title: scene.title,
    defaults: serialiseStyle(scene.defaults),
    elements: scene.elements.map((element) => ({
      id: element.id,
      type: element.type,
      x: wholePixels(element.x),
      y: wholePixels(element.y),
      width: wholePixels(element.width),
      height: wholePixels(element.height),
      ...serialiseStyle(element),
    })),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** The Scene hash written into the SVG: sha256 of the serialised Scene. */
export function hashScene(scene: Scene): string {
  return createHash('sha256').update(serialiseScene(scene), 'utf8').digest('hex');
}

function serialiseStyle(style: SceneStyle): {
  roughness: number;
  stroke: Stroke;
  fill: Fill;
  tone: Tone;
  corners: Corners;
} {
  return {
    roughness: style.roughness,
    stroke: { width: style.stroke.width, style: style.stroke.style },
    fill: { kind: style.fill.kind, grey: style.fill.grey },
    tone: style.tone,
    corners: style.corners,
  };
}

function parseTitle(raw: unknown, problems: Problem[]): string | null {
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw;
  }
  problems.push(sceneProblem('title must be a non-empty string'));
  return null;
}

function parseDefaults(raw: unknown, problems: Problem[]): SceneDefaults {
  if (raw === undefined) {
    return DEFAULT_STYLE;
  }
  if (!isRecord(raw)) {
    problems.push(sceneProblem('defaults must be a JSON object'));
    return DEFAULT_STYLE;
  }
  rejectUnknownKeys(raw, DEFAULTS_KEYS, (key) =>
    problems.push(sceneProblem(`defaults: unknown key "${key}"`)),
  );
  const roughness = parseRoughness(raw.roughness, DEFAULT_STYLE.roughness, problems);
  const stroke = parseStroke(raw.stroke, DEFAULT_STYLE.stroke, problems);
  const fill = parseFill(raw.fill, DEFAULT_STYLE.fill, problems);
  const tone = parseTone(raw.tone, DEFAULT_STYLE.tone, problems);
  const corners = parseCorners(raw.corners, DEFAULT_STYLE.corners, problems);
  return { roughness, stroke, fill, tone, corners };
}

function parseElements(
  raw: unknown,
  defaults: SceneDefaults,
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

function parseElement(
  id: string,
  raw: Record<string, unknown>,
  defaults: SceneDefaults,
  problems: Problem[],
): Element | null {
  const before = problems.length;
  const report = (message: string) => problems.push({ elementId: id, message });

  rejectUnknownKeys(raw, ELEMENT_KEYS, report);

  if (raw.type !== 'rectangle') {
    report(`type must be one of ${list(ELEMENT_TYPES)}, got ${describe(raw.type)}`);
  }

  const geometry = {
    x: parseNumber(raw.x, 'x', report),
    y: parseNumber(raw.y, 'y', report),
    width: parseNumber(raw.width, 'width', report),
    height: parseNumber(raw.height, 'height', report),
  };
  for (const side of ['width', 'height'] as const) {
    if (raw[side] !== undefined && geometry[side] !== null) {
      if (geometry[side] < 1) {
        report(`${side} must be at least 1 pixel, got ${geometry[side]}`);
      }
    }
  }

  const seed =
    raw.seed === undefined ? seedForId(id) : parseIntInRange(raw.seed, 'seed', 1, MAX_SEED, report);

  const element = {
    id,
    type: 'rectangle' as const,
    x: geometry.x ?? 0,
    y: geometry.y ?? 0,
    width: geometry.width ?? 0,
    height: geometry.height ?? 0,
    roughness: parseRoughness(raw.roughness, defaults.roughness, problems, id),
    seed: seed ?? seedForId(id),
    stroke: parseStroke(raw.stroke, defaults.stroke, problems, id),
    fill: parseFill(raw.fill, defaults.fill, problems, id),
    tone: parseTone(raw.tone, defaults.tone, problems, id),
    corners: parseCorners(raw.corners, defaults.corners, problems, id),
  };

  return problems.length === before ? element : null;
}

function parseRoughness(
  raw: unknown,
  fallback: number,
  problems: Problem[],
  elementId: string | null = null,
): number {
  if (raw === undefined) {
    return fallback;
  }
  const report = (message: string) => problems.push({ elementId, message });
  const value = parseNumber(raw, 'roughness', report);
  if (value === null) {
    return fallback;
  }
  if (value < ROUGHNESS_RANGE[0]! || value > ROUGHNESS_RANGE[1]!) {
    report(`roughness must be between ${ROUGHNESS_RANGE[0]} and ${ROUGHNESS_RANGE[1]}`);
    return fallback;
  }
  return value;
}

function parseStroke(
  raw: unknown,
  fallback: Stroke,
  problems: Problem[],
  elementId: string | null = null,
): Stroke {
  if (raw === undefined) {
    return fallback;
  }
  const report = (message: string) => problems.push({ elementId, message });
  if (!isRecord(raw)) {
    report('stroke must be a JSON object');
    return fallback;
  }
  rejectUnknownKeys(raw, STROKE_KEYS, report);
  const width =
    raw.width === undefined ? fallback.width : parseNumber(raw.width, 'stroke.width', report);
  if (width !== null && width <= 0) {
    report(`stroke.width must be greater than 0, got ${width}`);
  }
  const style = raw.style === undefined ? fallback.style : raw.style;
  if (!isOneOf(STROKE_STYLES, style)) {
    report(`stroke.style must be one of ${list(STROKE_STYLES)}, got ${describe(style)}`);
  }
  return {
    width: width !== null && width > 0 ? width : fallback.width,
    style: isOneOf(STROKE_STYLES, style) ? style : fallback.style,
  };
}

function parseFill(
  raw: unknown,
  fallback: Fill,
  problems: Problem[],
  elementId: string | null = null,
): Fill {
  if (raw === undefined) {
    return fallback;
  }
  const report = (message: string) => problems.push({ elementId, message });
  if (!isRecord(raw)) {
    report('fill must be a JSON object');
    return fallback;
  }
  rejectUnknownKeys(raw, FILL_KEYS, report);
  const kind = raw.kind === undefined ? fallback.kind : raw.kind;
  if (!isOneOf(FILL_KINDS, kind)) {
    report(`fill.kind must be one of ${list(FILL_KINDS)}, got ${describe(kind)}`);
  }
  const grey =
    raw.grey === undefined
      ? fallback.grey
      : parseIntInRange(raw.grey, 'fill.grey', GREY_MIN, GREY_MAX, report);
  return {
    kind: isOneOf(FILL_KINDS, kind) ? kind : fallback.kind,
    grey: grey ?? fallback.grey,
  };
}

function parseTone(
  raw: unknown,
  fallback: Tone,
  problems: Problem[],
  elementId: string | null = null,
): Tone {
  if (raw === undefined) {
    return fallback;
  }
  if (!isOneOf(TONES, raw)) {
    problems.push({
      elementId,
      message: `tone must be one of ${list(TONES)}, got ${describe(raw)}`,
    });
    return fallback;
  }
  return raw;
}

function parseCorners(
  raw: unknown,
  fallback: Corners,
  problems: Problem[],
  elementId: string | null = null,
): Corners {
  if (raw === undefined) {
    return fallback;
  }
  if (!isOneOf(CORNERS, raw)) {
    problems.push({
      elementId,
      message: `corners must be one of ${list(CORNERS)}, got ${describe(raw)}`,
    });
    return fallback;
  }
  return raw;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A misspelled key is a problem worth reporting: it would otherwise be ignored in silence. */
function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  report: (message: string) => void,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      report(`unknown key "${key}"`);
    }
  }
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function list(allowed: readonly string[]): string {
  return allowed.join(', ');
}

function describe(value: unknown): string {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}

function sceneProblem(message: string): Problem {
  return { elementId: null, message };
}

function fail(problems: Problem[]): ParseResult {
  return { ok: false, problems };
}
