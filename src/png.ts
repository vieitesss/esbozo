/**
 * PNG: the Renderer's SVG in, PNG bytes out, in light or dark.
 *
 * resvg has no CSS engine: it knows neither `var(--ink)` nor `color-mix()`. So
 * the SVG is resolved first — every `var()` and every `color-mix()` inside a
 * colour or font attribute becomes a concrete value — and only then
 * rasterised. The paper colour is painted underneath by resvg itself.
 *
 * Themes:
 *   - The built-in light and dark palettes are sb's Excalidraw converter
 *     defaults, the prior art.
 *   - A stylesheet may replace them. Its `:root` (or `html`, `body`) block holds
 *     the light values, and its dark-mode block — `@media (prefers-color-scheme:
 *     dark)`, or a block whose selector names a dark theme such as `.dark` or
 *     `[data-theme="dark"]` — holds the dark values. Colours do not fall back
 *     from one theme to the other: asking for a theme the stylesheet does not
 *     define is an error that names the missing variables. `--font-hand` is the
 *     exception, because a font usually does not change with the theme: it is
 *     read from the dark block, else from the light block.
 *   - Explicit `--ink`, `--paper` and `--muted` win over the stylesheet.
 *
 * Colour parsing is deliberately small: `#rgb`, `#rrggbb`, `#rrggbbaa`,
 * `rgb()`, `rgba()`, `var()` and `color-mix(in srgb, …)`. A colour written any
 * other way (hsl(), oklch(), a named colour) is passed through untouched and
 * cannot take part in a mix. A mix is a plain per-channel lerp in gamma-encoded
 * sRGB, which is what `in srgb` means. Alpha is mixed the same way, without
 * premultiplying, because esbozo's colours are opaque.
 *
 * The font is a real file, not a promise: a TTF/OTF read from disk, or Kalam
 * bundled into the CLI. Its family name is read from the font's own `name`
 * table, so resvg is always told a family the file actually provides.
 */
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import kalam from '../fonts/Kalam-Regular.ttf';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** The three colours a theme is made of. */
export interface Palette {
  ink: string;
  paper: string;
  muted: string;
}

/** The colour variables a stylesheet may set. */
const COLOUR_VARIABLES = ['--ink', '--paper', '--muted'] as const;

/** The font family variable a stylesheet may set. */
const FONT_VARIABLE = '--font-hand';

/** Built-in themes: the same ink, paper and muted sb's converter falls back to. */
export const DEFAULT_PALETTES: Readonly<Record<Theme, Palette>> = {
  light: { ink: '#1a1a1a', paper: '#fffff8', muted: '#4a4a4a' },
  dark: { ink: '#fffff8', paper: '#1a1a1a', muted: '#c9c7bd' },
};

/** Kalam, bundled so `ez png` needs no font file to work. */
export const BUNDLED_FONT: Uint8Array = kalam;

const DEFAULT_FONT_FAMILY = 'Kalam';

type PaletteResult =
  | { ok: true; palette: Palette; fontFamily: string | null }
  | { ok: false; missing: string[] };

/**
 * Reads `--ink`, `--paper`, `--muted` and `--font-hand` for one theme out of a
 * stylesheet. `overrides` (the explicit flags) win, and may complete a
 * stylesheet that leaves a name out.
 */
export function paletteFromStylesheet(
  css: string,
  theme: Theme,
  overrides: Partial<Palette> = {},
): PaletteResult {
  const tokens = readTokens(css);
  const table = theme === 'dark' ? tokens.dark : tokens.light;
  const palette: Partial<Palette> = {};
  const missing: string[] = [];
  for (const name of COLOUR_VARIABLES) {
    const key = name.slice(2) as keyof Palette;
    const declared = table[name];
    const value = overrides[key] ?? (declared === undefined ? undefined : resolveVariables(declared, table));
    if (value === undefined || value.trim() === '') {
      missing.push(theme === 'dark' ? `${name} (dark)` : name);
      continue;
    }
    palette[key] = value;
  }
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  const fontFamily =
    resolveVariables(tokens.dark[FONT_VARIABLE], tokens.dark) ??
    resolveVariables(tokens.light[FONT_VARIABLE], tokens.light) ??
    null;
  return { ok: true, palette: palette as Palette, fontFamily };
}

