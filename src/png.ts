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
 * Fonts: `./font.ts` chooses them, and the precedence is the same for every
 * command that measures — `--font`, then a local `@font-face` for the
 * stylesheet's `--font-hand`, then the bundled Kalam — so `ez check` and
 * `ez png` measure the same bytes for the same inputs. The font is read once,
 * and that one parse does both jobs: Layout measures the Scene's words with it,
 * so the line breaks are the font's, and its glyphs are drawn from the same
 * outlines (`./glyphs.ts`), so the PNG shows the font it was measured for. A
 * PNG therefore has no `<text>` left in it: no text engine lays the words out a
 * second time, and `ez render` keeps real `<text>` because a person can select
 * it.
 *
 * The built-in light and dark palettes are sb's Excalidraw converter defaults,
 * the prior art.
 */
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import { colourText, readColour, resolveSvgColours, resolveVariables, themeVariables } from './css.js';
import type { Rgba, Theme, Variables } from './css.js';
import { chooseFont, layoutFor, readStylesheet } from './font.js';
import type { Stylesheet } from './font.js';
import { outlineText } from './outlines.js';
import { renderScene } from './renderer.js';
import type { Scene } from './scene.js';

export type { Theme } from './css.js';

interface Palette {
  ink: string;
  paper: string;
  muted: string;
}

const COLOUR_VARIABLES = ['--ink', '--paper', '--muted'] as const;
type ColourVariable = (typeof COLOUR_VARIABLES)[number];

const FONT_VARIABLE = '--font-hand';

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

export interface PngOptions {
  theme: Theme;
  cssPath?: string;
  ink?: string;
  paper?: string;
  muted?: string;
  fontPath?: string;
}

type PngResult =
  | { ok: true; png: Uint8Array; notes: string[] }
  | { ok: false; problems: string[] };

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
  const layout = layoutFor(font.value);
  const svg = renderScene(scene, layout);
  const resolved = resolveSvgColours(svg, {
    '--ink': palette.value.ink,
    '--paper': palette.value.paper,
    '--muted': palette.value.muted,
    [FONT_VARIABLE]: family,
  });
  if (!resolved.ok) {
    return resolved;
  }
  if (layout.glyphs === undefined) {
    return { ok: false, problems: ['the font this Scene was measured with gave no outlines to draw'] };
  }
  const outlined = outlineText(resolved.value, layout.glyphs);
  if (!outlined.ok) {
    return { ok: false, problems: outlined.problems };
  }

  try {
    const png = await rasterise(outlined.svg, palette.value);
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

async function rasterise(svg: string, palette: Palette): Promise<Uint8Array> {
  await readyWasm();
  const resvg = new Resvg(svg, {
    background: palette.paper,
    fitTo: { mode: 'original' },
  });
  try {
    return resvg.render().asPng();
  } finally {
    resvg.free();
  }
}

let wasmReady: Promise<void> | null = null;

function readyWasm(): Promise<void> {
  wasmReady ??= initWasm(resvgWasm);
  return wasmReady;
}

function messageOf(error: unknown): string {
  return (error as NodeJS.ErrnoException).message;
}
