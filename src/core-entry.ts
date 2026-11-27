import { chooseFont, layoutFor, readStylesheet } from './font.js';
import { anchorEditOf, anchorScene, snapEditOf, snapScene } from './ends.js';
import { renderScene } from './renderer.js';
import { parseScene, serialiseScene } from './scene.js';
import { renderPng } from './png.js';
import type { PngOptions, Theme } from './png.js';
import { sha256Hex } from './sha256.js';
import { EXIT } from './exit.js';
import type { AnchorWords, Change, Outcome } from './ends.js';
import type { Layout } from './layout.js';
import type { Scene } from './scene.js';

interface EzHost {
  readText(path: string): string;
  readBytes(path: string): ArrayBuffer;
  encodeUtf8(text: string): ArrayBuffer;
  decodeUtf8(bytes: ArrayBuffer): string;
  sha256(bytes: Uint8Array): ArrayBuffer;
  cwd(): string;
  bundledFont(): ArrayBuffer;
  bundledFontMetrics(): string;
  rasterise(svg: string, options: string): ArrayBuffer;
}

declare global {
  // eslint-disable-next-line no-var
  var __ezHost: EzHost;
}

// goja has no TextEncoder global; back it with the host's UTF-8 encoder.
(globalThis as unknown as Record<string, unknown>).TextEncoder = class {
  encode(text = ''): Uint8Array {
    return new Uint8Array(globalThis.__ezHost.encodeUtf8(String(text)));
  }
};

/**
 * goja's `JSON.parse` differs from V8 in three ways that Scenes hit: it rejects
 * float64 overflow (V8 reads ±Infinity), replaces lone UTF-16 surrogates with
 * U+FFFD (V8 keeps the code unit), and formats SyntaxErrors differently.
 */
const engineParse = JSON.parse;

const REFUSED_TEXTS = ['NaN', 'Infinity', 'undefined'];

const SURROGATE_ESCAPE = /\\u[dD][89a-fA-F]/;

const v8Parse = (text: string, reviver?: unknown): unknown => {
  if (reviver !== undefined) {
    return (engineParse as (text: string, reviver?: unknown) => unknown)(text, reviver);
  }
  const source = String(text);
  if (REFUSED_TEXTS.includes(source)) {
    throw new SyntaxError(`"${source}" is not valid JSON`);
  }
  if (SURROGATE_ESCAPE.test(source)) {
    return readJson(source);
  }
  try {
    return engineParse(source);
  } catch {
    return readJson(source);
  }
};

function readAsV8<T>(read: () => T): T {
  const engine = JSON as unknown as { parse: typeof v8Parse };
  const parse = engine.parse;
  engine.parse = v8Parse;
  try {
    return read();
  } finally {
    engine.parse = parse;
  }
}

const SNIPPET_SIDE = 10;