/**
 * Replaces every `var()` and `color-mix()` in the SVG's colour and font
 * attributes, so resvg has nothing left to resolve. `fontFamily` overrides the
 * family the SVG asks for; null keeps whatever the stylesheet said.
 */
function resolveSvg(svg: string, palette: Palette, fontFamily: string | null): string {
  const scope = scopeOf(palette);
  if (fontFamily !== null) {
    scope[FONT_VARIABLE] = fontFamily;
  }
  return svg.replace(/\b(fill|stroke|font-family|color)="([^"]*)"/g, (_match, name: string, value: string) => {
    if (!/(?:var|color-mix)\(/.test(value)) {
      return `${name}="${value}"`;
    }
    // A font stack may arrive quoted — `"Kalam", cursive` — so the quotes have
    // to be escaped before they land inside a double-quoted attribute.
    const resolved = resolveValue(value, scope).replace(/"/g, '&quot;');
    return `${name}="${resolved}"`;
  });
}

/** The palette as a `var()` lookup table. */
function scopeOf(palette: Palette): Record<string, string> {
  return { '--ink': palette.ink, '--paper': palette.paper, '--muted': palette.muted };
}

/** The family a font file calls itself, or null when the file has no usable name table. */
function fontFamilyOf(bytes: Uint8Array): string | null {
  return readFontName(bytes)?.family ?? null;
}

type FontCheck = { ok: true; family: string } | { ok: false; problem: string };

/**
 * Accepts TrueType, OpenType and TrueType collections, the shapes resvg can
 * rasterise. WOFF and WOFF2 are compressed containers rather than fonts resvg
 * reads, so they are named as a problem instead of being silently ignored.
 */
export function readFont(bytes: Uint8Array): FontCheck {
  const signature = bytes.length >= 4 ? new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0) : 0;
  const tag = tagAt(bytes, 0);
  if (tag === 'wOFF' || tag === 'wOF2') {
    return { ok: false, problem: `is a compressed webfont (${tag}), not a TrueType or OpenType font` };
  }
  const known = signature === 0x00010000 || tag === 'true' || tag === 'OTTO' || tag === 'ttcf';
  if (!known) {
    return { ok: false, problem: 'is not a TrueType or OpenType font' };
  }
  return { ok: true, family: readFontName(bytes)?.family ?? DEFAULT_FONT_FAMILY };
}

export interface RasterOptions {
  palette: Palette;
  font: Uint8Array;
  /** The family the SVG should ask for; defaults to the family the font file provides. */
  fontFamily?: string | null;
}

