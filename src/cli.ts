/**
 * The `ez` command line.
 *
 * Surface:
 *
 *   ez render <scene> [--font <file>]
 *   ez check <scene> [--font <file>] [--css <stylesheet>]
 *   ez anchor <scene> <element> <start|end> <place>
 *   ez anchor <scene> --all
 *   ez snap <scene> <element> <start|end> <target|off>
 *   ez png <scene> --theme light|dark [--css <stylesheet>]
 *                  [--ink <colour>] [--paper <colour>] [--muted <colour>]
 *                  [--font <file>]
 *   ez serve <dir> [--host 127.0.0.1] [--port N] [--read-only]
 *   ez bundle <dir>
 *
 * `render` writes `<name>.svg` beside the Scene and prints that path.
 * `check` reports what is wrong with a Scene and prints nothing when it is
 * clean, so a script can rely on the exit code alone.
 * `anchor` and `snap` edit a Scene in place, on the arrow or line their element
 * id names. `anchor` puts one end on a named place of its target's outline —
 * `top`, `bottom-left`, a pair of fractions, or `none` to drop the Anchor and aim
 * at the centre again — and `--all` freezes every Snapped end that carries no
 * Anchor where it draws today, so the SVG does not move. `snap` attaches an end
 * to an Element, at the outline point nearest where it draws, or writes
 * `"snap": false` with `off`. An Anchor writes the end's `x`, `y` at the spot it
 * draws on, so the file's numbers and its ink agree. Both print the end they
 * changed. Both refuse what the schema refuses, with `ez check`'s exit codes, and
 * neither writes a Scene the parser turns down.
 *
 * `png` writes `<name>.<theme>.png` beside the Scene and prints that path, so
 * `sketch.esbozo` gives `sketch.light.png` and `sketch.dark.png`. A Scene is a
 * `.esbozo` file, or a `.json` one that holds a Scene: the extension only names
 * the outputs beside it.
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
 * Exit codes: the one place they are defined is `src/exit.ts`.
 *
 * Problems are plain text, one per line, on stderr, and name the Element they
 * belong to: `a: width must be at least 1 pixel, got 0`.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD, BUILT_AT } from './build-id.js';
import { anchorEditOf, anchorScene, refusal, snapEditOf, snapScene } from './ends.js';
import { EXIT } from './exit.js';
import { sceneStem, svgFileName } from './paths.js';
import { parseScene, serialiseScene } from './scene.js';
import { renderScene } from './renderer.js';
import { sha256Hex } from './sha256.js';
import { THEMES, renderPng } from './png.js';
import { serve } from './serve.js';
import type { ServeOptions } from './serve.js';
import type { PngOptions, Theme } from './png.js';
import type { AnchorEdit, Change, Outcome, SnapEdit } from './ends.js';
import type { Scene } from './scene.js';
import { chooseFont, layoutFor, readStylesheet } from './font.js';
import { USAGE_LINE, commandHelp, shouldBold, topLevelHelp } from './help.js';
import type { HelpTopic } from './help.js';
import type { Layout } from './layout.js';

const DEFAULT_PORT = 4320;

const BUILT = fileURLToPath(new URL('.', import.meta.url));

function helpTopicFor(command: string | undefined, rest: readonly string[]): HelpTopic | null {
  if (command === 'skill' && rest.length === 2 && rest[0] === 'install' && rest[1] === '--help') {
    return 'skill install';
  }
  if (rest.length === 1 && rest[0] === '--help') {
    if (
      command === 'render' ||
      command === 'png' ||
      command === 'bundle' ||
      command === 'check' ||
      command === 'anchor' ||
      command === 'snap' ||
      command === 'serve' ||
      command === 'skill'
    ) {
      return command;
    }
  }
  return null;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'help') {
    return runHelp(rest);
  }
  const topic = helpTopicFor(command, rest);
  if (topic !== null) {
    process.stdout.write(commandHelp(topic, shouldBold(process.stdout)));
    return EXIT.ok;
  }
  if (command === 'render') {
    return runRender(rest);
  }
  if (command === 'check') {
    return runCheck(rest);
  }
  if (command === 'anchor') {
    return runAnchor(rest);
  }
  if (command === 'snap') {
    return runSnap(rest);
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
  if (command === 'skill') {
    return runSkill(rest);
  }
  if (command === '--help') {
    process.stdout.write(topLevelHelp(shouldBold(process.stdout)));
    return EXIT.ok;
  }
  process.stderr.write(topLevelHelp(false));
  return EXIT.usage;
}

/**
 * `ez help [command [subcommand]]`: the top-level help alone, or the same help
 * `ez <command> --help` prints. A name `helpTopicFor` does not know is an
 * unknown command, and answers as any other unknown command does.
 */
