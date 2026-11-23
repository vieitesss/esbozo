import { parse as parseFont } from 'opentype.js';
import { shaftSide } from './geometry.js';
import { glyphsOf } from './glyphs.js';
import type { Curve, Glyphs } from './glyphs.js';
import type {
  Element,
  FontSize,
  OutlinedElement,
  Point,
  StrokeWidth,
  TextAlign,
  TextElement,
} from './scene.js';

const FONT_SIZE_PX: Record<FontSize, number> = { S: 14, M: 18, L: 24, XL: 32 };

export const STROKE_WIDTH_PX: Record<StrokeWidth, number> = { thin: 1, bold: 2, extra: 4 };

const LABEL_PADDING = 8;

const SHAFT_LABEL_GAP = 4;

const ELLIPSE_FRACTION = Math.SQRT1_2;

const DIAMOND_FRACTION = 0.5;

const GROW_ROUNDS = 8;

/** Floating-point slack, so a Label that fits to the last thousandth is not reported as overflowing. */
const EPSILON = 0.01;

const GLYPH_GAP = 0.5;

/** The font units per em a file is assumed to use when it does not say. */
const DEFAULT_UNITS_PER_EM = 1000;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Shaft {
  start: Point;
  end: Point;
}

export interface Line {
  text: string;
  x: number;
  baseline: number;
  /**
   * The offset in the words of every glyph boundary this line draws: one more
   * than its characters, so a caret between any two glyphs has one place. A run
   * of spaces a wrapped line swallowed is one drawn space, and the boundary
   * after it is where the next word starts.
   */
  boundaries: readonly number[];
  top: number;
  height: number;
}

export interface Block extends Box {
  size: number;
  anchor: 'start' | 'middle' | 'end';
  lines: Line[];
}

