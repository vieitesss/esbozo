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
 */
import { parse as parseFont } from 'opentype.js';

/** The outlines of one font, ready to write a line as SVG path data. */
export interface Glyphs {
  /**
   * One line of words as path data, drawn from the baseline at `baseline` and
   * anchored at `x` the way the Renderer's `text-anchor` anchors it. Empty when
   * the line has no ink: a blank line takes its space and draws nothing.
   */
  path(text: string, size: number, x: number, baseline: number, anchor: TextAnchor): string;
}

/** The anchors a Block places its lines on, as the Renderer writes them. */
export type TextAnchor = 'start' | 'middle' | 'end';

/** Parses a font once, in the font units the file carries. */
export function glyphsOf(bytes: Uint8Array): Glyphs {
  const font = parseFont(arrayBufferOf(bytes));
  return {
    path(text, size, x, baseline, anchor) {
      if (text.trim() === '') {
        return '';
      }
      const advance = font.getAdvanceWidth(text, size, { kerning: true });
      const start = anchor === 'middle' ? x - advance / 2 : anchor === 'end' ? x - advance : x;
      // Two decimals, the precision the Renderer writes its own paths with.
      return font.getPath(text, start, baseline, size, { kerning: true }).toPathData(2);
    },
  };
}

/** The bytes as the buffer opentype.js parses, without copying the whole file twice. */
function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
