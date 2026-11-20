/**
 * The unusual fonts the suites measure with, built here so a test can say
 * exactly what a font measures: how wide its glyphs are, how tall its glyphs
 * draw and where its ascender and descender sit. One builder, so `--font` is
 * the same font in every suite.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import opentype from 'opentype.js';
import type { Glyph } from 'opentype.js';

export interface FontShape {
  /** Advance width of every glyph, in font units. */
  advance?: number;
  /** Ascender, in font units above the baseline. */
  ascender?: number;
  /** Descender, in font units below the baseline. */
  descender?: number;
  /** How tall the box every glyph draws above the baseline is, in font units. */
  glyphHeight?: number;
  /** The family name the file gives. */
  family?: string;
}

/** Every character these fonts carry; one glyph per character, plus `.notdef`. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,';

/** Bytes of a valid font whose glyphs all measure and draw the same. */
export function fontBytes(shape: FontShape = {}): Uint8Array {
  const advance = shape.advance ?? 1000;
  const height = shape.glyphHeight ?? 800;
  const glyph = (name: string, code: number): Glyph => {
    const path = new opentype.Path();
    path.moveTo(0, 0);
    path.lineTo(advance, 0);
    path.lineTo(advance, height);
    path.close();
    return new opentype.Glyph({ name, unicode: code, advanceWidth: advance, path });
  };
  const font = new opentype.Font({
    familyName: shape.family ?? 'Wide',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: shape.ascender ?? 800,
    descender: shape.descender ?? -200,
    glyphs: [
      glyph('.notdef', 0),
      ...ALPHABET.split('').map((character) =>
        glyph(character === ' ' ? 'space' : character, character.codePointAt(0)!),
      ),
    ],
  });
  return new Uint8Array(font.toArrayBuffer());
}

/** Writes that font into `folder` and returns its file name. */
export async function writeFont(
  folder: string,
  name: string,
  shape: FontShape = {},
): Promise<string> {
  await writeFile(join(folder, name), Buffer.from(fontBytes(shape)));
  return name;
}
