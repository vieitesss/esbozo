/**
 * PNG: the Renderer's SVG in, PNG bytes out, in light or dark.
 *
 * resvg has no CSS engine: it knows neither `var(--ink)` nor `color-mix()`. So
 * every colour is resolved first — the stylesheet to a palette, the SVG's
 * colour and font attributes to concrete values — and only then rasterised.
 * One resolver (`./css.ts`) does both passes, so a value means the same thing
 * in a stylesheet and in the drawing. A colour that does not resolve is a
 * problem with exit 5 naming it, never a silent black.
 *
 * The stylesheet subset, also printed by `ez --help`:
 *
 *   - Light theme: custom properties declared in `:root` or `html` blocks.
 *   - Dark theme: those values, overridden by declarations in
 *     `@media (prefers-color-scheme: dark)` blocks and in the explicit dark
 *     scopes on the root only — `:root.dark`, `:root[data-theme="dark"]`,
 *     `html.dark`, `html[data-theme="dark"]`. A later declaration wins, and
 *     dark values always win over base ones.
 *   - `--ink`, `--paper`, `--muted` and `--font-hand` are the only properties
 *     read. Other selectors — `.dark-card`, `.dark`, `body` — are ignored, so
 *     a component's colours never become the page's palette.
 *   - Values may use recursive `var()` with fallbacks and
 *     `color-mix(in srgb, A p%, B)`, whose operands may be hex, `rgb()`/
 *     `rgba()` or a CSS named colour. Anything else is reported, not guessed.
 *   - `--font-hand` follows the same cascade per theme: light never reads the
 *     dark font.
 *   - A palette is complete when every colour of the chosen theme has a value;
 *     dark inherits the light values, so a `:root`-only stylesheet covers both
 *     themes. Nothing is filled in from the built-ins once a stylesheet is
 *     given.
 *
 * Fonts, in order of precedence: `--font`, then a local `@font-face` in the
 * stylesheet whose family matches the effective `--font-hand`, then the bundled
 * Kalam. The stylesheet's `--font-hand` only matters — and only has to resolve —
 * when the font comes from there: `--font` never needs it. A remote `@font-face`
 * is ignored with a note, because only files on this machine can be read. Every
 * candidate is parsed with `opentype.js` once, and its bytes and family travel
 * together: a file that does not parse, or has no glyphs, is a problem rather
 * than a font resvg would silently draw nothing with. WOFF and WOFF2 are named
 * and rejected, because resvg draws no glyphs from them.
 *
 * The built-in light and dark palettes are sb's Excalidraw converter defaults,
 * the prior art.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse as parseFont } from 'opentype.js';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import kalam from '../fonts/Kalam-Regular.ttf';
import {
  colourText,
  fontFaces,
  readColour,
  resolveVariables,
  themeVariables,
} from './css.js';
import type { Rgba, Theme, Variables } from './css.js';

export { THEMES } from './css.js';
export type { Theme } from './css.js';

/** The three colours a theme is made of, each a resolved `rgb()`/`rgba()` value. */
interface Palette {
  ink: string;
  paper: string;
  muted: string;
}

/** The colour variables a stylesheet may set. */
const COLOUR_VARIABLES = ['--ink', '--paper', '--muted'] as const;
type ColourVariable = (typeof COLOUR_VARIABLES)[number];

/** The font family variable a stylesheet may set. */
const FONT_VARIABLE = '--font-hand';

/** Built-in themes: the same ink, paper and muted sb's converter falls back to. */
const DEFAULT_COLOURS: Readonly<Record<Theme, Readonly<Record<ColourVariable, Rgba>>>> = {
  light: {
    '--ink': { r: 0x1a, g: 0x1a, b: 0x1a, a: 255 },
    '--paper': { r: 0xff, g: 0xff, b: 0xf8, a: 255 },
    '--muted': { r: 0x4a, g: 0x4a, b: 0x4a, a: 255 },
  },
  dark: {
    '--ink': { r: 0xff, g: 0xff, b: 0xf8, a: 255 },
    '--paper': { r: 0x1a, g: 0x1a, b: 0x1a, a: 255 },
    '--muted': { r: 0xc9, g: 0xc7, b: 0xbd, a: 255 },
  },
};

/** Kalam, bundled so `ez png` needs no font file to work. */
const BUNDLED_FONT: Uint8Array = kalam;
const BUNDLED_FONT_NAME = 'Kalam';

