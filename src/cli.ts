/**
 * The `ez` command line.
 *
 * Surface:
 *
 *   ez render <scene> [--font <file>]
 *   ez check <scene> [--font <file>]
 *   ez png <scene> --theme light|dark [--css <stylesheet>]
 *                  [--ink <colour>] [--paper <colour>] [--muted <colour>]
 *                  [--font <file>]
 *
 * `render` writes `<name>.svg` beside the Scene and prints that path.
 * `check` reports what is wrong with a Scene and prints nothing when it is
 * clean, so a script can rely on the exit code alone.
 * `png` writes `<name>.<theme>.png` beside the Scene and prints that path, so
 * `sketch.json` gives `sketch.light.png` and `sketch.dark.png`.
 *
 * Words are measured: `render` and `check` measure with `--font`, or with the
 * bundled Kalam when it is absent. `png` measures with the font it draws with —
 * `--font`, then the stylesheet's `@font-face`, then Kalam — so the line breaks
 * in the PNG are the ones that font makes.
 *
 * `png` needs a theme. Colours come from `--css` when given, from the built-in
 * themes otherwise; `--ink`, `--paper` and `--muted` win over both. The
 * stylesheet subset is documented in `src/css.ts` and printed by `ez --help`.
 *
 * Exit codes — the one place they are defined, `EXIT`:
 *   0  the Scene is clean, was rendered, or the PNG was written
 *   2  wrong arguments (unknown command, missing or extra arguments, bad flag)
 *   3  the Scene could not be read or parsed
 *   4  the output could not be written
 *   5  missing theme values, or a missing or unreadable font
 *   6  a Label that does not fit its Element (see `ez check`)
 *
 * Problems are plain text, one per line, on stderr, and name the Element they
 * belong to: `a: width must be at least 1 pixel, got 0`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { sceneStem, svgFileName } from './paths.js';
import { parseScene } from './scene.js';
import { renderScene } from './renderer.js';
import { THEMES, renderPng } from './png.js';
import type { PngOptions, Theme } from './png.js';
import type { Scene } from './scene.js';
import { BUNDLED_FONT, BUNDLED_FONT_NAME, checkFont, fontFromFile, layoutFor } from './font.js';
import type { Layout } from './layout.js';

const EXIT = {
  ok: 0,
  usage: 2,
  invalidScene: 3,
  writeFailed: 4,
  missingThemeOrFont: 5,
  labelOverflow: 6,
} as const;

const RENDER_USAGE = 'usage: ez render <scene> [--font <file>]';
const CHECK_USAGE = 'usage: ez check <scene> [--font <file>]';
const PNG_USAGE =
  'usage: ez png <scene> --theme light|dark [--css <stylesheet>]' +
  ' [--ink <colour>] [--paper <colour>] [--muted <colour>] [--font <file>]';

/** Every exit code `ez` returns, so a caller can tell the failures apart. */
const EXIT_CODES = [
  'exit codes:',
  '  0  the Scene is clean, was rendered, or the PNG was written',
  '  2  wrong arguments (unknown command, missing or extra arguments, bad flag)',
  '  3  the Scene could not be read or parsed',
  '  4  the output could not be written',
  '  5  missing theme values, or a missing or unreadable font',
  '  6  a Label that does not fit its Element (see `ez check`)',
].join('\n');

/** The stylesheet subset `png` reads, the same one documented in `src/css.ts`. */
const CSS_SUBSET = [
  'css: `:root` and `html` declarations are the light theme; dark is those values',
  'overridden by `@media (prefers-color-scheme: dark)` blocks and by `:root.dark`,',
  '`:root[data-theme="dark"]`, `html.dark` and `html[data-theme="dark"]`. Other',
  'selectors and every other grouping at-rule are ignored. Values may use `var()`',
  'and `color-mix(in srgb, A p%, B)` with hex, rgb()/rgba() or CSS colour names.',
  'Palette colours must be opaque.',
].join('\n');

const USAGE = `${RENDER_USAGE}\n${CHECK_USAGE}\n${PNG_USAGE}\n${CSS_SUBSET}\n${EXIT_CODES}\n`;

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'render') {
    return runRender(rest);
  }
  if (command === 'check') {
    return runCheck(rest);
  }
  if (command === 'png') {
    return runPng(rest);
  }
  if (command === '--help' || command === 'help') {
    process.stdout.write(USAGE);
    return EXIT.ok;
  }
  process.stderr.write(USAGE);
  return EXIT.usage;
}

async function runRender(argv: readonly string[]): Promise<number> {
  const parsed = parseSceneArguments(argv);
  if (parsed === null) {
    process.stderr.write(`${RENDER_USAGE}\n`);
    return EXIT.usage;
  }

  const scene = await loadScene(parsed.scenePath);
  if (!scene.ok) {
    return scene.exitCode;
  }
  const layout = await loadLayout(parsed.fontPath);
  if (!layout.ok) {
    return layout.exitCode;
  }

  const outputPath = svgPathFor(parsed.scenePath);
  try {
    await writeFile(outputPath, renderScene(scene.value, layout.value), 'utf8');
  } catch (error) {
    process.stderr.write(`cannot write SVG ${outputPath}: ${(error as NodeJS.ErrnoException).message}\n`);
    return EXIT.writeFailed;
  }
  process.stdout.write(`${outputPath}\n`);
  return EXIT.ok;
}

