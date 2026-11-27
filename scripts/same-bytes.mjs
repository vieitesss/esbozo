/**
 * The two runtimes, held to the same bytes.
 *
 * `ez` runs the core bundle in goja; the editor and the CLI run the same sources
 * in V8. This compares the two: every Scene in `test/fixtures/` is rendered and
 * checked by `dist/core.js` in Node and by `internal/core` in Go, and the SVG
 * bytes, the problem lines, the notes and the exit code have to be identical.
 * `png` runs in both themes too, and its bytes have to be identical as well: the
 * SVG comparison cannot see a rasteriser at all, and a PNG that came out the same
 * in both themes would mean the theme never arrived.
 *
 * Both sides are the core, so this survives deleting the TypeScript CLI: there is
 * no `dist/cli.js` here. The Go half is `TestCoreAnswers` in `internal/core`,
 * which writes what the core answers; this script runs it and compares.
 *
 * The two rasterisers behind them are the real ones: Node calls
 * `@resvg/resvg-wasm` here, and Go runs the same `index_bg.wasm` in wazero.
 *
 * Usage: node scripts/same-bytes.mjs — after `pnpm build`, which writes
 * `dist/core.js` and `dist/font-metrics.json`. Exit `0` when every fixture is
 * identical, `1` otherwise; one line per fixture and a count as the last line.
 */
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

/** The commands compared on every fixture, and the request each one carries. */
const KINDS = [
  { label: 'render', kind: 'render', theme: null },
  { label: 'check', kind: 'check', theme: null },
  { label: 'pngLight', kind: 'png', theme: 'light' },
  { label: 'pngDark', kind: 'png', theme: 'dark' },
];

const KALAM_BYTES = readFileSync(KALAM);
const FONT_METRICS_TEXT = readFileSync(FONT_METRICS, 'utf8');

/**
 * The real rasteriser, started before any fixture runs: the host answers `png`
 * synchronously, as Go's does, so the module is loaded once here rather than
 * awaited inside the call.
 */
await initWasm(readFileSync(RESVG_WASM));

/**
 * The host the bundle reaches through `globalThis.__ezHost`, answered with Node's
 * own filesystem: the same answers `internal/core/host.go` gives the goja
 * runtime, except that `rasterise` is resvg's own module in V8 rather than in
 * wazero.
 */
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

/** A copy of these bytes as the ArrayBuffer the request carries. */
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
  core.begin({ source: arrayBufferOf(source), fontPath: null, cssPath: null, theme }, kind);
  await new Promise((resolve) => setImmediate(resolve));
  const answer = core.answer();
  return {
    ok: answer.ok,
    exitCode: answer.exitCode,
    svg: answer.svg,
    png: answer.png === null || answer.png === undefined ? null : Buffer.from(answer.png).toString('base64'),
    problems: [...answer.problems],
    notes: [...answer.notes],
  };
}

/** Every fixture Scene, by the name both sides call it. */
async function fixtures() {
  const names = (await readdir(FIXTURES)).filter((name) => name.endsWith('.json')).sort();
  return names.map((name) => ({ name, source: readFileSync(join(FIXTURES, name)) }));
}

/**
 * What the Go core answered, written by `TestCoreAnswers`: the test is run rather
 * than reimplemented, because a second caller of `core.Run` would be a second
 * thing to keep right.
 */
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

/** Where two byte strings part company, as a byte offset. */
function firstDifference(one, other) {
  const end = Math.min(one.length, other.length);
  for (let at = 0; at < end; at += 1) {
    if (one[at] !== other[at]) return at;
  }
  return end;
}

/** The fields one answer disagrees on, as lines a person can act on. */
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
