/**
 * The probe helper, run as a probe writer runs it.
 *
 * Two probes go through a real Chromium against the built page: one answers with
 * the page's title, one throws. Each run is a child process of its own, so what
 * is asserted is what the helper prints and the code it exits with — and that
 * the port it served on is free again once the process is gone, whether the probe
 * returned or threw.
 *
 * `pnpm test` builds first, so `dist/` is there for these runs.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const PROBE = fileURLToPath(new URL('../scripts/probe-editor.mjs', import.meta.url));

/** The title the built editor page declares, so a served page is the page read. */
const EDITOR_TITLE = 'esbozo';

/** What one run of the helper left behind: its exit code and its two streams. */
interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Writes one probe module in a folder of its own, and answers its path. */
async function probeSource(t: TestContext, source: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'esbozo-probe-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const file = join(folder, 'probe.mjs');
  await writeFile(file, source, 'utf8');
  return file;
}

/** Runs the helper as a person runs it, and answers what it left behind. */
async function helper(args: readonly string[], input?: { source: string; folder: string }): Promise<Run> {
  return await new Promise((resolve, reject) => {
    const env = input && { ...process.env, TMPDIR: input.folder, TEMP: input.folder };
    const child = spawn(process.execPath, [PROBE, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end(input?.source);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** The port the helper says it is serving on, or a loud failure. */
function portOf(stderr: string): number {
  const match = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(stderr);
  assert.ok(match !== null, `no served URL in the helper's stderr: ${stderr}`);
  return Number(match[1]);
}

/** Whether nothing answers on `port` any more. */
async function released(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

test('a probe reads the live page and the helper prints what it returned', async (t) => {
  const file = await probeSource(t, 'export default async ({ page }) => await page.title();\n');
  const run = await helper([file]);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout), EDITOR_TITLE);
  const port = portOf(run.stderr);
  assert.equal(await released(port), true, `the helper left ${port} open`);
});

test('a stdin probe with no built page boots nothing and leaves no temporary module', async (t) => {
  const empty = await mkdtemp(join(tmpdir(), 'esbozo-probe-empty-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  const run = await helper(['--folder', empty], {
    source: 'export default async () => null;\n',
    folder: empty,
  });

  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /pnpm build/);
  assert.doesNotMatch(run.stderr, /probing http:\/\//);
  assert.equal(run.stdout, '');
  assert.deepEqual(await readdir(empty), []);
});

test('a throwing probe exits non-zero, prints the error, and leaves no server', async (t) => {
  const file = await probeSource(
    t,
    "export default async () => {\n  throw new Error('probe on purpose');\n};\n",
  );
  const run = await helper([file]);

  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /probe on purpose/);
  assert.equal(run.stdout, '');
  const port = portOf(run.stderr);
  assert.equal(await released(port), true, `the helper left ${port} open`);
});
