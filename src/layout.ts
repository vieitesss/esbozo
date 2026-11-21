/**
 * Layout: the words in a Scene, measured with a real font and placed.
 *
 * One module answers every question about text, so the Renderer, `ez check`
 * and the editor agree: how wide a line is, where a Label wraps, where its
 * lines sit inside an Element, whether it fits, and how the Element has to grow
 * to hold it. It runs in the browser as well as in the CLI, so it reads font
 * bytes and never the filesystem: the caller loads the font — the bundled
 * Kalam, a `--font` file, or the URL the host passes the editor — and hands the
 * bytes to `parseFontFile`.
 *
 * The font supplies the vertical metrics too, not just the advances: the line
 * height comes from its ascender, descender and line gap, and a line's ink is
 * centred on that same box. A font with tall glyphs takes tall lines and its
 * words stop fitting sooner, which is what `ez check` reports.
 *
 * A rectangle's, ellipse's or diamond's Label wraps inside the largest centred
 * box that fits the outline: the whole box for a rectangle, half of each side
 * for a diamond, and a square of `1/√2` of each side for an ellipse. What does
 * not fit overflows, and `overflow` says what and by how much: the drawing
 * still draws it, `ez check` reports it, and the editor outlines it in red. An
 * Element grows only when someone asks (`grow`), which is the editor's job
 * while typing: the Scene keeps the size the author gave it.
 *
 * An arrow's or line's Label has no box to wrap in, so it only breaks where the
 * author wrote a newline, and each line is measured once. It sits on one side
 * of the shaft — above it, or to the left when the shaft is vertical — far
 * enough out that the words clear the line at any heading. The Renderer passes
 * the drawn shaft in, because Snap moves the ends.
 *
 * A newline is a line break the author asked for; a run of ASCII spaces or tabs
 * is where a wrapped line may break; every other character, a non-breaking
 * space or an em space among them, stays on the line it was written on.
 */
import { parse as parseFont } from 'opentype.js';
import { glyphsOf } from './glyphs.js';
import type { Curve, Glyphs } from './glyphs.js';
import type {
  ArrowOrLineElement,
  Element,
  FontSize,
  OutlinedElement,
  Point,
  StrokeWidth,
  TextAlign,
  TextElement,
} from './scene.js';

/** Font size per named size, in pixels. */
const FONT_SIZE_PX: Record<FontSize, number> = { S: 14, M: 18, L: 24, XL: 32 };

/** The pixels a named Text or Label size draws at, for anything that has to match it. */
export function fontSizePx(size: FontSize): number {
  return FONT_SIZE_PX[size];
}

/** Stroke width per named width, in pixels. */
export const STROKE_WIDTH_PX: Record<StrokeWidth, number> = { thin: 1, bold: 2, extra: 4 };

/** Room between the words and the outline, per side, in pixels, before the stroke width. */
const LABEL_PADDING = 8;

/** Room between an arrow's or line's words and the ink of its shaft, in pixels. */
const SHAFT_LABEL_GAP = 4;

/** The largest centred box inside an ellipse, as a fraction of each side. */
const ELLIPSE_FRACTION = Math.SQRT1_2;

/** The largest centred box inside a diamond, as a fraction of each side. */
const DIAMOND_FRACTION = 0.5;

/** How many times `grow` may widen and heighten before it gives up. Each round shrinks the deficit. */
const GROW_ROUNDS = 8;

/** Floating-point slack, so a Label that fits to the last thousandth is not reported as overflowing. */
const EPSILON = 0.01;

/** The font units per em a file is assumed to use when it does not say. */
const DEFAULT_UNITS_PER_EM = 1000;

/** A rectangle in Scene coordinates. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The two ends of the shaft an arrow or line draws, after Snap moved them. */
export interface Shaft {
  start: Point;
  end: Point;
}

/** One measured line: where it starts and where its baseline sits. */
interface Line {
  text: string;
  x: number;
  baseline: number;
}

/** Words placed in a Scene: their lines, the size they draw at and the box they occupy. */
export interface Block extends Box {
  size: number;
  /** `text-anchor` for every line. */
  anchor: 'start' | 'middle' | 'end';
  lines: Line[];
}

/** A Label that does not fit the Element it belongs to. */
interface Overflow {
  elementId: string;
  message: string;
}

/**
 * A font measured once, in pixels: the one thing Layout needs from the outside.
 * Bytes in, numbers out, so the same module measures in the CLI and the editor.
 */
export interface Metrics {
  /** Advance width of one line at a font size. */
  advance(text: string, size: number): number;
  /** Baseline-to-baseline distance at a font size. */
  lineHeight(size: number): number;
  /** Where a line's ink sits above its baseline at a font size. */
  inkCentre(size: number): number;
}