/** Only files on this machine can be read; a URL is not one. */
const REMOTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** What the `png` command asks for, after the CLI has read the arguments. */
export interface PngOptions {
  theme: Theme;
  cssPath?: string;
  ink?: string;
  paper?: string;
  muted?: string;
  fontPath?: string;
}

/**
 * A PNG, or the plain-text problems that stopped one being drawn. `notes` are
 * the things worth saying that did not stop the render, such as a remote font
 * being ignored.
 */
type PngResult =
  | { ok: true; png: Uint8Array; notes: string[] }
  | { ok: false; problems: string[] };

/** Resolves the theme, picks the font and rasterises the SVG in one step. */
export async function renderPng(svg: string, options: PngOptions): Promise<PngResult> {
  const stylesheet = await readStylesheet(options.cssPath);
  if (!stylesheet.ok) {
    return stylesheet;
  }

  const palette = preparePalette(options, stylesheet.value);
  if (!palette.ok) {
    return palette;
  }

  const notes: string[] = [];
  const font = await prepareFont(options, stylesheet.value, palette.value.fontFamily, notes);
  if (!font.ok) {
    return font;
  }

  const family = palette.value.fontFamily ?? font.value.family;
  const resolved = resolveSvg(svg, palette.value.palette, family);
  if (!resolved.ok) {
    return resolved;
  }

  try {
    const png = await rasterise(resolved.value, palette.value.palette, font.value);
    return { ok: true, png, notes };
  } catch (error) {
    return { ok: false, problems: [`cannot rasterise the Scene: ${messageOf(error)}`] };
  }
}

interface Stylesheet {
  css: string;
  path: string;
}

