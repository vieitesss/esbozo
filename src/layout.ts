/**
 * Layout: the words in a Scene, measured with a real font and placed.
 *
 * One module answers every question about text, so the Renderer, `ez check`
 * and the editor agree: how wide a line is, where a Label wraps, where its
 * lines sit inside an Element, whether it fits, and how the Element has to grow
 * to hold it. It runs in the browser as well as in the CLI, so it reads font
 * bytes and never the filesystem: the caller loads the font — the bundled
 * Kalam, a `--font` file, or the URL the host passes the editor — and hands the
 * bytes to `measureFont`.
 *
 * Text draws on a baseline, so a line's ink sits a little above it. Lines are
 * spaced by a chosen line height and each one is centred on its ink, not on the
 * font's em box, which keeps a Label level with the line the author placed.
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
 * author wrote a newline. It is centred on the middle of the shaft the arrow
 * draws, and sits just above the ink of that shaft, because there is no paper
 * behind the words to clear the line they would otherwise sit on. The Renderer
 * passes the drawn middle in, because Snap moves the ends.
 */
import { parse as parseFont } from 'opentype.js';
import type {
  Element,
  FontSize,
  OutlinedElement,
  Point,
  StrokeWidth,
  TextAlign,
  TextElement,
} from './scene.js';

/** Font size per named size, in pixels. */
export const FONT_SIZE_PX: Record<FontSize, number> = { S: 14, M: 18, L: 24, XL: 32 };

/** Stroke width per named width, in pixels. */
export const STROKE_WIDTH_PX: Record<StrokeWidth, number> = { thin: 1, bold: 2, extra: 4 };

/** Room between the words and the outline, per side, in pixels, before the stroke width. */
const LABEL_PADDING = 8;

/** Baseline-to-baseline distance, as a multiple of the font size. Tighter than Kalam's own 1.59 em. */
const LINE_HEIGHT = 1.25;

/** Where a line's ink sits above its baseline, in ems. Kalam's x-height and capitals. */
const INK_CENTRE = 0.33;

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