/** A font parsed once: how to measure with it, and what the file itself says. */
export interface ParsedFont {
  /** The family name the file gives, which is the family resvg draws it as. */
  family: string;
  /**
   * How many glyphs the file holds, so a file with none is caught before
   * drawing. A reader that only measures the font does not count them.
   */
  glyphCount?: number;
  metrics: Metrics;
  /**
   * The same parse, as the font's own outlines: what a PNG draws its words with.
   * A page that only measures its font has none, and cannot draw a PNG of words.
   */
  glyphs?: Glyphs;
}

/**
 * Parses a font file once. The advances, the vertical metrics, the family name,
 * the glyph count and the outlines all come from this one parse, so a caller
 * that validates a font, measures with it and then draws its words reads the
 * file exactly once.
 */
export function parseFontFile(bytes: Uint8Array): ParsedFont {
  const font = parseFont(arrayBufferOf(bytes));
  const unitsPerEm = font.unitsPerEm > 0 ? font.unitsPerEm : DEFAULT_UNITS_PER_EM;
  const os2 = font.tables.os2;
  // A text engine uses OS/2's typographic metrics; a file without them falls
  // back to the hhea values opentype.js already read.
  const ascender = os2?.sTypoAscender ?? font.ascender;
  const descender = os2?.sTypoDescender ?? font.descender;
  const lineGap = os2?.sTypoLineGap ?? 0;
  // A file with no vertical metrics at all still gets one em between baselines,
  // so its lines stay apart instead of stacking on one another.
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

/**
 * The questions a Scene's words raise, answered with one font.
 *
 * `text` and `label` return placed words; `overflow` says what does not fit;
 * `grow` gives an Element the room it needs. Nothing here changes a Scene: the
 * caller decides whether to apply the growth.
 */
export interface Layout {
  /** Free-standing Text: its lines, and the box they occupy from `y` down. */
  text(element: TextElement): Block;
  /**
   * The Label of a container, arrow or line, wrapped and placed; null when the
   * Element has no Label or is a Text. A shaft's Label sits beside the shaft the
   * drawing makes, so `shaft` is required for an arrow or line: Snap moves its
   * ends, and the words belong to the line that is really drawn.
   */
  label(element: Element, shaft?: Shaft): Block | null;
  /**
   * The box an Element's Label may fill, or null for an Element with no box: a
   * Text is only words, and an arrow's or line's Label sits beside the shaft.
   * The editor sizes the place a person types a Label in with this, so the
   * words wrap where they will wrap in the Scene.
   */
  area(element: Element): Box | null;
  /** The Label that does not fit its Element, or null when it fits or there is none. */
  overflow(element: Element): Overflow | null;
  /** The Element grown down and right until its Label fits. Elements without one come back unchanged. */
  grow<T extends Element>(element: T): T;
  /**
   * The lines this Layout placed, as the font's own curves. A PNG draws these
   * instead of `<text>`, so the words it rasterises are the words it measured.
   * A page that only measures its font has none.
   */
  glyphs?: Glyphs;
}

/** Builds the Layout for one parsed font: measuring and outlining from one parse. */
export function createLayout(parsed: ParsedFont): Layout {
  const metrics = parsed.metrics;
  const layout: Layout = {
    text: (element) => textBlock(element, metrics),
    label: (element, shaft) => labelBlock(element, metrics, shaft),
    area: (element) => (isTextOrShaft(element) ? null : labelArea(element)),
    overflow: (element) => labelOverflow(element, metrics),
    grow: (element) => grown(element, metrics),
    ...(parsed.glyphs === undefined ? {} : { glyphs: parsed.glyphs }),
  };
  return layout;
}

/** Words measured once: how they break, how big they are and how far apart the lines sit. */
interface Measured {
  size: number;
  lines: string[];
  width: number;
  height: number;
  lineHeight: number;
  inkCentre: number;
}

/**
 * Measures one piece of text once. `maxWidth` is the box a container's Label
 * wraps inside, or null for words that only break where the author wrote a
 * newline: free-standing Text and the Label of an arrow or line.
 */
function measured(text: string, size: number, maxWidth: number | null, metrics: Metrics): Measured {
  const lines = maxWidth === null ? writtenLines(text) : breakLines(text, maxWidth, size, metrics);
  const lineHeight = metrics.lineHeight(size);
  return {
    size,
    lines,
    width: widestLine(lines, size, metrics),
    height: lines.length * lineHeight,
    lineHeight,
    inkCentre: metrics.inkCentre(size),
  };
}

/** The words as a Block: each line on its baseline, centred on its ink in the box. */
function placed(words: Measured, anchor: Block['anchor'], alignX: number, top: number): Block {
  return {
    x: leftOf(alignX, words.width, anchor),
    y: top,
    width: words.width,
    height: words.height,
    size: words.size,
    anchor,
    lines: words.lines.map((text, index) => ({
      text,
      x: alignX,
      baseline: top + words.lineHeight * (index + 0.5) + words.inkCentre,
    })),
  };
}

/** Free-standing Text: every line of its content, at its size and alignment. */
function textBlock(element: TextElement, metrics: Metrics): Block {
  const words = measured(element.content, FONT_SIZE_PX[element.fontSize], null, metrics);
  const anchor = anchorFor(element.textAlign);
  // `x` is the aligned edge whatever the alignment: the left edge, the centre
  // or the right edge the author placed.
  return placed(words, anchor, element.x, element.y);
}

/** A Label in its Element, or null when there is nothing to place. */
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
    // A shaft's Label is centred on its middle whatever the Element's alignment:
    // there is no box, and off-centre words would read as a mistake. It sits to
    // one side, far enough out that even a corner of the box clears the shaft.
    const middle = midpoint(shaft.start, shaft.end);
    const side = labelSide(shaft);
    const reach =
      SHAFT_LABEL_GAP + Math.abs(side.x) * (words.width / 2) + Math.abs(side.y) * (words.height / 2);
    const centre = {
      x: middle.x + side.x * reach,
      y: middle.y + side.y * reach,
    };
    return placed(words, 'middle', centre.x, centre.y - words.height / 2);
  }

  const area = labelArea(element);
  const words = measured(element.label, size, area.width, metrics);
  const anchor = anchorFor(element.textAlign);
  const alignX =
    element.textAlign === 'left'
      ? area.x
      : element.textAlign === 'center'
        ? area.x + area.width / 2
        : area.x + area.width;
  const top = area.y + (area.height - words.height) / 2;
  return placed(words, anchor, alignX, top);
}

