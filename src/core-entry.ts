/**
 * The core bundle: the Scene parser, the Layout and the Renderer behind one
 * surface for a host that is not Node.
 *
 * `ez` in Go embeds this file and runs it in goja, so the bundle carries no
 * Node API: what it needs from the host arrives through `globalThis.__ezHost`
 * (read a file, decode bytes, hand over the bundled font and its measurements,
 * rasterise an SVG), and the paths it hands back are resolved by the host. The
 * surface is synchronous for the caller — `begin` starts one command and
 * `answer` gives what it made — because a JS engine that does not own the
 * event loop cannot return a promise to Go.
 *
 * Nothing here decides what a Scene is: the rules are `scene.ts`, the measuring
 * is `layout.ts` and the drawing is `renderer.ts`.
 */
import { chooseFont, layoutFor, readStylesheet } from './font.js';
import { anchorEditOf, anchorScene, snapEditOf, snapScene } from './ends.js';
import { renderScene } from './renderer.js';
import { parseScene, serialiseScene } from './scene.js';
import { renderPng } from './png.js';
import type { PngOptions, Theme } from './png.js';
import { sha256Hex } from './sha256.js';
import type { AnchorWords, Change, Outcome } from './ends.js';
import type { Layout } from './layout.js';

/** What the host lends the bundle. */
interface EzHost {
  readText(path: string): string;
  readBytes(path: string): ArrayBuffer;
  encodeUtf8(text: string): ArrayBuffer;
  decodeUtf8(bytes: ArrayBuffer): string;
  /**
   * The folder the host's process runs in, because a stylesheet's `@font-face`
   * url is resolved beside the stylesheet and the command line may have named it
   * relatively.
   */
  cwd(): string;
  /**
   * The bundled font's bytes, read in place of the `.ttf` import the CLI bundles
   * as base64.
   */
  bundledFont(): ArrayBuffer;
  /**
   * What `opentype.js` makes of those very bytes, as JSON, taken by
   * `scripts/build-core.mjs`; `null` when the builder proved no table, and then
   * the core parses the font.
   */
  bundledFontMetrics(): string;
  /**
   * One SVG in, PNG bytes out, with resvg's own module: `ez` runs those bytes in
   * wazero (`internal/resvg`), so `scripts/core-host/resvg-wasm.mjs` hands the
   * SVG and the module's options JSON here.
   */
  rasterise(svg: string, options: string): ArrayBuffer;
}

declare global {
  // eslint-disable-next-line no-var
  var __ezHost: EzHost;
}

/**
 * `TextEncoder`, the one browser global the core draws on: `src/scene.ts` hashes
 * an Element id's bytes and `src/sha256.ts` hashes a string's.
 */
(globalThis as unknown as Record<string, unknown>).TextEncoder = class {
  encode(text = ''): Uint8Array {
    return new Uint8Array(globalThis.__ezHost.encodeUtf8(String(text)));
  }
};

/**
 * `JSON.parse`, as V8 reads it.
 *
 * `src/scene.ts` parses a Scene with `JSON.parse`, and a Scene is the one JSON a
 * person or an agent writes by hand: what V8 makes of that text is the answer,
 * down to the line `ez` prints when it refuses. goja's own parse is close, but
 * not close enough where a Scene reaches it: it refuses a number that overflows
 * a float64, where V8 reads ±Infinity; it turns a lone UTF-16 surrogate into
 * U+FFFD, where V8 keeps the code unit, so the check `src/scene.ts` makes for
 * characters XML cannot represent would never see one; and its refusals are
 * worded differently.
 *
 * A caller that asks for a `reviver` still gets the engine: it walks the
 * engine's own objects, and the core parses with none.
 */
const engineParse = JSON.parse;

/** The three words `JSON.parse` refuses by name instead of by the character it found. */
const REFUSED_TEXTS = ['NaN', 'Infinity', 'undefined'];

const v8Parse = (text: string, reviver?: unknown): unknown => {
  if (reviver !== undefined) {
    return (engineParse as (text: string, reviver?: unknown) => unknown)(text, reviver);
  }
  const source = String(text);
  if (REFUSED_TEXTS.includes(source)) {
    throw new SyntaxError(`"${source}" is not valid JSON`);
  }
  return readJson(source);
};

