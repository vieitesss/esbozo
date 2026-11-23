/**
 * The parts of `opentype.js` this project uses. The package ships no type
 * declarations, and parsing a font is all `png` needs.
 */
declare module 'opentype.js' {
  export class Font {
    constructor(options: FontOptions);
    glyphs: { length: number };
    getEnglishName(name: string): string | undefined;
    unitsPerEm: number;
    ascender: number;
    descender: number;
    tables: {
      os2?: {
        sTypoAscender?: number;
        sTypoDescender?: number;
        sTypoLineGap?: number;
      };
    };
    getAdvanceWidth(text: string, fontSize?: number, options?: { kerning?: boolean }): number;
    getPath(
      text: string,
      x: number,
      y: number,
      fontSize?: number,
      options?: { kerning?: boolean },
    ): Path;
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

  export function parse(buffer: ArrayBuffer): Font;

  export type PathCommand =
    | { type: 'M' | 'L'; x: number; y: number }
    | { type: 'Q'; x1: number; y1: number; x: number; y: number }
    | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: 'Z' };

  export class Path {
    commands: readonly PathCommand[];
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    close(): void;
    toPathData(decimalPlaces?: number): string;
  }

  export interface GlyphOptions {
    name: string;
    unicode?: number;
    advanceWidth: number;
    path: Path;
  }

  export class Glyph {
    constructor(options: GlyphOptions);
  }

  const opentype: {
    Font: typeof Font;
    Glyph: typeof Glyph;
    Path: typeof Path;
    parse: typeof parse;
  };
  export default opentype;
}
