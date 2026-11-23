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

export type TextAnchor = 'start' | 'middle' | 'end';

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

export interface OutlineFont {
  advance(text: string, size: number): number;
  curves(text: string, x: number, baseline: number, size: number): readonly Curve[];
}

export interface Glyphs {
  path(text: string, size: number, x: number, baseline: number, anchor: TextAnchor): string | null;
}

const DECIMALS = 2;

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

function shortest(value: number): string {
  const step = 10 ** DECIMALS;
  const rounded = Math.round(value * step) / step;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(DECIMALS);
}