/**
 * Read this text as V8 reads it. A Scene is the only JSON a person writes, so
 * this reader stands in for `JSON.parse` around the one parse of it: the bundle's
 * own JSON, the font table the build measured, stays the engine's.
 */
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

/** How much of the text either side of an unexpected token a message quotes, as V8 does. */
const SNIPPET_SIDE = 10;

/** The text around one offset, quoted as V8 quotes it. */
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

/** What one `\` `…` escape stands for, before the four-hex-digit form. */
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

/**
 * One JSON text, read as `JSON.parse` reads it: a number that overflows a float64
 * is ±Infinity because `Number` says so, a `\uXXXX` escape is the code unit it
 * names (a lone surrogate included), a duplicated key keeps the value written
 * last, and `__proto__` is an own property rather than a prototype. A refusal is
 * V8's own message, because that line is what `ez` prints after
 * `not valid JSON: `.
 */
function readJson(text: string): unknown {
  const end = text.length;
  let at = 0;

  /** One place in the text, as V8 words it: `position 4 (line 1 column 5)`. */
  function where(offset: number): string {
    let line = 1;
    let lineStart = 0;
    for (let index = 0; index < offset && index < end; index += 1) {
      const char = text[index];
      if (char === '\r' && text[index + 1] === '\n' && index + 1 < offset) {
        // A `\r\n` pair is one line break to V8, not two.
        index += 1;
      } else if (char !== '\r' && char !== '\n') {
        continue;
      }
      line += 1;
      lineStart = index + 1;
    }
    return `position ${offset} (line ${line} column ${offset - lineStart + 1})`;
  }

  /** Refuse the text at `offset` with one of V8's messages that names a place. */
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

  /** One quoted string; a `\uXXXX` escape keeps the code unit it names, lone surrogates too. */
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

  /** One escape, the `\` and the character after it already read. */
  function readEscape(): string {
    // A `\` with nothing after it ends the text, and V8 names that as the end of
    // the text rather than as a string that never closes.
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

  /** A number by RFC 8259's grammar, valued by `Number`, so overflow is ±Infinity. */
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
      // A `0` ends the number there: a digit after it is no number of JSON's,
      // and V8 names it as one rather than as the delimiter it is not.
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

  /** `true`, `false` or `null`, matched a character at a time as V8 matches them. */
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
        // V8 words the first key and a later one differently.
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
      // A plain assignment makes the own data property V8 makes; `__proto__` is
      // the one key where that would set the prototype instead.
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
    // This one names no JSON, because it is about what is not JSON: V8 words it
    // `… after JSON at position 4 (line 1 column 5)`.
    throw new SyntaxError(`Unexpected non-whitespace character after JSON at ${where(at)}`);
  }
  return value;
}

/**
 * The exit codes `render`, `check` and `png` use, copied from `EXIT` in
 * `src/cli.ts` because that table is not exported; the core answers them so a
 * host prints what the CLI prints.
 */
const EXIT = {
  invalidScene: 3,
  missingThemeOrFont: 5,
  labelOverflow: 6,
} as const;

/**
 * What `render` needs: the Scene's exact bytes, and where a `--font` flag pointed.
 * An absent flag is `null`, never an empty path.
 *
 * Each command has its own request, so no command reads a field another one
 * named. The surface is the bundle's, reached by the host as `__ezCore`:
 * esbuild's global is what makes `begin` and `answer` callable from Go.
 */
interface RenderRequest {
  readonly source: ArrayBuffer;
  readonly fontPath: string | null;
}

/** `check`'s request: the font, and where a `--css` flag pointed. */
interface CheckRequest extends RenderRequest {
  readonly cssPath: string | null;
}

/** `png`'s request: the stylesheet and the font, the palette and its colours. */
interface PngRequest extends CheckRequest {
  /** The palette `png` draws in, and `null` when the flag was not given. */
  readonly theme: Theme | null;
  /** The colour `--ink` overrides, and `null` when the flag was not given. */
  readonly ink: string | null;
  readonly paper: string | null;
  readonly muted: string | null;
}

/**
 * `anchor`'s request: the Scene, and the words the command line typed. `--all`
 * names no Element, end or place, and each is `null` when it is set.
 */
