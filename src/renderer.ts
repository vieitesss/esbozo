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
 * fill so the two read as the same weight. The Scene hash is written into
 * `data-scene-hash` so an SVG can always be traced back to the Scene it came
 * from, and the root `<svg role="img">` carries its accessible name as its own
 * first-child `<title>`, with no document-wide id to collide with.
 *
 * A Snapped arrow or line end is resolved against its target's outline here
 * (`geometry.ts` does the maths), and its head sits on that end pointing along
 * the arrow, into the target.
 */
import { RoughGenerator } from 'roughjs/bin/generator.js';
import type { Options, PathInfo } from 'roughjs/bin/core.js';
import { canonicalScene, hashScene, isOutlined } from './scene.js';
import type {
  ArrowOrLineElement,
  Element,
  FontSize,
  Head,
  OutlinedElement,
  Point,
  Scene,
  StrokeWidth,
  TextElement,
} from './scene.js';
import {
  CORNER_RADIUS,
  arrowHeadTriangle,
  barThrough,
  pointOnOutline,
  unit,
} from './geometry.js';

const INK = 'var(--ink)';
const MUTED = 'var(--muted)';
const PAPER = 'var(--paper)';
const FONT = 'var(--font-hand)';

/** Stroke width per named width, in pixels. */
const STROKE_WIDTH_PX: Record<StrokeWidth, number> = { thin: 1, bold: 2, extra: 4 };
/** Arrow head length per stroke width, in pixels. */
const HEAD_LENGTH_PX: Record<StrokeWidth, number> = { thin: 9, bold: 13, extra: 18 };
/** Font size per named size, in pixels. */
const FONT_SIZE_PX: Record<FontSize, number> = { S: 14, M: 18, L: 24, XL: 32 };

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

/** Line height of Text, as a multiple of its font size, until #4 measures the font. */
const TEXT_LINE_HEIGHT = 1.25;
/** Rough advance width of one character, as a fraction of the font size, until #4 measures the font. */
const TEXT_CHAR_WIDTH = 0.55;

