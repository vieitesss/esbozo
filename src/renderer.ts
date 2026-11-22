/**
 * Renderer: a Scene in, an SVG string out.
 *
 * Pure and deterministic: the same Scene always produces byte-identical SVG.
 * Rough.js supplies the hand-drawn path data through its generator API (no DOM
 * and no canvas), and each Element draws with its own stored seed and
 * roughness, so nothing depends on Math.random or on the order of runs.
 *
 * Colours and the font come from `var(--ink)`, `var(--paper)`, `var(--muted)`
 * and `var(--font-hand)`, which a host sets, and each carries the light theme's
 * value as its own fallback: a saved SVG nothing styles — its own page, an
 * `<img>` — still paints paper, ink and the hand's words, and an inlined one
 * still takes the host's theme, light, dark or its own. Nothing else is written
 * as a colour: each grey step is a fixed `color-mix` of ink into paper, an
 * opaque colour, so an overlap never darkens and a host backdrop other than
 * paper never shows through. A hachure or cross-hatch fill takes one step more ink
 * than a solid fill of the same grey, and its hatch gap leaves a lattice
 * rather than a wash at every roughness, so the two line fills stay a texture.
 * The Scene hash is written into `data-scene-hash` so an SVG can always be
 * traced back to the Scene it came from, and the root `<svg role="img">`
 * carries its accessible name as its own first-child `<title>`, with no
 * document-wide id to collide with.
 *
 * A Snapped arrow or line end is resolved against its target's outline here
 * (`geometry.ts` does the maths), and its head sits on that end pointing along
 * the arrow, into the target. A shaft of more than two points draws through
 * them: consecutive `round` bend points make one smooth curve, a `sharp` one
 * breaks it into a softened corner, and the head at each end follows the curve
 * it arrives on rather than the straight line between the two ends. Rough.js
 * still draws that path, so a bend wobbles like every other line in the Scene.
 * A dashed or dotted shaft fits its dash pattern to the arc length it draws, so
 * a stroke that ends on an outline ends on a dash rather than on bare paper.
 *
 * Words are measured, never guessed: a Text and a Label are placed by Layout,
 * with the font the drawing is made for, so the page, the line breaks and the
 * words a host sees agree. The Renderer is pure, so the font arrives as a
 * `Layout` the caller measured: `renderScene(scene, layout)`. Nothing here
 * reads a file, and nothing here grows an Element: a Label that does not fit is
 * drawn where it is and `ez check` reports it.
 *
 * A shaft's Label sits where the Scene's `labelAt` puts it — a fraction along
 * the drawn shaft and a signed distance to one side — and Layout's own place
 * above the middle of the shaft when the Scene writes none. A Label has no
 * paper behind it: where the words sit over their own shaft, that shaft is cut
 * open and the page shows through. Only the shaft is cut, so anything else
 * under the words — a box the shaft crosses, another Element — shows through
 * them as well.
 *
 * Each Element is measured once per drawing, and both the box it covers and the
 * SVG that draws it come from that one result. The editor reads the same boxes
 * through `elementBounds` and `pageBounds`, so selection, fitting and the page
 * cannot disagree with the ink.
 */
import { RoughGenerator } from 'roughjs/bin/generator.js';
import type { Drawable, OpSet, Options } from 'roughjs/bin/core.js';
import { canonicalElement, canonicalScene, hashScene, isOutlined } from './scene.js';
import type {
  ArrowOrLineElement,
  Element,
  Head,
  OutlinedElement,
  Point,
  Scene,
  StrokeWidth,
  TextElement,
} from './scene.js';
import { STROKE_WIDTH_PX } from './layout.js';
import type { Block, Box, Layout } from './layout.js';
import {
  arrowHeadTriangle,
  barThrough,
  curve,
  cutAtGap,
  fillets,
  pathMeetsGap,
  quadraticRoots,
  shaftEnds,
  shaftLabelAnchor,
  shaftPath,
  shaftTangentAt,
  straight,
} from './geometry.js';
import type { ShaftPath, ShaftPiece } from './geometry.js';

/**
 * The theme's variables, each with the light theme as its own fallback, so a
 * saved SVG opened on its own — no host page, no stylesheet, or an `<img>` with
 * nothing around it — still draws paper, ink and the hand's words. A host that
 * sets the variable still wins: a fallback is only read when the name is not
 * declared, so an inlined drawing takes the host's theme, light, dark or its
 * own. The values are `src/editor/editor.css`'s light theme: ink `#1b1a17`,
 * paper `#fbf8f1`, muted that ink at 52% in that paper (`#878580`), and Kalam
 * first in the hand's font stack. The stack is single-quoted, which XML allows
 * inside the double-quoted attribute it lands in.
 */
const INK = 'var(--ink, #1b1a17)';
const MUTED = 'var(--muted, #878580)';
const PAPER = 'var(--paper, #fbf8f1)';
const FONT = "var(--font-hand, 'Kalam', 'Bradley Hand', 'Segoe Print', cursive)";

/** Arrow head length per stroke width, in pixels. */
const HEAD_LENGTH_PX: Record<StrokeWidth, number> = { thin: 9, bold: 13, extra: 18 };

/** Padding around the Scene's Elements, in whole pixels. */
const PADDING = 16;
/** Size of an empty Scene's page, in whole pixels. */
const EMPTY_PAGE = { width: 320, height: 240 };

/**
 * The seven-grey ladder, as the percentage of ink mixed into paper for each
 * step: 0 is bare paper, 6 is solid ink.
 */