interface AnchorRequest {
  readonly source: ArrayBuffer;
  readonly all: boolean;
  readonly elementId: string | null;
  readonly end: string | null;
  readonly place: string | null;
}

/** `snap`'s request: the Scene, the Element and end it names, and the target or `off`. */
interface SnapRequest {
  readonly source: ArrayBuffer;
  readonly elementId: string;
  readonly end: string;
  readonly target: string;
}

/** What a command made: the SVG, the PNG, the Scene text, or the lines it refuses with. */
interface Answer {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly svg: string;
  /** The image `png` drew, and `null` for any other command. */
  readonly png: Uint8Array | null;
  /** The Scene text `anchor` and `snap` save, and `''` for any other command. */
  readonly scene: string;
  /** The lines `anchor` and `snap` print once they have saved it. */
  readonly lines: readonly string[];
  readonly problems: readonly string[];
  /** Lines the command prints on stderr but does not fail on, such as a remote font. */
  readonly notes: readonly string[];
}

function failed(exitCode: number, problems: readonly string[]): Answer {
  return {
    ok: false,
    exitCode,
    svg: '',
    png: null,
    scene: '',
    lines: [],
    problems,
    notes: [],
  };
}

/** A problem as `ez` prints it: `id: message`, or the message alone with no id. */
function problemLines(problems: readonly { elementId: string | null; message: string }[]): string[] {
  return problems.map((problem) =>
    problem.elementId === null ? problem.message : `${problem.elementId}: ${problem.message}`,
  );
}

function loadScene(source: ArrayBuffer) {
  const bytes = new Uint8Array(source);
  // Decoded as Node's `bytes.toString('utf8')` decodes it.
  return { bytes, parsed: readAsV8(() => parseScene(globalThis.__ezHost.decodeUtf8(source))) };
}

async function render(request: RenderRequest): Promise<Answer> {
  const { bytes, parsed } = loadScene(request.source);
  if (!parsed.ok) {
    return failed(EXIT.invalidScene, problemLines(parsed.problems));
  }

  // `render` takes no `--css`, so it reads no stylesheet.
  const font = await chooseFont(request.fontPath ?? undefined, null, 'light');
  if (!font.ok) {
    return failed(EXIT.missingThemeOrFont, font.problems);
  }

  const layout: Layout = layoutFor(font.value);
  const svg = renderScene(parsed.scene, layout, sha256Hex(bytes));
  return {
    ok: true,
    exitCode: 0,
    svg,
    png: null,
    scene: '',
    lines: [],
    problems: [],
    notes: font.notes,
  };
}

async function check(request: CheckRequest): Promise<Answer> {
  const { parsed } = loadScene(request.source);
  if (!parsed.ok) {
    return failed(EXIT.invalidScene, problemLines(parsed.problems));
  }

  const stylesheet = await readStylesheet(request.cssPath ?? undefined);
  if (!stylesheet.ok) {
    return failed(EXIT.missingThemeOrFont, stylesheet.problems);
  }
  const font = await chooseFont(request.fontPath ?? undefined, stylesheet.value, 'light');
  if (!font.ok) {
    return failed(EXIT.missingThemeOrFont, font.problems);
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
    return { ...failed(EXIT.labelOverflow, overflowed), notes: font.notes };
  }
  return {
    ok: true,
    exitCode: 0,
    svg: '',
    png: null,
    scene: '',
    lines: [],
    problems: [],
    notes: font.notes,
  };
}

/**
 * `png`: `src/png.ts` owns the palette, the font and the outlines, and the host
 * owns resvg, so this hands the Scene over and answers the image.
 */
async function png(request: PngRequest): Promise<Answer> {
  const theme = request.theme;
  if (theme === null) {
    throw new Error('png needs a theme: the host decides light or dark, not the core');
  }

  const { parsed } = loadScene(request.source);
  if (!parsed.ok) {
    return failed(EXIT.invalidScene, problemLines(parsed.problems));
  }

  const rendered = await renderPng(parsed.scene, pngOptions(theme, request));
  if (!rendered.ok) {
    return failed(EXIT.missingThemeOrFont, rendered.problems);
  }
  return {
    ok: true,
    exitCode: 0,
    svg: '',
    png: rendered.png,
    scene: '',
    lines: [],
    problems: [],
    notes: rendered.notes,
  };
}

