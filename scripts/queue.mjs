/**
 * One run at a time of a command that loads the whole machine.
 *
 * Four full e2e runs started at once from four worktrees loaded an 8-core
 * machine to 83, and every one of them timed out: each run's browser starved
 * the others, so none could tell a slow page from a broken one. A full run
 * already uses every core on its own, so a second one gains nothing by starting
 * early. This script makes the second caller wait, says whose run it waits on,
 * and starts the command once that run ends.
 *
 * The name is held by a file in the temporary directory, created exclusively
 * and holding the holder's pid and folder. A holder that died without letting
 * go — killed, or the machine slept through it — is found by its pid and its
 * file taken over, so a crash never blocks the next run.
 *
 * Usage: node scripts/queue.mjs <name> <command> [arguments...]
 *        The four `e2e` scripts run through it under the name `e2e`.
 */
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';

const USAGE = 'Usage: node scripts/queue.mjs <name> <command> [arguments...]';

/** How often a waiting run looks again; a full run takes minutes, so a second is nothing. */
const POLL_MS = 1_000;

const [name, ...command] = process.argv.slice(2);
if (name === undefined || command.length === 0) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

const held = join(tmpdir(), `esbozo-queue-${name}`);

/** The run holding the name, or null when it is free or its holder died. */
function holder() {
  let text;
  try {
    text = readFileSync(held, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const [pid = '', folder = ''] = text.split('\n');
  try {
    process.kill(Number(pid), 0);
  } catch (error) {
    // EPERM is a live process this user may not signal: still a holder.
    if (error.code !== 'ESRCH') return { pid, folder };
    rmSync(held, { force: true });
    return null;
  }
  return { pid, folder };
}

/** Take the name, or say who has it. */
function take() {
  try {
    writeFileSync(held, `${process.pid}\n${process.cwd()}\n`, { flag: 'wx' });
    return null;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return holder() ?? take();
  }
}

/** Let go of the name, unless a run that took it over after us holds it now. */
function release() {
  try {
    if (readFileSync(held, 'utf8').split('\n')[0] === String(process.pid)) rmSync(held);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/** The signal this run was interrupted with, so the exit says what happened. */
let interrupted;
/** The command, once it runs. */
let child;

/**
 * A terminal interrupt reaches the command on its own: the terminal sends SIGINT
 * to the whole foreground group. While still waiting there is no command, so
 * this run ends.
 */
process.on('SIGINT', () => {
  interrupted ??= 'SIGINT';
  if (child === undefined) process.exit(128 + constants.signals.SIGINT);
});

/** A SIGTERM is aimed at this run alone, so the command only hears it passed on. */
process.on('SIGTERM', () => {
  interrupted ??= 'SIGTERM';
  if (child === undefined) process.exit(128 + constants.signals.SIGTERM);
  child.kill('SIGTERM');
});

let waiting = take();
if (waiting !== null) {
  process.stderr.write(`queue: waiting for the ${name} run in ${waiting.folder} (pid ${waiting.pid}) to finish\n`);
  while (waiting !== null) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    waiting = take();
  }
}

child = spawn(command[0], command.slice(1), { stdio: 'inherit' });
const ended = await new Promise((resolve) => {
  child.once('error', (error) => {
    process.stderr.write(`${command[0]}: ${error.message}\n`);
    resolve({ code: 1, signal: null });
  });
  child.once('close', (code, signal) => resolve({ code, signal }));
});
release();

if (interrupted !== undefined) {
  process.exitCode = 128 + (constants.signals[interrupted] ?? 0);
} else if (ended.code !== null) {
  process.exitCode = ended.code;
} else {
  // The command was killed by a signal this run never saw: report it as a shell does.
  process.exitCode = 128 + (constants.signals[ended.signal] ?? 0);
}
