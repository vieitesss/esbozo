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
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD, BUILT_AT } from './build-id.js';
import { anchorOf, anchorPoint, pointOnOutline } from './geometry.js';
import { sceneStem, svgFileName } from './paths.js';
import { isOutlined, parseScene, serialiseScene, snapTargetId, elementsById } from './scene.js';
import { drawnGeometry, renderScene } from './renderer.js';
import { sha256Hex } from './sha256.js';
import { THEMES, renderPng } from './png.js';
import { serve } from './serve.js';
import type { ServeOptions } from './serve.js';
import type { PngOptions, Theme } from './png.js';
import type { Anchor, ArrowOrLineElement, Element, OutlinedElement, Point, Scene } from './scene.js';
import { chooseFont, layoutFor, readStylesheet } from './font.js';
import { USAGE_LINE, shouldBold, topLevelHelp } from './help.js';
import type { Layout } from './layout.js';

const EXIT = {
  ok: 0,
  usage: 2,
  invalidScene: 3,
  writeFailed: 4,
  missingThemeOrFont: 5,
  labelOverflow: 6,
} as const;

/**
 * The places an Anchor takes on the command line: names for the middle of a
 * side, the middle of the box, and its four corners. A Scene never holds a name,
 * only the fractions these stand for.
 */
const SIDE_PLACES: Readonly<Record<string, Anchor>> = {
  top: { x: 0.5, y: 0 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
};

/** A name for a corner of the box, as fractions of it. */
const CORNER_PLACES: Readonly<Record<string, Anchor>> = {
  'top-left': { x: 0, y: 0 },
  'top-right': { x: 1, y: 0 },
  'bottom-left': { x: 0, y: 1 },
  'bottom-right': { x: 1, y: 1 },
};

/** Every place a person can name, in the order the help lists them. */
const PLACE_WORDS = [...Object.keys(SIDE_PLACES), ...Object.keys(CORNER_PLACES)];

const DEFAULT_PORT = 4320;

const BUILT = fileURLToPath(new URL('.', import.meta.url));

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
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
  if (command === '--help' || command === 'help') {
    process.stdout.write(topLevelHelp(shouldBold(process.stdout)));
    return EXIT.ok;
  }
  process.stderr.write(topLevelHelp(false));
  return EXIT.usage;
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
 * `anchor` and `snap`: the two commands that edit a Scene in place.
 *
 * An Anchor names a place on a Snap target's box, so the names below exist on
 * the command line only: the Scene always stores fractions, and a person who
 * wants a corner of a rounded box or of an ellipse gets the point where the box
 * corner's line to the centre meets the outline, because those shapes have no
 * corner where their box has one.
 */

/** Which end of an arrow or line a command names: its first point, or its last. */
const ENDS = ['start', 'end'] as const;
type End = (typeof ENDS)[number];

/**
 * What a command says to anchor an end at, before the target's outline is known:
 * a place on the box, a corner of it, or no Anchor at all.
 */
type Place =
  | { readonly kind: 'none' }
  | { readonly kind: 'spot'; readonly anchor: Anchor; readonly corner: boolean };

/** What a command made of a Scene: the Scene to save, and the lines a person reads. */
interface Change {
  readonly scene: Scene;
  readonly lines: readonly string[];
}

/** A command's answer: what it made, or the message and exit code it refused with. */
type Answer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly exitCode: number };

function refusal(message: string, exitCode: number): { ok: false; message: string; exitCode: number } {
  return { ok: false, message, exitCode };
}

/** Load the Scene a command names, apply its edit, and save what it made. */
async function editScene<T extends { readonly scenePath: string }>(
  request: Answer<T>,
  apply: (scene: Scene, request: T) => Answer<Change>,
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
  return editScene(parseAnchorArguments(argv), (scene, request) =>
    request.all ? freezeEnds(scene) : placeEnd(scene, request),
  );
}

async function runSnap(argv: readonly string[]): Promise<number> {
  return editScene(parseSnapArguments(argv), snapEnd);
}

/** One end anchored at a named place, or with its Anchor dropped. */
type AnchorRequest =
  | { readonly scenePath: string; readonly all: true }
  | {
      readonly scenePath: string;
      readonly all: false;
      readonly elementId: string;
      readonly end: End;
      readonly place: Place;
    };

/** One end attached to an Element, or written free with `off`. */
interface SnapRequest {
  readonly scenePath: string;
  readonly elementId: string;
  readonly end: End;
  /** The Element to attach to, or null for `off`: an end that remembers no Snap. */
  readonly target: string | null;
}

function parseAnchorArguments(argv: readonly string[]): Answer<AnchorRequest> {
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
  const end = parseEnd(word);
  if (end === null) {
    return refusal(endMessage(word), EXIT.usage);
  }
  const parsed = parsePlace(place);
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true, value: { scenePath, all: false, elementId, end, place: parsed.value } };
}