/**
 * What `png` was asked for: the theme, and the flags the host gave. An absent flag
 * is an absent key rather than one holding `undefined`, which `PngOptions` and
 * `exactOptionalPropertyTypes` refuse.
 */
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

/**
 * `anchor`: one end's Anchor placed on its target's outline, or every Snapped end
 * frozen where it draws — the Scene text to save, and the line a person reads.
 */
async function anchor(request: AnchorRequest): Promise<Answer> {
  // The words first, as the CLI judges them before it reads the Scene.
  const edit = anchorEditOf(anchorWords(request));
  if (!edit.ok) {
    return failed(edit.exitCode, [edit.message]);
  }
  const { parsed } = loadScene(request.source);
  if (!parsed.ok) {
    return failed(EXIT.invalidScene, problemLines(parsed.problems));
  }
  return saved(anchorScene(parsed.scene, edit.value));
}

/** `snap`: one end attached to an Element, or written free with `off`. */
async function snap(request: SnapRequest): Promise<Answer> {
  const edit = snapEditOf({
    elementId: request.elementId,
    end: request.end,
    target: request.target,
  });
  if (!edit.ok) {
    return failed(edit.exitCode, [edit.message]);
  }
  const { parsed } = loadScene(request.source);
  if (!parsed.ok) {
    return failed(EXIT.invalidScene, problemLines(parsed.problems));
  }
  return saved(snapScene(parsed.scene, edit.value));
}

/** The words `anchor`'s request carries; `--all` names no Element, end or place. */
function anchorWords(request: AnchorRequest): AnchorWords {
  if (request.all) {
    return { all: true };
  }
  if (request.elementId === null || request.end === null || request.place === null) {
    throw new Error('anchor needs an element, an end and a place without --all');
  }
  return { all: false, elementId: request.elementId, end: request.end, place: request.place };
}

/**
 * An edit saved: the Scene text the host writes and the lines it prints after, or
 * the problems the parser finds in what serialising made — `saveScene`'s check,
 * so no command hands a host a Scene the parser turns down.
 */
function saved(edit: Outcome<Change>): Answer {
  if (!edit.ok) {
    return failed(edit.exitCode, [edit.message]);
  }
  const text = serialiseScene(edit.value.scene);
  const checked = parseScene(text);
  if (!checked.ok) {
    return failed(EXIT.invalidScene, problemLines(checked.problems));
  }
  return {
    ok: true,
    exitCode: 0,
    svg: '',
    png: null,
    scene: text,
    lines: edit.value.lines,
    problems: [],
    notes: [],
  };
}

/**
 * The command that is running, what it made, and what it threw. `begin` starts it
 * and `answer` reads it: goja runs the queue of promises when the script that
 * awaited them ends, so the host gives it two calls rather than one promise.
 */
let settled: Answer | null = null;
let failure: { error: unknown } | null = null;

/**
 * Start one command over `request`, as the host built it: `render`'s fields for
 * `render`, `check`'s for `check`, `png`'s for `png`, and so on.
 *
 * A command this bundle does not have is refused here rather than answered as
 * `check`: a Scene reported as unmeasurable when nothing measured it is a
 * refusal about the wrong thing, and the host words it as its own failure.
 *
 * @public
 */
export function begin(
  request: RenderRequest | CheckRequest | PngRequest | AnchorRequest | SnapRequest,
  kind: string,
): void {
  settled = null;
  failure = null;
  // The host builds the request for the kind it names, so each branch reads only
  // the fields `begin` was handed for it.
  let running: Promise<Answer>;
  switch (kind) {
    case 'render':
      running = render(request as RenderRequest);
      break;
    case 'check':
      running = check(request as CheckRequest);
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
      // Kept for `answer` to throw: a throw inside the core is the core failing
      // to run, not a Scene it reads and refuses.
      failure = { error };
    },
  );
}

/**
 * What the command `begin` started settled on.
 *
 * @public
 */
export function answer(): Answer {
  if (failure !== null) {
    throw failure.error;
  }
  if (settled === null) {
    throw new Error('the core has no answer: call begin first');
  }
  return settled;
}
