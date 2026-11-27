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
 *     "fill": { "kind": "none", "grey": 2 },
 *     "tone": "ink",
 *     "corners": "sharp",
 *     "fontSize": "M"
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
 *       "corners": "sharp",                         // sharp | round: outlines and bend points
 *       "fontSize": "M",                            // S | M | L | XL
 *       "label": "Orders and invoices"              // optional: wraps inside the box
 *     },
 *     {
 *       "id": "b",
 *       "type": "arrow",                            // or line
 *       "points": [                                 // two or more points
 *         { "x": 40, "y": 40 },
 *         { "x": 120, "y": 60, "corner": "round" },  // a bend point: sharp | round
 *         { "x": 200, "y": 140, "snap": "a" }        // Snap target: an Element id
 *       ],
 *       "heads": { "start": "none", "end": "arrow" }, // none | arrow | dot | bar
 *       "label": "then",                           // optional: sits on the shaft
 *       "labelAt": { "t": 0.5, "offset": 12 }       // optional: where on the shaft
 *     },
 *     {
 *       "id": "c",
 *       "type": "text",
 *       "x": 40, "y": 200,
 *       "content": "Free-standing Text",            // newlines are line breaks
 *       "fontSize": "L",
 *       "textAlign": "left"                         // left | center | right
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
 * Roughness, stroke, fill, tone and corners draw. Text and Labels draw with
 * tone, font size and text alignment. A `textAlign` written on the Element, or
 * in the Scene `defaults`, is the alignment of both; when neither writes one, a
 * Label centres in the Element it belongs to and a Text keeps the left edge its
 * `x` places, which is the edge an author aligns words to. Nothing is filled
 * unless the Scene asks: `fill` defaults to none. Fill applies to closed
 * outlines: an arrow or line is a stroke, so it has no fill. `corners` rounds
 * the vertices of a rectangle or a diamond, and it is the corner a middle point
 * of an arrow or line bends by unless that point writes its own `corner`; an
 * ellipse has no corners, so it ignores the field.
 *
 * An arrow or line draws through two or more points: the first and the last are
 * its ends, and every point between them is a bend point. Only an end may carry
 * a `snap`, and only a bend point may carry a `corner`, so a Scene that writes
 * one where it does not belong is refused rather than quietly ignored. Two
 * ends may Snap to one Element once the shaft has a bend point to reach its
 * outline by; a shaft of two points cannot, because it has no second direction
 * to aim along.
 *
 * A Label is words that belong to an Element and wrap inside it: a rectangle,
 * ellipse, diamond, arrow or line carries one optional Label, and a Text is
 * only words, so it has `content` and no Label. Where a Label sits and whether
 * it fits is Layout's question: the Scene keeps the words, and the drawing and
 * `ez check` measure them with the same font. An arrow or line may also write
 * `labelAt`: `t` is how far along the drawn shaft its Label sits, and `offset`
 * is a signed distance to one side, so a shaft's words need not stay where
 * Layout puts them. Only a shaft has one; where a shaft Label sits over its own
 * shaft, the Renderer cuts that shaft open so the words stay legible.
 *
 * Geometry is rounded to whole pixels in one place, `canonicalScene`: parsing,
 * serialising, hashing and drawing all go through it, so a Scene mutated in
 * memory (the editor assigns `x = 40.2`) saves, hashes and draws as the Scene
 * that reopens. Characters XML cannot represent are rejected here, because the
 * title and the Text content end up in the SVG.
 *
 * The values and ranges below are the schema's, and they are exported: the
 * Style menu offers exactly what a Scene may hold and keeps only the words a
 * person reads, so a control can never save a value the file would reject.
 */
import { anchorPoint, writtenFraction } from './geometry.js';
import { sha256, sha256Hex } from './sha256.js';

const SCENE_VERSION = 1;

export const STROKE_WIDTHS = ['thin', 'bold', 'extra'] as const;
export type StrokeWidth = (typeof STROKE_WIDTHS)[number];

export const STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const;
type StrokeStyle = (typeof STROKE_STYLES)[number];

/** `none` draws no fill. `hachure` and `cross-hatch` are hand-drawn lines (Rough.js), `solid` is a flat wash. */
export const FILL_KINDS = ['none', 'solid', 'hachure', 'cross-hatch'] as const;
type FillKind = (typeof FILL_KINDS)[number];

/** Colours are never spelled out: they come from the host's CSS variables. */
export const TONES = ['ink', 'muted'] as const;
type Tone = (typeof TONES)[number];

export const CORNERS = ['sharp', 'round'] as const;
export type Corner = (typeof CORNERS)[number];

export const FONT_SIZES = ['S', 'M', 'L', 'XL'] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const HEADS = ['none', 'arrow', 'dot', 'bar'] as const;
export type Head = (typeof HEADS)[number];

export const ROUGHNESS_MIN = 0;
export const ROUGHNESS_MAX = 2;

const ELEMENT_TYPES = ['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'text'] as const;

const OUTLINED_TYPES = ['rectangle', 'ellipse', 'diamond'] as const;

export function isOutlined(element: Element): element is OutlinedElement {
  return (OUTLINED_TYPES as readonly string[]).includes(element.type);
}

export const GREY_MIN = 0;
export const GREY_MAX = 6;

interface Stroke {
  width: StrokeWidth;
  style: StrokeStyle;
}

interface Fill {
  kind: FillKind;
  /** Grey step on the seven-grey ladder: 0 is paper, 6 is ink. */
  grey: number;
}

/** The arrow head drawn at each end. Defaults: start none, end arrow for an arrow, both none for a line. */
interface Heads {
  start: Head;
  end: Head;
}

/**
 * One point an arrow or line draws through. `snap` is the id of the Element
 * outline an end is drawn on, or `false` for a free end the editor will not
 * attach again; a middle point bends by its own `corner`, or by the Element's.
 */
export interface Point {
  x: number;
  y: number;
  snap?: string | false;
  /**
   * Where on the target's box a Snapped end sits: fractions of the box from its
   * top-left, `0` to `1`, drawn at the nearest point of the target's outline.
   * Only an end that Snaps to an Element carries one.
   */
  anchor?: Anchor;
  /**
   * How the shaft turns at this point: a smooth `round` bend or a `sharp` one.
   * Only a middle point carries one; the ends have nothing to turn.
   */
  corner?: Corner;
}

/** A Snapped end's place on its target's outline, as fractions of the target's box. */
export interface Anchor {
  /** Fraction across the box: `0` is its left edge, `1` its right. */
  x: number;
  /** Fraction down the box: `0` is its top edge, `1` its bottom. */
  y: number;
}

/**
 * The Element a point Snaps to, or null where the end is free: a point with no
 * `snap`, and one written `"snap": false`.
 */
export function snapTargetId(point: Point): string | null {
  return typeof point.snap === 'string' ? point.snap : null;
}

/**
 * Where a shaft's Label sits instead of the place Layout gives it: a fraction
 * along the drawn shaft, and a signed distance to one side.
 */
interface LabelAt {
  /** Fraction along the shaft: 0 at the start, 1 at the end. Four decimals are kept. */
  t: number;
  /**
   * Signed perpendicular distance in pixels, rounded to whole pixels: 0 sits on
   * the shaft, and a positive value is the side the default Label takes, which
   * is the side that points up (the left of a vertical shaft).
   */
  offset: number;
}

export interface ElementStyle {
  roughness: number;
  stroke: Stroke;
  fill: Fill;
  tone: Tone;
  /**
   * Rounds a rectangle's or a diamond's vertices, and is the corner an arrow's
   * or line's bend point turns by unless the point writes its own; an ellipse
   * has none to round.
   */
  corners: Corner;
  /** Font size of a Text or a Label. */
  fontSize: FontSize;
  /** Alignment of a Text's or a Label's lines. */
  textAlign: TextAlign;
}

interface ElementBase extends ElementStyle {
  id: string;
  seed: number;
}

interface LabelledBase extends ElementBase {
  label?: string;
}

export interface RectangleElement extends LabelledBase {
  type: 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EllipseElement extends LabelledBase {
  type: 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DiamondElement extends LabelledBase {
  type: 'diamond';
  x: number;
  y: number;
  width: number;
  height: number;
}

export type OutlinedElement = RectangleElement | EllipseElement | DiamondElement;

interface ArrowOrLineBase extends LabelledBase {
  /** The two ends, and any bend points between them, in drawing order. */
  points: [Point, Point, ...Point[]];
  heads: Heads;
  /** Where the Label sits on the drawn shaft; a shaft without it lets Layout place its words. */
  labelAt?: LabelAt;
}

interface ArrowElement extends ArrowOrLineBase {
  type: 'arrow';
}

interface LineElement extends ArrowOrLineBase {
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

/**
 * Scene-wide style; every field of it has a default. `textAlign` is the one
 * field a Scene may leave unset, because what it falls back to depends on the
 * Element (see `UNWRITTEN_TEXT_ALIGN`).
 */
export type SceneStyle = Omit<ElementStyle, 'textAlign'> & { textAlign?: TextAlign };

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
  fill: { kind: 'none', grey: 2 },
  tone: 'ink',
  corners: 'sharp',
  fontSize: 'M',
};

/**
 * What an unwritten alignment means: a Label centres in the Element it belongs
 * to, and a Text keeps the left edge its `x` places, because `x` is the edge the
 * author aligned the words to. Only an explicit `textAlign`, on the Element or
 * in the Scene `defaults`, overrides that.
 */
const UNWRITTEN_TEXT_ALIGN: Readonly<Record<'label' | 'text', TextAlign>> = {
  label: 'center',
  text: 'left',
};

/**
 * Every Element of a Scene by its id: the one index the Renderer and the Editor
 * both read, so a Snap, a pick and a handle all resolve an id to the same
 * Element. A Scene keeps its ids unique, so no Element is lost to a later one.
 */
export function elementsById(elements: readonly Element[]): Map<string, Element> {
  return new Map(elements.map((element) => [element.id, element]));
}

const DEFAULT_TITLE = 'Scene';

/** The smallest width or height an Element can have: one pixel of ink. */
export const MIN_SIZE = 1;

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
const OUTLINED_ELEMENT_KEYS = [
  'id',
  'type',
  'x',
  'y',
  'width',
  'height',
  'label',
  ...ELEMENT_STYLE_KEYS,
] as const;
const ARROW_OR_LINE_ELEMENT_KEYS = [
  'id',
  'type',
  'points',
  'heads',
  'label',
  'labelAt',
  ...ELEMENT_STYLE_KEYS,
] as const;
const TEXT_ELEMENT_KEYS = ['id', 'type', 'x', 'y', 'content', ...ELEMENT_STYLE_KEYS] as const;
const ALL_ELEMENT_KEYS = [
  ...new Set([...OUTLINED_ELEMENT_KEYS, ...ARROW_OR_LINE_ELEMENT_KEYS, ...TEXT_ELEMENT_KEYS]),
];
const STROKE_KEYS = ['width', 'style'] as const;
const FILL_KEYS = ['kind', 'grey'] as const;
const POINT_KEYS = ['x', 'y', 'snap', 'anchor', 'corner'] as const;
const ANCHOR_KEYS = ['x', 'y'] as const;
const HEADS_KEYS = ['start', 'end'] as const;
const LABEL_AT_KEYS = ['t', 'offset'] as const;

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

export function canonicalElement(element: ArrowOrLineElement): ArrowOrLineElement;
export function canonicalElement(element: Element): Element;
export function canonicalElement(element: Element): Element {
  if (element.type === 'arrow' || element.type === 'line') {
    return {
      ...element,
      points: wholePoints(element.points),
      ...(element.labelAt === undefined ? {} : { labelAt: canonicalLabelAt(element.labelAt) }),
    };
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

function wholePoints(points: [Point, Point, ...Point[]]): [Point, Point, ...Point[]] {
  const [start, second, ...bends] = points;
  return [wholePoint(start), wholePoint(second), ...bends.map(wholePoint)];
}

function canonicalLabelAt(labelAt: LabelAt): LabelAt {
  return { t: writtenFraction(labelAt.t), offset: wholePixels(labelAt.offset) };
}

/**
 * Deterministic default seed for an Element that carries none: the same id
 * always draws the same way, and it is never 0 (Rough.js reads 0 as "pick one
 * at random"). Exported so the editor seeds what it draws the same way.
 */
export function seedForId(id: string): number {
  const digest = sha256(new TextEncoder().encode(id));
  const first = ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
  return (first % (MAX_SEED - 1)) + 1;
}

export function emptyScene(title: string = DEFAULT_TITLE): Scene {
  const problems: Problem[] = [];
  const parsedTitle = parseTitle(title, problems);
  if (parsedTitle === null) {
    throw new Error(`cannot build an empty Scene: ${problems[0]?.message ?? 'invalid title'}`);
  }
  return { version: SCENE_VERSION, title: parsedTitle, defaults: serialiseStyle(DEFAULT_STYLE), elements: [] };
}

export function parseScene(source: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return { ok: false, problems: [sceneProblem(`not valid JSON: ${(error as Error).message}`)] };
  }
  return parseSceneObject(raw);
}

function parseSceneObject(raw: unknown): ParseResult {
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
  return sceneJson(canonical, canonical.elements.map(serialiseElementJson));
}

export function sceneJson(scene: Scene, elements: readonly string[]): string {
  return [
    '{',
    `  "version": ${JSON.stringify(scene.version)},`,
    `  "title": ${JSON.stringify(scene.title)},`,
    `  "defaults": ${following(JSON.stringify(serialiseStyle(scene.defaults), null, 2), 2)},`,
    `  "elements": ${elements.length === 0 ? '[]' : `[\n${elements.join(',\n')}\n  ]`}`,
    '}',
    '',
  ].join('\n');
}

export function serialiseElementJson(element: Element): string {
  return indented(JSON.stringify(serialiseElement(element), null, 2), 4);
}

function indented(json: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return json
    .split('\n')
    .map((line) => `${pad}${line}`)
    .join('\n');
}

function following(json: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return json
    .split('\n')
    .map((line, index) => (index === 0 ? line : `${pad}${line}`))
    .join('\n');
}

function sceneObject(scene: Scene): {
  version: number;
  title: string;
  defaults: SceneStyle;
  elements: object[];
} {
  const canonical = canonicalScene(scene);
  return {
    version: canonical.version,
    title: canonical.title,
    defaults: serialiseStyle(canonical.defaults),
    elements: canonical.elements.map(serialiseElement),
  };
}

/** The Scene hash written into the SVG: sha256 of the serialised Scene. */
export function hashScene(scene: Scene): string {
  return sha256Hex(serialiseScene(scene));
}

/**
 * The given Elements as a Scene fragment: the schema version and the Elements,
 * nothing else, so a copy can be read as Scene JSON and pasted into a file by
 * hand. A Snap to an Element the fragment does not carry is dropped, because a
 * fragment has to parse on its own: a copy of one Snapped arrow is a
 * free-standing arrow, not a broken Scene.
 */
export function serialiseFragment(scene: Scene, elements: readonly Element[]): string {
  const written = sceneObject({ ...scene, elements: [...elements] });
  return JSON.stringify({ version: written.version, elements: localised(written.elements) }, null, 2);
}

/**
 * The Elements a fragment carries, or null when the source is not a fragment.
 *
 * A fragment is `{ "version": 1, "elements": [...] }`: the version is checked by
 * the same parser a Scene file goes through, so a fragment written by another
 * schema is refused rather than silently repaired, and a fragment with no
 * version is the current one. A bare array is not a fragment. The Elements are
 * resolved against `defaults`, the Scene being pasted into, so a fragment that
 * carries no style still lands styled.
 */
export function parseFragment(source: string, defaults: SceneStyle): Element[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return null;
  }
  if (!isRecord(raw)) {
    return null;
  }
  const elements = raw['elements'];
  if (!Array.isArray(elements)) {
    return null;
  }
  const parsed = parseSceneObject({
    ...('version' in raw ? { version: raw['version'] } : { version: SCENE_VERSION }),
    defaults,
    elements: localised(elements),
  });
  return parsed.ok ? parsed.scene.elements : null;
}

function localised(elements: readonly unknown[]): unknown[] {
  const ids = new Set(
    elements
      .map((element) => (isRecord(element) ? element['id'] : undefined))
      .filter((id) => typeof id === 'string'),
  );
  return elements.map((element) => {
    if (!isRecord(element)) {
      return element;
    }
    const points = element['points'];
    if (!Array.isArray(points)) {
      return element;
    }
    return { ...element, points: points.map((point) => freeUnlessLocal(point, ids)) };
  });
}

function freeUnlessLocal(point: unknown, ids: ReadonlySet<unknown>): unknown {
  if (!isRecord(point)) {
    return point;
  }
  const snap = point['snap'];
  if (typeof snap !== 'string' || ids.has(snap)) {
    return point;
  }
  const free = { ...point };
  delete free['snap'];
  delete free['anchor'];
  return free;
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
        ...(point.anchor === undefined ? {} : { anchor: point.anchor }),
        ...(point.corner === undefined ? {} : { corner: point.corner }),
      })),
      heads: { start: element.heads.start, end: element.heads.end },
      ...(element.label === undefined ? {} : { label: element.label }),
      ...(element.labelAt === undefined ? {} : { labelAt: element.labelAt }),
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
    ...(element.label === undefined ? {} : { label: element.label }),
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
    ...(style.textAlign === undefined ? {} : { textAlign: style.textAlign }),
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
  validateSnapTargets(elements, seen, problems);
  return elements;
}

function validateSnapTargets(
  elements: Element[],
  seen: ReadonlySet<string>,
  problems: Problem[],
): void {
  const byId = new Map(elements.map((element) => [element.id, element]));
  for (const element of elements) {
    if (element.type !== 'arrow' && element.type !== 'line') {
      continue;
    }
    const points = element.points;
    const start = points[0];
    const end = points[points.length - 1]!;
    const startId = snapTargetId(start);
    const endId = snapTargetId(end);
    if (points.length === 2 && startId !== null && startId === endId) {
      const refusal = bothEndsProblem(start, end, startId, byId.get(startId));
      if (refusal !== null) {
        problems.push({ elementId: element.id, message: refusal });
        continue;
      }
    }
    for (const point of points) {
      const target = snapTargetId(point);
      if (target === null) {
        continue;
      }
      const found = byId.get(target);
      if (found === undefined) {
        if (!seen.has(target)) {
          problems.push({
            elementId: element.id,
            message: `snap target "${target}" does not exist`,
          });
        }
      } else if (!isOutlined(found)) {
        problems.push({
          elementId: element.id,
          message: `snap target "${target}" must be a rectangle, ellipse or diamond`,
        });
      }
    }
  }
}

/**
 * Why two ends Snapped to one Element cannot both be drawn there, or null when
 * they can. Two ends on one outline need two places to be to have a direction to
 * draw the shaft along, so they need two Anchors, and two outline points those
 * Anchors name: a hair apart in the box may still be the same foot on the
 * outline, and two ends drawn on one point have no direction either.
 */
function bothEndsProblem(
  start: Point,
  end: Point,
  id: string,
  target: Element | undefined,
): string | null {
  const one = start.anchor;
  const other = end.anchor;
  if (one === undefined || other === undefined || (one.x === other.x && one.y === other.y)) {
    return `both ends Snap to ${id}`;
  }
  if (target === undefined || !isOutlined(target)) {
    // The target's own problem is reported where every Snap is checked.
    return null;
  }
  const first = anchorPoint(target, one);
  const second = anchorPoint(target, other);
  return Math.round(first.x) === Math.round(second.x) && Math.round(first.y) === Math.round(second.y)
    ? `both ends Snap to ${id} at the same outline point`
    : null;
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
  rejectUnknownKeys(raw, elementKeys(type), (unknownKey) =>
    report(unknownKeyMessage(type, unknownKey)),
  );

  const written = parseStyle(raw, defaults, report);
  const style: ElementStyle = { ...written, textAlign: written.textAlign ?? unwrittenTextAlign(type) };
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
    const label = parseLabel(raw.label, report);
    const labelAt = parseLabelAt(raw.labelAt, report);
    if (points !== null) {
      element = {
        id,
        type,
        points,
        heads,
        seed,
        ...style,
        ...(label === undefined ? {} : { label }),
        ...(labelAt === undefined ? {} : { labelAt }),
      };
    }
  } else if (type !== null) {
    const geometry = parseOutlinedGeometry(raw, report);
    const label = parseLabel(raw.label, report);
    if (geometry !== null) {
      element = {
        id,
        type,
        ...geometry,
        seed,
        ...style,
        ...(label === undefined ? {} : { label }),
      };
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

function unknownKeyMessage(type: Element['type'] | null, unknownKey: string): string {
  if (unknownKey === 'labelAt' && type !== 'arrow' && type !== 'line') {
    return 'labelAt applies only to an arrow or line';
  }
  return `unknown key "${unknownKey}"`;
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
      if (value < MIN_SIZE) {
        report(`${field} must be at least ${MIN_SIZE} pixel, got ${value}`);
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

function parseLabel(
  raw: unknown,
  report: (message: string) => void,
): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    report(`label must be a non-empty string, got ${describe(raw)}`);
    return undefined;
  }
  if (hasXmlInvalidChars(raw)) {
    report('label must not contain characters XML cannot represent');
    return undefined;
  }
  return raw;
}

function parseLabelAt(
  raw: unknown,
  report: (message: string) => void,
): LabelAt | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    report('labelAt must be a JSON object');
    return undefined;
  }
  rejectUnknownKeys(raw, LABEL_AT_KEYS, (unknownKey) =>
    report(`labelAt: unknown key "${unknownKey}"`),
  );
  const t = parseFraction(raw.t, 'labelAt.t', report);
  const offset = parseNumber(raw.offset, 'labelAt.offset', report);
  return t === null || offset === null ? undefined : canonicalLabelAt({ t, offset });
}

function parseFraction(
  raw: unknown,
  field: string,
  report: (message: string) => void,
): number | null {
  const value = parseNumber(raw, field, report);
  if (value === null) {
    return null;
  }
  if (value < 0 || value > 1) {
    report(`${field} must be between 0 and 1, got ${value}`);
    return null;
  }
  return value;
}

function parsePoints(
  raw: unknown,
  report: (message: string) => void,
): [Point, Point, ...Point[]] | null {
  if (!Array.isArray(raw) || raw.length < 2) {
    report('points must be an array of two or more points');
    return null;
  }
  const parsed = raw.map((point, index) =>
    parsePoint(point, index, index === 0 || index === raw.length - 1, report),
  );
  return parsed.some((point) => point === null) ? null : (parsed as [Point, Point, ...Point[]]);
}

function parsePoint(
  raw: unknown,
  index: number,
  end: boolean,
  report: (message: string) => void,
): Point | null {
  if (!isRecord(raw)) {
    report(`points[${index}] must be a JSON object`);
    return null;
  }
  rejectUnknownKeys(raw, POINT_KEYS, (unknownKey) => report(`unknown key "${unknownKey}"`));
  const x = parseWholePixels(raw.x, `points[${index}].x`, report);
  const y = parseWholePixels(raw.y, `points[${index}].y`, report);
  const snap = parseSnap(raw.snap, index, end, report);
  const anchor = parseAnchor(raw.anchor, index, end, snap, report);
  let corner: Corner | undefined;
  if (raw.corner !== undefined && end) {
    report(`points[${index}].corner applies only to a middle point`);
  } else if (raw.corner !== undefined) {
    if (!isOneOf(CORNERS, raw.corner)) {
      report(
        `points[${index}].corner must be one of ${CORNERS.join(', ')}, got ${describe(raw.corner)}`,
      );
    } else {
      corner = raw.corner;
    }
  }
  return x === null || y === null || snap === null || anchor === null
    ? null
    : {
        x,
        y,
        ...(snap === undefined ? {} : { snap }),
        ...(anchor === undefined ? {} : { anchor }),
        ...(corner === undefined ? {} : { corner }),
      };
}

/**
 * An end's Snap: the id of the Element it is drawn on, or `false` for a free
 * end the editor will not attach again. Null is a point the Scene cannot hold.
 */
function parseSnap(
  raw: unknown,
  index: number,
  end: boolean,
  report: (message: string) => void,
): string | false | undefined | null {
  if (raw === undefined) {
    return undefined;
  }
  if (!end) {
    report(`points[${index}].snap applies only to the first or last point`);
    return null;
  }
  if (raw === false) {
    return false;
  }
  if (typeof raw !== 'string' || raw === '') {
    report(`points[${index}].snap must be an Element id or false, got ${describe(raw)}`);
    return null;
  }
  return raw;
}

/**
 * Where a Snapped end sits on its target's outline, as fractions of its box. An
 * Anchor needs a Snap target to be a fraction of, so a free end, a `false` one
 * and a bend point have none.
 */
function parseAnchor(
  raw: unknown,
  index: number,
  end: boolean,
  snap: string | false | undefined | null,
  report: (message: string) => void,
): Anchor | undefined | null {
  if (raw === undefined) {
    return undefined;
  }
  if (!end) {
    report(`points[${index}].anchor applies only to the first or last point`);
    return null;
  }
  if (typeof snap !== 'string') {
    report(`points[${index}].anchor applies only to an end that Snaps to an Element`);
    return null;
  }
  if (!isRecord(raw)) {
    report(`points[${index}].anchor must be a JSON object`);
    return null;
  }
  rejectUnknownKeys(raw, ANCHOR_KEYS, (unknownKey) =>
    report(`points[${index}].anchor: unknown key "${unknownKey}"`),
  );
  const x = parseFraction(raw.x, `points[${index}].anchor.x`, report);
  const y = parseFraction(raw.y, `points[${index}].anchor.y`, report);
  return x === null || y === null ? null : { x, y };
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
  const textAlign = parseTextAlign(raw.textAlign, fallback.textAlign, report);
  return {
    roughness: parseRoughness(raw.roughness, fallback.roughness, report),
    stroke: parseStroke(raw.stroke, fallback.stroke, report),
    fill: parseFill(raw.fill, fallback.fill, report),
    tone: parseChoice(raw.tone, 'tone', TONES, fallback.tone, report),
    corners: parseChoice(raw.corners, 'corners', CORNERS, fallback.corners, report),
    fontSize: parseChoice(raw.fontSize, 'fontSize', FONT_SIZES, fallback.fontSize, report),
    ...(textAlign === undefined ? {} : { textAlign }),
  };
}

function parseTextAlign(
  raw: unknown,
  fallback: TextAlign | undefined,
  report: (message: string) => void,
): TextAlign | undefined {
  if (raw === undefined) {
    return fallback;
  }
  return parseChoice(raw, 'textAlign', TEXT_ALIGNS, fallback ?? UNWRITTEN_TEXT_ALIGN.label, report);
}

/**
 * The alignment an Element's words take when neither it nor the Scene writes
 * one: what a scene file and the editor both resolve by, so a drawn Element is
 * the Element that would reopen.
 */
export function unwrittenTextAlign(type: Element['type'] | null): TextAlign {
  return type === 'text' ? UNWRITTEN_TEXT_ALIGN.text : UNWRITTEN_TEXT_ALIGN.label;
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
 * the SVG unparseable. Only the title, a Text's content and a Label enter the
 * SVG, so only they are checked: an Element id is a name, never ink.
 *
 * The editor asks the same question of words before it draws them: what the
 * Scene cannot hold must not reach the page's own SVG either.
 */
export function hasXmlInvalidChars(text: string): boolean {
  for (let at = 0; at < text.length; at += 1) {
    const code = text.codePointAt(at)!;
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
    // A character above U+FFFF is two code units, and both are read here at once.
    if (code >= 0x10000) {
      at += 1;
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
