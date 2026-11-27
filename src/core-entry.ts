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
 * `JSON.parse`, with V8's numbers.
 *
 * goja reads a JSON number as a Go float64 and refuses the ones that overflow
 * it, where V8 reads them as ±Infinity. A Scene file is the one place a person
 * or an agent can write a number that large — `JSON.stringify` writes Infinity
 * as `null`, so no editor can — and `scene.ts` refuses it by name (`labelAt.t
 * must be a finite number, got null`) rather than as JSON it cannot read. The
 * engine stays the parser: it validates the text, decodes the strings and builds
 * the objects, and only a text it refused is read again with those numbers put
 * back.
 */
const engineParse = JSON.parse;

const v8Parse = (text: string, reviver?: unknown): unknown => {
  try {
    return (engineParse as (text: string, reviver?: unknown) => unknown)(text, reviver);
  } catch (error) {
    // A reviver reads the engine's own objects, and the core parses with none.
    if (reviver !== undefined) {
      throw error;
    }
    const repaired = withOverflowingNumbers(text);
    if (repaired === null) {
      throw error;
    }
    const parsed = engineParse(repaired.source) as Record<string, unknown>;
    for (const { path, value } of repaired.overflowed) {
      if (path.length === 0) {
        return value;
      }
      let holder = parsed;
      for (const step of path.slice(0, -1)) {
        holder = holder[String(step)] as Record<string, unknown>;
      }
      const slot = String(path[path.length - 1]);
      // Only where the `0` this walk wrote still stands: a duplicated key that
      // came later in the text is the value V8 keeps, and is left alone.
      if (holder[slot] === 0) {
        holder[slot] = value;
      }
    }
    return parsed;
  }
};

(JSON as unknown as { parse: typeof v8Parse }).parse = v8Parse;

/** One number V8 reads as ±Infinity, and where in the text it was written. */
interface OverflowedNumber {
  readonly path: readonly (string | number)[];
  readonly value: number;
}

/**
 * A JSON text with every number V8 reads as ±Infinity written as `0`, and the
 * places those numbers were — `null` when there is no such number, or when the
 * walk cannot read the text, because then the engine's own refusal is the
 * answer.
 *
 * This walk finds numbers; it does not judge the text. Whatever it rewrites is
 * parsed by the engine afterwards, which is what refuses a text that is not
 * JSON.
 */
function withOverflowingNumbers(
  text: string,
): { source: string; overflowed: OverflowedNumber[] } | null {
  const found: (OverflowedNumber & { start: number; end: number })[] = [];
  let at = 0;

  const space = (): void => {
    while (at < text.length && ' \t\n\r'.includes(text[at] as string)) {
      at += 1;
    }
  };

  /** One quoted string, quotes and all: the engine decodes what this skips. */
  const quoted = (): void => {
    at += 1;
    while (at < text.length) {
      if (text[at] === '\\') {
        at += 2;
        continue;
      }
      const char = text[at];
      at += 1;
      if (char === '"') {
        return;
      }
    }
    throw new Error('the string never closes');
  };

  const value = (path: (string | number)[]): void => {
    space();
    const char = text[at];
    if (char === '{') {
      at += 1;
      space();
      if (text[at] === '}') {
        at += 1;
        return;
      }
      for (;;) {
        space();
        const start = at;
        quoted();
        const key = engineParse(text.slice(start, at)) as string;
        space();
        at += 1;
        value([...path, key]);
        space();
        if (text[at] === ',') {
          at += 1;
          continue;
        }
        at += 1;
        return;
      }
    }
    if (char === '[') {
      at += 1;
      space();
      if (text[at] === ']') {
        at += 1;
        return;
      }
      for (let index = 0; ; index += 1) {
        value([...path, index]);
        space();
        if (text[at] === ',') {
          at += 1;
          continue;
        }
        at += 1;
        return;
      }
    }
    if (char === '"') {
      quoted();
      return;
    }
    if (char === '-' || (char !== undefined && char >= '0' && char <= '9')) {
      const start = at;
      while (at < text.length && '+-.0123456789eE'.includes(text[at] as string)) {
        at += 1;
      }
      const number = Number(text.slice(start, at));
      if (Number.isNaN(number)) {
        throw new Error('the number does not read as one');
      }
      if (!Number.isFinite(number)) {
        found.push({ path, value: number, start, end: at });
      }
      return;
    }
    if (char === 't' || char === 'f' || char === 'n') {
      while (at < text.length && 'abcdefghijklmnopqrstuvwxyz'.includes(text[at] as string)) {
        at += 1;
      }
      return;
    }
    throw new Error('this walk cannot read this text');
  };

  try {
    value([]);
  } catch {
    return null;
  }
  if (found.length === 0) {
    return null;
  }

  let source = '';
  let copied = 0;
  for (const { start, end } of found) {
    source += `${text.slice(copied, start)}0`;
    copied = end;
  }
  source += text.slice(copied);
  return { source, overflowed: found };
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
 * @public The bundle's surface, reached by the host as `__ezCore`: esbuild's
 * global is what makes these exports callable from Go, so nothing in the repo
 * imports them and knip is told not to ask.
 */
export interface Request {
  readonly source: ArrayBuffer;
  readonly fontPath: string | null;
  readonly cssPath: string | null;
}

/**
 * What a command made: the SVG, or the lines it refuses with.
 *
 * @public
 */
export interface Answer {
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

/** The Scene's text, decoded as Node's `bytes.toString('utf8')` decodes it. */
function textOf(source: ArrayBuffer): string {
  return globalThis.__ezHost.decodeUtf8(source);
}

/** A problem as `ez` prints it: `id: message`, or the message alone with no id. */
function problemLines(problems: readonly { elementId: string | null; message: string }[]): string[] {
  return problems.map((problem) =>
    problem.elementId === null ? problem.message : `${problem.elementId}: ${problem.message}`,
  );
}

function loadScene(source: ArrayBuffer) {
  const bytes = new Uint8Array(source);
  return { bytes, parsed: parseScene(textOf(source)) };
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
 * The command that is running, and what it made. `begin` starts it and `answer`
 * reads it: goja runs the queue of promises when the script that awaited them
 * ends, so the host gives it two calls rather than one promise.
 */
let settled: Answer | null = null;

/**
 * Start one command over the request the host installed as `__ezRequest`.
 *
 * @public
 */
export function begin(request: Request, kind: 'render' | 'check'): void {
  settled = null;
  const running = kind === 'render' ? render(request) : check(request);
  void running.then(
    (answer) => {
      settled = answer;
    },
    (error: unknown) => {
      settled = failed(EXIT.invalidScene, [threw(error)]);
    },
  );
}

/**
 * What a throw inside the core reads like. The stack is here because a host that
 * sees this line has no other way to find where the core gave up.
 */
function threw(error: unknown): string {
  const stack = (error as { stack?: unknown } | null)?.stack;
  return `the core threw: ${typeof stack === 'string' ? stack : String(error)}`;
}

/**
 * What the command `begin` started settled on.
 *
 * @public
 */
export function answer(): Answer {
  if (settled === null) {
    throw new Error('the core has no answer: call begin first');
  }
  return settled;
}
