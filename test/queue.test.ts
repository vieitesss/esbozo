/**
 * Script seam: `scripts/queue.mjs` around commands that must not run side by side.
 *
 * Four full e2e runs started at once from four worktrees once loaded an 8-core
 * machine to 83, and every one of them timed out. So what is asserted here is
 * the queue as a second caller meets it: it waits while another run holds the
 * name, says whose run it waits on, starts once that run ends, takes over a
 * name whose holder died, and passes the command's exit code through. Every
 * command is a real child process, so the timing is the timing a person sees.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../scripts/queue.mjs', import.meta.url));

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The queue running `code` in a child node under `name`, until both end. */
function queued(name: string, code: string): Promise<Run> {
  const proc = spawn(process.execPath, [SCRIPT, name, process.execPath, '-e', code], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  proc.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  proc.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  return new Promise((resolve) => {
    proc.once('close', (exit) => resolve({ code: exit ?? -1, stdout, stderr }));
  });
}

/** A command that prints when it starts and ends, holding the name for `ms` between. */
function timed(ms: number): string {
  return `process.stdout.write('start ' + Date.now() + '\\n');
    setTimeout(() => process.stdout.write('end ' + Date.now() + '\\n'), ${ms});`;
}

/** The start and end times a `timed` command printed. */
function span(run: Run): { start: number; end: number } {
  const at = (word: string): number => Number(new RegExp(`^${word} (\\d+)$`, 'm').exec(run.stdout)?.[1]);
  return { start: at('start'), end: at('end') };
}

test('a second run under the same name waits for the first, and says whose run it waits on', { timeout: 30_000 }, async () => {
  const first = queued('one', timed(1_500));
  // The first is given time to take the name before the second asks for it.
  await new Promise((resolve) => setTimeout(resolve, 400));
  const second = queued('one', timed(100));
  const [a, b] = await Promise.all([first, second]);

  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  assert.ok(span(b).start >= span(a).end, `the second started after the first ended: ${a.stdout} ${b.stdout}`);
  assert.match(b.stderr, /waiting for the one run in .+ \(pid \d+\)/, 'the wait names the run it waits on');
  assert.equal(a.stderr, '', 'a run that waited on nobody says nothing');
});

test('runs under different names do not wait for each other', { timeout: 30_000 }, async () => {
  const [a, b] = await Promise.all([queued('left', timed(1_000)), queued('right', timed(1_000))]);

  assert.ok(span(b).start < span(a).end, `the two ran side by side: ${a.stdout} ${b.stdout}`);
  assert.equal(b.stderr, '');
});

test('a name held by a run that died is taken over', { timeout: 30_000 }, async () => {
  // A pid far above any the system hands out, so no process answers to it.
  writeFileSync(join(tmpdir(), 'esbozo-queue-dead'), `${2 ** 22 + 7}\n/nowhere\n`);
  const run = await queued('dead', 'process.stdout.write("ran\\n")');

  assert.equal(run.code, 0);
  assert.equal(run.stdout, 'ran\n', 'the command ran without waiting on the dead holder');
});

test('the exit code of the command passes through, and the name is free afterwards', { timeout: 30_000 }, async () => {
  const failed = await queued('exit', 'process.exit(3)');
  assert.equal(failed.code, 3);

  const next = await queued('exit', 'process.stdout.write("ran\\n")');
  assert.equal(next.stdout, 'ran\n');
  assert.equal(next.stderr, '', 'the failed run let go of the name');
});