const GREY_INK_PERCENT = [0, 12, 24, 38, 55, 72, 100] as const;
const GREY_LAST = GREY_INK_PERCENT.length - 1;

/** A box in Scene units: what an Element covers, and what a page shows. */
export type { Box } from './layout.js';

/** Every Element by id, so a Snapped arrow or line end resolves its target. */
export function elementsById(elements: readonly Element[]): Map<string, Element> {
  return new Map(elements.map((element) => [element.id, element]));
}

export function renderScene(scene: Scene, layout: Layout): string {
  const canonical = canonicalScene(scene);
  const byId = elementsById(canonical.elements);
  const drawn = canonical.elements.map((element) => renderElement(element, byId, layout));
  return sceneSvg(canonical, hashScene(canonical), drawn);
}

/**
 * One Element drawn: the box it takes on the page, and the SVG that draws it.
 * Exported so an editor that keeps what it last painted asks the Renderer for
 * one Element at a time, and gets the very same bytes `renderScene` writes.
 */
export interface DrawnElement {
  readonly bounds: Box;
  /**
   * The box the ink reaches: the box the Element occupies, grown by what its
   * drawn paths reach past it. Outlined Elements and Text are picked by this
   * box rather than `bounds`: rough strokes stray and glyphs overhang. A shaft
   * keeps `bounds` here and is picked by distance to its drawn path.
   */
  readonly ink: Box;
  readonly svg: string;
  /**
   * The words the drawing placed, as the Block a caret and a selection sit in;
   * null when the Element draws none. The drawing measured them to draw them,
   * so an editor that keeps the drawing keeps the placement with it: a caret
   * that moves reads this Block instead of placing the words again.
   */
  readonly words: Block | null;
}

/**
 * One Element of a canonical Scene, drawn. The target outlines a Snapped end
 * resolves against are in `byId`, so a caller that redraws one Element redraws
 * the same drawing the whole Scene would have given it.
 */
export function renderElement(
  element: Element,
  byId: ReadonlyMap<string, Element>,
  layout: Layout,
): DrawnElement {
  return drawElement(element, byId, layout);
}

/**
 * The SVG document a Scene's drawings make: the page around every Element, its
 * title and its hash. `renderScene` is this, from a Scene; an editor that keeps
 * the drawings it already made assembles the same bytes from them.
 */
export function sceneSvg(
  scene: Scene,
  hash: string,
  drawings: readonly DrawnElement[],
): string {
  const page = pageOfBounds(drawings.map((drawing) => drawing.bounds));
  const body = drawings.map((drawing) => drawing.svg).join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}"` +
      ` viewBox="${page.x} ${page.y} ${page.width} ${page.height}"` +
      ` role="img" font-family="${FONT}" data-scene-hash="sha256:${hash}">`,
    `<title>${escapeXml(scene.title)}</title>`,
    body,
    '</svg>',
    '',
  ].join('\n');
}

/**
 * The page a Scene occupies: the box around every Element, padded, or the empty
 * page when there are none. Exported so a host fits the page the Renderer
 * draws, not a second copy of the same arithmetic. The Scene is canonicalised
 * first, so an editor's unrounded draft is measured where it is drawn.
 */
export function pageBounds(scene: Scene, layout: Layout): Box {
  const canonical = canonicalScene(scene);
  const byId = elementsById(canonical.elements);
  return pageOfBounds(canonical.elements.map((element) => elementBounds(element, byId, layout)));
}

/** The page a set of Element boxes occupies: the box around them, padded. */
function pageOfBounds(bounds: readonly Box[]): Box {
  if (bounds.length === 0) {
    return { x: 0, y: 0, ...EMPTY_PAGE };
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const box of bounds) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  const x = Math.floor(left - PADDING);
  const y = Math.floor(top - PADDING);
  return {
    x,
    y,
    width: Math.ceil(right + PADDING) - x,
    height: Math.ceil(bottom + PADDING) - y,
  };
}

/** The box an Element covers, its words included: its selection outline, and what a box sweeps up. */
export function elementBounds(
  element: Element,
  byId: ReadonlyMap<string, Element>,
  layout: Layout,
): Box {
  const placed = placement(element, byId, layout);
  return joined(placed.box, placed.words);
}

/**
 * The outline an Element is stored as, without its words: the rectangle a
 * handle sits on and a resize moves. A Label that overflows its Element draws
 * outside this box, and dragging a handle that followed the ink would rewrite
 * the geometry the author set.
 */
