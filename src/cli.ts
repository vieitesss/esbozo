/**
 * The `ez` command line.
 *
 * Surface:
 *
 *   ez render <scene> [--font <file>]
 *   ez check <scene> [--font <file>] [--css <stylesheet>]
 *   ez png <scene> --theme light|dark [--css <stylesheet>]
 *                  [--ink <colour>] [--paper <colour>] [--muted <colour>]
 *                  [--font <file>]
 *   ez serve <dir> [--host 127.0.0.1] [--port N] [--read-only]
 *   ez bundle <dir>
 *
 * `render` writes `<name>.svg` beside the Scene and prints that path.
 * `check` reports what is wrong with a Scene and prints nothing when it is
 * clean, so a script can rely on the exit code alone.
 * `png` writes `<name>.<theme>.png` beside the Scene and prints that path, so
 * `sketch.json` gives `sketch.light.png` and `sketch.dark.png`.
 *
 * Words are measured with the same font the drawing shows: `--font`, then a
 * local `@font-face` in the stylesheet for the effective `--font-hand`, then
 * the bundled Kalam. `render` reads no stylesheet (the SVG draws in the host's
 * family), so it measures with `--font` or Kalam. `check` and `png` share one
 * resolver, so the same Scene, stylesheet and font give the same measurement:
 * `check` reads the stylesheet's light theme, because it has no `--theme`, and
 * a dark-scope font belongs to `png --theme dark`.
 *
 * `png` needs a theme. Colours come from `--css` when given, from the built-in
 * themes otherwise; `--ink`, `--paper` and `--muted` win over both. The
 * stylesheet subset is documented in `src/css.ts` and printed by `ez --help`.
 *
 * `serve` puts the editor on a folder of Scenes over http: the page and its
 * assets come from the folder the built CLI lives in, and the save API in
 * `src/serve.ts` reads and writes the Scenes. It binds to 127.0.0.1 unless
 * `--host` says otherwise, and `--read-only` refuses every write.
 *
 * `bundle` writes the editor as one ES module into a folder of someone else's
 * page: `<dir>/esbozo-<version>.js` defines `<esbozo-editor>`, configured by its
 * `scene`, `save` and `font` attributes and carrying the editor's stylesheet. An
 * existing file of that name is replaced, so a page's diff is one file. The
 * version is the one in `package.json`, and the bytes are the ones `pnpm build`
 * made — the same editor the served page shows, not a second copy of it.
 *
 * Exit codes — the one place they are defined, `EXIT`:
 *   0  the Scene is clean, was rendered, the PNG was written, the bundle was
 *      written, or the server stopped
 *   2  wrong arguments (unknown command, missing or extra arguments, bad flag)
 *   3  the Scene could not be read or parsed
 *   4  the output could not be written, the server could not start, or the
 *      editor is not built
 *   5  missing theme values, or a missing or unreadable font
 *   6  a Label that does not fit its Element (see `ez check`)
 *
 * Problems are plain text, one per line, on stderr, and name the Element they
 * belong to: `a: width must be at least 1 pixel, got 0`.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sceneStem, svgFileName } from './paths.js';
import { parseScene } from './scene.js';
import { renderScene } from './renderer.js';
import { THEMES, renderPng } from './png.js';
import { serve } from './serve.js';
import type { ServeOptions } from './serve.js';
import type { PngOptions, Theme } from './png.js';
import type { Scene } from './scene.js';
import { chooseFont, layoutFor, readStylesheet } from './font.js';
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
const CHECK_USAGE = 'usage: ez check <scene> [--font <file>] [--css <stylesheet>]';
const PNG_USAGE =
  'usage: ez png <scene> --theme light|dark [--css <stylesheet>]' +
  ' [--ink <colour>] [--paper <colour>] [--muted <colour>] [--font <file>]';
const SERVE_USAGE = 'usage: ez serve <dir> [--host 127.0.0.1] [--port N] [--read-only]';
const BUNDLE_USAGE = 'usage: ez bundle <dir>';
/** The port `ez serve` takes when nothing says otherwise. */
const DEFAULT_PORT = 4320;

/** The built page's files and the bundle, beside the bundled CLI. */
const BUILT = fileURLToPath(new URL('.', import.meta.url));

