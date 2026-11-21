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
 *       "corners": "sharp",                         // sharp | round: rectangles and diamonds
 *       "fontSize": "M",                            // S | M | L | XL
 *       "label": "Orders and invoices"              // optional: wraps inside the box
 *     },
 *     {
 *       "id": "b",
 *       "type": "arrow",                            // or line
 *       "points": [                                 // exactly two ends
 *         { "x": 40, "y": 40 },
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
 * unless the Scene asks: `fill` defaults to none. Fill and corners apply to
 * closed outlines: an arrow or line is a stroke, so it has no fill and no
 * corners. `corners` rounds the vertices of a rectangle or a diamond; an
 * ellipse has no corners, so it ignores the field.
 *
 * A Label is words that belong to an Element and wrap inside it: a rectangle,
 * ellipse, diamond, arrow or line carries one optional Label, and a Text is
 * only words, so it has `content` and no Label. Where a Label sits and whether
 * it fits is Layout's question: the Scene keeps the words, and the drawing and
 * `ez check` measure them with the same font. An arrow or line may also write
 * `labelAt`: `t` is how far along the drawn shaft its Label sits, and `offset`
 * is a signed distance to one side, so a shaft's words need not stay where
 * Layout puts them. Only a shaft has one, and the Renderer draws paper behind
 * every shaft Label, so a Label over its own shaft stays legible.
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
type Corners = (typeof CORNERS)[number];

export const FONT_SIZES = ['S', 'M', 'L', 'XL'] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const HEADS = ['none', 'arrow', 'dot', 'bar'] as const;
export type Head = (typeof HEADS)[number];

/**
 * Roughness is a whole number, with three named looks: 0 architect, 1 artist
 * and 2 cartoonist. The number keeps the Scene short and lets the editor step
 * through the looks; the names live in the docs and the Style menu.
 */
export const ROUGHNESS_MIN = 0;
export const ROUGHNESS_MAX = 2;

const ELEMENT_TYPES = ['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'text'] as const;

/** The Element types with an outline a Snap can land on. */
const OUTLINED_TYPES = ['rectangle', 'ellipse', 'diamond'] as const;

/** Whether an Element has an outline: only those can be Snap targets. */
export function isOutlined(element: Element): element is OutlinedElement {
  return (OUTLINED_TYPES as readonly string[]).includes(element.type);
}

/** The seven-grey ladder runs from paper (0) to ink (6). */
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
 * One end of an arrow or line. `snap` is the id of the Element outline it is drawn on.
 */
export interface Point {
  x: number;
  y: number;
  snap?: string;
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
  /** Rounds a rectangle's or a diamond's vertices; an ellipse has none to round. */
  corners: Corners;
  /** Font size of a Text or a Label. */
  fontSize: FontSize;
  /** Alignment of a Text's or a Label's lines. */
  textAlign: TextAlign;
}

interface ElementBase extends ElementStyle {
  id: string;
  seed: number;
}

/** An Element that can carry words inside it: everything but a Text. */
interface LabelledBase extends ElementBase {
  /** Words that belong to this Element. Wrapping and fit are Layout's job. */
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
  points: [Point, Point];
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
const POINT_KEYS = ['x', 'y', 'snap'] as const;
const HEADS_KEYS = ['start', 'end'] as const;
const LABEL_AT_KEYS = ['t', 'offset'] as const;

/**
 * `labelAt.t` keeps four decimals: fine enough that a Label slides along even a
 * long shaft, short enough that the saved file stays readable.
 */
const LABEL_AT_T_DECIMALS = 4;

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

/** One Element as it is drawn: whole pixels, so no two roundings draw it twice. */
export function canonicalElement(element: Element): Element {
  if (element.type === 'arrow' || element.type === 'line') {
    const [start, end] = element.points;
    return {
      ...element,
      points: [wholePoint(start), wholePoint(end)],
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

/**
 * A Label's place on its shaft, rounded where it is written: the fraction to
 * `LABEL_AT_T_DECIMALS`, the distance to whole pixels like the geometry around
 * it, so a position the editor assigns saves and reopens as itself.
 */
function canonicalLabelAt(labelAt: LabelAt): LabelAt {
  const scale = 10 ** LABEL_AT_T_DECIMALS;
  const rounded = Math.round(labelAt.t * scale) / scale;
  return { t: rounded === 0 ? 0 : rounded, offset: wholePixels(labelAt.offset) };
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

/**
 * An empty Scene at the current schema version: what a new or missing Scene
 * file opens as. The title goes through the same check a file's title does, and
 * the style is a fresh copy of the defaults, so a new Scene and a reopened one
 * agree without a JSON round trip.
 */
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

/**
 * The same parse, on a value that is already JSON: the one validation a Scene
 * and a clipboard fragment share, so neither has to write JSON to be read.
 */
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

/**
 * A Scene file, out of the JSON of each Element it holds, in the Scene's order:
 * the head is written here, and each Element's own block is written once by
 * `serialiseElementJson`, so a page that already holds those blocks assembles
 * the very file this serialiser writes — not a second one that reads the same.
 */
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

/** One Element's block in a Scene file: its own JSON, indented into the array. */
export function serialiseElementJson(element: Element): string {
  return indented(JSON.stringify(serialiseElement(element), null, 2), 4);
}

/** The JSON of a value with every line moved right: a block on a line of its own. */
function indented(json: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return json
    .split('\n')
    .map((line) => `${pad}${line}`)
    .join('\n');
}

/** The JSON of a value with every line but the first moved right: it follows `"key": `. */
function following(json: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return json
    .split('\n')
    .map((line, index) => (index === 0 ? line : `${pad}${line}`))
    .join('\n');
}

/** A Scene as the plain object a fragment is written from. */
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
    // An omitted version is the current one; a version that is there is left
    // for Scene validation to judge, so `null` is refused like any other.
    ...('version' in raw ? { version: raw['version'] } : { version: SCENE_VERSION }),
    defaults,
    elements: localised(elements),
  });
  return parsed.ok ? parsed.scene.elements : null;
}

/** A Snap only means something inside the fragment it travels with. */
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

/** A point whose Snap names an Element the fragment does not carry loses the Snap. */
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
    // An unwritten alignment stays unwritten, so a Scene saved from `emptyScene`
    // reopens as one whose Labels centre and whose Text stays left.
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
  // Every id the Scene lists, including the Elements that failed to parse, so a
  // Snap to one of those is not a Snap to nothing.
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
  // An Element that failed to parse is still one the author declared, so a Snap
  // to it is not a Snap to nothing: its own problem is the one to report.
  validateSnapTargets(elements, seen, problems);
  return elements;
}

/**
 * A Snap end is drawn on its target's outline, so the target must exist and
 * must be a rectangle, ellipse or diamond. The problem names the arrow or line,
 * not the target: the Scene's own Element is what the author has to fix.
 *
 * `seen` holds every id the Scene lists, including the Elements that failed to
 * parse. A Snap to one of those is not a Snap to a missing Element: the target
 * has its own problem, and calling it missing would send the author looking for
 * the wrong thing.
 */
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
    const [start, end] = element.points;
    if (start.snap !== undefined && start.snap === end.snap) {
      // Both ends on one outline have no line between two targets to aim
      // along, so the arrow or line cannot say which way it points.
      problems.push({
        elementId: element.id,
        message: `both ends Snap to ${start.snap}`,
      });
      continue;
    }
    for (const point of element.points) {
      if (point.snap === undefined) {
        continue;
      }
      const target = byId.get(point.snap);
      if (target === undefined) {
        if (!seen.has(point.snap)) {
          problems.push({
            elementId: element.id,
            message: `snap target "${point.snap}" does not exist`,
          });
        }
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
  rejectUnknownKeys(raw, elementKeys(type), (unknownKey) =>
    report(unknownKeyMessage(type, unknownKey)),
  );

  // An alignment neither the Element nor the Scene writes is resolved per type
  // here, so every Element carries the value its words are placed by.
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

/**
 * A key an Element may not carry. `labelAt` is not a misspelling elsewhere: it
 * is a shaft's key, and only an arrow or line has a shaft, so the problem says
 * that instead of calling the key unknown.
 */
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

/**
 * A Label is words on an Element: an absent Label is `undefined`, and a Label
 * that is not words is a problem. Newlines are line breaks the author asked
 * for; everything else wraps to fit.
 */
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

/**
 * Where a shaft's Label sits: a fraction along the drawn shaft, and a signed
 * distance to one side. Both are numbers the drawing uses, so both are checked
 * here and rounded by `canonicalLabelAt`.
 */
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
  // Both fields are rounded by `canonicalLabelAt`, the one owner of a Label's place.
  const offset = parseNumber(raw.offset, 'labelAt.offset', report);
  return t === null || offset === null ? undefined : canonicalLabelAt({ t, offset });
}

/** A fraction of a shaft: a finite number from 0 to 1, 0 at its start and 1 at its end. */
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

/**
 * An alignment the Scene does not write stays unset here, so each Element can
 * resolve its own; `parseElement` turns it into the value a Label or a Text draws with.
 */
function parseTextAlign(
  raw: unknown,
  fallback: TextAlign | undefined,
  report: (message: string) => void,
): TextAlign | undefined {
  if (raw === undefined) {
    return fallback;
  }
  // The fallback only reads when the value is wrong, and then the Scene fails to
  // parse, so which of the two defaults stands in makes no difference.
  return parseChoice(raw, 'textAlign', TEXT_ALIGNS, fallback ?? UNWRITTEN_TEXT_ALIGN.label, report);
}

/** What an unwritten alignment means for this Element: a Label centres, a Text stays left. */
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
 * the SVG unparseable. Only the title, a Text's content and a Label enter the
 * SVG, so only they are checked: an Element id is a name, never ink.
 *
 * The editor asks the same question of words before it draws them: what the
 * Scene cannot hold must not reach the page's own SVG either.
 */
export function hasXmlInvalidChars(text: string): boolean {
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
