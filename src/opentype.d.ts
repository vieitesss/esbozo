/**
 * The parts of `opentype.js` this project uses. The package ships no type
 * declarations, and parsing a font is all `png` needs.
 */
declare module 'opentype.js' {
  export interface Font {
    /** Every glyph in the file; glyph 0 is `.notdef`, so a font with none has an empty list. */
    glyphs: { length: number };
    /** One of the `name` table entries, in English, or undefined when it is absent. */
    getEnglishName(name: string): string | undefined;
  }

  /** Parses a TrueType/OpenType file; throws when the bytes are not a font. */
  export function parse(buffer: ArrayBuffer): Font;
}