function runHelp(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  if (command === undefined) {
    process.stdout.write(topLevelHelp(shouldBold(process.stdout)));
    return EXIT.ok;
  }
  const topic = helpTopicFor(command, [...rest, '--help']);
  if (topic === null) {
    process.stderr.write(topLevelHelp(false));
    return EXIT.usage;
  }
  process.stdout.write(commandHelp(topic, shouldBold(process.stdout)));
  return EXIT.ok;
}

async function runRender(argv: readonly string[]): Promise<number> {
  const parsed = parseSceneArguments(argv, SCENE_FLAGS);
  if (parsed === null) {
    process.stderr.write(`${USAGE_LINE.render}\n`);
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
    await writeFile(outputPath, renderScene(scene.value, layout.value, scene.sourceHash), 'utf8');
  } catch (error) {
    process.stderr.write(`cannot write SVG ${outputPath}: ${(error as NodeJS.ErrnoException).message}\n`);
    return EXIT.writeFailed;
  }
  process.stdout.write(`${outputPath}\n`);
  return EXIT.ok;
}

async function runCheck(argv: readonly string[]): Promise<number> {
  const parsed = parseSceneArguments(argv, CHECK_FLAGS);
  if (parsed === null) {
    process.stderr.write(`${USAGE_LINE.check}\n`);
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

interface SceneArguments {
  scenePath: string;
  fontPath?: string;
  cssPath?: string;
}

const SCENE_FLAGS = { '--font': 'fontPath' } as const;

const CHECK_FLAGS = { ...SCENE_FLAGS, '--css': 'cssPath' } as const;

type SceneOption = 'fontPath' | 'cssPath';

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

function failed(problems: readonly string[]): { ok: false; exitCode: number } {
  for (const problem of problems) {
    process.stderr.write(`${problem}\n`);
  }
  return { ok: false, exitCode: EXIT.missingThemeOrFont };
}

/*
 * `anchor` and `snap`: the two commands that edit a Scene in place. What the edit
 * means is `src/ends.ts`'s; here are the words and the file.
 */

/** Load the Scene a command names, apply its edit, and save what it made. */
async function editScene<T extends { readonly scenePath: string }>(
  request: Outcome<T>,
  apply: (scene: Scene, request: T) => Outcome<Change>,
): Promise<number> {
  if (!request.ok) {
    process.stderr.write(`${request.message}\n`);
    return request.exitCode;
  }
  const scene = await loadScene(request.value.scenePath);
  if (!scene.ok) {
    return scene.exitCode;
  }
  const answer = apply(scene.value, request.value);
  if (!answer.ok) {
    process.stderr.write(`${answer.message}\n`);
    return answer.exitCode;
  }
  return saveScene(request.value.scenePath, answer.value);
}

async function runAnchor(argv: readonly string[]): Promise<number> {
  return editScene(parseAnchorArguments(argv), anchorScene);
}

async function runSnap(argv: readonly string[]): Promise<number> {
  return editScene(parseSnapArguments(argv), snapScene);
}

function parseAnchorArguments(
  argv: readonly string[],
): Outcome<AnchorEdit & { readonly scenePath: string }> {
  if (argv.includes('--all')) {
    const rest = argv.filter((word) => word !== '--all');
    const scenePath = rest[0];
    if (rest.length !== 1 || scenePath === undefined || scenePath === '') {
      return refusal(USAGE_LINE.anchor, EXIT.usage);
    }
    if (scenePath.startsWith('--')) {
      return refusal(USAGE_LINE.anchor, EXIT.usage);
    }
    return { ok: true, value: { scenePath, all: true } };
  }

  const [scenePath, elementId, word, place] = argv;
  if (
    argv.length !== 4 ||
    argv.some((argument) => argument === '' || argument.startsWith('--')) ||
    scenePath === undefined ||
    elementId === undefined ||
    place === undefined
  ) {
    return refusal(USAGE_LINE.anchor, EXIT.usage);
  }
  const edit = anchorEditOf({ all: false, elementId, end: word ?? '', place });
  if (!edit.ok) {
    return edit;
  }
  return { ok: true, value: { scenePath, ...edit.value } };
}

function parseSnapArguments(
  argv: readonly string[],
): Outcome<SnapEdit & { readonly scenePath: string }> {
  const [scenePath, elementId, word, target] = argv;
  if (
    argv.length !== 4 ||
    argv.some((argument) => argument === '' || argument.startsWith('--')) ||
    scenePath === undefined ||
    elementId === undefined ||
    target === undefined
  ) {
    return refusal(USAGE_LINE.snap, EXIT.usage);
  }
  const edit = snapEditOf({ elementId, end: word ?? '', target });
  if (!edit.ok) {
    return edit;
  }
  return { ok: true, value: { scenePath, ...edit.value } };
}

/** Save the Scene a command built, refusing to write one the parser turns down. */
async function saveScene(scenePath: string, change: Change): Promise<number> {
  const text = serialiseScene(change.scene);
  const checked = parseScene(text);
  if (!checked.ok) {
    printProblems(checked.problems);
    return EXIT.invalidScene;
  }
  try {
    await writeFile(scenePath, text, 'utf8');
  } catch (error) {
    process.stderr.write(
      `cannot write Scene ${scenePath}: ${(error as NodeJS.ErrnoException).message}\n`,
    );
    return EXIT.writeFailed;
  }
  for (const line of change.lines) {
    process.stdout.write(`${line}\n`);
  }
  return EXIT.ok;
}

async function runPng(argv: readonly string[]): Promise<number> {
  const parsed = parsePngArguments(argv);
  if (parsed === null) {
    process.stderr.write(`${USAGE_LINE.png}\n`);
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

async function runServe(argv: readonly string[]): Promise<number> {
  const parsed = parseServeArguments(argv);
  if (parsed === null) {
    process.stderr.write(`${USAGE_LINE.serve}\n`);
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
  const build = BUILT_AT === null ? `build ${BUILD}` : `build ${BUILD}, ${BUILT_AT}`;
  process.stdout.write(`serving ${running.folder} on ${running.url}/${mode} (${build})\n`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void running.close());
  }
  await running.closed;
  return EXIT.ok;
}

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

async function runBundle(argv: readonly string[]): Promise<number> {
  const folder = argv.length === 1 ? argv[0] : undefined;
  if (folder === undefined || folder === '' || folder.startsWith('--')) {
    process.stderr.write(`${USAGE_LINE.bundle}\n`);
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

const SHIPPED_SKILL = fileURLToPath(new URL('../skills/esbozo/SKILL.md', import.meta.url));

type SkillArguments = { action: 'print' } | { action: 'install'; dir: string };

function parseSkillArguments(argv: readonly string[]): SkillArguments | null {
  if (argv.length === 0) {
    return { action: 'print' };
  }
  if (argv[0] !== 'install') {
    return null;
  }
  if (argv.length === 1) {
    return { action: 'install', dir: join(homedir(), '.agents', 'skills') };
  }
  if (argv.length === 3 && argv[1] === '--dir') {
    const dir = argv[2];
    if (dir === undefined || dir === '' || dir.startsWith('--')) {
      return null;
    }
    return { action: 'install', dir: resolve(dir) };
  }
  return null;
}

async function runSkill(argv: readonly string[]): Promise<number> {
  const parsed = parseSkillArguments(argv);
  if (parsed === null) {
    process.stderr.write(`${USAGE_LINE.skill}\n`);
    return EXIT.usage;
  }

  let source: Buffer;
  try {
    source = await readFile(SHIPPED_SKILL);
  } catch (error) {
    process.stderr.write(
      `cannot read ${SHIPPED_SKILL}: ${(error as NodeJS.ErrnoException).message}\n`,
    );
    return EXIT.writeFailed;
  }
  if (parsed.action === 'print') {
    process.stdout.write(source);
    return EXIT.ok;
  }

  const target = join(parsed.dir, 'esbozo', 'SKILL.md');
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
  } catch (error) {
    process.stderr.write(`cannot write ${target}: ${(error as NodeJS.ErrnoException).message}\n`);
    return EXIT.writeFailed;
  }
  process.stdout.write(`${target}\n`);
  return EXIT.ok;
}

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

type LoadedScene =
  | { ok: true; value: Scene; sourceHash: string }
  | { ok: false; exitCode: number };

/** Every problem a parse found, one line each, naming the Element it belongs to. */
function printProblems(problems: readonly { elementId: string | null; message: string }[]): void {
  for (const problem of problems) {
    const where = problem.elementId === null ? '' : `${problem.elementId}: `;
    process.stderr.write(`${where}${problem.message}\n`);
  }
}

async function loadScene(scenePath: string): Promise<LoadedScene> {
  let bytes: Buffer;
  try {
    bytes = await readFile(scenePath);
  } catch (error) {
    process.stderr.write(`cannot read Scene ${scenePath}: ${(error as NodeJS.ErrnoException).message}\n`);
    return { ok: false, exitCode: EXIT.invalidScene };
  }

  const parsed = parseScene(bytes.toString('utf8'));
  if (!parsed.ok) {
    printProblems(parsed.problems);
    return { ok: false, exitCode: EXIT.invalidScene };
  }
  return { ok: true, value: parsed.scene, sourceHash: sha256Hex(bytes) };
}

function svgPathFor(scenePath: string): string {
  return resolve(dirname(scenePath), svgFileName(basename(scenePath)));
}

function pngPathFor(scenePath: string, theme: Theme): string {
  return resolve(dirname(scenePath), `${sceneStem(basename(scenePath))}.${theme}.png`);
}

process.exitCode = await main(process.argv.slice(2));
