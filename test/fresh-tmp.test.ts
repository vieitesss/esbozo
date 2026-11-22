/**
 * Seam 3: `scripts/fresh-tmp.mjs` around a command that makes temporary folders.
 *
 * A suite that leaves a folder behind is found today by a person looking at
 * `$TMPDIR`, one folder at a time, long after the run went green. So what is
 * asserted here is the whole behaviour of the guard: what it does with a command
 * that leaves an `esbozo*` entry, with one that leaves only its own, with the
 * exit code it is handed, and with the folder — before, during and after an
 * interrupt. The command is a real child process, so the folder it is given is
 * read the way a suite reads it: `TMPDIR`.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../scripts/fresh-tmp.mjs', import.meta.url));

interface Run {
  readonly code: number;
  /** The folder the command was handed, as the command printed it. */
  readonly folder: string;
  readonly stderr: string;
}

/**
 * The guard running a child that first prints the folder it was handed and then
 * runs `code`, so a test reads the folder from the run rather than guessing it.
 */
function guard(code: string): Run {
  const child = `process.stdout.write(process.env.TMPDIR + '\\n');${code}`;
  const run = spawnSync(process.execPath, [SCRIPT, process.execPath, '-e', child], {
    encoding: 'utf8',
  });
  const [folder = ''] = run.stdout.split('\n');
  return { code: run.status ?? -1, folder, stderr: run.stderr };
}

test('a command that leaves a temporary folder behind fails the run, and the folder is named', () => {
  const run = guard(
    `require('node:fs').mkdirSync(require('node:path').join(process.env.TMPDIR, 'esbozo-x'))`,
  );

  assert.equal(run.code, 1, 'a leftover folder fails the run even though the command passed');
  assert.match(run.stderr, /esbozo-x/, 'the name left behind is printed');
  assert.equal(existsSync(run.folder), false, 'and the folder it was in is removed anyway');
});

test('one interrupt to the run is handed to the command once', { timeout: 30_000 }, async () => {
  // The command counts the interrupts it is sent and takes a moment to finish,
  // the way a runner's graceful cleanup does, so a second copy would be seen.
  const child = `let got = 0;
    process.on('SIGINT', () => {
      process.stdout.write('interrupt ' + (++got) + '\\n');
      setTimeout(() => process.exit(130), 300);
    });
    process.stdout.write(process.env.TMPDIR + '\\nready\\n');
    setInterval(() => {}, 1_000);`;
  // A group of its own, so one interrupt to it is one interrupt to the wrapper
  // and to the command, the way a terminal's Ctrl-C reaches both.
  const proc = spawn(process.execPath, [SCRIPT, process.execPath, '-e', child], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let stdout = '';
  proc.stdout.setEncoding('utf8');
  const ready = new Promise<void>((resolve) => {
    proc.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.includes('ready')) resolve();
    });
  });
  await ready;
  process.kill(-(proc.pid as number), 'SIGINT');
  const code = await new Promise<number>((resolve) => proc.once('close', resolve));

  const [folder = ''] = stdout.split('\n');
  assert.deepEqual(stdout.trim().split('\n').slice(1), ['ready', 'interrupt 1']);
  assert.equal(code, 130, 'the run ends the way a shell reports SIGINT');
  assert.equal(existsSync(folder), false, 'the folder is removed after the interrupt');
});

test('a command that leaves only its own entries passes', () => {
  const run = guard(
    `require('node:fs').mkdirSync(require('node:path').join(process.env.TMPDIR, 'other-x'))`,
  );

  assert.equal(run.code, 0, 'an entry that is not ours is not a failure');
  assert.equal(run.stderr, '', 'and nothing is printed about it');
});

test('the folder the command was given is under the temporary directory, and gone afterwards', () => {
  const run = guard('');

  assert.equal(run.code, 0);
  assert.ok(run.folder.startsWith(tmpdir()), `the folder is under ${tmpdir()}: ${run.folder}`);
  assert.equal(existsSync(run.folder), false, 'the folder is removed once the command ends');
});

test('the exit code of the command passes through', () => {
  const run = guard('process.exit(3)');

  assert.equal(run.code, 3);
  assert.equal(run.stderr, '', 'a clean run says nothing');
});

test(
  'an interrupt reaches the command, and the folder is removed anyway',
  { timeout: 30_000 },
  async () => {
    const child = `process.stdout.write(process.env.TMPDIR + '\\nready\\n');setInterval(() => {}, 1_000)`;
    const proc = spawn(process.execPath, [SCRIPT, process.execPath, '-e', child], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    proc.stdout.setEncoding('utf8');
    const ready = new Promise<void>((resolve) => {
      proc.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (stdout.includes('ready')) resolve();
      });
    });
    await ready;
    proc.kill('SIGTERM');
    const code = await new Promise<number>((resolve) => proc.once('close', resolve));

    const [folder = ''] = stdout.split('\n');
    assert.equal(code, 143, 'the run ends the way a shell reports SIGTERM');
    assert.equal(existsSync(folder), false, 'the folder is removed after the interrupt');
  },
);
