import { RoughGenerator } from 'roughjs/bin/generator.js';
import type { Drawable, OpSet, Options } from 'roughjs/bin/core.js';
import { canonicalElement, canonicalScene, hashScene, isOutlined, snapTargetId } from './scene.js';
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
  shaftLabelAnchor,
  shaftPath,
  shaftTangentAt,
  straight,
  uAt,
} from './geometry.js';
import type { EndTarget, ShaftPath, ShaftPiece } from './geometry.js';

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

const HEAD_LENGTH_PX: Record<StrokeWidth, number> = { thin: 9, bold: 13, extra: 18 };

const PADDING = 16;
const EMPTY_PAGE = { width: 320, height: 240 };

const GREY_INK_PERCENT = [0, 12, 24, 38, 55, 72, 100] as const;
const GREY_LAST = GREY_INK_PERCENT.length - 1;

export type { Box } from './layout.js';

export function elementsById(elements: readonly Element[]): Map<string, Element> {
  return new Map(elements.map((element) => [element.id, element]));
}

export function renderScene(scene: Scene, layout: Layout): string {
  const canonical = canonicalScene(scene);
  const byId = elementsById(canonical.elements);
  const drawn = canonical.elements.map((element) => renderElement(element, byId, layout));
  return sceneSvg(canonical, hashScene(canonical), drawn);
}

export interface DrawnElement {
  readonly bounds: Box;
  readonly ink: Box;
  readonly svg: string;
  readonly words: Block | null;
}

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

export function pageBounds(scene: Scene, layout: Layout): Box {
  const canonical = canonicalScene(scene);
  const byId = elementsById(canonical.elements);
  return pageOfBounds(canonical.elements.map((element) => elementBounds(element, byId, layout)));
}

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

export function elementBounds(
  element: Element,
  byId: ReadonlyMap<string, Element>,
  layout: Layout,
): Box {
  const placed = placement(element, byId, layout);
  return joined(placed.box, placed.words);
}

