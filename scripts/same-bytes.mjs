import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORE = join(ROOT, 'dist/core.js');
const FIXTURES = join(ROOT, 'test/fixtures');
const KALAM = join(ROOT, 'fonts/Kalam-Regular.ttf');
const FONT_METRICS = join(ROOT, 'dist/font-metrics.json');
const RESVG_WASM = join(ROOT, 'node_modules/@resvg/resvg-wasm/index_bg.wasm');

const KINDS = [
  { label: 'render', kind: 'render', theme: null },
  { label: 'check', kind: 'check', theme: null },
  { label: 'pngLight', kind: 'png', theme: 'light' },
  { label: 'pngDark', kind: 'png', theme: 'dark' },
];

const KALAM_BYTES = readFileSync(KALAM);
const FONT_METRICS_TEXT = readFileSync(FONT_METRICS, 'utf8');

await initWasm(readFileSync(RESVG_WASM));

globalThis.__ezHost = {
  readText: (path) => readFileSync(String(path), 'utf8'),
  readBytes: (path) => arrayBufferOf(readFileSync(String(path))),
  encodeUtf8: (text) => arrayBufferOf(Buffer.from(String(text), 'utf8')),
  decodeUtf8: (bytes) => Buffer.from(new Uint8Array(bytes)).toString('utf8'),
  cwd: () => process.cwd(),
  bundledFont: () => arrayBufferOf(KALAM_BYTES),
  bundledFontMetrics: () => FONT_METRICS_TEXT,
  rasterise: (svg, options) => {
    const resvg = new Resvg(String(svg), JSON.parse(String(options)));
    try {
      return arrayBufferOf(Buffer.from(resvg.render().asPng()));
    } finally {
      resvg.free();
    }
  },
};

// The bundle is an IIFE that leaves its surface on `__ezCore`, which a script
// in this context defines as a global; `import` would keep it module-scoped.
runInThisContext(readFileSync(CORE, 'utf8'), { filename: CORE });
const core = globalThis.__ezCore;

function arrayBufferOf(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * One command's answer, as both sides write it. `begin` starts the command and
 * `answer` reads it, because goja cannot be handed a promise: the macrotask here
 * lets every microtask the command awaits run first. A PNG is base64, which is
 * how Go writes a `[]byte`.
 */
async function answerOf({ kind, theme }, source) {
  core.begin(requestFor(kind, arrayBufferOf(source), theme), kind);
  await new Promise((resolve) => setImmediate(resolve));
  const answer = core.answer();
  return {
    ok: answer.ok,
    exitCode: answer.exitCode,
    svg: answer.svg ?? '',
    png: answer.png === null || answer.png === undefined ? null : Buffer.from(answer.png).toString('base64'),
    problems: [...answer.problems],
    notes: [...answer.notes],
  };
}

function requestFor(kind, scene, theme) {
  switch (kind) {
    case 'render':
      return { source: scene, fontPath: null };
    case 'check':
      return { source: scene, fontPath: null, cssPath: null };
    case 'png':
      return {
        source: scene,
        fontPath: null,
        cssPath: null,
        theme,
        ink: null,
        paper: null,
        muted: null,
      };
    default:
      throw new Error(`no request for ${kind}`);
  }
}

async function fixtures() {
  const names = (await readdir(FIXTURES)).filter((name) => name.endsWith('.json')).sort();
  return names.map((name) => ({ name, source: readFileSync(join(FIXTURES, name)) }));
}

function goAnswers() {
  const output = join(scratch, 'go-answers.json');
  const ran = spawnSync('go', ['test', './internal/core', '-run', '^TestCoreAnswers$', '-count=1'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, GOTOOLCHAIN: 'local', CGO_ENABLED: '0', EZ_SAME_BYTES_OUT: output },
  });
  if (ran.status !== 0) {
    process.stderr.write(`go test failed:\n${ran.stderr || ran.stdout}\n`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(output, 'utf8'));
}

function firstDifference(one, other) {
  const end = Math.min(one.length, other.length);
  for (let at = 0; at < end; at += 1) {
    if (one[at] !== other[at]) return at;
  }
  return end;
}

function answerDifferences(label, go, node) {
  const found = [];
  if (go.ok !== node.ok) {
    found.push(`${label}: ok ${go.ok}, the bundle's ${node.ok}`);
  }
  if (go.exitCode !== node.exitCode) {
    found.push(`${label}: exit ${go.exitCode}, the bundle's ${node.exitCode}`);
  }
  if (go.svg !== node.svg) {
    found.push(
      `${label}: SVG ${go.svg.length} bytes, the bundle's ${node.svg.length}, ` +
        `first difference at byte ${firstDifference(go.svg, node.svg)}`,
    );
  }
  if (go.png !== node.png) {
    const [one, other] = [go.png ?? '', node.png ?? ''];
    found.push(
      `${label}: PNG ${one.length} base64 characters, the bundle's ${other.length}, ` +
        `first difference at character ${firstDifference(one, other)}`,
    );
  }
  for (const field of ['problems', 'notes']) {
    const [one, other] = [go[field], node[field]];
    if (one.length !== other.length || one.some((line, at) => line !== other[at])) {
      found.push(`${label}: ${field} ${JSON.stringify(one)}, the bundle's ${JSON.stringify(other)}`);
    }
  }
  return found;
}

const scratch = await mkdtemp(join(tmpdir(), 'esbozo-same-bytes-'));
let failed = 0;

try {
  const scenes = await fixtures();
  const go = goAnswers();
  const goByFixture = new Map(go.fixtures.map((fixture) => [fixture.fixture, fixture]));

  for (const scene of scenes) {
    const node = { fixture: scene.name };
    for (const kind of KINDS) {
      node[kind.label] = await answerOf(kind, scene.source);
    }

    const emitted = goByFixture.get(scene.name);
    if (emitted === undefined) {
      failed += 1;
      process.stdout.write(`FAIL ${scene.name}: the Go core answered no fixture of that name\n`);
      continue;
    }

    let differences = [];
    for (const kind of KINDS) {
      differences = differences.concat(answerDifferences(kind.label, emitted[kind.label], node[kind.label]));
    }
    if (differences.length === 0) {
      process.stdout.write(`PASS ${scene.name}\n`);
      continue;
    }
    failed += 1;
    for (const difference of differences) {
      process.stdout.write(`FAIL ${scene.name}: ${difference}\n`);
    }
  }

  for (const name of goByFixture.keys()) {
    if (scenes.some((scene) => scene.name === name)) continue;
    failed += 1;
    process.stdout.write(`FAIL ${name}: the Go core answered a fixture the bundle did not read\n`);
  }

  process.stdout.write(`${scenes.length - failed}/${scenes.length} fixtures byte-identical\n`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
