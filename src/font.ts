import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fontFaces, resolveVariables, themeVariables } from './css.js';
import type { Theme } from './css.js';
import kalam from '../fonts/Kalam-Regular.ttf';
import { createLayout, parseFontFile } from './layout.js';
import type { Layout, ParsedFont } from './layout.js';

const BUNDLED_FONT_NAME = 'Kalam';

const BUNDLED_FONT: Uint8Array = kalam;

const REMOTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export interface FontFile {
  bytes: Uint8Array;
  family: string;
  parsed: ParsedFont;
}

type FontResult =
  | { ok: true; value: FontFile }
  | { ok: false; problems: string[] };

export type ChosenFont =
  | { ok: true; value: FontFile; family: string | null; notes: string[] }
  | { ok: false; problems: string[] };

export function layoutFor(font: FontFile): Layout {
  return createLayout(font.parsed);
}

export interface Stylesheet {
  css: string;
  path: string;
}

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

function stylesheetFamily(
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

export async function chooseFont(
  fontPath: string | undefined,
  stylesheet: Stylesheet | null,
  theme: Theme,
): Promise<ChosenFont> {
  if (fontPath !== undefined) {
    const font = await loadFont(fontPath);
    return font.ok ? { ok: true, value: font.value, family: null, notes: [] } : font;
  }

  const family = stylesheetFamily(stylesheet, theme);
  if (!family.ok) {
    return family;
  }

  const notes: string[] = [];
  if (stylesheet !== null) {
    const face = fontFaces(stylesheet.css)
      .filter((candidate) => theme === 'dark' || !candidate.dark)
      .findLast((candidate) => familyMatches(candidate.family, family.value));
    if (face !== undefined) {
      if (REMOTE_URL.test(face.url)) {
        notes.push(
          `stylesheet font ${face.url} is remote, so the bundled ${BUNDLED_FONT_NAME} is used`,
        );
      } else {
        const path = resolve(dirname(stylesheet.path), face.url);
        const font = await loadFont(path, `${face.url} (from ${stylesheet.path})`);
        return font.ok ? { ok: true, value: font.value, family: family.value, notes } : font;
      }
    }
  }

  const bundled = await loadFont();
  return bundled.ok
    ? { ok: true, value: bundled.value, family: family.value, notes }
    : bundled;
}

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
async function loadFont(
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
function checkFont(bytes: Uint8Array, label: string): FontResult {
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
  return { ok: true, value: { bytes, family: parsed.family, parsed } };
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
