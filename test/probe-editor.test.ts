/**
 * The probe helper, run as a probe writer runs it: `pnpm probe`, against the
 * built page.
 *
 * Two probes go through a real Chromium against the built editor: one reads the
 * status line while a Space pan runs, one throws. Each run is a child process of
 * its own, so what is asserted is what the documented command prints and the
 * code it exits with — and that the port it served on is free again once the
 * process is gone, whether the probe returned or threw.
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

/** The repository the `pnpm probe` script runs in. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * A probe that holds Space and answers the status line: `Panning` is a word only
 * the running editor writes, so a page that never ran its JS cannot answer it.
 */
const PAN_PROBE = `export default async ({ page }) => {
  await page.getByRole('button', { name: 'Select' }).waitFor();
  await page.keyboard.down(' ');
  const status = await page.getByRole('contentinfo').innerText();
  await page.keyboard.up(' ');
  return status;
};
`;

/**
 * The status line while the pan runs: the one thing the served page answers to a
 * key press, and what a page of static HTML never says.
 */
const PAN_STATUS = /Panning/;

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

/**
 * Runs the documented command, and answers what it left behind. pnpm's own
 * banner is silenced so the streams the run prints are the helper's alone.
 */
async function helper(args: readonly string[], input?: { source: string; folder: string }): Promise<Run> {
  return await new Promise((resolve, reject) => {
    const env = input && { ...process.env, TMPDIR: input.folder, TEMP: input.folder };
    const child = spawn('pnpm', ['--silent', 'probe', ...args], {
      cwd: ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end(input?.source);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * The probe folders a run left in the `TMPDIR` it was handed: one per run that
 * never cleaned up, and nothing else, since pnpm keeps a cache of its own there.
 */
async function strays(folder: string): Promise<string[]> {
  return (await readdir(folder)).filter((name) => name.startsWith('esbozo-probe-'));
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

test('a probe reads the running editor: a held Space names the pan in the status line', async (t) => {
  const file = await probeSource(t, PAN_PROBE);
  const run = await helper([file]);

  assert.equal(run.code, 0, run.stderr);
  assert.match(JSON.parse(run.stdout), PAN_STATUS);
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
  assert.deepEqual(await strays(empty), []);
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
