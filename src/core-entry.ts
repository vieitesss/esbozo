/**
 * The core bundle: the Scene parser, the Layout and the Renderer behind one
 * surface for a host that is not Node.
 *
 * `ez` in Go embeds this file and runs it in goja, so the bundle carries no
 * Node API: what it needs from the host arrives through `globalThis.__ezHost`
 * (read a file, decode bytes, hand over the bundled font and its measurements),
 * and the paths it hands back are resolved by the host. The surface is
 * synchronous for the caller — `begin` starts one command and `answer` gives
 * what it made — because a JS engine that does not own the event loop cannot
 * return a promise to Go.
 *
 * Nothing here decides what a Scene is: the rules are `scene.ts`, the measuring
 * is `layout.ts` and the drawing is `renderer.ts`, exactly the code the CLI and
 * the editor already run. This file only joins them the way `src/cli.ts` does
 * for `render` and `check`, and hands back what those two print.
 */
import { chooseFont, layoutFor, readStylesheet } from './font.js';
import { renderScene } from './renderer.js';
import { parseScene } from './scene.js';
import { sha256Hex } from './sha256.js';
import type { Layout } from './layout.js';

/**
 * What the host lends the bundle. `ez` in Go provides all seven; a host that
 * cannot is a host that cannot run the core.
 */
interface EzHost {
  readText(path: string): string;
  readBytes(path: string): ArrayBuffer;
  encodeUtf8(text: string): ArrayBuffer;
  decodeUtf8(bytes: ArrayBuffer): string;
  /**
   * The folder the host's process runs in, because a stylesheet's `@font-face`
   * url is resolved beside the stylesheet and the command line may have named it
   * relatively: `node:path`'s `resolve` needs the host's working folder.
   */
  cwd(): string;
  /**
   * The bundled font's bytes, read in place of the `.ttf` import the CLI bundles
   * as base64: the binary carries that very file, so the bundle keeps only a
   * stub instead of a second copy of it.
   */
  bundledFont(): ArrayBuffer;
  /**
   * What `opentype.js` makes of those very bytes, as JSON, taken by
   * `scripts/build-core.mjs` so no cold start pays for the parse; the host's
   * `opentype.js` shim measures from it. `null` when the builder proved no
   * table, and then the core parses the font as it always did.
   */
  bundledFontMetrics(): string;
}

declare global {
  // eslint-disable-next-line no-var
  var __ezHost: EzHost;
}

/**
 * `TextEncoder`, the one browser global the core draws on: `src/scene.ts` hashes
 * an Element id's bytes and `src/sha256.ts` hashes a string's. It is installed
 * here rather than in a shim so the bundle keeps no Node API of its own.
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
 * not close enough where a Scene reaches it. It refuses a number that overflows
 * a float64, where V8 reads ±Infinity. It turns a lone UTF-16 surrogate into
 * U+FFFD, where V8 keeps the code unit, so the check `src/scene.ts` makes for
 * characters XML cannot represent would never see one. And its refusals are
 * worded differently.
 *
 * A caller that asks for a `reviver` still gets the engine: it walks the
 * engine's own objects, and the core parses with none. Everything else is read
 * here, once, left to right, and answered as V8 answers it: the same values, and
 * for a text V8 refuses, the same `SyntaxError` naming the same place.
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
 * this reader stands in for `JSON.parse` around the one parse of it: the
 * bundle's own JSON, the font table the build measured, stays the engine's,
 * which reads it several times faster than a reader written in JavaScript can.
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

/** The text around one offset, quoted as V8 quotes it, with `...` where it was cut. */
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
 * One JSON text, read as `JSON.parse` reads it.
 *
 * Everything V8 accepts is accepted as V8 makes it: a number that overflows a
 * float64 is ±Infinity because `Number` says so, a `\uXXXX` escape is the code
 * unit it names (a lone surrogate included), a duplicated key keeps the value
 * written last, and `__proto__` is an own property rather than a prototype.
 * Everything V8 refuses is refused with V8's own message, because that line is
 * what `ez` prints after `not valid JSON: `.
 */
