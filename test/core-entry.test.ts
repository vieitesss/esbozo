/** Module seam: the core bundle's `begin` and `answer` calls. */
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

interface RenderRequest {
  source: ArrayBuffer;
  fontPath: string | null;
}

interface Answer {
  ok: boolean;
  exitCode: number;
  problems: string[];
  notes: string[];
}

interface Described extends Answer {
  exit: Record<string, number>;
  commands: Record<string, string[]>;
}

interface Core {
  begin(request: object, kind: string): void;
  answer(): Answer;
}

interface Host {
  readText(path: string): string;
  readBytes(path: string): ArrayBuffer;
  encodeUtf8(text: string): ArrayBuffer;
  decodeUtf8(bytes: ArrayBuffer): string;
  cwd(): string;
  bundledFont(): ArrayBuffer;
  bundledFontMetrics(): string;
}

function arrayBufferOf(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

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
  (globalThis as unknown as { __ezHost: Host }).__ezHost = host();
  runInThisContext(readFileSync(CORE, 'utf8'), { filename: CORE });
  core = (globalThis as unknown as { __ezCore: Core }).__ezCore;
});

function request(): RenderRequest {
  return { source: arrayBufferOf(readFileSync(SCENE)), fontPath: null };
}

async function drainMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

test('a command the core does not have is refused, not answered as check', () => {
  assert.throws(() => core.begin(request(), 'publish'), /no command publish/);
  assert.throws(() => core.answer(), /call begin first/, 'nothing settled for it to answer');
});

test('a kind inherited from Object.prototype is refused too', () => {
  for (const kind of ['toString', 'constructor', '__proto__']) {
    assert.throws(() => core.begin({}, kind), new RegExp(`no command ${kind}`));
    assert.throws(() => core.answer(), /call begin first/, 'nothing settled for it to answer');
  }
});

test('a request that is not an object is refused', () => {
  const refused: unknown[] = [42, true, 'abc', [], null, undefined];
  for (const request of refused) {
    assert.throws(
      () => core.begin(request as object, 'describe'),
      /describe expects a request object/,
    );
    assert.throws(() => core.answer(), /call begin first/, 'nothing settled for it to answer');
  }
});

test('a request key the command does not take is refused', () => {
  assert.throws(
    () => core.begin({ ...request(), lablePath: 'typo.ttf' }, 'render'),
    /render has no key lablePath: it takes keys source, fontPath/,
  );
  assert.throws(() => core.answer(), /call begin first/, 'nothing settled for it to answer');
});

test('a request key the command needs is refused when missing', () => {
  assert.throws(
    () => core.begin({ source: request().source }, 'render'),
    /render is missing the key fontPath: it takes keys source, fontPath/,
  );
  assert.throws(() => core.answer(), /call begin first/, 'nothing settled for it to answer');
});

test('describe answers the exit table and every command\u2019s request keys', async () => {
  core.begin({}, 'describe');
  await drainMicrotasks();
  const answer = core.answer() as Described;
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.exit, {
    ok: 0,
    usage: 2,
    invalidScene: 3,
    writeFailed: 4,
    missingThemeOrFont: 5,
    labelOverflow: 6,
  });
  assert.deepEqual(answer.commands, {
    render: ['source', 'fontPath'],
    check: ['source', 'fontPath', 'cssPath'],
    parse: ['source'],
    png: ['source', 'fontPath', 'cssPath', 'theme', 'ink', 'paper', 'muted'],
    anchor: ['source', 'all', 'elementId', 'end', 'place'],
    snap: ['source', 'elementId', 'end', 'target'],
    describe: [],
  });
});

test('describe answers copies, so a caller cannot change the commands', async () => {
  core.begin({}, 'describe');
  await drainMicrotasks();
  const answer = core.answer() as Described;
  answer.commands.render!.push('lablePath');
  answer.commands.describe!.push('hacked');
  core.begin({}, 'describe');
  await drainMicrotasks();
  const again = core.answer() as Described;
  assert.deepEqual(again.commands.render, ['source', 'fontPath']);
  assert.deepEqual(again.commands.describe, []);
});

test('a throw inside the core comes back a throw, not a refused Scene', async () => {
  const installed = (globalThis as unknown as { __ezHost: Host }).__ezHost;
  const decode = installed.decodeUtf8;
  installed.decodeUtf8 = () => {
    throw new Error('the host gave up');
  };
  try {
    core.begin(request(), 'render');
    await drainMicrotasks();
    assert.throws(() => core.answer(), /the host gave up/);
  } finally {
    installed.decodeUtf8 = decode;
  }
});
