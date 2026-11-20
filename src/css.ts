/**
 * The stylesheet subset `ez png` reads, and the one colour resolver both the
 * stylesheet pass and the SVG pass use.
 *
 * The subset, documented for whoever writes the site's CSS:
 *
 *   - The light theme is the custom properties declared in `:root` or `html`
 *     blocks.
 *   - The dark theme is those same values, overridden by declarations in
 *     `@media (prefers-color-scheme: dark)` blocks and in the explicit dark
 *     scopes on the root only: `:root.dark`, `:root[data-theme="dark"]`,
 *     `html.dark`, `html[data-theme="dark"]`. Dark declarations always win over
 *     base ones, and a later declaration wins over an earlier one.
 *   - Any other selector (`.dark-card`, `.dark`, `body`, `.card`) is ignored: a
 *     component's colours are not the page's palette.
 *   - Any other grouping at-rule — `@media print`,
 *     `@media (prefers-color-scheme: light)`, `@supports`, `@layer`,
 *     `@container` — is ignored for both themes. A group this subset does not
 *     model never reaches a theme.
 *   - A `@font-face` rule keeps the scope it is written in: one inside dark
 *     scope is dark's font alone, and the light theme never reads it.
 *   - Values may use `var()` — recursive, with `var(--x, fallback)` — and
 *     `color-mix(in srgb, A p%, B)`, whose operands may themselves be `var()`s.
 *     Parentheses are matched, so nesting works to any depth.
 *   - A colour is `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()` (comma or
 *     space syntax, percentages allowed) or one of the CSS named colours.
 *     Anything else is reported as unresolved rather than passed to resvg,
 *     which would paint it black.
 *
 * Everything here is pure: text in, values out, no I/O and no state.
 */

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Custom properties that apply to one theme, in the order the cascade left them. */
export type Variables = Readonly<Record<string, string>>;

/** A colour in gamma-encoded sRGB: 0–255 channels, alpha 0–255. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A `var()`/`color-mix()` result, or the smallest expression that would not resolve. */
export type Resolution = { ok: true; value: string } | { ok: false; unresolved: string };

/**
 * A `@font-face` rule: the family it declares, the first source it lists, and
 * whether the rule only applies to the dark theme.
 */
export interface FontFace {
  family: string;
  url: string;
  dark: boolean;
}

