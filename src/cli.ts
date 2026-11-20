/**
 * The `ez` command line.
 *
 * Surface:
 *
 *   ez render <scene>
 *   ez png <scene> --theme light|dark [--css <stylesheet>]
 *                  [--ink <colour>] [--paper <colour>] [--muted <colour>]
 *                  [--font <file>]
 *
 * `render` writes `<name>.svg` beside the Scene and prints that path.
 * `png` writes `<name>.<theme>.png` beside the Scene and prints that path, so
 * `sketch.json` gives `sketch.light.png` and `sketch.dark.png`.
 *
 * `png` needs a theme. Colours come from `--css` when given (its `:root` block
 * for light, its dark-mode block for dark), from the built-in themes otherwise;
 * `--ink`, `--paper` and `--muted` win over both. The font comes from `--font`
 * or from the bundled Kalam.
 *
 * Exit codes:
 *   0  the Scene rendered
 *   2  wrong arguments (unknown command, missing or extra arguments, bad flag)
 *   3  the Scene could not be read or parsed
 *   4  the output could not be written
 *   5  missing theme values, or a missing or unreadable font
 *
 * The codes live in one place, `EXIT`, so a caller can tell a bad Scene from a
 * failed write or an incomplete theme. 6 is kept for Label overflow.
 *
 * Problems are plain text, one per line, on stderr, and name the Element they
 * belong to: `a: width must be at least 1 pixel, got 0`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { parseScene } from './scene.js';
import { renderScene } from './renderer.js';
import {
  BUNDLED_FONT,
  DEFAULT_PALETTES,
  THEMES,
  paletteFromStylesheet,
  rasterise,
  readFont,
} from './png.js';
import type { Palette, Theme } from './png.js';
import type { Scene } from './scene.js';

const EXIT = {
  ok: 0,
  usage: 2,
  invalidScene: 3,
  writeFailed: 4,
  missingTheme: 5,
} as const;

const RENDER_USAGE = 'usage: ez render <scene>';
const PNG_USAGE =
  'usage: ez png <scene> --theme light|dark [--css <stylesheet>]' +
  ' [--ink <colour>] [--paper <colour>] [--muted <colour>] [--font <file>]';

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'render') {
    return runRender(rest);
  }
  if (command === 'png') {
    return runPng(rest);
  }
  process.stderr.write(`${RENDER_USAGE}\n${PNG_USAGE}\n`);
  return EXIT.usage;
}

async function runRender(argv: readonly string[]): Promise<number> {
  const [scenePath, ...extra] = argv;
  if (scenePath === undefined || scenePath === '' || extra.length > 0) {
    process.stderr.write(`${RENDER_USAGE}\n`);
    return EXIT.usage;
  }

  const scene = await loadScene(scenePath);
  if (!scene.ok) {
    return scene.exitCode;
  }

  const outputPath = svgPathFor(scenePath);
  try {
    await writeFile(outputPath, renderScene(scene.value), 'utf8');
  } catch (error) {
    process.stderr.write(`cannot write SVG ${outputPath}: ${(error as NodeJS.ErrnoException).message}\n`);
    return EXIT.writeFailed;
  }
  process.stdout.write(`${outputPath}\n`);
  return EXIT.ok;
}

async function runPng(argv: readonly string[]): Promise<number> {
  const parsed = parsePngArguments(argv);
  if (parsed === null) {
    process.stderr.write(`${PNG_USAGE}\n`);
    return EXIT.usage;
  }

  const scene = await loadScene(parsed.scenePath);
  if (!scene.ok) {
    return scene.exitCode;
  }

  const overrides: Partial<Palette> = {};
  if (parsed.ink !== undefined) {
    overrides.ink = parsed.ink;
  }
  if (parsed.paper !== undefined) {
    overrides.paper = parsed.paper;
  }
  if (parsed.muted !== undefined) {
    overrides.muted = parsed.muted;
  }

  let palette: Palette;
  let fontFamily: string | null = null;
  if (parsed.css === undefined) {
    palette = { ...DEFAULT_PALETTES[parsed.theme], ...overrides };
  } else {
    let stylesheet: string;
    try {
      stylesheet = await readFile(parsed.css, 'utf8');
    } catch (error) {
      process.stderr.write(`cannot read stylesheet ${parsed.css}: ${(error as NodeJS.ErrnoException).message}\n`);
      return EXIT.missingTheme;
    }
    const themed = paletteFromStylesheet(stylesheet, parsed.theme, overrides);
    if (!themed.ok) {
      process.stderr.write(`stylesheet is missing: ${themed.missing.join(', ')}\n`);
      return EXIT.missingTheme;
    }
    palette = themed.palette;
    fontFamily = themed.fontFamily;
  }

  let font = BUNDLED_FONT;
  if (parsed.font !== undefined) {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(parsed.font);
    } catch (error) {
      process.stderr.write(`cannot read font ${parsed.font}: ${(error as NodeJS.ErrnoException).message}\n`);
      return EXIT.missingTheme;
    }
    const check = readFont(bytes);
    if (!check.ok) {
      process.stderr.write(`${parsed.font} ${check.problem}\n`);
      return EXIT.missingTheme;
    }
    font = bytes;
  }

  const outputPath = pngPathFor(parsed.scenePath, parsed.theme);
  let png: Uint8Array;
  try {
    png = await rasterise(renderScene(scene.value), { palette, font, fontFamily });
  } catch (error) {
    process.stderr.write(`cannot rasterise ${parsed.scenePath}: ${(error as Error).message}\n`);
    return EXIT.missingTheme;
  }
  try {
    await writeFile(outputPath, png);
  } catch (error) {
    process.stderr.write(`cannot write PNG ${outputPath}: ${(error as NodeJS.ErrnoException).message}\n`);
    return EXIT.writeFailed;
  }
  process.stdout.write(`${outputPath}\n`);
  return EXIT.ok;
}

interface PngArguments {
  scenePath: string;
  theme: Theme;
  css?: string;
  ink?: string;
  paper?: string;
  muted?: string;
  font?: string;
}

/** Space-separated flags only: `--theme dark`, never `--theme=dark`. */
function parsePngArguments(argv: readonly string[]): PngArguments | null {
  let scenePath: string | undefined;
  const flags: Record<string, string> = {};
  const known = new Set(['--theme', '--css', '--ink', '--paper', '--muted', '--font']);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument.startsWith('--')) {
      if (!known.has(argument)) {
        return null;
      }
      const value = argv[index + 1];
      if (value === undefined || value === '' || value.startsWith('--')) {
        return null;
      }
      flags[argument] = value;
      index += 1;
      continue;
    }
    if (argument === '' || scenePath !== undefined) {
      return null;
    }
    scenePath = argument;
  }

  if (scenePath === undefined) {
    return null;
  }
  const requested = flags['--theme'];
  if (requested === undefined || !(THEMES as readonly string[]).includes(requested)) {
    return null;
  }

  const parsed: PngArguments = { scenePath, theme: requested as Theme };
  for (const name of ['--css', '--ink', '--paper', '--muted', '--font'] as const) {
    const value = flags[name];
    if (value !== undefined) {
      parsed[name.slice(2) as 'css' | 'ink' | 'paper' | 'muted' | 'font'] = value;
    }
  }
  return parsed;
}

