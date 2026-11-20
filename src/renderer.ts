/**
 * Renderer: a Scene in, an SVG string out.
 *
 * Pure and deterministic: the same Scene always produces byte-identical SVG.
 * Rough.js supplies the hand-drawn path data through its generator API (no DOM
 * and no canvas), and each Element draws with its own stored seed and
 * roughness, so nothing depends on Math.random or on the order of runs.
 *
 * Colours and the font are never spelled out: they come from `var(--ink)`,
 * `var(--paper)`, `var(--muted)` and `var(--font-hand)`, which hosts set. Each
 * grey step is a fixed `color-mix` of ink into paper, an opaque colour, so an
 * overlap never darkens and a host backdrop other than paper never shows
 * through. A hachure or cross-hatch fill takes one step more ink than a solid
 * fill of the same grey, and its hatch gap leaves a lattice rather than a wash
 * at every roughness, so the two line fills stay a texture. The Scene hash is
 * written into `data-scene-hash` so an SVG can always be traced back to the
 * Scene it came from, and the root `<svg role="img">` carries its accessible
 * name as its own first-child `<title>`, with no document-wide id to collide
 * with.
 *
 * A Snapped arrow or line end is resolved against its target's outline here
 * (`geometry.ts` does the maths), and its head sits on that end pointing along
 * the arrow, into the target.
 * A dashed or dotted shaft fits its dash pattern to the length it draws, so a
 * stroke that ends on an outline ends on a dash rather than on bare paper.
 * Two Snapped ends whose targets overlap draw to the second target's centre
 * instead of turning the head around and out of it.
 *
 * Words are measured, never guessed: a Text and a Label are placed by Layout,
 * with the font the drawing is made for, so the page, the line breaks and the
 * words a host sees agree. The Renderer is pure, so the font arrives as a
 * `Layout` the caller measured: `renderScene(scene, layout)`. Nothing here
 * reads a file, and nothing here grows an Element: a Label that does not fit is
 * drawn where it is and `ez check` reports it.
 */
import { RoughGenerator } from 'roughjs/bin/generator.js';
import type { Options, PathInfo } from 'roughjs/bin/core.js';
import { canonicalScene, hashScene, isOutlined } from './scene.js';
import type {
  ArrowOrLineElement,
  Element,
  Head,
  OutlinedElement,
  Point,
  Scene,
  StrokeWidth,
} from './scene.js';
import { STROKE_WIDTH_PX } from './layout.js';
import type { Block, Box, Layout } from './layout.js';
import {
  arrowHeadTriangle,
  barThrough,
  centreOf,
  fillets,
  pointOnOutline,
  unit,
} from './geometry.js';

const INK = 'var(--ink)';
const MUTED = 'var(--muted)';
const PAPER = 'var(--paper)';
const FONT = 'var(--font-hand)';

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

export function renderScene(scene: Scene, layout: Layout): string {
  const canonical = canonicalScene(scene);
  const hash = hashScene(canonical);
  const byId = new Map(canonical.elements.map((element) => [element.id, element]));
  const page = pageBounds(canonical, byId, layout);
  const body = canonical.elements
    .map((element) => renderElement(element, byId, layout))
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}"` +
      ` viewBox="${page.x} ${page.y} ${page.width} ${page.height}"` +
      ` role="img" font-family="${FONT}" data-scene-hash="sha256:${hash}">`,
    `<title>${escapeXml(canonical.title)}</title>`,
    body,
    '</svg>',
    '',
  ].join('\n');
}

interface Page {
  x: number;
  y: number;
  width: number;
  height: number;
}