function readJson(text: string): unknown {
  const end = text.length;
  let at = 0;

  /** One place in the text, as V8 words it: `position 4 (line 1 column 5)`. */
  function where(offset: number): string {
    let line = 1;
    let lineStart = 0;
    for (let index = 0; index < offset && index < end; index += 1) {
      if (text[index] === '\n') {
        line += 1;
        lineStart = index + 1;
      }
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
      // A plain assignment is V8's own data property, which is what a Scene's
      // parse is paid for in bulk; `__proto__` is the one key V8 makes an own
      // property where an assignment would set the prototype instead.
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
 * The exit codes `render` and `check` use, copied from `EXIT` in `src/cli.ts`
 * because that table is not exported. The Go side owns them for the process; the
 * core answers them so a host prints what the CLI prints.
 */
const EXIT = {
  invalidScene: 3,
  missingThemeOrFont: 5,
  labelOverflow: 6,
} as const;

/**
 * What a command needs: the Scene's exact bytes, and where a `--font` or `--css`
 * flag pointed. An absent flag is `null`, never an empty path.
 *
 * The surface is the bundle's, reached by the host as `__ezCore`: esbuild's
 * global is what makes `begin` and `answer` callable from Go, so nothing in the
 * repo imports them and only those two are exported.
 */
interface Request {
  readonly source: ArrayBuffer;
  readonly fontPath: string | null;
  readonly cssPath: string | null;
}

/** What a command made: the SVG, or the lines it refuses with. */
interface Answer {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly svg: string;
  readonly problems: readonly string[];
  /** Lines the command prints on stderr but does not fail on, such as a remote font. */
  readonly notes: readonly string[];
}

function failed(exitCode: number, problems: readonly string[]): Answer {
  return { ok: false, exitCode, svg: '', problems, notes: [] };
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

async function render(request: Request): Promise<Answer> {
  const { bytes, parsed } = loadScene(request.source);
  if (!parsed.ok) {
    return failed(EXIT.invalidScene, problemLines(parsed.problems));
  }

  // `render` takes no `--css`, so it reads no stylesheet: `src/cli.ts` hands
  // `loadLayout` an undefined path for it, and the bytes it draws are the same
  // bytes whether or not a stylesheet exists.
  const font = await chooseFont(request.fontPath ?? undefined, null, 'light');
  if (!font.ok) {
    return failed(EXIT.missingThemeOrFont, font.problems);
  }

  const layout: Layout = layoutFor(font.value);
  const svg = renderScene(parsed.scene, layout, sha256Hex(bytes));
  return { ok: true, exitCode: 0, svg, problems: [], notes: font.notes };
}

async function check(request: Request): Promise<Answer> {
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
  return { ok: true, exitCode: 0, svg: '', problems: [], notes: font.notes };
}

/**
 * The command that is running, what it made, and what it threw. `begin` starts it
 * and `answer` reads it: goja runs the queue of promises when the script that
 * awaited them ends, so the host gives it two calls rather than one promise.
 */
let settled: Answer | null = null;
let failure: { error: unknown } | null = null;

/**
 * Start one command over the request the host installed as `__ezRequest`.
 *
 * A command this bundle does not have is refused here rather than answered as
 * `check`: a Scene reported as unmeasurable when nothing measured it is a
 * refusal about the wrong thing, and the host words it as its own failure.
 *
 * @public
 */
export function begin(request: Request, kind: 'render' | 'check'): void {
  settled = null;
  failure = null;
  if (kind !== 'render' && kind !== 'check') {
    throw new Error(`the core has no command ${String(kind)}`);
  }
  void (kind === 'render' ? render(request) : check(request)).then(
    (answer) => {
      settled = answer;
    },
    (error: unknown) => {
      // Kept for `answer` to throw: a throw inside the core is the core failing
      // to run, not a Scene it reads and refuses, and the host tells those apart
      // by exit code. The error's stack is what names the place it gave up.
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