async function readStylesheet(
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

interface PreparedPalette {
  palette: Palette;
  /** The effective `--font-hand`, or null when the stylesheet leaves the font to the file. */
  fontFamily: string | null;
}

function preparePalette(
  options: PngOptions,
  stylesheet: Stylesheet | null,
): { ok: true; value: PreparedPalette } | { ok: false; problems: string[] } {
  const variables: Variables = stylesheet === null ? {} : themeVariables(stylesheet.css, options.theme);
  const flags: Readonly<Record<ColourVariable, string | undefined>> = {
    '--ink': options.ink,
    '--paper': options.paper,
    '--muted': options.muted,
  };
  const palette: Partial<Palette> = {};
  const missing: string[] = [];
  const problems: string[] = [];

  for (const name of COLOUR_VARIABLES) {
    const key = name.slice(2) as keyof Palette;
    const fromFlag = flags[name];
    const declared = fromFlag ?? variables[name];
    if (declared === undefined) {
      if (stylesheet === null) {
        palette[key] = colourText(DEFAULT_COLOURS[options.theme][name]);
      } else {
        missing.push(options.theme === 'dark' ? `${name} (dark)` : name);
      }
      continue;
    }
    const checked = paletteColour(name, declared, fromFlag !== undefined, variables);
    if (!checked.ok) {
      problems.push(checked.problem);
      continue;
    }
    palette[key] = checked.value;
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  if (missing.length > 0) {
    return { ok: false, problems: [`stylesheet is missing: ${missing.join(', ')}`] };
  }

  // `--font` wins over the stylesheet, so the stylesheet's `--font-hand` is
  // only read — and only has to resolve — when the font comes from the CSS.
  let fontFamily: string | null = null;
  const declaredFamily = options.fontPath === undefined ? variables[FONT_VARIABLE] : undefined;
  if (declaredFamily !== undefined) {
    const resolved = resolveVariables(declaredFamily, variables);
    if (!resolved.ok) {
      return {
        ok: false,
        problems: [`stylesheet font ${FONT_VARIABLE} is unresolved: ${resolved.unresolved}`],
      };
    }
    fontFamily = resolved.value.trim() === '' ? null : resolved.value.trim();
  }

  return { ok: true, value: { palette: palette as Palette, fontFamily } };
}

function paletteColour(
  name: ColourVariable,
  source: string,
  fromFlag: boolean,
  variables: Variables,
): { ok: true; value: string } | { ok: false; problem: string } {
  const resolved = fromFlag ? ({ ok: true, value: source } as const) : resolveVariables(source, variables);
  const where = fromFlag ? `flag ${name}` : `stylesheet colour ${name}`;
  if (!resolved.ok) {
    return { ok: false, problem: `stylesheet colour ${name} is unresolved: ${resolved.unresolved}` };
  }
  const colour = readColour(resolved.value);
  if (colour === null) {
    return { ok: false, problem: `${where} is not a colour: ${resolved.value.trim()}` };
  }
  return { ok: true, value: colourText(colour) };
}

/** A font file parsed once: the bytes resvg needs and the family it draws as. */
interface PreparedFont {
  bytes: Uint8Array;
  family: string;
}

async function prepareFont(
  options: PngOptions,
  stylesheet: Stylesheet | null,
  fontFamily: string | null,
  notes: string[],
): Promise<{ ok: true; value: PreparedFont } | { ok: false; problems: string[] }> {
  if (options.fontPath !== undefined) {
    return fontFromFile(options.fontPath, options.fontPath);
  }

  if (stylesheet !== null) {
    const face = fontFaces(stylesheet.css).find((candidate) => familyMatches(candidate.family, fontFamily));
    if (face !== undefined) {
      if (REMOTE_URL.test(face.url)) {
        notes.push(`stylesheet font ${face.url} is remote, so the bundled ${BUNDLED_FONT_NAME} is used`);
      } else {
        const path = resolve(dirname(stylesheet.path), face.url);
        return fontFromFile(path, `${face.url} (from ${stylesheet.path})`);
      }
    }
  }

  return checkFont(BUNDLED_FONT, BUNDLED_FONT_NAME);
}

async function fontFromFile(
  path: string,
  label: string,
): Promise<{ ok: true; value: PreparedFont } | { ok: false; problems: string[] }> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (error) {
    return { ok: false, problems: [`cannot read font ${label}: ${messageOf(error)}`] };
  }
  return checkFont(bytes, label);
}

/**
 * Parses a font once, so resvg is told a family the file really provides and
 * an unusable file is a problem instead of a blank drawing.
 */
function checkFont(
  bytes: Uint8Array,
  label: string,
): { ok: true; value: PreparedFont } | { ok: false; problems: string[] } {
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

/** Whether `family` names the `@font-face` family, allowing a font stack. */
function familyMatches(faceFamily: string, fontFamily: string | null): boolean {
  if (fontFamily === null) {
    return false;
  }
  const plain = (name: string): string => name.trim().replace(/^["']|["']$/g, '').toLowerCase();
  return fontFamily.split(',').map(plain).includes(plain(faceFamily));
}

/**
 * Replaces every `var()` and `color-mix()` in the SVG's colour and font
 * attributes, so resvg has nothing left to resolve. Anything still unresolved
 * is a problem naming it; a colour attribute that is not a colour is one too.
 */
function resolveSvg(
  svg: string,
  palette: Palette,
  family: string,
): { ok: true; value: string } | { ok: false; problems: string[] } {
  const variables: Variables = {
    '--ink': palette.ink,
    '--paper': palette.paper,
    '--muted': palette.muted,
    [FONT_VARIABLE]: family,
  };
  const problems: string[] = [];
  const resolved = svg.replace(
    /\b(fill|stroke|font-family|color)="([^"]*)"/g,
    (match, name: string, value: string) => {
      if (!/(?:var|color-mix)\(/.test(value)) {
        return match;
      }
      const resolution = resolveVariables(value, variables);
      if (!resolution.ok) {
        problems.push(`the drawing is unresolved: ${resolution.unresolved}`);
        return match;
      }
      if (name !== 'font-family' && readColour(resolution.value) === null) {
        problems.push(`the drawing colour ${name} is not one this subset reads: ${resolution.value.trim()}`);
        return match;
      }
      // A font stack may arrive quoted — `"Kalam", cursive` — so the quotes
      // have to be escaped before they land inside a double-quoted attribute.
      return `${name}="${resolution.value.replace(/"/g, '&quot;')}"`;
    },
  );
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: resolved };
}

async function rasterise(svg: string, palette: Palette, font: PreparedFont): Promise<Uint8Array> {
  await readyWasm();
  const resvg = new Resvg(svg, {
    background: palette.paper,
    fitTo: { mode: 'original' },
    font: { fontBuffers: [font.bytes], loadSystemFonts: false, defaultFontFamily: font.family },
  });
  try {
    return resvg.render().asPng();
  } finally {
    resvg.free();
  }
}

/** `initWasm` may only run once per process, so it is memoised. */
let wasmReady: Promise<void> | null = null;

function readyWasm(): Promise<void> {
  wasmReady ??= initWasm(resvgWasm);
  return wasmReady;
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