export function outlineBox(element: OutlinedElement): Box {
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

/**
 * The two ends an arrow or line draws, each Snapped end resolved onto its
 * target's outline and a covered bend's ink stopped where it enters: the shaft
 * the editor picks by, so a click follows the ink rather than the empty box
 * around it.
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
  const path = shaftPathOf(canonicalElement(element), byId);
  return [path.start, path.end];
}

export interface ShaftInk {
  readonly path: ShaftPath;
  readonly heads: readonly HeadInk[];
}

export function shaftInk(element: ArrowOrLineElement, byId: ReadonlyMap<string, Element>): ShaftInk {
  const canonical = canonicalElement(element);
  const path = shaftPathOf(canonical, byId);
  return { path, heads: headsOf(canonical, path).map((head) => head.ink) };
}

export function shaftLabel(
  element: ArrowOrLineElement,
  byId: ReadonlyMap<string, Element>,
  layout: Layout,
): Block | null {
  const placed = placement(element, byId, layout);
  return placed.kind === 'shaft' ? placed.words : null;
}

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

export function wordsInkBounds(words: Block): Box {
  const hang = words.size * GLYPH_HANG_EM;
  return { x: words.x - hang, y: words.y, width: words.width + hang * 2, height: words.height };
}

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

function roughenedInk(element: ArrowOrLineElement, path: ShaftPath): Extent | null {
  const generator = new RoughGenerator();
  const drawable = generator.path(shaftData(path), lineOptions(element));
  let ink: Extent | null = null;
  for (const set of drawable.sets) {
    ink = extendWithSet(ink, set);
  }
  return ink;
}

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

export function renderElement(
  element: Element,
  byId: ReadonlyMap<string, Element>,
  layout: Layout,
): DrawnElement {
  const placed = placement(element, byId, layout);
  const bounds = joined(placed.box, placed.words);
  if (placed.kind === 'outline') {
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
    const svg = arrowOrLineSvg(placed.element, placed.path, placed.words);
    return { bounds, ink: bounds, words: placed.words, svg };
  }
  const ink = wordsInkBounds(placed.words);
  const svg = renderBlock(placed.words, placed.element.tone === 'muted' ? MUTED : INK);
  return { bounds, ink, words: placed.words, svg };
}

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

function outlineOptions(element: OutlinedElement): Options {
  return {
    seed: element.seed,
    roughness: element.roughness,
    strokeWidth: STROKE_WIDTH_PX[element.stroke.width],
  };
}

function fillDrawables(generator: RoughGenerator, element: OutlinedElement): Drawable[] {
  if (element.fill.kind === 'none') {
    return [];
  }
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

function outlineDrawables(generator: RoughGenerator, element: OutlinedElement): Drawable[] {
  return outlinesOf(generator, element, {
    ...outlineOptions(element),
    stroke: element.tone === 'muted' ? MUTED : INK,
  });
}

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
  const heads = headsOf(element, path);
  const faces = headFacesOf(heads, width / 2);
  const passes = strokePasses(shaft).map((ops) => passPieces(ops));
  const runs: { d: string; from: number }[] = [];
  if (gap === null && faces.start === null) {
    const drawn = passes
      .map((pieces) => shaftBehindHeads(pieces, faces))
      .map((cut) => piecePath(generator, cut.pieces))
      .filter((one) => one !== '');
    if (drawn.length > 0) {
      runs.push({ d: drawn.join(' '), from: 0 });
    }
  } else {
    for (const pieces of passes) {
      const headed = shaftBehindHeads(pieces, faces);
      const stops = gap === null ? [{ pieces: headed.pieces, start: 0 }] : cutAtGap(headed.pieces, gap);
      for (const stop of stops) {
        if (stop.pieces.length > 0) {
          runs.push({ d: piecePath(generator, stop.pieces), from: stop.start + headed.removed });
        }
      }
    }
  }

  for (const run of runs) {
    const offset = dash !== '' && run.from > 0 ? ` stroke-dashoffset="${formatNumber(run.from)}"` : '';
    paths.push(
      `<path d="${pathData(run.d)}" fill="none" stroke="${colour}"` +
        ` stroke-width="${formatNumber(width)}"${dash}${offset}/>`,
    );
  }

  for (const head of heads) {
    paths.push(...headPaths(generator, element, head.ink, colour));
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
  const ink = wordsInkBounds(words);
  const half = width / 2;
  return {
    x: ink.x - half,
    y: ink.y - half,
    width: ink.width + width,
    height: ink.height + width,
  };
}

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
    if (last === undefined) {
      pass.push(op);
    } else if (last[last.length - 2] !== op.data[0] || last[last.length - 1] !== op.data[1]) {
      pass.push({ op: 'lineTo', data: op.data });
    }
  }
  return passes.filter((ops) => ops.length > 0);
}

export type HeadInk =
  | { readonly kind: 'arrow'; readonly triangle: readonly [Point, Point, Point] }
  | { readonly kind: 'dot'; readonly centre: Point; readonly radius: number }
  | { readonly kind: 'bar'; readonly through: readonly [Point, Point] };

interface PlacedHead {
  readonly at: 'start' | 'end';
  readonly ink: HeadInk;
}

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

function headsOf(element: ArrowOrLineElement, path: ShaftPath): PlacedHead[] {
  const headLength = HEAD_LENGTH_PX[element.stroke.width];
  const arriving = shaftTangentAt(path, 1);
  const leaving = shaftTangentAt(path, 0);
  const direction = {
    start: path.length === 0 ? { x: 1, y: 0 } : { x: -leaving.x, y: -leaving.y },
    end: arriving,
  };
  const heads: PlacedHead[] = [];
  for (const [at, kind, apex, heading] of [
    ['start', element.heads.start, path.start, direction.start],
    ['end', element.heads.end, path.end, direction.end],
  ] as const) {
    const ink = inkOfHead(kind, apex, heading, headLength);
    if (ink !== null) {
      heads.push({ at, ink });
    }
  }
  return heads;
}

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
    // Rough.js fills a solid polygon by jittering every corner of it, and reads
    // no `preserveVertices` there, so the triangle is filled at roughness 0: its
    // tip is the arrow's end and its corners are the ink a press on it lands on.
    return generator
      .toPaths(
        generator.polygon(
          head.triangle.map((point) => [point.x, point.y]),
          { ...headOptions, roughness: 0, stroke: 'none', fill: colour, fillStyle: 'solid' },
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

interface HeadFace {
  readonly apex: Point;
  readonly away: Point;
  readonly reach: number;
  readonly lean: number;
  readonly radius: number;
}

interface HeadFaces {
  readonly start: HeadFace | null;
  readonly end: HeadFace | null;
}

const HEAD_STEP = 0.25;

const HEAD_CROSSING_STEPS = 24;

function headFacesOf(heads: readonly PlacedHead[], radius: number): HeadFaces {
  const faces: { start: HeadFace | null; end: HeadFace | null } = { start: null, end: null };
  for (const head of heads) {
    faces[head.at] = headFaceOf(head.ink, radius);
  }
  return faces;
}

function headFaceOf(ink: HeadInk, radius: number): HeadFace | null {
  if (ink.kind !== 'arrow') {
    return null;
  }
  const [apex, left, right] = ink.triangle;
  const middle = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  const reach = Math.hypot(middle.x - apex.x, middle.y - apex.y);
  if (reach === 0) {
    return null;
  }
  return {
    apex,
    away: { x: (middle.x - apex.x) / reach, y: (middle.y - apex.y) / reach },
    reach,
    lean: Math.hypot(left.x - right.x, left.y - right.y) / 2 / reach,
    radius,
  };
}

interface HeadCut {
  readonly pieces: readonly ShaftPiece[];
  readonly removed: number;
}

function shaftBehindHeads(pieces: readonly ShaftPiece[], faces: HeadFaces): HeadCut {
  const start = faces.start === null ? { pieces, removed: 0 } : behindHead(pieces, faces.start, 'start');
  const end = faces.end === null ? start : behindHead(start.pieces, faces.end, 'end');
  return { pieces: end.pieces, removed: start.removed };
}

function behindHead(
  pieces: readonly ShaftPiece[],
  face: HeadFace,
  at: 'start' | 'end',
): HeadCut {
  const inward = at === 'end' ? [...pieces].reverse() : [...pieces];
  const total = inward.reduce((sum, piece) => sum + piece.length, 0);
  const covered = Math.min(coveredFrom(inward, face, at), total);
  let walked = covered;
  let index = 0;
  while (index < inward.length && walked >= inward[index]!.length) {
    walked -= inward[index]!.length;
    index += 1;
  }
  const piece = inward[index];
  if (piece === undefined) {
    return { pieces: [], removed: at === 'start' ? covered : 0 };
  }
  const cut = halvedAt(piece, parameterWalked(piece, walked, at));
  const kept =
    at === 'end'
      ? [cut.before, ...inward.slice(index + 1)].reverse()
      : [cut.after, ...inward.slice(index + 1)];
  return { pieces: kept.filter((one) => one.length > 0), removed: at === 'start' ? covered : 0 };
}

function coveredFrom(inward: readonly ShaftPiece[], face: HeadFace, at: 'start' | 'end'): number {
  const total = inward.reduce((sum, piece) => sum + piece.length, 0);
  const limit = Math.min(face.reach, total);
  const under = (arc: number): boolean => underHead(face, pointWalked(inward, arc, at));
  const into = (arc: number): boolean => intoTriangle(face, pointWalked(inward, arc, at));
  let entered = false;
  let covered = 0;
  let reached = 0;
  let arc = 0;
  while (arc < limit) {
    const next = Math.min(arc + HEAD_STEP, limit);
    if (under(next)) {
      entered = true;
      covered = next;
    } else if (entered) {
      return edgeOfCover(under, arc, next);
    } else if (into(next)) {
      reached = next;
    }
    arc = next;
  }
  if (entered) {
    return covered;
  }
  const beyond = Math.min(reached + HEAD_STEP, limit);
  return reached < beyond ? edgeOfCover(into, reached, beyond) : reached;
}

function edgeOfCover(under: (arc: number) => boolean, inside: number, outside: number): number {
  let covered = inside;
  let bare = outside;
  for (let step = 0; step < HEAD_CROSSING_STEPS; step += 1) {
    const middle = (covered + bare) / 2;
    if (under(middle)) {
      covered = middle;
    } else {
      bare = middle;
    }
  }
  return covered;
}

function pointWalked(pieces: readonly ShaftPiece[], arc: number, at: 'start' | 'end'): Point {
  let walked = arc;
  for (const piece of pieces) {
    if (piece.length > 0 && walked <= piece.length) {
      return halvedAt(piece, parameterWalked(piece, walked, at)).at;
    }
    walked -= piece.length;
  }
  const last = pieces[pieces.length - 1];
  return last === undefined ? { x: 0, y: 0 } : at === 'end' ? last.from : last.to;
}

function parameterWalked(piece: ShaftPiece, walked: number, at: 'start' | 'end'): number {
  return uAt(piece, at === 'end' ? piece.length - walked : walked);
}

function underHead(face: HeadFace, centre: Point): boolean {
  const { behind, beside } = fromApex(face, centre);
  if (behind > face.reach - face.radius) {
    return false;
  }
  return behind * face.lean - beside >= face.radius * Math.hypot(1, face.lean);
}

function intoTriangle(face: HeadFace, centre: Point): boolean {
  const { behind, beside } = fromApex(face, centre);
  return behind >= 0 && behind <= face.reach && behind * face.lean - beside >= 0;
}

function fromApex(face: HeadFace, centre: Point): { behind: number; beside: number } {
  const dx = centre.x - face.apex.x;
  const dy = centre.y - face.apex.y;
  return {
    behind: dx * face.away.x + dy * face.away.y,
    beside: Math.abs(dy * face.away.x - dx * face.away.y),
  };
}

function halvedAt(
  piece: ShaftPiece,
  fraction: number,
): { readonly at: Point; readonly before: ShaftPiece; readonly after: ShaftPiece } {
  if (piece.kind === 'straight') {
    const at = between(piece.from, piece.to, fraction);
    return { at, before: straight(piece.from, at), after: straight(at, piece.to) };
  }
  const first = between(piece.from, piece.control1, fraction);
  const second = between(piece.control1, piece.control2, fraction);
  const third = between(piece.control2, piece.to, fraction);
  const before = between(first, second, fraction);
  const after = between(second, third, fraction);
  const at = between(before, after, fraction);
  return {
    at,
    before: curve(piece.from, first, before, at),
    after: curve(at, after, third, piece.to),
  };
}

function between(from: Point, to: Point, fraction: number): Point {
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}

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

function snapTarget(
  element: ArrowOrLineElement,
  point: Point,
  byId: ReadonlyMap<string, Element>,
): EndTarget | undefined {
  const target = snapTargetId(point);
  if (target === null) {
    return undefined;
  }
  const stored = byId.get(target);
  if (stored === undefined) {
    throw new Error(`${element.id}: snap target "${target}" does not exist`);
  }
  const outlined = canonicalElement(stored);
  if (!isOutlined(outlined)) {
    throw new Error(
      `${element.id}: snap target "${target}" must be a rectangle, ellipse or diamond`,
    );
  }
  return { outline: outlined, ...(point.anchor === undefined ? {} : { anchor: point.anchor }) };
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
