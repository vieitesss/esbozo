/**
 * The parts of `opentype.js` this project uses. The package ships no type
 * declarations, and parsing a font is all `png` needs.
 */
declare module 'opentype.js' {
  export class Font {
    constructor(options: FontOptions);
    /** Every glyph in the file; glyph 0 is `.notdef`, so a font with none has an empty list. */
    glyphs: { length: number };
    /** One of the `name` table entries, in English, or undefined when it is absent. */
    getEnglishName(name: string): string | undefined;
    /** Font units per em, the scale every other unit is in. */
    unitsPerEm: number;
    /** The ascender from the file's hhea table, in font units. */
    ascender: number;
    /** The descender from the file's hhea table, in font units, negative below the baseline. */
    descender: number;
    /** The tables this project reads: OS/2's typographic metrics, when a font has them. */
    tables: {
      os2?: {
        sTypoAscender?: number;
        sTypoDescender?: number;
        sTypoLineGap?: number;
      };
    };
    /** The advance width of a line, in the font's units when no size is given. */
    getAdvanceWidth(text: string, fontSize?: number, options?: { kerning?: boolean }): number;
    /** The file's bytes, for tests that need a font which is valid but unusual. */
    toArrayBuffer(): ArrayBuffer;
  }

  export interface FontOptions {
    familyName: string;
    styleName: string;
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: unknown[];
  }

  /** Parses a TrueType/OpenType file; throws when the bytes are not a font. */
  export function parse(buffer: ArrayBuffer): Font;

  /** A glyph outline, built by tests that need a font which is valid but unusual. */
  export class Path {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    close(): void;
  }

  export interface GlyphOptions {
    name: string;
    unicode?: number;
    advanceWidth: number;
    path: Path;
  }

  /** One glyph, built by tests that need a font which is valid but unusual. */
  export class Glyph {
    constructor(options: GlyphOptions);
  }

  /** The package is CommonJS, so a default import is what Node can always load. */
  const opentype: {
    Font: typeof Font;
    Glyph: typeof Glyph;
    Path: typeof Path;
    parse: typeof parse;
  };
  export default opentype;
}
