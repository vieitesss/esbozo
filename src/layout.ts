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

/** Slack between two glyphs drawn side by side, so a run of them is one box. */
const GLYPH_GAP = 0.5;

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

/** One measured line: what it draws, where it starts and where its baseline sits. */
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
  /** The line's own box, from the top of its ink down: the room a caret and a selection fill. */
  top: number;
  height: number;
}

/** Words placed in a Scene: their lines, the size they draw at and the box they occupy. */
export interface Block extends Box {
  size: number;
  /** `text-anchor` for every line. */
  anchor: 'start' | 'middle' | 'end';
  lines: Line[];
}

/**
 * One caret slot in words a Block already placed: the room between two glyphs,
 * in Scene coordinates, on the line that holds the caret's offset.
 */
interface Caret {
  /** The line the caret is on, counted from the Block's first line. */
  readonly line: number;
  /** The left edge of the slot, and its own line's box. */
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

/** One line of words before it is placed: what it draws, and where in the words it came from. */
interface Written {
  text: string;
  /**
   * The runs of the words this line draws, and where each starts in them: a
   * wrapped line's space swallowed a run, so its glyphs are several runs. A
   * caret's offsets are read from them once the line is placed.
   */
  runs: readonly Run[];
  /**
   * The advance the line was measured at while it was being wrapped, when it
   * was: a wrapped line is the candidate that fitted, which the wrap measured
   * to decide. Measuring it again for its own width would measure the same
   * words twice.
   */
  width?: number;
}

/** A run of drawn glyphs, and the offset in the words its first glyph came from. */
interface Run {
  at: number;
  length: number;
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
 * One glyph a drawing laid out, in Scene coordinates: the box its ink covers.
 */
export interface GlyphBox {
  readonly left: number;
  readonly right: number;
}

/**
 * One line as the element that drew it laid it out: where its boundaries are,
 * and the box every glyph covers.
 */
export interface DrawnLine {
  /**
   * The x of every glyph boundary, in the words' own order: one more than the
   * line's characters, so a caret between any two glyphs has one place. A run
   * that reads right to left puts them the other way round.
   */
  readonly boundaries: readonly number[];
  /**
   * The box of every glyph it drew, in the words' own order. A run that reads
   * right to left is drawn the other way round, and the glyph at its end has a
   * right edge no boundary of the line names: the highlight of a selection is
   * read from these boxes, not from two boundaries.
   */
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
  /** The Label that does not fit its Element, or null when it fits or there is none. */
  overflow(element: Element): Overflow | null;
  /** The Element grown down and right until its Label fits. Elements without one come back unchanged. */
  grow<T extends Element>(element: T): T;
  /**
   * Where the caret sits for an offset into the words this Block was placed
   * from: the glyph boundary on the line that holds it, at the x the drawing
   * put that boundary. An offset inside a run of spaces a wrapped line swallowed
   * lands on the nearest boundary the line draws, and an offset past the words
   * lands after their last glyph.
   */
  caret(block: Block, offset: number, glyphs: LineGlyphs): Caret;
  /**
   * The highlight behind the words between two offsets: one box per run of
   * glyphs they cover, on the line that draws it. Read in either order, and
   * left to right whatever order the words run in: a run that reads right to
   * left is drawn right to left, so its own box is the one its glyphs cover and
   * not the span between its first and last boundary. An empty run selects
   * nothing.
   */
  selection(block: Block, from: number, to: number, glyphs: LineGlyphs): Box[];
  /**
   * The offset into those words of the glyph boundary nearest a Scene point:
   * the line the point's height falls on, the glyph its x falls on, and the
   * side of that glyph the point is on, read in the direction the glyph runs.
   */
  offsetAt(block: Block, point: Point, glyphs: LineGlyphs): number;
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
    overflow: (element) => labelOverflow(element, metrics),
    grow: (element) => grown(element, metrics),
    caret: (block, offset, glyphs) => caretAt(block, offset, glyphs),
    selection: (block, from, to, glyphs) => selectionAt(block, from, to, glyphs),
    offsetAt: (block, point, glyphs) => offsetAt(block, point, glyphs),
    ...(parsed.glyphs === undefined ? {} : { glyphs: parsed.glyphs }),
  };
  return layout;
}

/** A measured line, and how wide its own ink is: the one measurement the placed Block reads. */
interface MeasuredLine extends Written {
  width: number;
}

/** Words measured once: how they break, how big they are and how far apart the lines sit. */
interface Measured {
  size: number;
  lines: MeasuredLine[];
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
  const written = maxWidth === null ? writtenLines(text) : breakLines(text, maxWidth, size, metrics);
  // Each line is measured once: the wrap hands over the width it measured to
  // decide the line, and only a line it never measured is measured here. The
  // Block placed from these reads them, and the lines a Label only has to fit
  // are measured no further.
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

/** The words as a Block: each line on its baseline, centred on its ink in the box. */
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
function writtenLines(text: string): Written[] {
  const lines: Written[] = [];
  let start = 0;
  for (const line of text.split('\n')) {
    lines.push({ text: line, runs: [{ at: start, length: line.length }] });
    start += line.length + 1;
  }
  return lines;
}

/** Every glyph boundary of one drawn run, as the offset in the words it came from. */
function boundaryRun(from: number, length: number): number[] {
  return Array.from({ length: length + 1 }, (_, step) => from + step);
}

/** The runs of characters a wrapped line is built from, and where each starts in the words. */
function wordRuns(paragraph: string, from: number): { text: string; at: number }[] {
  return Array.from(paragraph.matchAll(/[^ \t]+/g), (match) => ({
    text: match[0] ?? '',
    at: from + (match.index ?? 0),
  }));
}

/**
 * Greedy word wrap: a line takes the next word while it still fits, then
 * starts again. A newline starts a new line, and a word longer than the box
 * keeps a line to itself and overflows rather than being cut in half. Only a
 * run of ASCII spaces or tabs can break a line, so a non-breaking space or an
 * em space stays on the line it was written on.
 */
function breakLines(text: string, maxWidth: number, size: number, metrics: Metrics): Written[] {
  const lines: Written[] = [];
  let paragraphStart = 0;
  for (const paragraph of text.split('\n')) {
    const words = wordRuns(paragraph, paragraphStart);
    const first = words[0];
    if (first === undefined) {
      // An empty paragraph is one empty run, so the line still has the boundary
      // a caret sits at.
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
          // The space the run became is one drawn glyph: it has no run of its
          // own, so the boundary before it is the last of the one word and the
          // one after it is where the next word starts. The width it was
          // measured at is kept, so the line it became is not measured again.
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

/** Where the caret for an offset sits: the glyph boundary on the line that holds it. */
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

/**
 * One boundary's x, clamped to the boundaries the line really draws: an offset
 * past the words is the place after the last glyph, never a made-up one. A line
 * whose drawing answered with no boundary at all sits where it anchors.
 */
function boundaryX(xs: readonly number[], column: number, anchor: number): number {
  return xs[Math.min(column, xs.length - 1)] ?? anchor;
}

/**
 * The highlight behind two offsets: the runs of glyphs they cover, one box per
 * run drawn side by side.
 */
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

/**
 * The runs of ink a set of glyphs covers: glyphs drawn side by side are one run,
 * and a gap between two of them is what a run that the words run the other way
 * in between them makes. Left to right, whichever order the words were read in.
 */
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

/**
 * The offset of the glyph boundary a point names: its line by height, the glyph
 * its x falls on, and the side of that glyph it is on. A press on the left half
 * of a letter written left to right is before it, and on the left half of one
 * written right to left is after it, because that is the side the words are
 * read to next.
 */
function offsetAt(block: Block, point: Point, glyphs: LineGlyphs): number {
  const line = nearestLine(block.lines, point.y);
  const drawn = glyphs(line);
  const hit = nearestGlyph(drawn.glyphs, point.x);
  if (hit === null) {
    return line.boundaries[0]!;
  }
  const { index, glyph } = hit;
  const middle = (glyph.left + glyph.right) / 2;
  // Which edge the glyph's own boundary is on tells the direction it runs in:
  // a right-to-left glyph starts at its right edge.
  const start = drawn.boundaries[index] ?? glyph.left;
  const backwards = Math.abs(start - glyph.right) < Math.abs(start - glyph.left);
  const after = backwards ? point.x <= middle : point.x >= middle;
  return line.boundaries[Math.min(after ? index + 1 : index, line.boundaries.length - 1)]!;
}

/** The glyph whose ink a point's x is on, or the one of them nearest it. */
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

/** The line an offset belongs to: the first whose glyphs reach it, and the last when none does. */
function lineAt(lines: readonly Line[], offset: number): number {
  for (let index = 0; index < lines.length; index += 1) {
    const boundaries = lines[index]!.boundaries;
    if (offset <= boundaries[boundaries.length - 1]!) {
      return index;
    }
  }
  return lines.length - 1;
}

/** How many of a line's drawn glyphs come before an offset: the nearest boundary it has. */
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

/** The line a height falls on: the one whose own box holds it, or the nearest of them. */
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