const LIGHT_ROOT = /^(?::root|html)$/i;
const DARK_ROOT = /^(?::root|html)(?:\.dark|\[data-theme\s*=\s*(?:"dark"|'dark'|dark)\])$/i;
const DARK_MEDIA = /@media[^{]*prefers-color-scheme\s*:\s*dark/i;

/**
 * The custom properties that apply to `theme`. Dark starts from the light
 * declarations, so a stylesheet that only declares `:root` describes both
 * themes and a dark block only has to name what changes.
 */
export function themeVariables(css: string, theme: Theme): Variables {
  const base: Record<string, string> = {};
  const dark: Record<string, string> = {};
  eachRule(stripComments(css), (prelude, body, inDarkBlock) => {
    if (prelude.startsWith('@')) {
      return;
    }
    for (const raw of prelude.split(',')) {
      const selector = raw.trim();
      if (!inDarkBlock && LIGHT_ROOT.test(selector)) {
        assign(base, body);
      }
      if (DARK_ROOT.test(selector) || (inDarkBlock && LIGHT_ROOT.test(selector))) {
        assign(dark, body);
      }
    }
  });
  return theme === 'dark' ? { ...base, ...dark } : base;
}

/** Every `@font-face` rule in a stylesheet, in source order, with its theme scope. */
export function fontFaces(css: string): FontFace[] {
  const faces: FontFace[] = [];
  eachRule(stripComments(css), (prelude, body, inDarkBlock) => {
    if (!/^@font-face$/i.test(prelude)) {
      return;
    }
    const declarations = declarationsOf(body);
    const family = declarations.find((declaration) => declaration.name === 'font-family')?.value;
    const source = declarations.find((declaration) => declaration.name === 'src')?.value;
    const url = source === undefined ? null : /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/.exec(source);
    const found = url?.[1] ?? url?.[2] ?? url?.[3];
    if (family === undefined || found === undefined) {
      return;
    }
    faces.push({ family: unquote(family), url: found.trim(), dark: inDarkBlock });
  });
  return faces;
}

/**
 * Resolves every `var()` and `color-mix()` in a value. Recursion carries the
 * names already expanded, so `--a: var(--b); --b: var(--a)` is reported as
 * unresolved instead of looping.
 */
export function resolveVariables(value: string, variables: Variables): Resolution {
  return resolveText(value, variables, [], 0);
}

/** A colour in the subset's grammar, or null when `text` is not one. */
export function readColour(text: string): Rgba | null {
  const trimmed = text.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(trimmed);
  if (hex !== null) {
    const digits = hex[1] ?? '';
    if (![3, 4, 6, 8].includes(digits.length)) {
      return null;
    }
    const short = digits.length === 3 || digits.length === 4;
    const step = short ? 1 : 2;
    const channels: number[] = [];
    for (let index = 0; index + step <= digits.length; index += step) {
      channels.push(
        Number.parseInt(short ? `${digits[index]}${digits[index]}` : digits.slice(index, index + step), 16),
      );
    }
    if (channels.length < 3 || channels.length > 4) {
      return null;
    }
    return {
      r: channels[0] ?? 0,
      g: channels[1] ?? 0,
      b: channels[2] ?? 0,
      a: channels[3] ?? 255,
    };
  }

  const functional = /^rgba?\(([^()]*)\)$/i.exec(trimmed);
  if (functional !== null) {
    return readFunctionalColour(functional[1] ?? '');
  }

  // Only names in the table: `constructor` and friends are Object's, not CSS's.
  return NAMED_COLOURS.get(trimmed.toLowerCase()) ?? null;
}

/** `rgb()`/`rgba()` text for a colour, the form the SVG is resolved to. */
export function colourText(colour: Rgba): string {
  const { r, g, b, a } = colour;
  if (a >= 255) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
}

/** The longest nesting `resolveText` follows before calling a value unresolved. */
const MAX_DEPTH = 32;

const FUNCTIONS = ['color-mix', 'var'] as const;

function resolveText(
  text: string,
  variables: Variables,
  expanded: readonly string[],
  depth: number,
): Resolution {
  if (depth > MAX_DEPTH) {
    return { ok: false, unresolved: text.trim() };
  }
  let out = '';
  let index = 0;
  while (index < text.length) {
    const call = functionAt(text, index);
    if (call === null) {
      out += text[index] ?? '';
      index += 1;
      continue;
    }
    const close = closingParen(text, call.open);
    if (close < 0) {
      return { ok: false, unresolved: text.slice(index).trim() };
    }
    const arguments_ = text.slice(call.open + 1, close);
    const resolved =
      call.name === 'var'
        ? resolveVar(arguments_, variables, expanded, depth)
        : resolveMix(arguments_, variables, expanded, depth);
    if (!resolved.ok) {
      return resolved;
    }
    out += resolved.value;
    index = close + 1;
  }
  return { ok: true, value: out };
}

/** `var(` or `color-mix(` starting at `index`, at a word boundary. */
function functionAt(text: string, index: number): { name: (typeof FUNCTIONS)[number]; open: number } | null {
  if (index > 0 && /[-\w]/.test(text[index - 1] ?? '')) {
    return null;
  }
  for (const name of FUNCTIONS) {
    if (text.slice(index, index + name.length + 1).toLowerCase() === `${name}(`) {
      return { name, open: index + name.length };
    }
  }
  return null;
}

/** The index of the `)` matching the `(` at `open`, or -1 when it is unclosed. */
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/** Splits on `separator`, ignoring any inside parentheses. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
    } else if (character === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function resolveVar(
  arguments_: string,
  variables: Variables,
  expanded: readonly string[],
  depth: number,
): Resolution {
  const parts = splitTopLevel(arguments_, ',');
  const name = (parts[0] ?? '').trim();
  const fallback = parts.length > 1 ? parts.slice(1).join(',').trim() : undefined;
  const declared = variables[name];
  if (declared !== undefined) {
    if (expanded.includes(name)) {
      return { ok: false, unresolved: `var(${name})` };
    }
    return resolveText(declared, variables, [...expanded, name], depth + 1);
  }
  if (fallback !== undefined) {
    return resolveText(fallback, variables, expanded, depth + 1);
  }
  return { ok: false, unresolved: `var(${name})` };
}

function resolveMix(
  arguments_: string,
  variables: Variables,
  expanded: readonly string[],
  depth: number,
): Resolution {
  const inner = resolveText(arguments_, variables, expanded, depth + 1);
  if (!inner.ok) {
    return inner;
  }
  const mixed = mixColours(inner.value);
  if (mixed === null) {
    return { ok: false, unresolved: `color-mix(${inner.value.trim()})` };
  }
  return { ok: true, value: mixed };
}

/**
 * `in srgb, <colour> [p%], <colour> [p%]` into `rgb()`/`rgba()`, or null when
 * the arguments are not a shape this subset understands. One missing
 * percentage is the other's complement, two missing ones are 50/50, and
 * percentages that do not add up to 100 are normalised, as CSS does.
 */
function mixColours(arguments_: string): string | null {
  const parts = splitTopLevel(arguments_, ',').map((part) => part.trim());
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
  return colourText({
    r: channel(first.colour.r, second.colour.r),
    g: channel(first.colour.g, second.colour.g),
    b: channel(first.colour.b, second.colour.b),
    a: channel(first.colour.a, second.colour.a),
  });
}

function readWeightedColour(text: string): { colour: Rgba; weight: number | null } | null {
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

function readFunctionalColour(body: string): Rgba | null {
  const slash = body.indexOf('/');
  const channelsText = (slash < 0 ? body : body.slice(0, slash)).trim();
  const pieces = channelsText.split(/[\s,]+/).filter((piece) => piece !== '');
  const alphaText = slash < 0 ? undefined : body.slice(slash + 1).trim();
  const alphaPiece = pieces.length === 4 ? pieces.pop() : undefined;
  if (pieces.length !== 3) {
    return null;
  }
  const channels = pieces.map(readChannel);
  if (channels.some((channel) => channel === null)) {
    return null;
  }
  const alpha = readAlpha(alphaText ?? alphaPiece);
  if (alpha === null) {
    return null;
  }
  const [r, g, b] = channels as [number, number, number];
  return { r, g, b, a: alpha };
}

function readChannel(text: string): number | null {
  const numeric = Number(text.replace(/%$/, ''));
  if (text === '' || !Number.isFinite(numeric)) {
    return null;
  }
  return clamp(text.endsWith('%') ? Math.round((numeric / 100) * 255) : Math.round(numeric));
}

function readAlpha(text: string | undefined): number | null {
  if (text === undefined) {
    return 255;
  }
  const numeric = Number(text.replace(/%$/, ''));
  if (text === '' || !Number.isFinite(numeric)) {
    return null;
  }
  return clamp(text.endsWith('%') ? Math.round((numeric / 100) * 255) : Math.round(numeric * 255));
}

function clamp(value: number): number {
  return Math.min(255, Math.max(0, value));
}

/** The CSS named colours, as the hex they are defined by. */
const NAMED_HEX: Readonly<Record<string, string>> = {
  aliceblue: 'f0f8ff',
  antiquewhite: 'faebd7',
  aqua: '00ffff',
  aquamarine: '7fffd4',
  azure: 'f0ffff',
  beige: 'f5f5dc',
  bisque: 'ffe4c4',
  black: '000000',
  blanchedalmond: 'ffebcd',
  blue: '0000ff',
  blueviolet: '8a2be2',
  brown: 'a52a2a',
  burlywood: 'deb887',
  cadetblue: '5f9ea0',
  chartreuse: '7fff00',
  chocolate: 'd2691e',
  coral: 'ff7f50',
  cornflowerblue: '6495ed',
  cornsilk: 'fff8dc',
  crimson: 'dc143c',
  cyan: '00ffff',
  darkblue: '00008b',
  darkcyan: '008b8b',
  darkgoldenrod: 'b8860b',
  darkgray: 'a9a9a9',
  darkgreen: '006400',
  darkgrey: 'a9a9a9',
  darkkhaki: 'bdb76b',
  darkmagenta: '8b008b',
  darkolivegreen: '556b2f',
  darkorange: 'ff8c00',
  darkorchid: '9932cc',
  darkred: '8b0000',
  darksalmon: 'e9967a',
  darkseagreen: '8fbc8f',
  darkslateblue: '483d8b',
  darkslategray: '2f4f4f',
  darkslategrey: '2f4f4f',
  darkturquoise: '00ced1',
  darkviolet: '9400d3',
  deeppink: 'ff1493',
  deepskyblue: '00bfff',
  dimgray: '696969',
  dimgrey: '696969',
  dodgerblue: '1e90ff',
  firebrick: 'b22222',
  floralwhite: 'fffaf0',
  forestgreen: '228b22',
  fuchsia: 'ff00ff',
  gainsboro: 'dcdcdc',
  ghostwhite: 'f8f8ff',
  gold: 'ffd700',
  goldenrod: 'daa520',
  gray: '808080',
  green: '008000',
  greenyellow: 'adff2f',
  grey: '808080',
  honeydew: 'f0fff0',
  hotpink: 'ff69b4',
  indianred: 'cd5c5c',
  indigo: '4b0082',
  ivory: 'fffff0',
  khaki: 'f0e68c',
  lavender: 'e6e6fa',
  lavenderblush: 'fff0f5',
  lawngreen: '7cfc00',
  lemonchiffon: 'fffacd',
  lightblue: 'add8e6',
  lightcoral: 'f08080',
  lightcyan: 'e0ffff',
  lightgoldenrodyellow: 'fafad2',
  lightgray: 'd3d3d3',
  lightgreen: '90ee90',
  lightgrey: 'd3d3d3',
  lightpink: 'ffb6c1',
  lightsalmon: 'ffa07a',
  lightseagreen: '20b2aa',
  lightskyblue: '87cefa',
  lightslategray: '778899',
  lightslategrey: '778899',
  lightsteelblue: 'b0c4de',
  lightyellow: 'ffffe0',
  lime: '00ff00',
  limegreen: '32cd32',
  linen: 'faf0e6',
  magenta: 'ff00ff',
  maroon: '800000',
  mediumaquamarine: '66cdaa',
  mediumblue: '0000cd',
  mediumorchid: 'ba55d3',
  mediumpurple: '9370db',
  mediumseagreen: '3cb371',
  mediumslateblue: '7b68ee',
  mediumspringgreen: '00fa9a',
  mediumturquoise: '48d1cc',
  mediumvioletred: 'c71585',
  midnightblue: '191970',
  mintcream: 'f5fffa',
  mistyrose: 'ffe4e1',
  moccasin: 'ffe4b5',
  navajowhite: 'ffdead',
  navy: '000080',
  oldlace: 'fdf5e6',
  olive: '808000',
  olivedrab: '6b8e23',
  orange: 'ffa500',
  orangered: 'ff4500',
  orchid: 'da70d6',
  palegoldenrod: 'eee8aa',
  palegreen: '98fb98',
  paleturquoise: 'afeeee',
  palevioletred: 'db7093',
  papayawhip: 'ffefd5',
  peachpuff: 'ffdab9',
  peru: 'cd853f',
  pink: 'ffc0cb',
  plum: 'dda0dd',
  powderblue: 'b0e0e6',
  purple: '800080',
  rebeccapurple: '663399',
  red: 'ff0000',
  rosybrown: 'bc8f8f',
  royalblue: '4169e1',
  saddlebrown: '8b4513',
  salmon: 'fa8072',
  sandybrown: 'f4a460',
  seagreen: '2e8b57',
  seashell: 'fff5ee',
  sienna: 'a0522d',
  silver: 'c0c0c0',
  skyblue: '87ceeb',
  slateblue: '6a5acd',
  slategray: '708090',
  slategrey: '708090',
  snow: 'fffafa',
  springgreen: '00ff7f',
  steelblue: '4682b4',
  tan: 'd2b48c',
  teal: '008080',
  thistle: 'd8bfd8',
  tomato: 'ff6347',
  turquoise: '40e0d0',
  violet: 'ee82ee',
  wheat: 'f5deb3',
  white: 'ffffff',
  whitesmoke: 'f5f5f5',
  yellow: 'ffff00',
  yellowgreen: '9acd32',
  transparent: '00000000',
};

/** The names above, as colours. A Map, so only own keys are ever looked up. */
const NAMED_COLOURS: ReadonlyMap<string, Rgba> = new Map(
  Object.entries(NAMED_HEX).map(([name, hex]) => [name, readColour(`#${hex}`) as Rgba]),
);

/** Every `selector { body }` and `@rule { body }` at this level of a stylesheet. */
function topLevelBlocks(css: string): { prelude: string; body: string }[] {
  const blocks: { prelude: string; body: string }[] = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = -1;
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (character === '{') {
      if (depth === 0) {
        bodyStart = index + 1;
      }
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0 && bodyStart >= 0) {
        blocks.push({ prelude: css.slice(preludeStart, bodyStart - 1), body: css.slice(bodyStart, index) });
        preludeStart = index + 1;
        bodyStart = -1;
      }
    } else if (character === ';' && depth === 0) {
      preludeStart = index + 1;
    }
  }
  return blocks;
}