/**
 * Which side of the shaft a Label sits on, as a unit normal: above the shaft
 * where it has an upper side, and to the left where it is vertical. The rule
 * depends on the heading, not on which way the arrow points, so two arrows
 * along one line keep their words on the same side.
 */
function labelSide(shaft: Shaft): Point {
  const along = { x: shaft.end.x - shaft.start.x, y: shaft.end.y - shaft.start.y };
  const length = Math.hypot(along.x, along.y);
  if (length === 0) {
    return { x: 0, y: -1 };
  }
  // The perpendicular that points up for a level shaft. On a diagonal only one
  // of the two perpendiculars points up, so take that one; a vertical shaft
  // points neither up nor down, so it takes the left.
  const normal = { x: along.y / length, y: -along.x / length };
  return normal.y > 0 || (normal.y === 0 && normal.x > 0)
    ? { x: -normal.x, y: -normal.y }
    : normal;
}

/** Whether an Element's words sit outside a box: a Text and an arrow's or a line's Label. */
function isTextOrShaft(element: Element): element is TextElement | ArrowOrLineElement {
  return element.type === 'text' || element.type === 'arrow' || element.type === 'line';
}

/** The box an Element's Label may fill: the largest centred box the outline holds, minus padding. */
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

/** The largest centred box in an outline, as a fraction of each side. */
function outlineFraction(element: OutlinedElement): number {
  return element.type === 'ellipse'
    ? ELLIPSE_FRACTION
    : element.type === 'diamond'
      ? DIAMOND_FRACTION
      : 1;
}

/** What a Label costs the Element it sits in, or null when it fits. */
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

/**
 * The Element with room for its Label: full lines make it taller, a line wider
 * than its box makes it wider. Growth goes down and right from where the
 * Element already sits, so an Element never moves when its words change, and it
 * stops as soon as the words fit. The editor calls this while typing; the
 * Renderer never does, so a saved Scene keeps the size the author chose.
 */
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

/** The lines the author wrote, split on explicit newlines and nothing else. */
function writtenLines(text: string): string[] {
  return text.split('\n');
}

/**
 * Greedy word wrap: a line takes the next word while it still fits, then
 * starts again. A newline starts a new line, and a word longer than the box
 * keeps a line to itself and overflows rather than being cut in half. Only a
 * run of ASCII spaces or tabs can break a line, so a non-breaking space or an
 * em space stays on the line it was written on.
 */
function breakLines(text: string, maxWidth: number, size: number, metrics: Metrics): string[] {
  const lines: string[] = [];
  for (const paragraph of writtenLines(text)) {
    const words = paragraph.split(/[ \t]+/).filter((word) => word !== '');
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = words[0] ?? '';
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (metrics.advance(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function widestLine(lines: readonly string[], size: number, metrics: Metrics): number {
  return lines.reduce((widest, line) => Math.max(widest, metrics.advance(line, size)), 0);
}

function anchorFor(align: TextAlign): Block['anchor'] {
  return align === 'left' ? 'start' : align === 'center' ? 'middle' : 'end';
}

/** The left edge of a block whose lines anchor at `alignX`. */
function leftOf(alignX: number, width: number, anchor: Block['anchor']): number {
  return anchor === 'start' ? alignX : anchor === 'middle' ? alignX - width / 2 : alignX - width;
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
