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
 *     a component's colours never become the page's palette. So is every other
 *     grouping at-rule: only `@media (prefers-color-scheme: dark)` is entered.
 *   - Values may use recursive `var()` with fallbacks and
 *     `color-mix(in srgb, A p%, B)`, whose operands may be hex, `rgb()`/
 *     `rgba()` or a CSS named colour. Anything else is reported, not guessed.
 *   - Palette colours are opaque: a colour with alpha below 1 is a problem, so
 *     nothing is mixed unpremultiplied. A wash is an ink mixed into the paper.
 *   - `--font-hand` follows the same cascade per theme: light never reads the
 *     dark font.
 *   - A palette is complete when every colour of the chosen theme has a value;
 *     dark inherits the light values, so a `:root`-only stylesheet covers both
 *     themes. Nothing is filled in from the built-ins once a stylesheet is
 *     given.
 *
 * Fonts: `./font.ts` chooses them, and the precedence is the same for every
 * command that measures — `--font`, then a local `@font-face` for the
 * stylesheet's `--font-hand`, then the bundled Kalam — so `ez check` and
 * `ez png` measure the same bytes for the same inputs. The font is read once,
 * and the same bytes are used for two things: Layout measures the Scene's words
 * with them, so the drawing that is rasterised has the line breaks this font
 * makes, and resvg draws the glyphs with them, so the PNG shows the font it was
 * measured for.
 *
 * The built-in light and dark palettes are sb's Excalidraw converter defaults,
 * the prior art.
 */
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import { colourText, readColour, resolveSvgColours, resolveVariables, themeVariables } from './css.js';
import type { Rgba, Theme, Variables } from './css.js';
import { chooseFont, layoutFor, readStylesheet } from './font.js';
import type { FontFile, Stylesheet } from './font.js';
import { renderScene } from './renderer.js';
import type { Scene } from './scene.js';

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

/** Resolves the theme, measures and renders the Scene, and rasterises it in one step. */
export async function renderPng(scene: Scene, options: PngOptions): Promise<PngResult> {
  const stylesheet = await readStylesheet(options.cssPath);
  if (!stylesheet.ok) {
    return stylesheet;
  }

  const palette = preparePalette(options, stylesheet.value);
  if (!palette.ok) {
    return palette;
  }

  const font = await chooseFont(options.fontPath, stylesheet.value, options.theme);
  if (!font.ok) {
    return font;
  }
  const notes = font.notes;

  const family = font.family ?? font.value.family;
  // The words are measured with the font the glyphs are drawn with, so the PNG
  // wraps exactly as that font makes it wrap.
  const svg = renderScene(scene, layoutFor(font.value));
  const resolved = resolveSvgColours(svg, {
    '--ink': palette.value.ink,
    '--paper': palette.value.paper,
    '--muted': palette.value.muted,
    [FONT_VARIABLE]: family,
  });
  if (!resolved.ok) {
    return resolved;
  }

  try {
    const png = await rasterise(resolved.value, palette.value, font.value);
    return { ok: true, png, notes };
  } catch (error) {
    return { ok: false, problems: [`cannot rasterise the Scene: ${messageOf(error)}`] };
  }
}

function preparePalette(
  options: PngOptions,
  stylesheet: Stylesheet | null,
): { ok: true; value: Palette } | { ok: false; problems: string[] } {
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

  return { ok: true, value: palette as Palette };
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
  // A palette is opaque: resvg would mix a translucent value unpremultiplied,
  // so a wash is mixed into the paper here instead, in opaque channels.
  if (colour.a < 255) {
    return { ok: false, problem: `colours must be opaque: ${where} is ${resolved.value.trim()}` };
  }
  return { ok: true, value: colourText(colour) };
}

async function rasterise(svg: string, palette: Palette, font: FontFile): Promise<Uint8Array> {
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

function messageOf(error: unknown): string {
  return (error as NodeJS.ErrnoException).message;
}