interface Caret {
  readonly line: number;
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

interface Written {
  text: string;
  runs: readonly Run[];
  width?: number;
}

interface Run {
  at: number;
  length: number;
}

interface Overflow {
  elementId: string;
  message: string;
}

export interface Metrics {
  advance(text: string, size: number): number;
  lineHeight(size: number): number;
  inkCentre(size: number): number;
}

export interface ParsedFont {
  /** The family name the file gives, which is the family resvg draws it as. */
  family: string;
  glyphCount?: number;
  metrics: Metrics;
  glyphs?: Glyphs;
}

export function parseFontFile(bytes: Uint8Array): ParsedFont {
  const font = parseFont(arrayBufferOf(bytes));
  const unitsPerEm = font.unitsPerEm > 0 ? font.unitsPerEm : DEFAULT_UNITS_PER_EM;
  const os2 = font.tables.os2;
  // A text engine uses OS/2's typographic metrics; a file without them falls
  // back to the hhea values opentype.js already read.
  const ascender = os2?.sTypoAscender ?? font.ascender;
  const descender = os2?.sTypoDescender ?? font.descender;
  const lineGap = os2?.sTypoLineGap ?? 0;
  const lineHeightEm =
    ascender - descender > 0 ? (ascender - descender + lineGap) / unitsPerEm : 1;
  const inkCentreEm = (ascender + descender) / 2 / unitsPerEm;
  const advance = (text: string, size: number): number =>
    font.getAdvanceWidth(text, size, { kerning: true });
  return {
    family: font.getEnglishName('fontFamily')?.trim() ?? '',
    glyphCount: font.glyphs.length,
    metrics: {
      advance,
      lineHeight: (size) => size * lineHeightEm,
      inkCentre: (size) => size * inkCentreEm,
    },
    glyphs: glyphsOf({
      advance,
      curves: (text, x, baseline, size) =>
        font.getPath(text, x, baseline, size, { kerning: true }).commands as readonly Curve[],
    }),
  };
}

export interface GlyphBox {
  readonly left: number;
  readonly right: number;
}

export interface DrawnLine {
  readonly boundaries: readonly number[];
  readonly glyphs: readonly GlyphBox[];
}

/**
 * Where the drawing put one line's glyph boundaries and the box of each of its
 * glyphs, as the engine that draws them laid them out: one more boundary than
 * the line's characters, so a caret between any two glyphs has one place.
 * Layout cannot answer this from the font file — a glyph the font lacks is a
 * fallback font's, and a run that reads right to left is laid out right to
 * left — so the caller that draws the words hands in where its glyphs went.
 */
export type LineGlyphs = (line: Line) => DrawnLine;

export interface Layout {
  text(element: TextElement): Block;
  label(element: Element, shaft?: Shaft): Block | null;
  overflow(element: Element): Overflow | null;
  grow<T extends Element>(element: T): T;
  caret(block: Block, offset: number, glyphs: LineGlyphs): Caret;
  selection(block: Block, from: number, to: number, glyphs: LineGlyphs): Box[];
  offsetAt(block: Block, point: Point, glyphs: LineGlyphs): number;
  glyphs?: Glyphs;
}

export function createLayout(parsed: ParsedFont): Layout {
  const metrics = parsed.metrics;
  const layout: Layout = {
    text: (element) => textBlock(element, metrics),
    label: (element, shaft) => labelBlock(element, metrics, shaft),
    overflow: (element) => labelOverflow(element, metrics),
    grow: (element) => grown(element, metrics),
    caret: (block, offset, glyphs) => caretAt(block, offset, glyphs),
    selection: (block, from, to, glyphs) => selectionAt(block, from, to, glyphs),
    offsetAt: (block, point, glyphs) => offsetAt(block, point, glyphs),
    ...(parsed.glyphs === undefined ? {} : { glyphs: parsed.glyphs }),
  };
  return layout;
}

interface MeasuredLine extends Written {
  width: number;
}

interface Measured {
  size: number;
  lines: MeasuredLine[];
  width: number;
  height: number;
  lineHeight: number;
  inkCentre: number;
}

function measured(text: string, size: number, maxWidth: number | null, metrics: Metrics): Measured {
  const written = maxWidth === null ? writtenLines(text) : breakLines(text, maxWidth, size, metrics);
  const lines = written.map((line) => ({
    ...line,
    width: line.width ?? metrics.advance(line.text, size),
  }));
  const lineHeight = metrics.lineHeight(size);
  return {
    size,
    lines,
    width: lines.reduce((widest, line) => Math.max(widest, line.width), 0),
    height: lines.length * lineHeight,
    lineHeight,
    inkCentre: metrics.inkCentre(size),
  };
}

function placed(
  words: Measured,
  anchor: Block['anchor'],
  alignX: number,
  top: number,
): Block {
  return {
    x: leftOf(alignX, words.width, anchor),
    y: top,
    width: words.width,
    height: words.height,
    size: words.size,
    anchor,
    lines: words.lines.map((line, index) => ({
      text: line.text,
      boundaries: line.runs.flatMap((run) => boundaryRun(run.at, run.length)),
      x: alignX,
      baseline: top + words.lineHeight * (index + 0.5) + words.inkCentre,
      top: top + words.lineHeight * index,
      height: words.lineHeight,
    })),
  };
}

function textBlock(element: TextElement, metrics: Metrics): Block {
  const words = measured(element.content, FONT_SIZE_PX[element.fontSize], null, metrics);
  const anchor = anchorFor(element.textAlign);
  return placed(words, anchor, element.x, element.y);
}

function labelBlock(
  element: Element,
  metrics: Metrics,
  shaft: Shaft | undefined,
): Block | null {
  if (element.type === 'text' || element.label === undefined) {
    return null;
  }
  const size = FONT_SIZE_PX[element.fontSize];
  if (element.type === 'arrow' || element.type === 'line') {
    if (shaft === undefined) {
      throw new Error(`${element.id}: a shaft Label needs the shaft that is drawn`);
    }
    const words = measured(element.label, size, null, metrics);
    const middle = midpoint(shaft.start, shaft.end);
    const side = shaftSide({ x: shaft.end.x - shaft.start.x, y: shaft.end.y - shaft.start.y });
    const reach =
      SHAFT_LABEL_GAP + Math.abs(side.x) * (words.width / 2) + Math.abs(side.y) * (words.height / 2);
    const centre = {
      x: middle.x + side.x * reach,
      y: middle.y + side.y * reach,
    };
    const anchor = anchorFor(element.textAlign);
    const left = centre.x - words.width / 2;
    const alignX = left + anchorOffset(words.width, anchor);
    return placed(words, anchor, alignX, centre.y - words.height / 2);
  }

  const area = labelArea(element);
  const words = measured(element.label, size, area.width, metrics);
  const anchor = anchorFor(element.textAlign);
  const alignX = area.x + anchorOffset(area.width, anchor);
  const top = area.y + (area.height - words.height) / 2;
  return placed(words, anchor, alignX, top);
}

function labelArea(element: OutlinedElement): Box {
  const fraction = outlineFraction(element);
  const pad = LABEL_PADDING + STROKE_WIDTH_PX[element.stroke.width];
  const width = Math.max(1, element.width * fraction - 2 * pad);
  const height = Math.max(1, element.height * fraction - 2 * pad);
  return {
    x: element.x + (element.width - width) / 2,
    y: element.y + (element.height - height) / 2,
    width,
    height,
  };
}

function outlineFraction(element: OutlinedElement): number {
  return element.type === 'ellipse'
    ? ELLIPSE_FRACTION
    : element.type === 'diamond'
      ? DIAMOND_FRACTION
      : 1;
}

function labelOverflow(element: Element, metrics: Metrics): Overflow | null {
  if (element.type === 'text' || element.label === undefined) {
    return null;
  }
  if (element.type === 'arrow' || element.type === 'line') {
    return null;
  }
  const area = labelArea(element);
  const words = measured(element.label, FONT_SIZE_PX[element.fontSize], area.width, metrics);
  const tooTall = words.height > area.height + EPSILON;
  const tooWide = words.width > area.width + EPSILON;
  if (!tooTall && !tooWide) {
    return null;
  }
  const parts: string[] = [];
  if (tooTall) {
    const count = words.lines.length;
    parts.push(
      `${count} line${count === 1 ? ' needs' : 's need'} ${round(words.height)}px,` +
        ` the text box is ${round(area.height)}px tall`,
    );
  }
  if (tooWide) {
    parts.push(
      `the longest line needs ${round(words.width)}px, the text box is ${round(area.width)}px wide`,
    );
  }
  return {
    elementId: element.id,
    message: `label does not fit: ${parts.join(', and ')}`,
  };
}

function grown<T extends Element>(element: T, metrics: Metrics): T {
  if (element.type === 'text' || element.type === 'arrow' || element.type === 'line') {
    return element;
  }
  if (element.label === undefined) {
    return element;
  }
  const fraction = outlineFraction(element);
  let width = element.width;
  let height = element.height;
  for (let round = 0; round < GROW_ROUNDS; round += 1) {
    const candidate: OutlinedElement = { ...element, width, height };
    const area = labelArea(candidate);
    const words = measured(element.label, FONT_SIZE_PX[element.fontSize], area.width, metrics);
    const deficitWidth = words.width - area.width;
    const deficitHeight = words.height - area.height;
    let grew = false;
    if (deficitHeight > EPSILON) {
      height += Math.ceil(deficitHeight / fraction);
      grew = true;
    }
    if (deficitWidth > EPSILON) {
      width += Math.ceil(deficitWidth / fraction);
      grew = true;
    }
    if (!grew) {
      return { ...element, width, height };
    }
  }
  return { ...element, width, height };
}

function writtenLines(text: string): Written[] {
  const lines: Written[] = [];
  let start = 0;
  for (const line of text.split('\n')) {
    lines.push({ text: line, runs: [{ at: start, length: line.length }] });
    start += line.length + 1;
  }
  return lines;
}

function boundaryRun(from: number, length: number): number[] {
  return Array.from({ length: length + 1 }, (_, step) => from + step);
}

function wordRuns(paragraph: string, from: number): { text: string; at: number }[] {
  return Array.from(paragraph.matchAll(/[^ \t]+/g), (match) => ({
    text: match[0] ?? '',
    at: from + (match.index ?? 0),
  }));
}

function breakLines(text: string, maxWidth: number, size: number, metrics: Metrics): Written[] {
  const lines: Written[] = [];
  let paragraphStart = 0;
  for (const paragraph of text.split('\n')) {
    const words = wordRuns(paragraph, paragraphStart);
    const first = words[0];
    if (first === undefined) {
      lines.push({ text: '', runs: [{ at: paragraphStart, length: 0 }] });
    } else {
      let line: Written = {
        text: first.text,
        runs: [{ at: first.at, length: first.text.length }],
      };
      for (const word of words.slice(1)) {
        const candidate = `${line.text} ${word.text}`;
        const width = metrics.advance(candidate, size);
        if (width <= maxWidth) {
          line = {
            text: candidate,
            runs: [...line.runs, { at: word.at, length: word.text.length }],
            width,
          };
        } else {
          lines.push(line);
          line = { text: word.text, runs: [{ at: word.at, length: word.text.length }] };
        }
      }
      lines.push(line);
    }
    paragraphStart += paragraph.length + 1;
  }
  return lines;
}

function caretAt(block: Block, offset: number, glyphs: LineGlyphs): Caret {
  const index = lineAt(block.lines, offset);
  const line = block.lines[index]!;
  return {
    line: index,
    x: boundaryX(glyphs(line).boundaries, columnAt(line, offset), line.x),
    y: line.top,
    height: line.height,
  };
}

function boundaryX(xs: readonly number[], column: number, anchor: number): number {
  return xs[Math.min(column, xs.length - 1)] ?? anchor;
}

function selectionAt(
  block: Block,
  from: number,
  to: number,
  glyphs: LineGlyphs,
): Box[] {
  const [start, end] = from <= to ? [from, to] : [to, from];
  if (start === end) {
    return [];
  }
  const boxes: Box[] = [];
  for (const line of block.lines) {
    const first = line.boundaries[0]!;
    const last = line.boundaries[line.boundaries.length - 1]!;
    if (end < first || start > last) {
      continue;
    }
    const drawn = glyphs(line);
    const one = columnAt(line, Math.max(start, first));
    const other = columnAt(line, Math.min(end, last));
    for (const run of inkRuns(drawn.glyphs.slice(one, other))) {
      boxes.push({
        x: run.left,
        y: line.top,
        width: run.right - run.left,
        height: line.height,
      });
    }
  }
  return boxes;
}

function inkRuns(glyphs: readonly GlyphBox[]): GlyphBox[] {
  const ordered = [...glyphs].sort((one, other) => one.left - other.left);
  const runs: GlyphBox[] = [];
  for (const glyph of ordered) {
    const run = runs[runs.length - 1];
    if (run !== undefined && glyph.left <= run.right + GLYPH_GAP) {
      runs[runs.length - 1] = { left: run.left, right: Math.max(run.right, glyph.right) };
    } else {
      runs.push({ left: glyph.left, right: glyph.right });
    }
  }
  return runs;
}

function offsetAt(block: Block, point: Point, glyphs: LineGlyphs): number {
  const line = nearestLine(block.lines, point.y);
  const drawn = glyphs(line);
  const hit = nearestGlyph(drawn.glyphs, point.x);
  if (hit === null) {
    return line.boundaries[0]!;
  }
  const { index, glyph } = hit;
  const middle = (glyph.left + glyph.right) / 2;
  const start = drawn.boundaries[index] ?? glyph.left;
  const backwards = Math.abs(start - glyph.right) < Math.abs(start - glyph.left);
  const after = backwards ? point.x <= middle : point.x >= middle;
  return line.boundaries[Math.min(after ? index + 1 : index, line.boundaries.length - 1)]!;
}

function nearestGlyph(
  glyphs: readonly GlyphBox[],
  x: number,
): { index: number; glyph: GlyphBox } | null {
  let nearest: { index: number; glyph: GlyphBox } | null = null;
  let reach = Number.POSITIVE_INFINITY;
  for (const [index, glyph] of glyphs.entries()) {
    const distance = x < glyph.left ? glyph.left - x : x > glyph.right ? x - glyph.right : 0;
    if (distance < reach) {
      reach = distance;
      nearest = { index, glyph };
    }
  }
  return nearest;
}

function lineAt(lines: readonly Line[], offset: number): number {
  for (let index = 0; index < lines.length; index += 1) {
    const boundaries = lines[index]!.boundaries;
    if (offset <= boundaries[boundaries.length - 1]!) {
      return index;
    }
  }
  return lines.length - 1;
}

function columnAt(line: Line, offset: number): number {
  let column = 0;
  for (let index = 0; index < line.boundaries.length; index += 1) {
    if (line.boundaries[index]! > offset) {
      break;
    }
    column = index;
  }
  return column;
}

function nearestLine(lines: readonly Line[], y: number): Line {
  let nearest = lines[0]!;
  let reach = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    const distance = y < line.top ? line.top - y : y > line.top + line.height ? y - line.top - line.height : 0;
    if (distance < reach) {
      reach = distance;
      nearest = line;
    }
  }
  return nearest;
}

function anchorFor(align: TextAlign): Block['anchor'] {
  return align === 'left' ? 'start' : align === 'center' ? 'middle' : 'end';
}

function leftOf(alignX: number, width: number, anchor: Block['anchor']): number {
  return alignX - anchorOffset(width, anchor);
}

function anchorOffset(width: number, anchor: Block['anchor']): number {
  return anchor === 'start' ? 0 : anchor === 'middle' ? width / 2 : width;
}

function midpoint(from: Point, to: Point): Point {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** A copy of the bytes as the ArrayBuffer opentype.js parses. */
function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
