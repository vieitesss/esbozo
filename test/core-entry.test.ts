/**
 * Module seam: the core bundle's two calls — `begin` starts one command and
 * `answer` reads what it made — reached the way the Go host reaches them. A throw
 * inside the core is the core failing, not a Scene it reads and refuses, so the
 * bundle is loaded here the way `scripts/same-bytes.mjs` loads it and asked
 * directly. `pnpm build` writes the bundle this reads.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import { runInThisContext } from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORE = join(ROOT, 'dist/core.js');
const SCENE = join(ROOT, 'test/fixtures/small.json');
const KALAM = join(ROOT, 'fonts/Kalam-Regular.ttf');

/** `render`'s request, as the host builds it for `__ezCore.begin`. */
interface RenderRequest {
  source: ArrayBuffer;
  fontPath: string | null;
}

/** What the bundle answers with, as `internal/core` reads it. */
interface Answer {
  ok: boolean;
  exitCode: number;
  svg: string;
  problems: string[];
  notes: string[];
}

/** The surface `dist/core.js` leaves on the realm, which Go calls by name. */
interface Core {
  begin(request: RenderRequest, kind: string): void;
  answer(): Answer;
}

/** The host the bundle reaches through `globalThis.__ezHost`, answered by Node. */
interface Host {
  readText(path: string): string;
  readBytes(path: string): ArrayBuffer;
  encodeUtf8(text: string): ArrayBuffer;
  decodeUtf8(bytes: ArrayBuffer): string;
  cwd(): string;
  bundledFont(): ArrayBuffer;
  bundledFontMetrics(): string;
}

/** These bytes as the ArrayBuffer the host's answers carry. */
function arrayBufferOf(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** The host every test here starts from: Node's own filesystem, like Go's. */
function host(): Host {
  const font = readFileSync(KALAM);
  return {
    readText: (path) => readFileSync(String(path), 'utf8'),
    readBytes: (path) => arrayBufferOf(readFileSync(String(path))),
    encodeUtf8: (text) => arrayBufferOf(Buffer.from(String(text), 'utf8')),
    decodeUtf8: (bytes) => Buffer.from(new Uint8Array(bytes)).toString('utf8'),
    cwd: () => process.cwd(),
    bundledFont: () => arrayBufferOf(font),
    bundledFontMetrics: () => readFileSync(join(ROOT, 'dist/font-metrics.json'), 'utf8'),
  };
}

let core: Core;

before(() => {
  // The font is read at bundle load, so the host is installed first.
  (globalThis as unknown as { __ezHost: Host }).__ezHost = host();
  runInThisContext(readFileSync(CORE, 'utf8'), { filename: CORE });
  core = (globalThis as unknown as { __ezCore: Core }).__ezCore;
});

/** The Scene these two edges are asked about, as the host hands it over. */
function request(): RenderRequest {
  return { source: arrayBufferOf(readFileSync(SCENE)), fontPath: null };
}

/** Let the microtasks one command awaits run, as goja's queue does. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

test('a command the core does not have is refused, not answered as check', () => {
  assert.throws(() => core.begin(request(), 'publish'), /no command publish/);
  assert.throws(() => core.answer(), /call begin first/, 'nothing settled for it to answer');
});

test('a throw inside the core comes back a throw, not a refused Scene', async () => {
  const installed = (globalThis as unknown as { __ezHost: Host }).__ezHost;
  const decode = installed.decodeUtf8;
  installed.decodeUtf8 = () => {
    throw new Error('the host gave up');
  };
  try {
    core.begin(request(), 'render');
    await settled();
    assert.throws(() => core.answer(), /the host gave up/);
  } finally {
    installed.decodeUtf8 = decode;
  }
});
