/**
 * Font: the bytes a Scene is measured and drawn with.
 *
 * Layout measures with a font file and the Renderer draws in whatever family
 * the host resolves `--font-hand` to, so the CLI has to make the two agree: the
 * font it measures with is the font it hands resvg. This module is the one
 * place a font file is read and checked, so `ez render`, `ez check` and `ez png`
 * cannot disagree about which bytes are used or what a broken file says.
 *
 * Kalam (OFL) is bundled, so a Scene needs no font file to be measured and
 * drawn in the CLI. A font file is parsed once: a file that does not parse, or
 * has no glyphs, is a plain-text problem rather than a drawing with no words.
 * WOFF and WOFF2 are named and rejected, because resvg draws no glyphs from
 * them.
 *
 * Only the CLI imports this: the bytes of the bundled font are an asset, and
 * the editor bundle takes its font from the URL the host passes it instead.
 */
import { readFile } from 'node:fs/promises';
import { parse as parseFont } from 'opentype.js';
import kalam from '../fonts/Kalam-Regular.ttf';
import { createLayout, measureFont } from './layout.js';
import type { Layout } from './layout.js';

/** Kalam, bundled so the CLI needs no font file to work. */
export const BUNDLED_FONT: Uint8Array = kalam;

/** The name the bundled font draws as. */
export const BUNDLED_FONT_NAME = 'Kalam';

/** A font file parsed once: the bytes to draw with and the family it draws as. */
export interface FontFile {
  bytes: Uint8Array;
  family: string;
}

export type FontResult =
  | { ok: true; value: FontFile }
  | { ok: false; problems: string[] };

/** The Layout for a font file, so measuring and drawing use the same bytes. */
export function layoutFor(font: FontFile): Layout {
  return createLayout(measureFont(font.bytes));
}

/** Reads a font file from disk and checks it. */
export async function fontFromFile(path: string, label: string): Promise<FontResult> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (error) {
    return { ok: false, problems: [`cannot read font ${label}: ${messageOf(error)}`] };
  }
  return checkFont(bytes, label);
}

/**
 * Parses a font once, so resvg is told a family the file really provides and an
 * unusable file is a problem instead of a blank drawing.
 */
export function checkFont(bytes: Uint8Array, label: string): FontResult {
  const tag = tagAt(bytes, 0);
  if (tag === 'wOFF' || tag === 'wOF2') {
    return {
      ok: false,
      problems: [`${label} is a compressed webfont (${tag}), not a TrueType or OpenType font`],
    };
  }
  let parsed: ReturnType<typeof parseFont>;
  try {
    parsed = parseFont(arrayBufferOf(bytes));
  } catch {
    return { ok: false, problems: [`${label} is not a TrueType or OpenType font`] };
  }
  const family = parsed.getEnglishName('fontFamily')?.trim() ?? '';
  if (family === '') {
    return { ok: false, problems: [`${label} has no family name`] };
  }
  if (parsed.glyphs.length === 0) {
    return { ok: false, problems: [`${label} has no glyphs`] };
  }
  return { ok: true, value: { bytes, family } };
}

function tagAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

/** A copy of the bytes as the ArrayBuffer opentype.js parses. */
function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function messageOf(error: unknown): string {
  return (error as NodeJS.ErrnoException).message;
}