function parseSnapArguments(argv: readonly string[]): Answer<SnapRequest> {
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
  const end = parseEnd(word);
  if (end === null) {
    return refusal(endMessage(word), EXIT.usage);
  }
  return {
    ok: true,
    value: { scenePath, elementId, end, target: target === 'off' ? null : target },
  };
}

/** The end a word names, or null where it names none. */
function parseEnd(word: string | undefined): End | null {
  return ENDS.find((candidate) => candidate === word) ?? null;
}

/** Why a word is no end: a Shaft has a start and an end, and nothing between. */
function endMessage(word: string | undefined): string {
  return `an end is start or end, got ${JSON.stringify(word)}`;
}

/** The place a word names: a name, a pair of fractions, or `none`. */
function parsePlace(word: string): Answer<Place> {
  if (word === 'none') {
    return { ok: true, value: { kind: 'none' } };
  }
  const side = SIDE_PLACES[word];
  if (side !== undefined) {
    return { ok: true, value: { kind: 'spot', anchor: side, corner: false } };
  }
  const corner = CORNER_PLACES[word];
  if (corner !== undefined) {
    return { ok: true, value: { kind: 'spot', anchor: corner, corner: true } };
  }
  const anchor = pairOfFractions(word);
  if (anchor === null) {
    return refusal(
      `a place is ${PLACE_WORDS.join(', ')}, a pair of fractions "fx,fy", or none,` +
        ` got ${JSON.stringify(word)}`,
      EXIT.usage,
    );
  }
  // A fraction outside the box is the one thing `ez check` refuses about an Anchor.
  for (const [axis, value] of [
    ['x', anchor.x],
    ['y', anchor.y],
  ] as const) {
    if (!(value >= 0 && value <= 1)) {
      return refusal(`anchor ${axis} must be between 0 and 1, got ${value}`, EXIT.invalidScene);
    }
  }
  return { ok: true, value: { kind: 'spot', anchor, corner: false } };
}

/** A pair of fractions written `fx,fy`, or null where the word is not one. */
function pairOfFractions(word: string): Anchor | null {
  const parts = word.split(',');
  if (parts.length !== 2) {
    return null;
  }
  const [x, y] = parts.map((part) => (/^-?\d+(?:\.\d+)?$/.test(part) ? Number(part) : Number.NaN));
  return x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y) ? null : { x, y };
}

/** The Scene with one end anchored at a named place, or its Anchor dropped. */
function placeEnd(scene: Scene, request: AnchorRequest & { all: false }): Answer<Change> {
  const found = findShaft(scene, request.elementId);
  if (!found.ok) {
    return found;
  }
  const element = found.value;
  const index = endIndex(element, request.end);
  const point = element.points[index]!;
  const target = snappedTarget(scene, element, request.end);
  if (!target.ok) {
    return target;
  }
  const anchor =
    request.place.kind === 'none' ? undefined : placeOn(request.place, target.value);
  const stored =
    anchor === undefined ? withoutAnchor(point) : drawnAt(point, target.value, anchor);
  return {
    ok: true,
    value: {
      scene: withPoint(scene, element, index, stored),
      lines: [changedLine(element.id, request.end, stored)],
    },
  };
}

/** The Scene with one end attached to an Element, or written free with `off`. */
function snapEnd(scene: Scene, request: SnapRequest): Answer<Change> {
  const found = findShaft(scene, request.elementId);
  if (!found.ok) {
    return found;
  }
  const element = found.value;
  const index = endIndex(element, request.end);
  const point = element.points[index]!;

  let stored: Point;
  if (request.target === null) {
    stored = { x: point.x, y: point.y, snap: false };
  } else {
    const target = scene.elements.find((candidate) => candidate.id === request.target);
    if (target === undefined) {
      return refusal(`no Element "${request.target}" in the Scene`, EXIT.invalidScene);
    }
    if (!isOutlined(target)) {
      return refusal(
        `snap target "${request.target}" must be a rectangle, ellipse or diamond`,
        EXIT.invalidScene,
      );
    }
    // The same place the editor's drop takes: the outline point nearest the spot
    // the end is drawn at now, not the target's centre.
    const [atStart, atEnd] = drawnEnds(element, elementsById(scene.elements));
    const anchor = anchorOf(target, request.end === 'start' ? atStart : atEnd);
    stored = { ...drawnAt(point, target, anchor), snap: request.target };
  }

  return {
    ok: true,
    value: {
      scene: withPoint(scene, element, index, stored),
      lines: [changedLine(element.id, request.end, stored)],
    },
  };
}

/**
 * Every Snapped end that carries no Anchor, given the Anchor of the spot it
 * draws at today, so freezing it moves no ink.
 */