/** Every exit code `ez` returns, so a caller can tell the failures apart. */
const EXIT_CODES = [
  'exit codes:',
  '  0  the Scene is clean, was rendered, the PNG or the bundle was written, or the server stopped',
  '  2  wrong arguments (unknown command, missing or extra arguments, bad flag)',
  '  3  the Scene could not be read or parsed',
  '  4  the output could not be written, the server could not start, or the editor is not built',
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

const USAGE = `${RENDER_USAGE}\n${CHECK_USAGE}\n${PNG_USAGE}\n${SERVE_USAGE}\n${BUNDLE_USAGE}\n${CSS_SUBSET}\n${EXIT_CODES}\n`;

async function main(argv: readonly string[]): Promise<number> {
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
  if (command === 'serve') {
    return runServe(rest);
  }
  if (command === 'bundle') {
    return runBundle(rest);
  }
  if (command === '--help' || command === 'help') {
    process.stdout.write(USAGE);
    return EXIT.ok;
  }
  process.stderr.write(USAGE);
  return EXIT.usage;
}

async function runRender(argv: readonly string[]): Promise<number> {
  const parsed = parseSceneArguments(argv, SCENE_FLAGS);
  if (parsed === null) {
    process.stderr.write(`${RENDER_USAGE}\n`);
    return EXIT.usage;
  }

  const scene = await loadScene(parsed.scenePath);
  if (!scene.ok) {
    return scene.exitCode;
  }
  const layout = await loadLayout(parsed.fontPath, undefined);
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
  const parsed = parseSceneArguments(argv, CHECK_FLAGS);
  if (parsed === null) {
    process.stderr.write(`${CHECK_USAGE}\n`);
    return EXIT.usage;
  }

  const scene = await loadScene(parsed.scenePath);
  if (!scene.ok) {
    return scene.exitCode;
  }
  const layout = await loadLayout(parsed.fontPath, parsed.cssPath);
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

/** `<scene> [--font <file>] [--css <stylesheet>]`, the arguments `render` and `check` read. */
interface SceneArguments {
  scenePath: string;
  fontPath?: string;
  cssPath?: string;
}

/** The flags `render` reads; `check` reads the same plus the stylesheet. */
const SCENE_FLAGS = { '--font': 'fontPath' } as const;

const CHECK_FLAGS = { ...SCENE_FLAGS, '--css': 'cssPath' } as const;

type SceneOption = 'fontPath' | 'cssPath';

/** Space-separated flags only: `--font kalam.ttf`, never `--font=kalam.ttf`. */
function parseSceneArguments(
  argv: readonly string[],
  flags: Readonly<Record<string, SceneOption>>,
): SceneArguments | null {
  let scenePath: string | undefined;
  const values: Partial<Record<SceneOption, string>> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument.startsWith('--')) {
      const option = flags[argument];
      if (option === undefined) {
        return null;
      }
      const value = argv[index + 1];
      if (value === undefined || value === '' || value.startsWith('--') || values[option] !== undefined) {
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
  if (scenePath === undefined) {
    return null;
  }
  return { scenePath, ...values };
}

/**
 * The Layout for the font a command measures with: `--font`, then a local
 * `@font-face` in the stylesheet, then the bundled Kalam — the same resolver
 * `png` uses, so both commands measure the same bytes for the same inputs. A
 * font or stylesheet that cannot be read is exit 5, like a missing theme: the
 * Scene cannot be measured without it.
 *
 * `check` has no `--theme`, so it reads the light theme. A font declared in
 * dark scope belongs to `png --theme dark`. It draws nothing, so it does not
 * ask the chosen font for the family to draw in.
 */
async function loadLayout(
  fontPath: string | undefined,
  cssPath: string | undefined,
): Promise<{ ok: true; value: Layout } | { ok: false; exitCode: number }> {
  const stylesheet = await readStylesheet(cssPath);
  if (!stylesheet.ok) {
    return failed(stylesheet.problems);
  }
  const font = await chooseFont(fontPath, stylesheet.value, 'light');
  if (!font.ok) {
    return failed(font.problems);
  }
  for (const note of font.notes) {
    process.stderr.write(`${note}\n`);
  }
  return { ok: true, value: layoutFor(font.value) };
}

/** Reports why a font could not be chosen, and the exit code that says so. */
function failed(problems: readonly string[]): { ok: false; exitCode: number } {
  for (const problem of problems) {
    process.stderr.write(`${problem}\n`);
  }
  return { ok: false, exitCode: EXIT.missingThemeOrFont };
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

/**
 * Serve the editor on a folder of Scenes until the process is asked to stop.
 * A folder that cannot be listed, page files that are not built and a port
 * already taken are startup problems, so they take the write-failure code.
 */
async function runServe(argv: readonly string[]): Promise<number> {
  const parsed = parseServeArguments(argv);
  if (parsed === null) {
    process.stderr.write(`${SERVE_USAGE}\n`);
    return EXIT.usage;
  }

  try {
    await readdir(parsed.folder);
  } catch (error) {
    process.stderr.write(`cannot read folder ${parsed.folder}: ${(error as NodeJS.ErrnoException).message}\n`);
    return EXIT.writeFailed;
  }

  let running: Awaited<ReturnType<typeof serve>>;
  try {
    running = await serve(parsed);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return EXIT.writeFailed;
  }

  const mode = running.readOnly ? ' (read-only)' : '';
  process.stdout.write(`serving ${running.folder} on ${running.url}/${mode}\n`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void running.close());
  }
  await running.closed;
  return EXIT.ok;
}

/** One folder, and space-separated flags: `--port 4320`, never `--port=4320`. */
function parseServeArguments(argv: readonly string[]): ServeOptions | null {
  let folder: string | undefined;
  let host = '127.0.0.1';
  let port = DEFAULT_PORT;
  let readOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument === '--read-only') {
      readOnly = true;
      continue;
    }
    if (argument === '--host' || argument === '--port') {
      const value = argv[index + 1];
      if (value === undefined || value === '' || value.startsWith('--')) {
        return null;
      }
      if (argument === '--host') {
        host = value;
      } else {
        const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;
        if (!Number.isInteger(parsed) || parsed > 65535) {
          return null;
        }
        port = parsed;
      }
      index += 1;
      continue;
    }
    if (argument === '' || argument.startsWith('--') || folder !== undefined) {
      return null;
    }
    folder = resolve(argument);
  }

  if (folder === undefined || host === '') {
    return null;
  }
  return { folder, host, port, readOnly };
}

/**
 * Write the editor as one versioned ES module into `folder`: the file a page
 * pins with a single script tag. The bytes are the ones `pnpm build` made, so a
 * bundle is the editor this CLI was built with, and a second run replaces the
 * file rather than adding another.
 */
async function runBundle(argv: readonly string[]): Promise<number> {
  const folder = argv.length === 1 ? argv[0] : undefined;
  if (folder === undefined || folder === '' || folder.startsWith('--')) {
    process.stderr.write(`${BUNDLE_USAGE}\n`);
    return EXIT.usage;
  }

  let source: Buffer;
  try {
    source = await readFile(join(BUILT, 'embed.js'));
  } catch {
    process.stderr.write(
      `the editor is not built: missing ${join(BUILT, 'embed.js')} (run pnpm build)\n`,
    );
    return EXIT.writeFailed;
  }

  let version: string;
  try {
    version = await packageVersion();
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return EXIT.writeFailed;
  }

  const outputPath = resolve(folder, `esbozo-${version}.js`);
  try {
    await writeFile(outputPath, source);
  } catch (error) {
    process.stderr.write(`cannot write ${outputPath}: ${(error as NodeJS.ErrnoException).message}\n`);
    return EXIT.writeFailed;
  }
  process.stdout.write(`${outputPath}\n`);
  return EXIT.ok;
}

/**
 * The version a bundle is named after: the one in the package the CLI was
 * installed from, so `esbozo-0.3.0.js` says which editor a page pinned.
 */
async function packageVersion(): Promise<string> {
  const path = fileURLToPath(new URL('../package.json', import.meta.url));
  let parsed: { version?: unknown };
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as { version?: unknown };
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as NodeJS.ErrnoException).message}`);
  }
  if (typeof parsed.version !== 'string' || parsed.version === '') {
    throw new Error(`${path} gives no version`);
  }
  return parsed.version;
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
function svgPathFor(scenePath: string): string {
  return resolve(dirname(scenePath), svgFileName(basename(scenePath)));
}

/** `<name>.<theme>.png` beside the Scene: `sketch.json --theme dark` gives `sketch.dark.png`. */
function pngPathFor(scenePath: string, theme: Theme): string {
  return resolve(dirname(scenePath), `${sceneStem(basename(scenePath))}.${theme}.png`);
}

process.exitCode = await main(process.argv.slice(2));