export function renderScene(scene: Scene): string {
  const canonical = canonicalScene(scene);
  const hash = hashScene(canonical);
  const byId = new Map(canonical.elements.map((element) => [element.id, element]));
  const page = pageBounds(canonical, byId);
  const body = canonical.elements.map((element) => renderElement(element, byId)).join('');

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

function pageBounds(scene: Scene, byId: Map<string, Element>): Page {
  if (scene.elements.length === 0) {
    return { x: 0, y: 0, ...EMPTY_PAGE };
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const element of scene.elements) {
    const bounds = elementBounds(element, byId);
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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function elementBounds(element: Element, byId: Map<string, Element>): Box {
  switch (element.type) {
    case 'arrow':
    case 'line': {
      const [start, end] = arrowOrLinePoints(element, byId);
      return {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      };
    }
    case 'text':
      return textBounds(element);
    default:
      return { x: element.x, y: element.y, width: element.width, height: element.height };
  }
}

/**
 * Provisional Text extent, so a Text fits its page and its alignment has an
 * edge to align to. #4 Layout replaces it with measurement of the real font;
 * until then it is a rough advance width, not measurement.
 */
function textBounds(element: TextElement): Box {
  const size = FONT_SIZE_PX[element.fontSize];
  const lines = element.content.split('\n');
  const width = Math.max(...lines.map((line) => [...line].length)) * size * TEXT_CHAR_WIDTH;
  const height = lines.length * size * TEXT_LINE_HEIGHT;
  const x =
    element.textAlign === 'left'
      ? element.x
      : element.textAlign === 'center'
        ? element.x - width / 2
        : element.x - width;
  return { x, y: element.y, width, height };
}

function renderElement(element: Element, byId: Map<string, Element>): string {
  switch (element.type) {
    case 'arrow':
    case 'line':
      return renderArrowOrLine(element, byId);
    case 'text':
      return renderText(element);
    default:
      return renderOutlined(element);
  }
}

/**
 * One outlined Element: its fill first, then its outline, so the ink of the
 * outline always sits on top of the fill it belongs to.
 */
function renderOutlined(element: OutlinedElement): string {
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
    // A hachure or cross-hatch fill is drawn as lines, so it needs one step
    // more ink than a solid wash to read as the same grey.
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

  return `<g stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</g>`;
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
        ? generator.toPaths(generator.path(roundedRectPath(element), options))
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
      return generator.toPaths(
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

/** A rounded rectangle as SVG path data, so Rough.js can draw and fill it like any other outline. */
function roundedRectPath(element: OutlinedElement): string {
  const x = element.x;
  const y = element.y;
  const width = element.width;
  const height = element.height;
  const r = Math.min(CORNER_RADIUS, width / 2, height / 2);
  return [
    `M ${formatNumber(x + r)} ${formatNumber(y)}`,
    `L ${formatNumber(x + width - r)} ${formatNumber(y)}`,
    `A ${formatNumber(r)} ${formatNumber(r)} 0 0 1 ${formatNumber(x + width)} ${formatNumber(y + r)}`,
    `L ${formatNumber(x + width)} ${formatNumber(y + height - r)}`,
    `A ${formatNumber(r)} ${formatNumber(r)} 0 0 1 ${formatNumber(x + width - r)} ${formatNumber(y + height)}`,
    `L ${formatNumber(x + r)} ${formatNumber(y + height)}`,
    `A ${formatNumber(r)} ${formatNumber(r)} 0 0 1 ${formatNumber(x)} ${formatNumber(y + height - r)}`,
    `L ${formatNumber(x)} ${formatNumber(y + r)}`,
    `A ${formatNumber(r)} ${formatNumber(r)} 0 0 1 ${formatNumber(x + r)} ${formatNumber(y)}`,
    'Z',
  ].join(' ');
}

/**
 * One arrow or line: its shaft, then its heads on top. A Snapped end sits on
 * its target's outline, resolved from the other end's point.
 */
function renderArrowOrLine(element: ArrowOrLineElement, byId: Map<string, Element>): string {
  const generator = new RoughGenerator();
  const [start, end] = arrowOrLinePoints(element, byId);
  const width = STROKE_WIDTH_PX[element.stroke.width];
  const colour = element.tone === 'muted' ? MUTED : INK;
  const dash = strokeDash(width, element.stroke.style);
  const paths: string[] = [];

  const lineOptions: Options = {
    seed: element.seed,
    roughness: element.roughness,
    strokeWidth: width,
    stroke: colour,
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

  return `<g stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</g>`;
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
 * outline along the line from the other end's point towards the target centre.
 */
function arrowOrLinePoints(
  element: ArrowOrLineElement,
  byId: Map<string, Element>,
): [Point, Point] {
  const [start, end] = element.points;
  const resolve = (point: Point, other: Point): Point => {
    if (point.snap === undefined) {
      return { x: point.x, y: point.y };
    }
    const target = byId.get(point.snap);
    if (target === undefined || !isOutlined(target)) {
      // parseScene already rejected this Scene; draw the end where it was asked.
      return { x: point.x, y: point.y };
    }
    return pointOnOutline(target, other);
  };
  return [resolve(start, end), resolve(end, start)];
}

/**
 * Free-standing Text: its content, one line per `\n`, at its font size and
 * alignment. `x` is the aligned edge, `y` the top of the first line. Font size
 * and alignment are the only style fields Text uses.
 */
function renderText(element: TextElement): string {
  const size = FONT_SIZE_PX[element.fontSize];
  const anchor =
    element.textAlign === 'left' ? 'start' : element.textAlign === 'center' ? 'middle' : 'end';
  const colour = element.tone === 'muted' ? MUTED : INK;
  const lines = element.content.split('\n');
  const spans = lines
    .map((line, index) => {
      const dy = index === 0 ? 0 : size * TEXT_LINE_HEIGHT;
      return `<tspan x="${formatNumber(element.x)}" dy="${formatNumber(dy)}">${escapeXml(line)}</tspan>`;
    })
    .join('');
  return (
    `<text x="${formatNumber(element.x)}" y="${formatNumber(element.y + size)}"` +
    ` font-size="${formatNumber(size)}" text-anchor="${anchor}" fill="${colour}">${spans}</text>`
  );
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