function freezeEnds(scene: Scene): Answer<Change> {
  const byId = elementsById(scene.elements);
  const lines: string[] = [];
  const elements = scene.elements.map((element) => {
    if (element.type !== 'arrow' && element.type !== 'line') {
      return element;
    }
    const [atStart, atEnd] = drawnEnds(element, byId);
    const last = element.points.length - 1;
    let changed = false;
    const points = element.points.map((point, index) => {
      const end: End | null = index === 0 ? 'start' : index === last ? 'end' : null;
      if (end === null || point.anchor !== undefined) {
        return point;
      }
      const target = snapTargetId(point);
      const outline = target === null ? undefined : byId.get(target);
      if (outline === undefined || !isOutlined(outline)) {
        return point;
      }
      const stored = drawnAt(
        point,
        outline,
        anchorOf(outline, end === 'start' ? atStart : atEnd),
      );
      changed = true;
      lines.push(changedLine(element.id, end, stored));
      return stored;
    });
    return changed ? ({ ...element, points } as ArrowOrLineElement) : element;
  });
  return { ok: true, value: { scene: { ...scene, elements }, lines } };
}

/**
 * Both ends a Shaft draws, each Snap resolved onto its target's outline: the
 * Renderer answers them canonically, so a Snap frozen here reads the very ends
 * the page draws.
 */
function drawnEnds(
  element: ArrowOrLineElement,
  byId: ReadonlyMap<string, Element>,
): readonly [Point, Point] {
  const ends = drawnGeometry(element, byId).ends;
  if (ends === null) {
    throw new Error(`${element.id}: only an arrow or line draws ends`);
  }
  return ends;
}

/** The arrow or line an id names, or why the Scene has no such Shaft. */
function findShaft(scene: Scene, id: string): Answer<ArrowOrLineElement> {
  const element = scene.elements.find((candidate) => candidate.id === id);
  if (element === undefined) {
    return refusal(`no Element "${id}" in the Scene`, EXIT.invalidScene);
  }
  if (element.type !== 'arrow' && element.type !== 'line') {
    return refusal(
      `"${id}" is a ${element.type}: only an arrow or a line has ends`,
      EXIT.invalidScene,
    );
  }
  return { ok: true, value: element };
}

/** The outlined Element an end Snaps to, or why it can hold no Anchor. */
function snappedTarget(
  scene: Scene,
  element: ArrowOrLineElement,
  end: End,
): Answer<OutlinedElement> {
  const id = snapTargetId(element.points[endIndex(element, end)]!);
  if (id === null) {
    return refusal(
      `"${element.id} ${end}" has no Snap: give it one with ez snap`,
      EXIT.invalidScene,
    );
  }
  const target = scene.elements.find((candidate) => candidate.id === id);
  if (target === undefined || !isOutlined(target)) {
    return refusal(`snap target "${id}" must be a rectangle, ellipse or diamond`, EXIT.invalidScene);
  }
  return { ok: true, value: target };
}

/** Where an end sits among its Shaft's points: the first one, or the last. */
function endIndex(element: ArrowOrLineElement, end: End): number {
  return end === 'start' ? 0 : element.points.length - 1;
}

/** The Anchor a named place means on this outline: fractions the Renderer draws there. */
function placeOn(place: Place & { kind: 'spot' }, outline: OutlinedElement): Anchor {
  if (!place.corner) {
    return place.anchor;
  }
  const corner = {
    x: outline.x + place.anchor.x * outline.width,
    y: outline.y + place.anchor.y * outline.height,
  };
  return anchorOf(outline, pointOnOutline(outline, corner));
}

/** The end stored where its Anchor draws it, so the file's numbers read true. */
function drawnAt(point: Point, target: OutlinedElement, anchor: Anchor): Point {
  const drawn = anchorPoint(target, anchor);
  return { ...point, x: drawn.x, y: drawn.y, anchor };
}

/** The same point with no Anchor: the Renderer aims the end again. */
function withoutAnchor(point: Point): Point {
  const cleared = { ...point };
  delete cleared.anchor;
  return cleared;
}

/** The Scene with one of a Shaft's points replaced. */
function withPoint(scene: Scene, element: ArrowOrLineElement, index: number, point: Point): Scene {
  const points = element.points.map((candidate, at) => (at === index ? point : candidate));
  const changed = { ...element, points } as ArrowOrLineElement;
  return {
    ...scene,
    elements: scene.elements.map((candidate) => (candidate.id === element.id ? changed : candidate)),
  };
}

/** The one line a command prints about the end it changed. */
function changedLine(id: string, end: End, point: Point): string {
  const snap = typeof point.snap === 'string' ? point.snap : 'off';
  const anchor =
    point.anchor === undefined ? '' : `, anchor {x: ${point.anchor.x}, y: ${point.anchor.y}}`;
  return `${id} ${end}: snap ${snap}${anchor}`;
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