function pageBounds(scene: Scene, byId: Map<string, Element>, layout: Layout): Page {
  if (scene.elements.length === 0) {
    return { x: 0, y: 0, ...EMPTY_PAGE };
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const element of scene.elements) {
    const bounds = elementBounds(element, byId, layout);
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
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

function elementBounds(element: Element, byId: Map<string, Element>, layout: Layout): Box {
  switch (element.type) {
    case 'arrow':
    case 'line': {
      const [start, end] = arrowOrLinePoints(element, byId);
      const shaft = {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      };
      return joined(shaft, layout.label(element, { start, end }));
    }
    case 'text':
      return layout.text(element);
    default:
      return joined(
        { x: element.x, y: element.y, width: element.width, height: element.height },
        layout.label(element),
      );
  }
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

function midpointOf(from: Point, to: Point): Point {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

function renderElement(element: Element, byId: Map<string, Element>, layout: Layout): string {
  switch (element.type) {
    case 'arrow':
    case 'line':
      return renderArrowOrLine(element, byId, layout);
    case 'text':
      return renderBlock(layout.text(element), element.tone === 'muted' ? MUTED : INK);
    default:
      return renderOutlined(element, layout);
  }
}

/**
 * One outlined Element: its fill first, then its outline, so the ink of the
 * outline always sits on top of the fill it belongs to.
 */
function renderOutlined(element: OutlinedElement, layout: Layout): string {
  const generator = new RoughGenerator();
  const width = STROKE_WIDTH_PX[element.stroke.width];
  const strokeColour = element.tone === 'muted' ? MUTED : INK;
  const commonOptions: Options = {
    seed: element.seed,
    roughness: element.roughness,
    strokeWidth: width,
  };
  const paths: string[] = [];

  if (element.fill.kind !== 'none') {
    // A hachure or cross-hatch fill is drawn as lines, so it takes one step
    // more ink than a solid wash at the same grey. The gap follows the stroke
    // width, wide enough that a cross-hatch at roughness 2 keeps both
    // directions visible instead of filling in as a dense mesh.
    const lineFilled = element.fill.kind !== 'solid';
    const grey = lineFilled
      ? Math.min(element.fill.grey + 1, GREY_LAST)
      : element.fill.grey;
    const colour = greyColour(grey);
    const options: Options = {
      ...commonOptions,
      stroke: 'none',
      fill: colour,
      fillStyle: element.fill.kind,
      fillWeight: Math.max(1, width / 2),
      hachureGap: Math.max(8, width * 3),
    };
    for (const path of outlinedPaths(generator, element, options)) {
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

  const outlineOptions: Options = { ...commonOptions, stroke: strokeColour };
  const dash = strokeDash(width, element.stroke.style);
  for (const path of outlinedPaths(generator, element, outlineOptions)) {
    paths.push(
      `<path d="${pathData(path.d)}" fill="none" stroke="${path.stroke}"` +
        ` stroke-width="${formatNumber(path.strokeWidth)}"${dash}/>`,
    );
  }

  return (
    `<g stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</g>` +
    renderBlock(layout.label(element), strokeColour)
  );
}

/** The outline of an Element, drawn by Rough.js, with whatever options the pass needs. */
function outlinedPaths(
  generator: RoughGenerator,
  element: OutlinedElement,
  options: Options,
): PathInfo[] {
  switch (element.type) {
    case 'rectangle':
      return element.corners === 'round'
        ? generator.toPaths(generator.path(roundedPath(element), options))
        : generator.toPaths(
            generator.rectangle(element.x, element.y, element.width, element.height, options),
          );
    case 'ellipse':
      return generator.toPaths(
        generator.ellipse(
          element.x + element.width / 2,
          element.y + element.height / 2,
          element.width,
          element.height,
          options,
        ),
      );
    case 'diamond': {
      const centre = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
      return element.corners === 'round'
        ? generator.toPaths(generator.path(roundedPath(element), options))
        : generator.toPaths(
            generator.polygon(
              [
                [centre.x, element.y],
                [element.x + element.width, centre.y],
                [centre.x, element.y + element.height],
                [element.x, centre.y],
              ],
              options,
            ),
          );
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
 * its target's outline, resolved from the other end's point.
 */
function renderArrowOrLine(
  element: ArrowOrLineElement,
  byId: Map<string, Element>,
  layout: Layout,
): string {
  const generator = new RoughGenerator();
  const [start, end] = arrowOrLinePoints(element, byId);
  const width = STROKE_WIDTH_PX[element.stroke.width];
  const colour = element.tone === 'muted' ? MUTED : INK;
  const dash = fittedDash(
    width,
    element.stroke.style,
    Math.hypot(end.x - start.x, end.y - start.y),
  );
  const paths: string[] = [];

  const lineOptions: Options = {
    seed: element.seed,
    roughness: element.roughness,
    strokeWidth: width,
    stroke: colour,
    // A Snapped end must touch the outline it belongs to at every roughness, so
    // the drawn ends stay where the geometry put them.
    preserveVertices: true,
  };
  for (const path of generator.toPaths(generator.line(start.x, start.y, end.x, end.y, lineOptions))) {
    paths.push(
      `<path d="${pathData(path.d)}" fill="none" stroke="${path.stroke}"` +
        ` stroke-width="${formatNumber(path.strokeWidth)}"${dash}/>`,
    );
  }

  const headLength = HEAD_LENGTH_PX[element.stroke.width];
  const direction = { start: unit(end, start), end: unit(start, end) };
  for (const [kind, apex, along] of [
    [element.heads.start, start, direction.start],
    [element.heads.end, end, direction.end],
  ] as const) {
    paths.push(...headPaths(generator, element, kind, apex, along, headLength, colour));
  }

  return (
    `<g stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</g>` +
    renderBlock(layout.label(element, { start, end }), colour)
  );
}

/** One arrow head, pointing along the arrow with its apex on the end. */
function headPaths(
  generator: RoughGenerator,
  element: ArrowOrLineElement,
  kind: Head,
  apex: Point,
  direction: Point,
  length: number,
  colour: string,
): string[] {
  if (kind === 'none') {
    return [];
  }
  const headOptions: Options = {
    seed: element.seed,
    roughness: element.roughness,
    strokeWidth: STROKE_WIDTH_PX[element.stroke.width],
    stroke: colour,
  };
  if (kind === 'arrow') {
    const triangle = arrowHeadTriangle(apex, direction, length);
    return generator
      .toPaths(
        generator.polygon(
          triangle.map((point) => [point.x, point.y]),
          { ...headOptions, stroke: 'none', fill: colour, fillStyle: 'solid' },
        ),
      )
      .map((path) => `<path d="${pathData(path.d)}" fill="${colour}"/>`);
  }
  if (kind === 'dot') {
    return generator
      .toPaths(
        generator.circle(apex.x, apex.y, length * 0.75, {
          ...headOptions,
          stroke: 'none',
          fill: colour,
          fillStyle: 'solid',
        }),
      )
      .map((path) => `<path d="${pathData(path.d)}" fill="${colour}"/>`);
  }
  const [from, to] = barThrough(apex, direction, length * 0.6);
  return generator.toPaths(generator.line(from.x, from.y, to.x, to.y, headOptions)).map(
    (path) =>
      `<path d="${pathData(path.d)}" fill="none" stroke="${path.stroke}"` +
      ` stroke-width="${formatNumber(path.strokeWidth)}"/>`,
  );
}

/**
 * Both ends of an arrow or line, with each Snapped end moved onto its target's
 * outline. An end aims at the other end: at the other target's centre when that
 * end is Snapped too, so both ends aim along the line between the two targets
 * as they are now, or from where the free end sits.
 */
function arrowOrLinePoints(
  element: ArrowOrLineElement,
  byId: Map<string, Element>,
): [Point, Point] {
  const [start, end] = element.points;
  const startTarget = snapTarget(element, start, byId);
  const endTarget = snapTarget(element, end, byId);
  const from = snappedEnd(start, startTarget, endTarget, end);
  const to = snappedEnd(end, endTarget, startTarget, start);
  if (
    startTarget !== undefined &&
    endTarget !== undefined &&
    runsAgainst(from, to, centreOf(startTarget), centreOf(endTarget))
  ) {
    // The two targets overlap along the line between their centres, so their
    // outline points sit the wrong way round and the head would point out of
    // the second target. Draw from the first target's exit point to the second
    // target's centre instead, so the head still points into it.
    return [from, centreOf(endTarget)];
  }
  return [from, to];
}

/** Whether the drawn shaft runs against the line from the first centre to the second. */
function runsAgainst(from: Point, to: Point, fromCentre: Point, toCentre: Point): boolean {
  const along = { x: to.x - from.x, y: to.y - from.y };
  const between = { x: toCentre.x - fromCentre.x, y: toCentre.y - fromCentre.y };
  return along.x * between.x + along.y * between.y < 0;
}

/**
 * The Element a Snapped end is drawn on, or undefined for a free end. A Snap
 * the Scene could not honour is an error naming the arrow or line and the
 * target it asked for: parseScene rejects those Scenes, so only a Scene built in
 * memory reaches this, and it must not draw a free end while still claiming a
 * Snap.
 */
function snapTarget(
  element: ArrowOrLineElement,
  point: Point,
  byId: Map<string, Element>,
): OutlinedElement | undefined {
  if (point.snap === undefined) {
    return undefined;
  }
  const target = byId.get(point.snap);
  if (target === undefined) {
    throw new Error(`${element.id}: snap target "${point.snap}" does not exist`);
  }
  if (!isOutlined(target)) {
    throw new Error(
      `${element.id}: snap target "${point.snap}" must be a rectangle, ellipse or diamond`,
    );
  }
  return target;
}

/** One end, moved onto its target's outline, aiming at the other end. */
function snappedEnd(
  point: Point,
  target: OutlinedElement | undefined,
  otherTarget: OutlinedElement | undefined,
  freeEnd: Point,
): Point {
  if (target === undefined) {
    return { x: point.x, y: point.y };
  }
  return pointOnOutline(target, otherTarget === undefined ? freeEnd : centreOf(otherTarget));
}

/**
 * Measured words as one `<text>` per line, on the baseline and at the anchor
 * Layout placed them on. A blank line takes its space and draws nothing.
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
        ` fill="${colour}">${escapeXml(line.text)}</text>`,
    )
    .join('');
}

/**
 * One grey step as a fixed mix of ink into paper. Grey 0 is bare paper and grey
 * 6 is solid ink; the steps between are opaque colours, so two overlapping
 * fills keep one grey and a host backdrop never shows through.
 */
function greyColour(grey: number): string {
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
