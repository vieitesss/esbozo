/**
 * The run that says a suite left a temporary folder behind, before a person has
 * to find it in `$TMPDIR`.
 *
 * `test/temp.ts` gives every test one owner for the folders it makes, and the
 * runners remove them in a teardown. A teardown that stops running is invisible:
 * git kept the branch green while folders piled up, 6,002 of them by one count,
 * and the only reader that ever noticed was a person looking at `$TMPDIR`. So a
 * run that expects no folder to survive gets a fresh temporary directory of its
 * own, and is judged on what is still in it.
 *
 * The command runs with `TMPDIR` pointing at that folder, so `mkdtemp` in
 * `node --test`, in an e2e worker and in Chromium all land inside it. Once the
 * command ends — passed, failed or interrupted — this script lists the names
 * left in the folder, prints the `esbozo*` ones, removes the folder, and fails
 * when any are left. Only `esbozo*` names are ours: Chromium and the e2e runner
 * write their own entries in there, and those are theirs to leave.
 *
 * Usage: node scripts/fresh-tmp.mjs <command> [arguments...]
 *        `pnpm test` and the three `e2e` scripts run through it.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';

/** The names `test/temp.ts` makes, so the only entries this run is judged on. */
const OURS = 'esbozo-';

/** This run's own folder, which the command is handed as `TMPDIR`. */
const GUARD = 'esbozo-guard-';

const USAGE = 'Usage: node scripts/fresh-tmp.mjs <command> [arguments...]';

const command = process.argv.slice(2);
if (command.length === 0) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

const folder = await mkdtemp(join(tmpdir(), GUARD));

/** The signal this run was interrupted with, so the exit says what happened. */
let interrupted;

const child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  env: { ...process.env, TMPDIR: folder },
});

/**
 * The interrupt goes to the command first, and to this run only through the
 * cleanup: stopping here alone would leave the folder behind with the command
 * still writing into it.
 */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted ??= signal;
    child.kill(signal);
  });
}

/** Whether the command could not be started at all. */
let failed = false;
const ended = await new Promise((resolve) => {
  child.once('error', (error) => {
    process.stderr.write(`${command[0]}: ${error.message}\n`);
    failed = true;
    resolve({ code: null, signal: null });
  });
  child.once('close', (code, signal) => resolve({ code, signal }));
});

/** Whatever is still in the folder is either ours, and a failure, or not ours. */
const left = await readdir(folder)
  .then((names) => names.filter((name) => name.startsWith(OURS)).sort())
  .catch(() => []);
await rm(folder, { recursive: true, force: true });

if (left.length > 0) {
  process.stderr.write(
    [
      `${left.length} temporary folder${left.length === 1 ? '' : 's'} left behind in ${folder}:`,
      ...left.map((name) => `  ${name}`),
      '',
      'A test that makes a folder removes it in its runner\'s teardown: `after` in',
      '`test/temp.ts`, `afterAll` in `tests/`. A name here means one of them stopped.',
      '',
    ].join('\n'),
  );
  process.exitCode = 1;
} else if (interrupted !== undefined) {
  process.exitCode = 128 + (constants.signals[interrupted] ?? 0);
} else if (ended.code !== null) {
  process.exitCode = ended.code;
} else if (!failed) {
  // The command was killed by a signal this run never saw: report it as a shell does.
  process.exitCode = 128 + (constants.signals[ended.signal] ?? 0);
} else {
  process.exitCode = 1;
}