export function outlineBox(element: OutlinedElement): Box {
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

/**
 * The two ends an arrow or line draws, each Snapped end resolved onto its
 * target's outline: the shaft the editor picks by, so a click follows the ink
 * rather than the empty box around it.
 *
 * The ends are the canonical ones the SVG is drawn from, rounded like a saved
 * Scene. A Scene in hand keeps more precision than a file writes, and a shaft's
 * Label is placed from the ends the page drew: a fraction of a pixel would tilt
 * the shaft enough to put the words on the other side of it.
 */
export function drawnShaft(
  element: ArrowOrLineElement,
  byId: ReadonlyMap<string, Element>,
): [Point, Point] {
  const canonical = canonicalElement(element);
  const last = canonical.points.length - 1;
  return shaftEnds(
    canonical.points,
    snapTarget(canonical, canonical.points[0], byId),
    snapTarget(canonical, canonical.points[last]!, byId),
  );
}

/**
 * An arrow or line as the page inks it: the shaft it draws, every bend and curve
 * of it, and the heads on its ends. What a press on the Element lands on, so the
 * editor picks the ink a person can see rather than the chord between two ends.
 */
export interface ShaftInk {
  readonly path: ShaftPath;
  readonly heads: readonly HeadInk[];
}

/** The ink one arrow or line draws, measured from the Scene as the SVG is. */
export function shaftInk(element: ArrowOrLineElement, byId: ReadonlyMap<string, Element>): ShaftInk {
  const canonical = canonicalElement(element);
  const path = shaftPathOf(canonical, byId);
  return { path, heads: headsOf(canonical, path) };
}

/**
 * Where a shaft's Label is drawn, or null when the shaft has none: Layout's own
 * place, moved to the `labelAt` the Scene wrote. These are the words themselves;
 * what they paint, and what a press on them covers, is `wordsInkBounds`.
 */
export function shaftLabel(
  element: ArrowOrLineElement,
  byId: ReadonlyMap<string, Element>,
  layout: Layout,
): Block | null {
  const placed = placement(element, byId, layout);
  return placed.kind === 'shaft' ? placed.words : null;
}

/** The stroke width an Element draws with, in pixels. */
export function strokeWidthOf(element: Element): number {
  return STROKE_WIDTH_PX[element.stroke.width];
}

/**
 * How far a hand font's glyphs hang past the advance box Layout measures their
 * words by, as a share of the font size: Kalam's `j`, the widest hang in the
 * bundled font, puts its hook 0.22 em left of the origin. The ink is the ink a
 * person sees, so a press on that hook is a press on the words, and a shaft's
 * own ink is cut to reach it as well.
 */
const GLYPH_HANG_EM = 0.25;

/**
 * The box one Block of words paints: the advance box Layout measured, grown by
 * that hang on both sides. It is the box a shaft's Label cuts out of its own
 * shaft, the ink a Text is picked by and the box a shaft's Label is pressed on,
 * so a cut pixel is a pixel a person can press.
 */
export function wordsInkBounds(words: Block): Box {
  const hang = words.size * GLYPH_HANG_EM;
  return { x: words.x - hang, y: words.y, width: words.width + hang * 2, height: words.height };
}

/** How far each side of a drawn path reaches, in Scene units. */
interface Extent {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The box an outlined Element's ink reaches, out of the very paths that draw
 * it: the box the Element occupies, grown by the extremes those paths reach and
 * by half the stroke centred on them. The drawn line is the answer, at every
 * roughness, stroke width and corner radius, so no estimate of what Rough.js
 * might do can shrink the ink a person sees or stretch the box a flat Element
 * is picked by.
 */
function inkOf(box: Box, element: OutlinedElement, drawables: readonly Drawable[]): Box {
  let ink: Extent | null = null;
  for (const drawable of drawables) {
    for (const set of drawable.sets) {
      ink = extendWithSet(ink, set);
    }
  }
  if (ink === null) {
    return box;
  }
  const half = strokeWidthOf(element) / 2;
  const left = Math.min(box.x, ink.left - half);
  const top = Math.min(box.y, ink.top - half);
  const right = Math.max(box.x + box.width, ink.right + half);
  const bottom = Math.max(box.y + box.height, ink.bottom + half);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** One set of drawing operations added to the extremes `ink` already reaches. */
function extendWithSet(ink: Extent | null, set: OpSet): Extent | null {
  let left = ink?.left ?? Number.POSITIVE_INFINITY;
  let top = ink?.top ?? Number.POSITIVE_INFINITY;
  let right = ink?.right ?? Number.NEGATIVE_INFINITY;
  let bottom = ink?.bottom ?? Number.NEGATIVE_INFINITY;
  const point = (x: number, y: number): void => {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  };
  const across = (value: number): void => {
    left = Math.min(left, value);
    right = Math.max(right, value);
  };
  const down = (value: number): void => {
    top = Math.min(top, value);
    bottom = Math.max(bottom, value);
  };
  let from: Point = { x: 0, y: 0 };
  for (const op of set.ops) {
    switch (op.op) {
      case 'move':
      case 'lineTo': {
        from = { x: op.data[0]!, y: op.data[1]! };
        point(from.x, from.y);
        break;
      }
      case 'bcurveTo': {
        const to = { x: op.data[4]!, y: op.data[5]! };
        extendWithCurve(
          point,
          across,
          down,
          from,
          { x: op.data[0]!, y: op.data[1]! },
          { x: op.data[2]!, y: op.data[3]! },
          to,
        );
        from = to;
        break;
      }
    }
  }
  return left === Number.POSITIVE_INFINITY ? null : { left, top, right, bottom };
}

/**
 * One cubic Bézier added to the extremes: its ends, and wherever it turns back
 * on either axis. A curve's control points sit outside it, so where the curve
 * itself peaks is solved for rather than bounded by its hull.
 */
function extendWithCurve(
  point: (x: number, y: number) => void,
  across: (value: number) => void,
  down: (value: number) => void,
  from: Point,
  control: Point,
  other: Point,
  to: Point,
): void {
  point(from.x, from.y);
  point(to.x, to.y);
  for (const axis of ['x', 'y'] as const) {
    const a = from[axis];
    const b = control[axis];
    const c = other[axis];
    const d = to[axis];
    // The derivative of the Bézier along one axis, as a quadratic in t.
    const roots = quadraticRoots(
      -a + 3 * b - 3 * c + d,
      2 * (a - 2 * b + c),
      b - a,
    );
    for (const t of roots) {
      if (!(t > 0 && t < 1)) {
        continue;
      }
      const rest = 1 - t;
      const value =
        rest * rest * rest * a +
        3 * rest * rest * t * b +
        3 * rest * t * t * c +
        t * t * t * d;
      if (axis === 'x') {
        across(value);
      } else {
        down(value);
      }
    }
  }
}

/**
 * What Layout places for one Element, and the box it is drawn against: a shaft's
 * two ends, a Text's own block, or a container's outline. Both the bounds and
 * the SVG come from this one result, so where the page ends and where the ink
 * goes cannot drift apart.
 */
type Placement =
  | {
      kind: 'shaft';
      element: ArrowOrLineElement;
      path: ShaftPath;
      words: Block | null;
      box: Box;
    }
  | { kind: 'text'; element: TextElement; words: Block; box: Box }
  | { kind: 'outline'; element: OutlinedElement; words: Block | null; box: Box };

function placement(
  element: Element,
  byId: ReadonlyMap<string, Element>,
  layout: Layout,
): Placement {
  // The same canonical Element `renderScene` draws: a Scene the editor mutates
  // keeps more precision than a saved one writes, and the bounds a host fits and
  // selects by have to be the bounds of the ink.
  const canonical = canonicalElement(element);
  switch (canonical.type) {
    case 'arrow':
    case 'line': {
      const path = shaftPathOf(canonical, byId);
      return {
        kind: 'shaft',
        element: canonical,
        path,
        words: shaftWords(canonical, path, layout),
        box: shaftBox(canonical, path),
      };
    }
    case 'text': {
      const words = layout.text(canonical);
      return { kind: 'text', element: canonical, words, box: words };
    }
    default:
      return {
        kind: 'outline',
        element: canonical,
        words: layout.label(canonical),
        box: outlineBox(canonical),
      };
  }
}

/**
 * The box a shaft covers: the curve it is drawn along, and — once it bends — the
 * ink Rough.js roughens that curve into. On a long bent shaft a roughness pushes
 * the stroke a long way past the curve it was measured from, and a page or a box
 * measured by the curve alone would clip the ink it was measured for.
 *
 * A two-point shaft's box is the rectangle between its two ends and nothing
 * else, as it always has been: it draws one straight run, so roughening it
 * cannot reach past the ends it runs between, and a Scene that never bent keeps
 * the page it always had.
 */
function shaftBox(element: ArrowOrLineElement, path: ShaftPath): Box {
  const ink = element.points.length > 2 ? roughenedInk(element, path) : null;
  if (ink === null) {
    return path.bounds;
  }
  const left = Math.min(path.bounds.x, ink.left);
  const top = Math.min(path.bounds.y, ink.top);
  const right = Math.max(path.bounds.x + path.bounds.width, ink.right);
  const bottom = Math.max(path.bounds.y + path.bounds.height, ink.bottom);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Where the ink of a shaft's stroke passes reaches, as Rough.js draws it. */
function roughenedInk(element: ArrowOrLineElement, path: ShaftPath): Extent | null {
  const generator = new RoughGenerator();
  const drawable = generator.path(shaftData(path), lineOptions(element));
  let ink: Extent | null = null;
  for (const set of drawable.sets) {
    ink = extendWithSet(ink, set);
  }
  return ink;
}

/**
 * The shaft's words: where Layout wrapped them, moved to the `labelAt` the Scene
 * wrote. A shaft that writes none keeps the place Layout gives it, so a Scene
 * that never asks for a position keeps the position it always had; only the
 * paper behind the words is new. What moves is where the words draw: a Line's
 * boundaries are offsets into its words, not x, and they stay where Layout put
 * them so a caret names the glyph it always named.
 */
function shaftWords(
  element: ArrowOrLineElement,
  path: ShaftPath,
  layout: Layout,
): Block | null {
  const words = layout.label(element, { start: path.start, end: path.end });
  if (words === null || element.labelAt === undefined) {
    return words;
  }
  const anchor = shaftLabelAnchor(path, element.labelAt);
  const dx = anchor.x - (words.x + words.width / 2);
  const dy = anchor.y - (words.y + words.height / 2);
  return {
    ...words,
    x: words.x + dx,
    y: words.y + dy,
    lines: words.lines.map((line) => ({
      ...line,
      x: line.x + dx,
      baseline: line.baseline + dy,
      top: line.top + dy,
    })),
  };
}

/** One Element: measured once, then both bounded and drawn from that result. */
function drawElement(
  element: Element,
  byId: ReadonlyMap<string, Element>,
  layout: Layout,
): DrawnElement {
  const placed = placement(element, byId, layout);
  const bounds = joined(placed.box, placed.words);
  if (placed.kind === 'outline') {
    // One generation of what Rough.js draws: the paths the SVG writes and the
    // box a press answers to are the same drawing, made once.
    const generator = new RoughGenerator();
    const fills = fillDrawables(generator, placed.element);
    const outlines = outlineDrawables(generator, placed.element);
    return {
      bounds,
      ink: inkOf(bounds, placed.element, [...fills, ...outlines]),
      words: placed.words,
      svg: outlinedSvg(placed.element, placed.words, generator, fills, outlines),
    };
  }
  if (placed.kind === 'shaft') {
    // A shaft is picked by distance to its drawn path, not by its box.
    const svg = arrowOrLineSvg(placed.element, placed.path, placed.words);
    return { bounds, ink: bounds, words: placed.words, svg };
  }
  // Text glyphs hang past the advance box that holds the words.
  const ink = wordsInkBounds(placed.words);
  const svg = renderBlock(placed.words, placed.element.tone === 'muted' ? MUTED : INK);
  return { bounds, ink, words: placed.words, svg };
}

/** The smallest box holding both, so a Label that sticks out still fits the page. */
function joined(box: Box, words: Block | null): Box {
  if (words === null || words.lines.length === 0) {
    return box;
  }
  const left = Math.min(box.x, words.x);
  const top = Math.min(box.y, words.y);
  const right = Math.max(box.x + box.width, words.x + words.width);
  const bottom = Math.max(box.y + box.height, words.y + words.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * One outlined Element: its fill first, then its outline, so the ink of the
 * outline always sits on top of the fill it belongs to.
 */
function outlinedSvg(
  element: OutlinedElement,
  words: Block | null,
  generator: RoughGenerator,
  fills: readonly Drawable[],
  outlines: readonly Drawable[],
): string {
  const width = STROKE_WIDTH_PX[element.stroke.width];
  const strokeColour = element.tone === 'muted' ? MUTED : INK;
  const paths: string[] = [];

  for (const drawable of fills) {
    const colour = drawable.options.fill;
    for (const path of generator.toPaths(drawable)) {
      if (path.fill !== 'none') {
        paths.push(`<path d="${pathData(path.d)}" fill="${colour}"/>`);
      } else {
        paths.push(
          `<path d="${pathData(path.d)}" fill="none" stroke="${colour}"` +
            ` stroke-width="${formatNumber(path.strokeWidth)}"/>`,
        );
      }
    }
  }

  const dash = strokeDash(width, element.stroke.style);
  for (const drawable of outlines) {
    for (const path of generator.toPaths(drawable)) {
      paths.push(
        `<path d="${pathData(path.d)}" fill="none" stroke="${path.stroke}"` +
          ` stroke-width="${formatNumber(path.strokeWidth)}"${dash}/>`,
      );
    }
  }

  return (
    `<g stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</g>` +
    renderBlock(words, strokeColour)
  );
}

/** The options every pass of an outlined Element draws with. */
function outlineOptions(element: OutlinedElement): Options {
  return {
    seed: element.seed,
    roughness: element.roughness,
    strokeWidth: STROKE_WIDTH_PX[element.stroke.width],
  };
}

/**
 * The fill of an outlined Element, as Rough.js draws it: one drawable per pass,
 * and none at all when the Element is not filled.
 */
function fillDrawables(generator: RoughGenerator, element: OutlinedElement): Drawable[] {
  if (element.fill.kind === 'none') {
    return [];
  }
  // A hachure or cross-hatch fill is drawn as lines, so it takes one step
  // more ink than a solid wash at the same grey. The gap follows the stroke
  // width, wide enough that a cross-hatch at roughness 2 keeps both
  // directions visible instead of filling in as a dense mesh.
  const lineFilled = element.fill.kind !== 'solid';
  const grey = lineFilled ? Math.min(element.fill.grey + 1, GREY_LAST) : element.fill.grey;
  const width = STROKE_WIDTH_PX[element.stroke.width];
  const options: Options = {
    ...outlineOptions(element),
    stroke: 'none',
    fill: greyColour(grey),
    fillStyle: element.fill.kind,
    fillWeight: Math.max(1, width / 2),
    hachureGap: Math.max(8, width * 3),
  };
  return outlinesOf(generator, element, options);
}

/** The outline of an outlined Element, as Rough.js draws it. */
function outlineDrawables(generator: RoughGenerator, element: OutlinedElement): Drawable[] {
  return outlinesOf(generator, element, {
    ...outlineOptions(element),
    stroke: element.tone === 'muted' ? MUTED : INK,
  });
}

/** The paths of an outlined Element, drawn by Rough.js with whatever options the pass needs. */
function outlinesOf(
  generator: RoughGenerator,
  element: OutlinedElement,
  options: Options,
): Drawable[] {
  switch (element.type) {
    case 'rectangle':
      return [
        element.corners === 'round'
          ? generator.path(roundedPath(element), options)
          : generator.rectangle(element.x, element.y, element.width, element.height, options),
      ];
    case 'ellipse':
      return [
        generator.ellipse(
          element.x + element.width / 2,
          element.y + element.height / 2,
          element.width,
          element.height,
          options,
        ),
      ];
    case 'diamond': {
      const centre = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
      return [
        element.corners === 'round'
          ? generator.path(roundedPath(element), options)
          : generator.polygon(
              [
                [centre.x, element.y],
                [element.x + element.width, centre.y],
                [centre.x, element.y + element.height],
                [element.x, centre.y],
              ],
              options,
            ),
      ];
    }
  }
}

/**
 * A round-cornered outline as SVG path data, so Rough.js can draw and fill it
 * like any other: a straight run between neighbouring fillets, then the arc
 * that rounds each vertex. `geometry.ts` owns the fillets, so the drawing and
 * Snap round the same corners at the same radius.
 */
function roundedPath(element: OutlinedElement): string {
  const corners = fillets(element);
  const first = corners[0]!;
  const commands = [`M ${formatPoint(first.after)}`];
  for (const corner of [...corners.slice(1), first]) {
    commands.push(`L ${formatPoint(corner.before)}`);
    commands.push(
      `A ${formatNumber(corner.radius)} ${formatNumber(corner.radius)} 0 0 1 ${formatPoint(corner.after)}`,
    );
  }
  commands.push('Z');
  return commands.join(' ');
}

function formatPoint(point: Point): string {
  return `${formatNumber(point.x)} ${formatNumber(point.y)}`;
}

/**
 * One arrow or line: its shaft, then its heads on top. A Snapped end sits on
 * its target's outline, and each head points along the curve that arrives at it.
 */
function arrowOrLineSvg(
  element: ArrowOrLineElement,
  path: ShaftPath,
  words: Block | null,
): string {
  const generator = new RoughGenerator();
  const width = STROKE_WIDTH_PX[element.stroke.width];
  const colour = element.tone === 'muted' ? MUTED : INK;
  const dash = fittedDash(width, element.stroke.style, path.length);
  const paths: string[] = [];

  // Rough.js starts a new subpath at every piece it draws, so the passes are
  // joined back into one stroke each before they are written.
  const shaft = generator.path(shaftData(path), lineOptions(element));
  const gap = labelGap(path, words, width);
  const runs: { d: string; from: number }[] = [];
  if (gap === null) {
    runs.push({
      d: strokePasses(shaft)
        .map((ops) => generator.opsToPath({ type: 'path', ops }))
        .join(' '),
      from: 0,
    });
  } else {
    for (const pass of strokePasses(shaft)) {
      for (const run of cutAtGap(passPieces(pass), gap)) {
        runs.push({ d: piecePath(generator, run.pieces), from: run.start });
      }
    }
  }

  for (const run of runs) {
    // A run keeps its place in the fitted dash pattern: the offset is the
    // distance the gap took out from in front of it, so the dashes outside the
    // gap fall where they would with no Label at all.
    const offset = dash !== '' && run.from > 0 ? ` stroke-dashoffset="${formatNumber(run.from)}"` : '';
    paths.push(
      `<path d="${pathData(run.d)}" fill="none" stroke="${colour}"` +
        ` stroke-width="${formatNumber(width)}"${dash}${offset}/>`,
    );
  }

  for (const head of headsOf(element, path)) {
    paths.push(...headPaths(generator, element, head, colour));
  }

  return (
    `<g stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</g>` +
    renderBlock(words, colour)
  );
}

/**
 * The gap a shaft's Label cuts in its own shaft, or null when it cuts none. Two
 * boxes decide it: the words' advance box, which the shaft's own centre line has
 * to enter, and the words' ink box grown by half the stroke, which is what is
 * cut out. The centre line decides because the ink that is drawn is roughened
 * after the decision: a stroke that wobbles past the words, or a Label placed
 * beside its shaft, cuts nothing. Words with nothing to read cut nothing either.
 */
function labelGap(path: ShaftPath, words: Block | null, width: number): Box | null {
  if (words === null || !words.lines.some((line) => line.text.trim() !== '')) {
    return null;
  }
  if (!pathMeetsGap(path.pieces, words)) {
    return null;
  }
  // The cut reaches half a stroke past the words' ink, so a round cap ends
  // where the words begin and no sliver of the shaft is left inside them.
  const ink = wordsInkBounds(words);
  const half = width / 2;
  return {
    x: ink.x - half,
    y: ink.y - half,
    width: ink.width + width,
    height: ink.height + width,
  };
}

/** One Rough.js pass as the pieces a shaft is measured in, so a gap can cut it. */
function passPieces(ops: OpSet['ops']): ShaftPiece[] {
  const pieces: ShaftPiece[] = [];
  let from: Point | null = null;
  for (const op of ops) {
    const [first, second, third, fourth, fifth, sixth] = op.data;
    if (op.op === 'move') {
      from = { x: first!, y: second! };
      continue;
    }
    if (from === null) {
      continue;
    }
    const to = op.op === 'lineTo' ? { x: first!, y: second! } : { x: fifth!, y: sixth! };
    pieces.push(
      op.op === 'lineTo'
        ? straight(from, to)
        : curve(from, { x: first!, y: second! }, { x: third!, y: fourth! }, to),
    );
    from = to;
  }
  return pieces;
}

/** One run of pieces as SVG path data, written the way Rough.js writes its own ops. */
function piecePath(generator: RoughGenerator, pieces: readonly ShaftPiece[]): string {
  const first = pieces[0];
  if (first === undefined) {
    return '';
  }
  const ops: OpSet['ops'] = [{ op: 'move', data: [first.from.x, first.from.y] }];
  for (const piece of pieces) {
    if (piece.kind === 'straight') {
      ops.push({ op: 'lineTo', data: [piece.to.x, piece.to.y] });
    } else {
      ops.push({
        op: 'bcurveTo',
        data: [
          piece.control1.x,
          piece.control1.y,
          piece.control2.x,
          piece.control2.y,
          piece.to.x,
          piece.to.y,
        ],
      });
    }
  }
  return generator.opsToPath({ type: 'path', ops });
}

/**
 * The options every stroke pass of an arrow or line draws with. A Snapped end
 * must touch the outline it belongs to at every roughness, so the drawn ends
 * stay where the geometry put them.
 */
function lineOptions(element: ArrowOrLineElement): Options {
  return {
    seed: element.seed,
    roughness: element.roughness,
    strokeWidth: STROKE_WIDTH_PX[element.stroke.width],
    stroke: element.tone === 'muted' ? MUTED : INK,
    preserveVertices: true,
  };
}

/**
 * The stroke passes of a roughened shaft, each as one unbroken subpath.
 *
 * Rough.js draws every piece of a path on its own, twice, and starts each with a
 * move of its own: written out as they come, a stroke pattern would begin again
 * at every bend and the ink would look struck from separate strokes. The pieces
 * of one pass are joined here instead, the end of one carrying the pen on into
 * the next, so a dash runs the whole length of the shaft it was fitted to.
 */
function strokePasses(drawable: Drawable): OpSet['ops'][] {
  const passes: OpSet['ops'][] = [];
  const passOf = (index: number): OpSet['ops'] => passes[index] ?? (passes[index] = []);
  let drawing = -1;
  for (const op of drawable.sets[0]?.ops ?? []) {
    if (op.op !== 'move') {
      passOf(drawing % 2).push(op);
      continue;
    }
    drawing += 1;
    const pass = passOf(drawing % 2);
    const last = pass[pass.length - 1]?.data;
    // The first move of a pass places the pen. A later one either continues the
    // same stroke from where the piece before it left off, or — when the pen is
    // already there — asks for nothing at all.
    if (last === undefined) {
      pass.push(op);
    } else if (last[last.length - 2] !== op.data[0] || last[last.length - 1] !== op.data[1]) {
      pass.push({ op: 'lineTo', data: op.data });
    }
  }
  return passes.filter((ops) => ops.length > 0);
}

/**
 * A head as the page draws it, in Scene units: the ink a press on that head
 * lands on. Picking reads the same shapes the drawing fills, so a head a person
 * can see is a head a press can take.
 */
export type HeadInk =
  | { readonly kind: 'arrow'; readonly triangle: readonly [Point, Point, Point] }
  | { readonly kind: 'dot'; readonly centre: Point; readonly radius: number }
  | { readonly kind: 'bar'; readonly through: readonly [Point, Point] };

/** The ink one head draws, or null for a head that draws nothing. */
function inkOfHead(
  kind: Head,
  apex: Point,
  direction: Point,
  length: number,
): HeadInk | null {
  if (kind === 'none') {
    return null;
  }
  if (kind === 'arrow') {
    return { kind, triangle: arrowHeadTriangle(apex, direction, length) };
  }
  if (kind === 'dot') {
    return { kind, centre: apex, radius: length * 0.75 };
  }
  return { kind, through: barThrough(apex, direction, length * 0.6) };
}

/**
 * The heads an arrow or line draws, each pointing along the curve that arrives
 * at it, in drawing order: the start's when it has one, then the end's.
 */
function headsOf(element: ArrowOrLineElement, path: ShaftPath): HeadInk[] {
  const headLength = HEAD_LENGTH_PX[element.stroke.width];
  const arriving = shaftTangentAt(path, 1);
  const leaving = shaftTangentAt(path, 0);
  // A start head points back along the shaft. One with no length at all has no
  // direction to point back along, so it keeps the way a zero-length shaft has
  // always drawn: rightwards.
  const direction = {
    start: path.length === 0 ? { x: 1, y: 0 } : { x: -leaving.x, y: -leaving.y },
    end: arriving,
  };
  const heads: HeadInk[] = [];
  for (const [kind, apex, along] of [
    [element.heads.start, path.start, direction.start],
    [element.heads.end, path.end, direction.end],
  ] as const) {
    const head = inkOfHead(kind, apex, along, headLength);
    if (head !== null) {
      heads.push(head);
    }
  }
  return heads;
}

/** One arrow head, drawn from the ink the picking answers to. */
function headPaths(
  generator: RoughGenerator,
  element: ArrowOrLineElement,
  head: HeadInk,
  colour: string,
): string[] {
  const headOptions: Options = {
    seed: element.seed,
    roughness: element.roughness,
    strokeWidth: STROKE_WIDTH_PX[element.stroke.width],
    stroke: colour,
  };
  if (head.kind === 'arrow') {
    return generator
      .toPaths(
        generator.polygon(
          head.triangle.map((point) => [point.x, point.y]),
          { ...headOptions, stroke: 'none', fill: colour, fillStyle: 'solid' },
        ),
      )
      .map((path) => `<path d="${pathData(path.d)}" fill="${colour}"/>`);
  }
  if (head.kind === 'dot') {
    const { centre, radius } = head;
    return generator
      .toPaths(
        generator.circle(centre.x, centre.y, radius, {
          ...headOptions,
          stroke: 'none',
          fill: colour,
          fillStyle: 'solid',
        }),
      )
      .map((path) => `<path d="${pathData(path.d)}" fill="${colour}"/>`);
  }
  const [from, to] = head.through;
  return generator.toPaths(generator.line(from.x, from.y, to.x, to.y, headOptions)).map(
    (path) =>
      `<path d="${pathData(path.d)}" fill="none" stroke="${path.stroke}"` +
      ` stroke-width="${formatNumber(path.strokeWidth)}"/>`,
  );
}

/**
 * The path an arrow or line draws: its ends moved onto the outlines they Snap
 * to, every bend point where the Scene put it, and the corner each of them turns
 * by. An unwritten corner is the Element's, so a whole shaft bends one way until
 * a single bend point asks for the other.
 */
function shaftPathOf(
  element: ArrowOrLineElement,
  byId: ReadonlyMap<string, Element>,
): ShaftPath {
  const last = element.points.length - 1;
  return shaftPath(
    element.points,
    element.corners,
    snapTarget(element, element.points[0], byId),
    snapTarget(element, element.points[last]!, byId),
  );
}

/**
 * The shaft as SVG path data: a move to its first point, then a line or a curve
 * per piece, in drawing order. Rough.js roughens this path like any other, so a
 * bent shaft wobbles with the rest of the Scene instead of looking struck.
 *
 * The numbers are the ones the shaft was measured with, unrounded: the ink is
 * roughened from them, and the SVG rounds what it writes once, at the end.
 */
function shaftData(path: ShaftPath): string {
  const at = (point: Point): string => `${point.x} ${point.y}`;
  const commands = [`M ${at(path.pieces[0]!.from)}`];
  for (const piece of path.pieces) {
    if (piece.kind === 'straight') {
      commands.push(`L ${at(piece.to)}`);
      continue;
    }
    commands.push(`C ${at(piece.control1)} ${at(piece.control2)} ${at(piece.to)}`);
  }
  return commands.join(' ');
}

/**
 * The Element a Snapped end is drawn on, or undefined for a free end. A Snap
 * the Scene could not honour is an error naming the arrow or line and the
 * target it asked for: parseScene rejects those Scenes, so only a Scene built in
 * memory reaches this, and it must not draw a free end while still claiming a
 * Snap.
 *
 * The target is the one that is drawn, rounded like the rest of the Scene, so
 * every caller that keeps a map of its own — the editor's in-memory draft
 * among them — resolves the same outline the ink does. A hair of precision left
 * in a target's `x` tilts the shaft enough to move the side its Label sits on.
 */
function snapTarget(
  element: ArrowOrLineElement,
  point: Point,
  byId: ReadonlyMap<string, Element>,
): OutlinedElement | undefined {
  if (point.snap === undefined) {
    return undefined;
  }
  const stored = byId.get(point.snap);
  if (stored === undefined) {
    throw new Error(`${element.id}: snap target "${point.snap}" does not exist`);
  }
  const target = canonicalElement(stored);
  if (!isOutlined(target)) {
    throw new Error(
      `${element.id}: snap target "${point.snap}" must be a rectangle, ellipse or diamond`,
    );
  }
  return target;
}

/**
 * Measured words as one `<text>` per line, on the baseline and at the anchor
 * Layout placed them on. A blank line takes its space and draws nothing.
 *
 * `xml:space="preserve"` keeps a run of ASCII spaces as wide as Layout measured
 * it: without it an SVG host collapses the run to one space and the drawing is
 * narrower than the box the words were wrapped and placed for.
 */
function renderBlock(block: Block | null, colour: string): string {
  if (block === null) {
    return '';
  }
  return block.lines
    .filter((line) => line.text !== '')
    .map(
      (line) =>
        `<text x="${formatNumber(line.x)}" y="${formatNumber(line.baseline)}"` +
        ` font-size="${formatNumber(block.size)}" text-anchor="${block.anchor}"` +
        ` xml:space="preserve" fill="${colour}">${escapeXml(line.text)}</text>`,
    )
    .join('');
}

/**
 * One grey step as a fixed mix of ink into paper. Grey 0 is bare paper and grey
 * 6 is solid ink; the steps between are opaque colours, so two overlapping
 * fills keep one grey and a host backdrop never shows through.
 */
export function greyColour(grey: number): string {
  const percent = GREY_INK_PERCENT[grey] ?? 0;
  if (percent === 0) {
    return PAPER;
  }
  if (percent === GREY_INK_PERCENT[GREY_LAST]) {
    return INK;
  }
  return `color-mix(in srgb, ${INK} ${percent}%, ${PAPER})`;
}

function strokeDash(width: number, style: Element['stroke']['style']): string {
  if (style === 'solid') {
    return '';
  }
  if (style === 'dashed') {
    return ` stroke-dasharray="${formatNumber(width * 3)} ${formatNumber(width * 3)}"`;
  }
  return ` stroke-dasharray="${formatNumber(width)} ${formatNumber(width * 2)}"`;
}

/**
 * The dash pattern of an arrow or line shaft, fitted to the length it draws, so
 * the stroke begins and ends on a dash. A Snapped end must reach its target's
 * outline, and a pattern cut off mid-gap stops short of it and leaves bare
 * paper. Whole periods fit between the first dash and the last, and the gap is
 * stretched or squeezed to take up the rest; a shaft too short for a dash, a
 * gap and another dash draws as one dash instead of a pattern that misses its
 * end.
 */
function fittedDash(
  width: number,
  style: Element['stroke']['style'],
  length: number,
): string {
  if (style === 'solid') {
    return '';
  }
  const [dash, gap] = style === 'dashed' ? [width * 3, width * 3] : [width, width * 2];
  const turns = (length - dash) / (dash + gap);
  let fitted = 0;
  let drift = Number.POSITIVE_INFINITY;
  for (const periods of [Math.floor(turns), Math.ceil(turns)]) {
    const candidate = (length - dash) / periods - dash;
    if (periods < 1 || candidate <= 0 || Math.abs(candidate - gap) >= drift) {
      continue;
    }
    fitted = candidate;
    drift = Math.abs(candidate - gap);
  }
  if (fitted === 0) {
    // Too short for two dashes and a gap: one dash across the whole shaft.
    return ` stroke-dasharray="${formatNumber(length)}"`;
  }
  return ` stroke-dasharray="${formatNumber(dash)} ${formatNumber(fitted)}"`;
}

/**
 * Rough.js emits full float precision. Two decimals is plenty for a hand-drawn
 * path and keeps the SVG small; the rounding is exact, so runs stay identical.
 * Rough.js's fixed-decimal conversion rounds tiny exponent-form coordinates to
 * zero instead of rounding their mantissas, which would change SVG bytes.
 */
function pathData(d: string): string {
  return d.replace(/-?\d+(?:\.\d+)?/g, (token) => formatNumber(Number(token)));
}

/** Locale-free, trailing-zero-free number formatting. */
function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
