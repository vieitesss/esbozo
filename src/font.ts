/**
 * Font: the bytes a Scene is measured and drawn with.
 *
 * Layout measures with a font file and the Renderer draws in whatever family
 * the host resolves `--font-hand` to, so the CLI has to make the two agree: the
 * font it measures with is the font it hands resvg. This module is the one
 * place a font file is read, checked and chosen, so `ez render`, `ez check` and
 * `ez png` cannot disagree about which bytes are used or what a broken file
 * says — and check and png measure the same bytes for the same inputs.
 *
 * Precedence, one resolver (`chooseFont`): `--font` wins, then a local
 * `@font-face` in the stylesheet whose family matches the effective
 * `--font-hand`, then the bundled Kalam. Only files on this machine can be
 * read: a remote `@font-face` is ignored with a note. The stylesheet's
 * `--font-hand` only matters, and only has to resolve, when the font comes from
 * there; `--font` never needs it.
 *
 * Kalam (OFL) is bundled, so a Scene needs no font file to be measured and
 * drawn in the CLI. A font file is parsed once (`parseFontFile`): its advances,
 * its family, its vertical metrics and its glyph count all come from that one
 * parse, so validating a font and measuring with it reads the file once. A file
 * that does not parse, or has no glyphs, is a plain-text problem rather than a
 * drawing with no words. WOFF and WOFF2 are named and rejected, because resvg
 * draws no glyphs from them.
 *
 * Only the CLI imports this: the bytes of the bundled font are an asset, and
 * the editor bundle takes its font from the URL the host passes it instead.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fontFaces, resolveVariables, themeVariables } from './css.js';
import type { Theme } from './css.js';
import kalam from '../fonts/Kalam-Regular.ttf';
import { createLayout, parseFontFile } from './layout.js';
import type { Layout, Metrics } from './layout.js';

/** The name the bundled font draws as. */
export const BUNDLED_FONT_NAME = 'Kalam';

/** Kalam, bundled so the CLI needs no font file to work. */
const BUNDLED_FONT: Uint8Array = kalam;

/** Only files on this machine can be read; a URL is not one. */
const REMOTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** A font read once: the bytes to draw with, the family it draws as and how to measure with it. */
export interface FontFile {
  bytes: Uint8Array;
  family: string;
  metrics: Metrics;
}

export type FontResult =
  | { ok: true; value: FontFile }
  | { ok: false; problems: string[] };

/** A font chosen for a command, with the notes worth saying that did not stop it. */
export type ChosenFont =
  | { ok: true; value: FontFile; notes: string[] }
  | { ok: false; problems: string[] };

/** The Layout for a font file, so measuring and drawing use the same bytes. */
export function layoutFor(font: FontFile): Layout {
  return createLayout(font.metrics);
}

/** A stylesheet read once: its text and the path a relative `@font-face` resolves against. */
export interface Stylesheet {
  css: string;
  path: string;
}

/** Reads a stylesheet, or returns null when the command was given none. */
export async function readStylesheet(
  path: string | undefined,
): Promise<{ ok: true; value: Stylesheet | null } | { ok: false; problems: string[] }> {
  if (path === undefined) {
    return { ok: true, value: null };
  }
  try {
    return { ok: true, value: { css: await readFile(path, 'utf8'), path } };
  } catch (error) {
    return { ok: false, problems: [`cannot read stylesheet ${path}: ${messageOf(error)}`] };
  }
}

/**
 * The `--font-hand` a stylesheet sets for a theme, or null when it leaves the
 * font to the file. It only decides which `@font-face` a stylesheet font comes
 * from, so it is read once and shared by the caller that also draws the family.
 */
export function stylesheetFamily(
  stylesheet: Stylesheet | null,
  theme: Theme,
): { ok: true; value: string | null } | { ok: false; problems: string[] } {
  if (stylesheet === null) {
    return { ok: true, value: null };
  }
  const variables = themeVariables(stylesheet.css, theme);
  const declared = variables['--font-hand'];
  if (declared === undefined) {
    return { ok: true, value: null };
  }
  const resolved = resolveVariables(declared, variables);
  if (!resolved.ok) {
    return {
      ok: false,
      problems: [`stylesheet font --font-hand is unresolved: ${resolved.unresolved}`],
    };
  }
  return { ok: true, value: resolved.value.trim() === '' ? null : resolved.value.trim() };
}