type LoadedScene = { ok: true; value: Scene } | { ok: false; exitCode: number };

async function loadScene(scenePath: string): Promise<LoadedScene> {
  let source: string;
  try {
    source = await readFile(scenePath, 'utf8');
  } catch (error) {
    process.stderr.write(`cannot read Scene ${scenePath}: ${(error as NodeJS.ErrnoException).message}\n`);
    return { ok: false, exitCode: EXIT.invalidScene };
  }

  const parsed = parseScene(source);
  if (!parsed.ok) {
    for (const problem of parsed.problems) {
      const where = problem.elementId === null ? '' : `${problem.elementId}: `;
      process.stderr.write(`${where}${problem.message}\n`);
    }
    return { ok: false, exitCode: EXIT.invalidScene };
  }
  return { ok: true, value: parsed.scene };
}

/** `<name>.svg` beside the Scene: only the `.json` suffix is replaced, so `a.esbozo.json` gives `a.esbozo.svg`. */
export function svgPathFor(scenePath: string): string {
  return resolve(dirname(scenePath), `${stemOf(scenePath)}.svg`);
}

/** `<name>.<theme>.png` beside the Scene: `sketch.json --theme dark` gives `sketch.dark.png`. */
export function pngPathFor(scenePath: string, theme: Theme): string {
  return resolve(dirname(scenePath), `${stemOf(scenePath)}.${theme}.png`);
}

function stemOf(scenePath: string): string {
  return basename(scenePath).replace(/\.json$/i, '');
}

process.exitCode = await main(process.argv.slice(2));
