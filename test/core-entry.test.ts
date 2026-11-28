/** Module seam: the core bundle's `begin` and `answer` calls. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import { runInThisContext } from 'node:vm';
import { arrayBufferOf, installHost } from '../scripts/core-host/host.ts';
import type { EzHost } from '../src/core-host.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORE = join(ROOT, 'dist/core.js');
const SCENE = join(ROOT, 'test/fixtures/small.json');

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

interface Names extends Answer {
  problem: string | null;
  stem: string;
  svg: string;
  png: string | null;
  listed: string;
  maxListedSceneBytes: number;
}

interface Core {
  begin(request: object, kind: string): void;
  answer(): Answer;
}

let core: Core;
let host: EzHost;

before(async () => {
  host = await installHost();
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
    anchor: ['scenePath', 'all', 'elementId', 'end', 'place'],
    snap: ['scenePath', 'elementId', 'end', 'target'],
    names: ['fileName', 'theme'],
    describe: [],
  });
});

test('names answers a Scene’s file rules, named for the files Go reads and writes', async () => {
  core.begin({ fileName: 'sketch.json', theme: 'dark' }, 'names');
  await drainMicrotasks();
  const answer = core.answer() as Names;
  assert.equal(answer.ok, true);
  assert.equal(answer.problem, null);
  assert.equal(answer.stem, 'sketch');
  assert.equal(answer.svg, 'sketch.svg');
  assert.equal(answer.png, 'sketch.dark.png');
  assert.equal(answer.listed, 'if-scene');
  assert.equal(answer.maxListedSceneBytes, 5 * 1024 * 1024);
});

test('names with no theme names no PNG, and a name that is no Scene says why', async () => {
  core.begin({ fileName: 'sketches/sketch.esbozo', theme: null }, 'names');
  await drainMicrotasks();
  const answer = core.answer() as Names;
  assert.equal(answer.ok, true);
  assert.equal(answer.problem, 'sketches/sketch.esbozo: name a Scene in the folder, not a path');
  assert.equal(answer.stem, 'sketches/sketch');
  assert.equal(answer.svg, 'sketches/sketch.svg');
  assert.equal(answer.png, null);
  assert.equal(answer.listed, 'always');
});

test('names reads an empty name as the missing one, not as a crash', async () => {
  core.begin({ fileName: '', theme: null }, 'names');
  await drainMicrotasks();
  const answer = core.answer() as Names;
  assert.equal(answer.ok, true);
  assert.equal(answer.problem, 'the Scene name is missing');
  assert.equal(answer.stem, '');
  assert.equal(answer.svg, '.svg');
  assert.equal(answer.png, null);
  assert.equal(answer.listed, 'never');
});

test('names reads an empty name with a theme as the missing one too', async () => {
  core.begin({ fileName: '', theme: 'light' }, 'names');
  await drainMicrotasks();
  const answer = core.answer() as Names;
  assert.equal(answer.ok, true);
  assert.equal(answer.problem, 'the Scene name is missing');
  assert.equal(answer.png, '.light.png');
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
  const decode = host.decodeUtf8;
  host.decodeUtf8 = () => {
    throw new Error('the host gave up');
  };
  try {
    core.begin(request(), 'render');
    await drainMicrotasks();
    assert.throws(() => core.answer(), /the host gave up/);
  } finally {
    host.decodeUtf8 = decode;
  }
});

test('the host installs again in one process, on the wasm that is already up', async () => {
  const again = await installHost();
  const installed = (globalThis as unknown as { __ezHost: EzHost }).__ezHost;
  assert.equal(installed, again, 'the newest host is the one the core reads');
});