/**
 * Calls `visit` for every rule that carries declarations, telling it whether
 * the rule sits in dark scope. Only `@media (prefers-color-scheme: dark)` is a
 * group this subset enters; `@media print`, `@supports`, `@layer`, `@container`
 * and the rest are skipped for both themes rather than guessed at. A block that
 * holds rules carries its own dark scope down to them.
 */
function eachRule(
  css: string,
  visit: (prelude: string, body: string, inDarkBlock: boolean) => void,
  inDarkBlock = false,
): void {
  for (const block of topLevelBlocks(css)) {
    const prelude = block.prelude.trim();
    if (prelude.startsWith('@')) {
      if (DARK_MEDIA.test(prelude)) {
        eachRule(block.body, visit, true);
      } else if (!block.body.includes('{')) {
        // `@font-face` carries declarations of its own, so it is visited as is.
        visit(prelude, block.body, inDarkBlock);
      }
      continue;
    }
    if (block.body.includes('{')) {
      eachRule(block.body, visit, inDarkBlock || namesDarkRoot(prelude));
      continue;
    }
    visit(prelude, block.body, inDarkBlock);
  }
}

/** Whether a rule's prelude lists a dark root scope, such as `:root.dark`. */
function namesDarkRoot(prelude: string): boolean {
  return prelude.split(',').some((selector) => DARK_ROOT.test(selector.trim()));
}

/** Every declaration in a block, in source order. */
function declarationsOf(body: string): { name: string; value: string }[] {
  const declarations: { name: string; value: string }[] = [];
  for (const raw of body.split(';')) {
    const colon = raw.indexOf(':');
    if (colon < 0) {
      continue;
    }
    const name = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    if (name !== '' && value !== '') {
      declarations.push({ name, value });
    }
  }
  return declarations;
}

/** Adds a block's custom properties to a table; a later declaration wins. */
function assign(table: Record<string, string>, body: string): void {
  for (const declaration of declarationsOf(body)) {
    if (declaration.name.startsWith('--')) {
      table[declaration.name] = declaration.value;
    }
  }
}

function unquote(text: string): string {
  return text.trim().replace(/^["']|["']$/g, '');
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}
