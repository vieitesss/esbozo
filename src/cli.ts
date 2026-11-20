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
 * `png` needs a theme. Colours come from `--css` when given, from the built-in
 * themes otherwise; `--ink`, `--paper` and `--muted` win over both. The font
 * comes from `--font`, then from a local `@font-face` in the stylesheet, then
 * from the bundled Kalam. The stylesheet subset is documented in `src/css.ts`
 * and printed by `ez --help`.
 *
 * Exit codes:
 *   0  the Scene rendered
 *   2  wrong arguments (unknown command, missing or extra arguments, bad flag)
 *   3  the Scene could not be read or parsed
 *   4  the output could not be written
 *   5  missing theme values, or a missing or unreadable font
 *
 * The codes live in one place, `EXIT`, so a caller can tell a bad Scene from a
 * failed write or an incomplete theme.
 *
 * Problems are plain text, one per line, on stderr, and name the Element they
 * belong to: `a: width must be at least 1 pixel, got 0`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { parseScene } from './scene.js';
import { renderScene } from './renderer.js';
import { THEMES, renderPng } from './png.js';
import type { PngOptions, Theme } from './png.js';
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

/** The stylesheet subset `png` reads, the same one documented in `src/css.ts`. */
const CSS_SUBSET = [
  'css: `:root` and `html` declarations are the light theme; dark is those values',
  'overridden by `@media (prefers-color-scheme: dark)` blocks and by `:root.dark`,',
  '`:root[data-theme="dark"]`, `html.dark` and `html[data-theme="dark"]`. Other',
  'selectors and every other grouping at-rule are ignored. Values may use `var()`',
  'and `color-mix(in srgb, A p%, B)` with hex, rgb()/rgba() or CSS colour names.',
].join('\n');

const USAGE = `${RENDER_USAGE}\n${PNG_USAGE}\n${CSS_SUBSET}\n`;

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'render') {
    return runRender(rest);
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

  const { scenePath, ...options } = parsed;
  const rendered = await renderPng(renderScene(scene.value), options);
  if (!rendered.ok) {
    for (const problem of rendered.problems) {
      process.stderr.write(`${problem}\n`);
    }
    return EXIT.missingTheme;
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

/** `<name>.svg` beside the Scene: only the `.json` suffix is replaced, so `a.esbozo.json` gives `a.esbozo.svg`. */
export function svgPathFor(scenePath: string): string {
  return resolve(dirname(scenePath), `${stemOf(scenePath)}.svg`);
}

/** `<name>.<theme>.png` beside the Scene: `sketch.json --theme dark` gives `sketch.dark.png`. */
function pngPathFor(scenePath: string, theme: Theme): string {
  return resolve(dirname(scenePath), `${stemOf(scenePath)}.${theme}.png`);
}

function stemOf(scenePath: string): string {
  return basename(scenePath).replace(/\.json$/i, '');
}

process.exitCode = await main(process.argv.slice(2));
