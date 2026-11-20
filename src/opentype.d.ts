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

  /** The package is CommonJS, so a default import is what Node can always load. */
  const opentype: { Font: typeof Font; parse: typeof parse };
  export default opentype;
}