/** A rectangle in Scene coordinates. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One measured line: where it starts and where its baseline sits. */
export interface Line {
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
export interface Overflow {
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

/** Reads a TrueType/OpenType file into the numbers Layout places text with. Throws when the bytes are not a font. */
export function measureFont(bytes: Uint8Array): Metrics {
  const font = parseFont(arrayBufferOf(bytes));
  return {
    advance: (text, size) => font.getAdvanceWidth(text, size, { kerning: true }),
    lineHeight: (size) => size * LINE_HEIGHT,
    inkCentre: (size) => size * INK_CENTRE,
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
   * Element has no Label or is a Text. `shaftMidpoint` is where an arrow's or
   * line's *drawn* shaft has its middle, which Snap moves: the Renderer passes
   * it in, and without it the middle of the Scene's own end points is used.
   */
  label(element: Element, shaftMidpoint?: Point): Block | null;
  /** The Label that does not fit its Element, or null when it fits or there is none. */
  overflow(element: Element): Overflow | null;
  /** The Element grown down and right until its Label fits. Elements without one come back unchanged. */
  grow<T extends Element>(element: T): T;
}

/** Builds the Layout for one measured font. */
export function createLayout(metrics: Metrics): Layout {
  const layout: Layout = {
    text: (element) => textBlock(element, metrics),
    label: (element, shaftMidpoint) => labelBlock(element, metrics, shaftMidpoint),
    overflow: (element) => labelOverflow(element, metrics),
    grow: (element) => grown(element, metrics),
  };
  return layout;
}

/** Free-standing Text: every line of its content, at its size and alignment. */
function textBlock(element: TextElement, metrics: Metrics): Block {
  const size = FONT_SIZE_PX[element.fontSize];
  const lines = breakLines(element.content, Number.POSITIVE_INFINITY, size, metrics);
  const width = widestLine(lines, size, metrics);
  const lineHeight = metrics.lineHeight(size);
  const height = lines.length * lineHeight;
  const anchor = anchorFor(element.textAlign);
  // `x` is the aligned edge whatever the alignment: the left edge, the centre
  // or the right edge the author placed.
  const alignX = element.x;
  return {
    x: leftOf(alignX, width, anchor),
    y: element.y,
    width,
    height,
    size,
    anchor,
    lines: placeLines(lines, alignX, element.y, size, metrics),
  };
}

/** A Label in its Element, or null when there is nothing to place. */
function labelBlock(
  element: Element,
  metrics: Metrics,
  shaftMidpoint: Point | undefined,
): Block | null {
  if (element.type === 'text' || element.label === undefined) {
    return null;
  }
  const size = FONT_SIZE_PX[element.fontSize];
  const lineHeight = metrics.lineHeight(size);
  if (element.type === 'arrow' || element.type === 'line') {
    const middle = shaftMidpoint ?? midpoint(element.points[0], element.points[1]);
    const lines = breakLines(element.label, Number.POSITIVE_INFINITY, size, metrics);
    const width = widestLine(lines, size, metrics);
    const height = lines.length * lineHeight;
    // A shaft's Label is centred on its middle whatever the Element's alignment:
    // there is no box, and off-centre words would read as a mistake. It sits
    // above the shaft, so the words never sit on the line they describe.
    const bottom = middle.y - SHAFT_LABEL_GAP;
    const top = bottom - height;
    return {
      x: middle.x - width / 2,
      y: top,
      width,
      height,
      size,
      anchor: 'middle',
      lines: placeLines(lines, middle.x, top, size, metrics),
    };
  }

  const area = labelArea(element);
  const lines = breakLines(element.label, area.width, size, metrics);
  const width = widestLine(lines, size, metrics);
  const height = lines.length * lineHeight;
  const anchor = anchorFor(element.textAlign);
  const alignX =
    element.textAlign === 'left'
      ? area.x
      : element.textAlign === 'center'
        ? area.x + area.width / 2
        : area.x + area.width;
  const top = area.y + (area.height - height) / 2;
  return {
    x: leftOf(alignX, width, anchor),
    y: top,
    width,
    height,
    size,
    anchor,
    lines: placeLines(lines, alignX, top, size, metrics),
  };
}

/** The box an Element's Label may fill: the largest centred box the outline holds, minus padding. */
function labelArea(element: OutlinedElement): Box {
  const fraction =
    element.type === 'ellipse'
      ? ELLIPSE_FRACTION
      : element.type === 'diamond'
        ? DIAMOND_FRACTION
        : 1;
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

/** What a Label costs the Element it sits in, or null when it fits. */
function labelOverflow(element: Element, metrics: Metrics): Overflow | null {
  if (element.type === 'text' || element.label === undefined) {
    return null;
  }
  if (element.type === 'arrow' || element.type === 'line') {
    return null;
  }
  const area = labelArea(element);
  const size = FONT_SIZE_PX[element.fontSize];
  const lines = breakLines(element.label, area.width, size, metrics);
  const neededHeight = lines.length * metrics.lineHeight(size);
  const neededWidth = widestLine(lines, size, metrics);
  const tooTall = neededHeight > area.height + EPSILON;
  const tooWide = neededWidth > area.width + EPSILON;
  if (!tooTall && !tooWide) {
    return null;
  }
  const parts: string[] = [];
  if (tooTall) {
    parts.push(
      `${lines.length} line${lines.length === 1 ? '' : 's'} need ${round(neededHeight)}px,` +
        ` the text box is ${round(area.height)}px tall`,
    );
  }
  if (tooWide) {
    parts.push(
      `the longest line needs ${round(neededWidth)}px, the text box is ${round(area.width)}px wide`,
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
  let width = element.width;
  let height = element.height;
  for (let round = 0; round < GROW_ROUNDS; round += 1) {
    const candidate: OutlinedElement = { ...element, width, height };
    const area = labelArea(candidate);
    const size = FONT_SIZE_PX[element.fontSize];
    const lines = breakLines(element.label, area.width, size, metrics);
    const deficitWidth = widestLine(lines, size, metrics) - area.width;
    const deficitHeight = lines.length * metrics.lineHeight(size) - area.height;
    const fraction =
      element.type === 'ellipse'
        ? ELLIPSE_FRACTION
        : element.type === 'diamond'
          ? DIAMOND_FRACTION
          : 1;
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

/**
 * Greedy word wrap: a line takes the next word while it still fits, then
 * starts again. A newline starts a new line, and a word longer than the box
 * keeps a line to itself and overflows rather than being cut in half.
 */
function breakLines(text: string, maxWidth: number, size: number, metrics: Metrics): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((word) => word !== '');
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

/** Every line placed on a baseline, centred on its ink. */
function placeLines(
  lines: readonly string[],
  alignX: number,
  top: number,
  size: number,
  metrics: Metrics,
): Line[] {
  const lineHeight = metrics.lineHeight(size);
  const inkCentre = metrics.inkCentre(size);
  return lines.map((text, index) => ({
    text,
    x: alignX,
    baseline: top + lineHeight * (index + 0.5) + inkCentre,
  }));
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
