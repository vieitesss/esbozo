/**
 * Glyphs: one line of words as the outlines the font carries.
 *
 * Layout measures words with a font file and the Renderer draws them as
 * `<text>` in the host's family; a PNG is rasterised by a text engine that lays
 * the line out itself. resvg draws a glyph's curves from the file, while a
 * browser shapes, hints and antialiases the same line its own way, so a dense
 * page of words comes out as two different drawings even when both have the
 * font. Writing the line as its glyph outlines leaves every rasteriser the same
 * curves to fill: paths, with no text engine in between.
 *
 * The placement is Layout's, not a second copy of it: the anchor shifts by the
 * advance the same font measures, so a line centred or right-aligned in a Scene
 * is centred or right-aligned in the PNG.
 *
 * The path data is written here, from the commands the font gives, because a
 * path is only drawable when every number in it is finite. opentype.js's own
 * serializer emits `NaN` for a coordinate whose fraction is smaller than its
 * rounding step (`72.00000000000001` becomes `NaN`), and a browser stops
 * reading a path at the first number it cannot parse: a five-line page of XL
 * words came out as the word `Kalam` and nothing else. Rounding each number
 * here, and refusing a line the font could not place, keeps a page of words
 * whole.
 */

/** The anchors a Block places its lines on, as the Renderer writes them. */
export type TextAnchor = 'start' | 'middle' | 'end';

/** One command of a glyph outline, in pixels. */
export type Curve =
  | { readonly type: 'M'; readonly x: number; readonly y: number }
  | { readonly type: 'L'; readonly x: number; readonly y: number }
  | {
      readonly type: 'Q';
      readonly x1: number;
      readonly y1: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: 'C';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: 'Z' };

/**
 * A parsed font, as outlines need it: the advance to anchor a line by, and the
 * curves the file draws for it. Layout owns the parse, so the words a PNG draws
 * are the words Layout measured.
 */
export interface OutlineFont {
  /** Advance width of one line at a font size. */
  advance(text: string, size: number): number;
  /** One line as the font's curves, drawn from the baseline at `baseline`. */
  curves(text: string, x: number, baseline: number, size: number): readonly Curve[];
}

/** The outlines of one font, ready to write a line as SVG path data. */
export interface Glyphs {
  /**
   * One line of words as path data, drawn from the baseline at `baseline` and
   * anchored at `x` the way the Renderer's `text-anchor` anchors it. Empty when
   * the line has no ink: a blank line takes its space and draws nothing. Null
   * when the font gives no finite curves for it: the line cannot be drawn, and
   * a caller must say so rather than draw part of it.
   */
  path(text: string, size: number, x: number, baseline: number, anchor: TextAnchor): string | null;
}

/** How many decimals a path's numbers keep, the precision the Renderer writes its own paths with. */
const DECIMALS = 2;

/** The outlines of a parsed font, at the anchors a Block places its lines on. */
export function glyphsOf(font: OutlineFont): Glyphs {
  return {
    path(text, size, x, baseline, anchor) {
      if (text.trim() === '') {
        return '';
      }
      const advance = font.advance(text, size);
      const start = anchor === 'middle' ? x - advance / 2 : anchor === 'end' ? x - advance : x;
      return pathDataOf(font.curves(text, start, baseline, size));
    },
  };
}

/** The commands as one `d`, or null when a number of it is not finite. */
function pathDataOf(curves: readonly Curve[]): string | null {
  const drawn: string[] = [];
  for (const curve of curves) {
    const numbers = numbersOf(curve);
    if (numbers.some((value) => !Number.isFinite(value))) {
      return null;
    }
    drawn.push(`${curve.type}${numbers.map(shortest).join(' ')}`);
  }
  return drawn.join('');
}

/** One command's coordinates, in the order SVG reads them. */
function numbersOf(curve: Curve): number[] {
  switch (curve.type) {
    case 'M':
    case 'L':
      return [curve.x, curve.y];
    case 'Q':
      return [curve.x1, curve.y1, curve.x, curve.y];
    case 'C':
      return [curve.x1, curve.y1, curve.x2, curve.y2, curve.x, curve.y];
    case 'Z':
      return [];
  }
}

/** One number, rounded to the decimals a path keeps and written without padding zeroes. */
function shortest(value: number): string {
  const step = 10 ** DECIMALS;
  const rounded = Math.round(value * step) / step;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(DECIMALS);
}