function jsonSnippet(text: string, at: number): string {
  if (text.length <= SNIPPET_SIDE * 2) {
    return `"${text}"`;
  }
  const start = Math.max(0, at - SNIPPET_SIDE);
  const stop = Math.min(text.length, at + SNIPPET_SIDE);
  return `${start > 0 ? '...' : ''}"${text.slice(start, stop)}"${stop < text.length ? '...' : ''}`;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

function isHexDigit(char: string | undefined): boolean {
  return char !== undefined && '0123456789abcdefABCDEF'.includes(char);
}

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

function readJson(text: string): unknown {
  const end = text.length;
  let at = 0;

  function where(offset: number): string {
    let line = 1;
    let lineStart = 0;
    for (let index = 0; index < offset && index < end; index += 1) {
      const char = text[index];
      if (char === '\r' && text[index + 1] === '\n' && index + 1 < offset) {
        index += 1;
      } else if (char !== '\r' && char !== '\n') {
        continue;
      }
      line += 1;
      lineStart = index + 1;
    }
    return `position ${offset} (line ${line} column ${offset - lineStart + 1})`;
  }

  function refuse(offset: number, what: string): never {
    throw new SyntaxError(`${what} in JSON at ${where(offset)}`);
  }

  function refuseToken(offset: number): never {
    throw new SyntaxError(
      `Unexpected token '${text[offset]!}', ${jsonSnippet(text, offset)} is not valid JSON`,
    );
  }

  function refuseEnd(): never {
    throw new SyntaxError('Unexpected end of JSON input');
  }

  function skipSpace(): void {
    while (at < end) {
      const char = text[at];
      if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') {
        return;
      }
      at += 1;
    }
  }

  function readString(): string {
    at += 1;
    let start = at;
    let read = '';
    for (;;) {
      if (at >= end) {
        refuse(end, 'Unterminated string');
      }
      const char = text[at]!;
      if (char === '"') {
        read += text.slice(start, at);
        at += 1;
        return read;
      }
      if (char === '\\') {
        read += text.slice(start, at);
        at += 1;
        read += readEscape();
        start = at;
        continue;
      }
      if (char < ' ') {
        refuse(at, 'Bad control character in string literal');
      }
      at += 1;
    }
  }

  function readEscape(): string {
    if (at >= end) {
      refuseEnd();
    }
    const char = text[at]!;
    const simple = SIMPLE_ESCAPES[char];
    if (simple !== undefined) {
      at += 1;
      return simple;
    }
    if (char !== 'u') {
      refuse(at, 'Bad escaped character');
    }
    at += 1;
    let code = 0;
    for (let digit = 0; digit < 4; digit += 1) {
      const hex = text[at];
      if (!isHexDigit(hex)) {
        refuse(at, 'Bad Unicode escape');
      }
      code = code * 16 + parseInt(hex!, 16);
      at += 1;
    }
    return String.fromCharCode(code);
  }

  function readNumber(): number {
    const start = at;
    if (text[at] === '-') {
      at += 1;
      if (!isDigit(text[at])) {
        refuse(at, 'No number after minus sign');
      }
    }
    if (text[at] === '0') {
      at += 1;
      if (isDigit(text[at])) {
        refuse(at, 'Unexpected number');
      }
    } else {
      while (isDigit(text[at])) {
        at += 1;
      }
    }
    if (text[at] === '.') {
      at += 1;
      if (!isDigit(text[at])) {
        refuse(at, 'Unterminated fractional number');
      }
      while (isDigit(text[at])) {
        at += 1;
      }
    }
    if (text[at] === 'e' || text[at] === 'E') {
      at += 1;
      if (text[at] === '+' || text[at] === '-') {
        at += 1;
      }
      if (!isDigit(text[at])) {
        refuse(at, 'Exponent part is missing a number');
      }
      while (isDigit(text[at])) {
        at += 1;
      }
    }
    return Number(text.slice(start, at));
  }

  function readLiteral(): unknown {
    const literal = text[at] === 't' ? 'true' : text[at] === 'f' ? 'false' : 'null';
    for (let index = 1; index < literal.length; index += 1) {
      at += 1;
      if (at >= end) {
        refuseEnd();
      }
      if (text[at] !== literal[index]) {
        refuseToken(at);
      }
    }
    at += 1;
    return literal === 'null' ? null : literal === 'true';
  }

  function readArray(): unknown[] {
    at += 1;
    const array: unknown[] = [];
    skipSpace();
    if (text[at] === ']') {
      at += 1;
      return array;
    }
    for (;;) {
      array.push(readValue());
      skipSpace();
      if (text[at] === ',') {
        at += 1;
        continue;
      }
      if (text[at] !== ']') {
        refuse(at, "Expected ',' or ']' after array element");
      }
      at += 1;
      return array;
    }
  }

  function readObject(): Record<string, unknown> {
    at += 1;
    const object: Record<string, unknown> = {};
    skipSpace();
    if (text[at] === '}') {
      at += 1;
      return object;
    }
    for (let first = true; ; first = false) {
      skipSpace();
      if (text[at] !== '"') {
        refuse(
          at,
          first ? "Expected property name or '}'" : 'Expected double-quoted property name',
        );
      }
      const key = readString();
      skipSpace();
      if (text[at] !== ':') {
        refuse(at, "Expected ':' after property name");
      }
      at += 1;
      if (key === '__proto__') {
        Object.defineProperty(object, key, {
          value: readValue(),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } else {
        object[key] = readValue();
      }
      skipSpace();
      if (text[at] === ',') {
        at += 1;
        continue;
      }
      if (text[at] !== '}') {
        refuse(at, "Expected ',' or '}' after property value");
      }
      at += 1;
      return object;
    }
  }

  function readValue(): unknown {
    skipSpace();
    if (at >= end) {
      refuseEnd();
    }
    const char = text[at]!;
    if (char === '{') {
      return readObject();
    }
    if (char === '[') {
      return readArray();
    }
    if (char === '"') {
      return readString();
    }
    if (char === '-' || isDigit(char)) {
      return readNumber();
    }
    if (char === 't' || char === 'f' || char === 'n') {
      return readLiteral();
    }
    refuseToken(at);
  }

  const value = readValue();
  skipSpace();
  if (at < end) {
    throw new SyntaxError(`Unexpected non-whitespace character after JSON at ${where(at)}`);
  }
  return value;
}

interface RenderRequest {
  readonly source: ArrayBuffer;
  readonly fontPath: string | null;
}

interface CheckRequest extends RenderRequest {
  readonly cssPath: string | null;
}

interface PngRequest extends CheckRequest {
  readonly theme: Theme | null;
  readonly ink: string | null;
  readonly paper: string | null;
  readonly muted: string | null;
}

interface AnchorRequest {
  readonly source: ArrayBuffer | null;
  readonly all: boolean;
  readonly elementId: string | null;
  readonly end: string | null;
  readonly place: string | null;
}

interface SnapRequest {
  readonly source: ArrayBuffer | null;
  readonly elementId: string;
  readonly end: string;
  readonly target: string;
}

interface ParseRequest {
  readonly source: ArrayBuffer;
}

interface Result {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly problems: readonly string[];
  readonly notes: readonly string[];
}

interface Rendered extends Result {
  readonly svg: string;
}

interface Image extends Result {
  readonly png: Uint8Array | null;
}

interface Edited extends Result {
  readonly scene: string;
  readonly lines: readonly string[];
}

function ok(): Result {
  return { ok: true, exitCode: 0, problems: [], notes: [] };
}

function refused(exitCode: number, problems: readonly string[]): Result {
  return { ok: false, exitCode, problems, notes: [] };
}

function nothingSaved(result: Result): Edited {
  return { ...result, scene: '', lines: [] };
}

function problemLines(problems: readonly { elementId: string | null; message: string }[]): string[] {
  return problems.map((problem) =>
    problem.elementId === null ? problem.message : `${problem.elementId}: ${problem.message}`,
  );
}

function loadScene(source: ArrayBuffer) {
  const bytes = new Uint8Array(source);
  return { bytes, parsed: readAsV8(() => parseScene(globalThis.__ezHost.decodeUtf8(source))) };
}

async function render(request: RenderRequest): Promise<Rendered> {
  const { bytes, parsed } = loadScene(request.source);
  if (!parsed.ok) {
    return { ...refused(EXIT.invalidScene, problemLines(parsed.problems)), svg: '' };
  }

  const font = await chooseFont(request.fontPath ?? undefined, null, 'light');
  if (!font.ok) {
    return { ...refused(EXIT.missingThemeOrFont, font.problems), svg: '' };
  }

  const layout: Layout = layoutFor(font.value);
  const svg = renderScene(parsed.scene, layout, sha256Hex(bytes));
  return { ...ok(), svg, notes: font.notes };
}

async function check(request: CheckRequest): Promise<Result> {
  const { parsed } = loadScene(request.source);
  if (!parsed.ok) {
    return refused(EXIT.invalidScene, problemLines(parsed.problems));
  }

  const stylesheet = await readStylesheet(request.cssPath ?? undefined);
  if (!stylesheet.ok) {
    return refused(EXIT.missingThemeOrFont, stylesheet.problems);
  }
  const font = await chooseFont(request.fontPath ?? undefined, stylesheet.value, 'light');
  if (!font.ok) {
    return refused(EXIT.missingThemeOrFont, font.problems);
  }

  const layout = layoutFor(font.value);
  const overflowed: string[] = [];
  for (const element of parsed.scene.elements) {
    const overflow = layout.overflow(element);
    if (overflow !== null) {
      overflowed.push(`${overflow.elementId}: ${overflow.message}`);
    }
  }
  if (overflowed.length > 0) {
    return { ...refused(EXIT.labelOverflow, overflowed), notes: font.notes };
  }
  return { ...ok(), notes: font.notes };
}

async function parseOnly(request: ParseRequest): Promise<Result> {
  const { parsed } = loadScene(request.source);
  return parsed.ok
    ? ok()
    : refused(
        EXIT.invalidScene,
        parsed.problems.map((problem) => problem.message),
      );
}

async function png(request: PngRequest): Promise<Image> {
  const theme = request.theme;
  if (theme === null) {
    throw new Error('png needs a theme: the host decides light or dark, not the core');
  }

  const { parsed } = loadScene(request.source);
  if (!parsed.ok) {
    return { ...refused(EXIT.invalidScene, problemLines(parsed.problems)), png: null };
  }

  const rendered = await renderPng(parsed.scene, pngOptions(theme, request));
  if (!rendered.ok) {
    return { ...refused(EXIT.missingThemeOrFont, rendered.problems), png: null };
  }
  return { ...ok(), png: rendered.png, notes: rendered.notes };
}

function pngOptions(theme: Theme, request: PngRequest): PngOptions {
  const options: PngOptions = { theme };
  if (request.cssPath !== null) {
    options.cssPath = request.cssPath;
  }
  if (request.ink !== null) {
    options.ink = request.ink;
  }
  if (request.paper !== null) {
    options.paper = request.paper;
  }
  if (request.muted !== null) {
    options.muted = request.muted;
  }
  if (request.fontPath !== null) {
    options.fontPath = request.fontPath;
  }
  return options;
}

async function anchor(request: AnchorRequest): Promise<Edited> {
  return saveEnd(anchorEditOf(anchorWords(request)), request.source, anchorScene);
}

async function snap(request: SnapRequest): Promise<Edited> {
  const words = snapEditOf({
    elementId: request.elementId,
    end: request.end,
    target: request.target,
  });
  return saveEnd(words, request.source, snapScene);
}

async function saveEnd<Edit>(
  words: Outcome<Edit>,
  source: ArrayBuffer | null,
  apply: (scene: Scene, edit: Edit) => Outcome<Change>,
): Promise<Edited> {
  if (!words.ok) {
    return nothingSaved(refused(words.exitCode, [words.message]));
  }
  if (source === null) {
    return nothingSaved(ok());
  }
  const { parsed } = loadScene(source);
  if (!parsed.ok) {
    return nothingSaved(refused(EXIT.invalidScene, problemLines(parsed.problems)));
  }
  return saved(apply(parsed.scene, words.value));
}

function anchorWords(request: AnchorRequest): AnchorWords {
  if (request.all) {
    return { all: true };
  }
  if (request.elementId === null || request.end === null || request.place === null) {
    throw new Error('anchor needs an element, an end and a place without --all');
  }
  return { all: false, elementId: request.elementId, end: request.end, place: request.place };
}

function saved(edit: Outcome<Change>): Edited {
  if (!edit.ok) {
    return nothingSaved(refused(edit.exitCode, [edit.message]));
  }
  const text = serialiseScene(edit.value.scene);
  const checked = parseScene(text);
  if (!checked.ok) {
    return nothingSaved(refused(EXIT.invalidScene, problemLines(checked.problems)));
  }
  return { ...ok(), scene: text, lines: edit.value.lines };
}

let settled: Result | null = null;
let failure: { error: unknown } | null = null;

/**
 * Start a core command (`render`, `check`, `parse`, `png`, `anchor`, or `snap`).
 *
 * Split into `begin` + `answer` because goja drains its promise queue when the
 * JS call returns to Go, so the host cannot await a returned promise.
 *
 * @public
 */
export function begin(
  request: RenderRequest | CheckRequest | PngRequest | AnchorRequest | SnapRequest | ParseRequest,
  kind: string,
): void {
  settled = null;
  failure = null;
  let running: Promise<Result>;
  switch (kind) {
    case 'render':
      running = render(request as RenderRequest);
      break;
    case 'check':
      running = check(request as CheckRequest);
      break;
    case 'parse':
      running = parseOnly(request as ParseRequest);
      break;
    case 'png':
      running = png(request as PngRequest);
      break;
    case 'anchor':
      running = anchor(request as AnchorRequest);
      break;
    case 'snap':
      running = snap(request as SnapRequest);
      break;
    default:
      throw new Error(`the core has no command ${String(kind)}`);
  }
  void running.then(
    (answer) => {
      settled = answer;
    },
    (error: unknown) => {
      failure = { error };
    },
  );
}

/**
 * Return (and clear) the settled result of the command started by `begin`, or
 * rethrow its failure.
 *
 * @public
 */
export function answer(): Result {
  const answered = settled;
  const failed = failure;
  settled = null;
  failure = null;
  if (failed !== null) {
    throw failed.error;
  }
  if (answered === null) {
    throw new Error('the core has no answer: call begin first');
  }
  return answered;
}