/**
 * What an author has to fix before drawing the Scene, measured with the font
 * the SVG will be drawn for: `ez check` reports it and exits 6. A Scene that
 * does not parse gets exit 3 first, because there is nothing to measure.
 */
async function runCheck(argv: readonly string[]): Promise<number> {
  const parsed = parseSceneArguments(argv);
  if (parsed === null) {
    process.stderr.write(`${CHECK_USAGE}\n`);
    return EXIT.usage;
  }

  const scene = await loadScene(parsed.scenePath);
  if (!scene.ok) {
    return scene.exitCode;
  }
  const layout = await loadLayout(parsed.fontPath);
  if (!layout.ok) {
    return layout.exitCode;
  }

  let overflowed = false;
  for (const element of scene.value.elements) {
    const overflow = layout.value.overflow(element);
    if (overflow !== null) {
      process.stderr.write(`${overflow.elementId}: ${overflow.message}\n`);
      overflowed = true;
    }
  }
  return overflowed ? EXIT.labelOverflow : EXIT.ok;
}

/** `<scene> [--font <file>]`, the arguments `render` and `check` share. */
interface SceneArguments {
  scenePath: string;
  fontPath?: string;
}

function parseSceneArguments(argv: readonly string[]): SceneArguments | null {
  let scenePath: string | undefined;
  let fontPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument === '--font') {
      const value = argv[index + 1];
      if (value === undefined || value === '' || value.startsWith('--') || fontPath !== undefined) {
        return null;
      }
      fontPath = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--') || argument === '' || scenePath !== undefined) {
      return null;
    }
    scenePath = argument;
  }
  if (scenePath === undefined) {
    return null;
  }
  return { scenePath, ...(fontPath === undefined ? {} : { fontPath }) };
}

/**
 * The Layout for `--font`, or for the bundled Kalam when no file is given. A
 * font that cannot be read is exit 5, like a missing theme: the Scene cannot be
 * measured without it.
 */
async function loadLayout(
  fontPath: string | undefined,
): Promise<{ ok: true; value: Layout } | { ok: false; exitCode: number }> {
  const font =
    fontPath === undefined
      ? checkFont(BUNDLED_FONT, BUNDLED_FONT_NAME)
      : await fontFromFile(fontPath, fontPath);
  if (!font.ok) {
    for (const problem of font.problems) {
      process.stderr.write(`${problem}\n`);
    }
    return { ok: false, exitCode: EXIT.missingThemeOrFont };
  }
  return { ok: true, value: layoutFor(font.value) };
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

  const { scenePath, ...options } = parsed;
  const rendered = await renderPng(scene.value, options);
  if (!rendered.ok) {
    for (const problem of rendered.problems) {
      process.stderr.write(`${problem}\n`);
    }
    return EXIT.missingThemeOrFont;
  }
  for (const note of rendered.notes) {
    process.stderr.write(`${note}\n`);
  }

  const outputPath = pngPathFor(scenePath, parsed.theme);
  try {
    await writeFile(outputPath, rendered.png);
  } catch (error) {
    process.stderr.write(`cannot write PNG ${outputPath}: ${(error as NodeJS.ErrnoException).message}\n`);
    return EXIT.writeFailed;
  }
  process.stdout.write(`${outputPath}\n`);
  return EXIT.ok;
}

/** Every `png` flag and the option it sets: one table for both jobs. */
const PNG_FLAGS = {
  '--theme': 'theme',
  '--css': 'cssPath',
  '--ink': 'ink',
  '--paper': 'paper',
  '--muted': 'muted',
  '--font': 'fontPath',
} as const;

type PngFlag = keyof typeof PNG_FLAGS;
type PngOption = (typeof PNG_FLAGS)[PngFlag];

interface PngArguments extends PngOptions {
  scenePath: string;
}

function isTheme(value: string): value is Theme {
  return (THEMES as readonly string[]).includes(value);
}

/** Space-separated flags only: `--theme dark`, never `--theme=dark`. */
function parsePngArguments(argv: readonly string[]): PngArguments | null {
  let scenePath: string | undefined;
  const values: { [K in PngOption]?: string } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument.startsWith('--')) {
      if (!(argument in PNG_FLAGS)) {
        return null;
      }
      const option = PNG_FLAGS[argument as PngFlag];
      const value = argv[index + 1];
      if (value === undefined || value === '' || value.startsWith('--')) {
        return null;
      }
      values[option] = value;
      index += 1;
      continue;
    }
    if (argument === '' || scenePath !== undefined) {
      return null;
    }
    scenePath = argument;
  }

  const theme = values.theme;
  if (scenePath === undefined || theme === undefined || !isTheme(theme)) {
    return null;
  }
  return { ...values, theme, scenePath };
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

/** `<name>.svg` beside the Scene, named by the rule the editor's autosave uses. */
export function svgPathFor(scenePath: string): string {
  return resolve(dirname(scenePath), svgFileName(basename(scenePath)));
}

/** `<name>.<theme>.png` beside the Scene: `sketch.json --theme dark` gives `sketch.dark.png`. */
function pngPathFor(scenePath: string, theme: Theme): string {
  return resolve(dirname(scenePath), `${sceneStem(basename(scenePath))}.${theme}.png`);
}

process.exitCode = await main(process.argv.slice(2));