/**
 * The font a command measures and draws with: `--font`, then a local
 * `@font-face` for the stylesheet's `--font-hand`, then the bundled Kalam.
 * `family` is that `--font-hand`, already resolved for the theme, so this
 * function is the one place the precedence lives; `theme` decides which
 * `@font-face` blocks belong to the theme.
 */
export async function chooseFont(
  fontPath: string | undefined,
  stylesheet: Stylesheet | null,
  family: string | null,
  theme: Theme,
): Promise<ChosenFont> {
  if (fontPath !== undefined) {
    const font = await loadFont(fontPath);
    return font.ok ? { ok: true, value: font.value, notes: [] } : font;
  }

  const notes: string[] = [];
  if (stylesheet !== null) {
    // A `@font-face` inside dark scope belongs to the dark theme alone, so the
    // light theme never reads it. A later rule wins, as in CSS.
    const face = fontFaces(stylesheet.css)
      .filter((candidate) => theme === 'dark' || !candidate.dark)
      .findLast((candidate) => familyMatches(candidate.family, family));
    if (face !== undefined) {
      if (REMOTE_URL.test(face.url)) {
        notes.push(
          `stylesheet font ${face.url} is remote, so the bundled ${BUNDLED_FONT_NAME} is used`,
        );
      } else {
        const path = resolve(dirname(stylesheet.path), face.url);
        const font = await loadFont(path, `${face.url} (from ${stylesheet.path})`);
        return font.ok ? { ok: true, value: font.value, notes } : font;
      }
    }
  }

  const bundled = await loadFont();
  return bundled.ok ? { ok: true, value: bundled.value, notes } : bundled;
}

/** Whether `family` names the `@font-face` family, allowing a font stack. */
function familyMatches(faceFamily: string, fontFamily: string | null): boolean {
  if (fontFamily === null) {
    return false;
  }
  const plain = (name: string): string => name.trim().replace(/^["']|["']$/g, '').toLowerCase();
  return fontFamily.split(',').map(plain).includes(plain(faceFamily));
}

/**
 * Reads a font file and checks it, or reads the bundled Kalam when no path is
 * given. Every caller goes through here, so the fallback is owned in one place.
 */
export async function loadFont(
  fontPath?: string,
  label = fontPath ?? BUNDLED_FONT_NAME,
): Promise<FontResult> {
  let bytes: Uint8Array;
  if (fontPath === undefined) {
    bytes = BUNDLED_FONT;
  } else {
    try {
      bytes = await readFile(fontPath);
    } catch (error) {
      return { ok: false, problems: [`cannot read font ${label}: ${messageOf(error)}`] };
    }
  }
  return checkFont(bytes, label);
}

/**
 * Parses a font once, so resvg is told a family the file really provides,
 * measurement comes from the same parse and an unusable file is a problem
 * instead of a blank drawing.
 */
export function checkFont(bytes: Uint8Array, label: string): FontResult {
  const tag = tagAt(bytes, 0);
  if (tag === 'wOFF' || tag === 'wOF2') {
    return {
      ok: false,
      problems: [`${label} is a compressed webfont (${tag}), not a TrueType or OpenType font`],
    };
  }
  let parsed: ReturnType<typeof parseFontFile>;
  try {
    parsed = parseFontFile(bytes);
  } catch {
    return { ok: false, problems: [`${label} is not a TrueType or OpenType font`] };
  }
  if (parsed.family === '') {
    return { ok: false, problems: [`${label} has no family name`] };
  }
  if (parsed.glyphCount === 0) {
    return { ok: false, problems: [`${label} has no glyphs`] };
  }
  return { ok: true, value: { bytes, family: parsed.family, metrics: parsed.metrics } };
}

function tagAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function messageOf(error: unknown): string {
  return (error as NodeJS.ErrnoException).message;
}