/** Rasterises a Renderer SVG: paper as the background, one PNG byte array out. */
export async function rasterise(svg: string, options: RasterOptions): Promise<Uint8Array> {
  const fileFamily = fontFamilyOf(options.font) ?? DEFAULT_FONT_FAMILY;
  const resolved = resolveSvg(svg, options.palette, options.fontFamily ?? fileFamily);
  await readyWasm();
  const paper = resolveValue(options.palette.paper, scopeOf(options.palette));
  const resvg = new Resvg(resolved, {
    background: paper,
    fitTo: { mode: 'original' },
    font: { fontBuffers: [options.font], loadSystemFonts: false, defaultFontFamily: fileFamily },
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

/** The light and dark declaration tables a stylesheet gives. */
interface Tokens {
  light: Record<string, string>;
  dark: Record<string, string>;
}

/**
 * Splits a stylesheet into a light table and a dark table. Comments are
 * dropped, every block is walked (media queries nest a `:root` inside them),
 * and once inside a dark block every declaration is dark.
 */
function readTokens(css: string): Tokens {
  const tokens: Tokens = { light: {}, dark: {} };
  walk(stripComments(css), tokens, 'light');
  return tokens;
}

const LIGHT_SELECTORS = /^(?::root|html|body)$/i;
/**
 * A block is a dark block when its prelude mentions dark at all: that covers
 * `@media (prefers-color-scheme: dark)`, `:root.dark`, `.dark` and
 * `[data-theme="dark"]`, the four spellings a site is likely to use.
 */
const DARK_PRELUDE = /dark/i;

function walk(css: string, tokens: Tokens, target: 'light' | 'dark'): void {
  for (const block of topLevelBlocks(css)) {
    const prelude = block.prelude.trim();
    const next = target === 'dark' || DARK_PRELUDE.test(prelude) ? 'dark' : 'light';
    if (block.body.includes('{')) {
      walk(block.body, tokens, next);
      continue;
    }
    if (next === 'light' && !LIGHT_SELECTORS.test(prelude)) {
      continue;
    }
    for (const declaration of declarationsOf(block.body)) {
      tokens[next][declaration.name] ??= declaration.value;
    }
  }
}

/** Every `selector { body }` at this level of a stylesheet, bodies kept raw. */
function topLevelBlocks(css: string): { prelude: string; body: string }[] {
  const blocks: { prelude: string; body: string }[] = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = -1;
  for (let i = 0; i < css.length; i += 1) {
    const character = css[i];
    if (character === '{') {
      if (depth === 0) {
        bodyStart = i + 1;
      }
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0 && bodyStart >= 0) {
        blocks.push({ prelude: css.slice(preludeStart, bodyStart - 1), body: css.slice(bodyStart, i) });
        preludeStart = i + 1;
        bodyStart = -1;
      }
    } else if (character === ';' && depth === 0) {
      preludeStart = i + 1;
    }
  }
  return blocks;
}

function declarationsOf(body: string): { name: string; value: string }[] {
  const declarations: { name: string; value: string }[] = [];
  for (const raw of body.split(';')) {
    const colon = raw.indexOf(':');
    if (colon < 0) {
      continue;
    }
    const name = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    if (name.startsWith('--') && value !== '') {
      declarations.push({ name, value });
    }
  }
  return declarations;
}

/** `var(--ink)` becomes its declared value; `var(--ink, #000)` falls back when the name is unknown. */
function resolveVariables(value: string | undefined, table: Record<string, string>): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return replaceInnermost(value, (name, arguments_) => {
    if (name === 'color-mix') {
      return `color-mix(${arguments_})`;
    }
    const comma = arguments_.indexOf(',');
    const variable = (comma < 0 ? arguments_ : arguments_.slice(0, comma)).trim();
    const fallback = comma < 0 ? undefined : arguments_.slice(comma + 1).trim();
    return table[variable] ?? fallback ?? '';
  });
}

/**
 * Resolves `var()` and `color-mix()` from the inside out: a mix may hold a
 * variable, and a variable may hold another mix, so one pass is not enough.
 */
function resolveValue(value: string, scope: Record<string, string>): string {
  let current = value;
  for (let pass = 0; pass < 8 && /(?:var|color-mix)\(/.test(current); pass += 1) {
    const next = replaceInnermost(current, (name, arguments_) => {
      if (name === 'var') {
        const comma = arguments_.indexOf(',');
        const variable = (comma < 0 ? arguments_ : arguments_.slice(0, comma)).trim();
        const fallback = comma < 0 ? undefined : arguments_.slice(comma + 1).trim();
        return scope[variable] ?? fallback ?? `var(${arguments_})`;
      }
      return mixColours(arguments_) ?? `color-mix(${arguments_})`;
    });
    if (next === current) {
      return current;
    }
    current = next;
  }
  return current;
}

/** Calls the innermost `var()`/`color-mix()` in `value`; inner arguments hold no parentheses. */
function replaceInnermost(value: string, replace: (name: string, arguments_: string) => string): string {
  return value.replace(/\b(var|color-mix)\(([^()]*)\)/g, (_match, name: string, arguments_: string) => replace(name, arguments_));
}

interface Colour {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * `in srgb, <colour> [p%], <colour> [p%]` into `rgb()`/`rgba()`, or null when
 * the arguments are not a shape this small parser understands.
 */
function mixColours(arguments_: string): string | null {
  const parts = arguments_.split(',').map((part) => part.trim());
  if (parts.length !== 3 || !/^in\s+srgb$/i.test(parts[0] ?? '')) {
    return null;
  }
  const first = readWeightedColour(parts[1] ?? '');
  const second = readWeightedColour(parts[2] ?? '');
  if (first === null || second === null) {
    return null;
  }
  let firstWeight = first.weight;
  let secondWeight = second.weight;
  if (firstWeight === null && secondWeight === null) {
    firstWeight = 50;
    secondWeight = 50;
  } else if (firstWeight === null) {
    firstWeight = 100 - (secondWeight as number);
  } else if (secondWeight === null) {
    secondWeight = 100 - firstWeight;
  }
  const total = (firstWeight as number) + (secondWeight as number);
  if (total <= 0) {
    return null;
  }
  const share = (firstWeight as number) / total;
  const channel = (a: number, b: number): number => Math.round(a * share + b * (1 - share));
  const r = channel(first.colour.r, second.colour.r);
  const g = channel(first.colour.g, second.colour.g);
  const b = channel(first.colour.b, second.colour.b);
  const alpha = channel(first.colour.a, second.colour.a);
  return alpha === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round(alpha / 255)})`;
}

function readWeightedColour(text: string): { colour: Colour; weight: number | null } | null {
  const match = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  const colour = readColour((match[1] ?? '').trim());
  if (colour === null) {
    return null;
  }
  const weight = match[2] === undefined ? null : Number(match[2]);
  return { colour, weight: weight !== null && Number.isFinite(weight) ? weight : null };
}

/** The colour notations this module understands, in sRGB with 0–255 channels. */
function readColour(text: string): Colour | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (hex !== null) {
    const digits = hex[1] ?? '';
    const short = digits.length === 3 || digits.length === 4;
    const step = short ? 1 : 2;
    const channels: number[] = [];
    for (let i = 0; i + step <= digits.length; i += step) {
      channels.push(Number.parseInt(short ? `${digits[i]}${digits[i]}` : digits.slice(i, i + step), 16));
    }
    if (channels.length < 3 || channels.length > 4) {
      return null;
    }
    return { r: channels[0] ?? 0, g: channels[1] ?? 0, b: channels[2] ?? 0, a: channels[3] ?? 255 };
  }
  const functional = /^rgba?\(([^)]*)\)$/i.exec(text);
  if (functional !== null) {
    const parts = (functional[1] ?? '').split(/[\s,/]+/).filter((part) => part !== '');
    if (parts.length < 3 || parts.length > 4) {
      return null;
    }
    const channels = parts.map((part) => {
      const numeric = Number(part.replace(/%$/, ''));
      if (!Number.isFinite(numeric)) {
        return null;
      }
      return part.endsWith('%') ? Math.round((numeric / 100) * 255) : Math.round(numeric);
    });
    if (channels.some((value) => value === null)) {
      return null;
    }
    const [r, g, b, a] = channels as [number, number, number, number | undefined];
    return { r, g, b, a: a ?? 255 };
  }
  return null;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function tagAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

/** The family name in a font's `name` table, preferring the Windows Unicode record. */
function readFontName(bytes: Uint8Array): { family: string } | null {
  if (bytes.length < 12) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let directory = 0;
  if (tagAt(bytes, 0) === 'ttcf') {
    if (bytes.length < 16) {
      return null;
    }
    directory = view.getUint32(12);
  }
  if (directory + 12 > bytes.length) {
    return null;
  }
  const tables = view.getUint16(directory + 4);
  for (let index = 0; index < tables; index += 1) {
    const record = directory + 12 + index * 16;
    if (record + 16 > bytes.length) {
      return null;
    }
    if (tagAt(bytes, record) !== 'name') {
      continue;
    }
    const nameTable = view.getUint32(record + 8);
    if (nameTable + 6 > bytes.length) {
      return null;
    }
    const count = view.getUint16(nameTable + 2);
    const strings = nameTable + view.getUint16(nameTable + 4);
    let windows: string | null = null;
    let mac: string | null = null;
    for (let entry = 0; entry < count; entry += 1) {
      const at = nameTable + 6 + entry * 12;
      if (at + 12 > bytes.length) {
        break;
      }
      const platform = view.getUint16(at);
      const nameId = view.getUint16(at + 6);
      if (nameId !== 1 && nameId !== 16) {
        continue;
      }
      const length = view.getUint16(at + 8);
      const offset = strings + view.getUint16(at + 10);
      if (offset + length > bytes.length) {
        continue;
      }
      const slice = bytes.subarray(offset, offset + length);
      if (platform === 3) {
        windows ??= decodeUtf16BigEndian(slice);
      } else if (platform === 1) {
        mac ??= new TextDecoder('macintosh').decode(slice);
      }
    }
    const found = windows ?? mac;
    if (found !== null) {
      return { family: found };
    }
  }
  return null;
}

function decodeUtf16BigEndian(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
  }
  return out;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}
