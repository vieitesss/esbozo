/**
 * The probe helper, run as a probe writer runs it: `pnpm probe`, against the
 * built page.
 *
 * Probes run through a real Chromium against the built editor: one reads the
 * status line while a Space pan runs, one is interrupted while its browser is
 * still starting, one throws. Each run is a child process of its own, so what is
 * asserted is what the documented command prints, the code it exits with, and
 * that the run ended inside a bound — a server or browser left holding the loop
 * open never gets there — with the browser it started, and the module it wrote,
 * gone once the process is gone, however the run ended.
 *
 * `pnpm test` builds first, so `dist/` is there for these runs.
 */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

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

/** What one run of the helper left behind: its exit code, its two streams, the
 * browser processes it started, and the probe process itself. */
interface Run {
  code: number;
  stdout: string;
  stderr: string;
  /** The pids of the Chromium processes the run started, watched as it ran. */
  browsers: number[];
  /** The pid of the probe process, watched as it ran, if a reading ever saw it. */
  probe: number | undefined;
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
 * How long a run has to end, its browser and server included. A run that left
 * one of them holding the loop open never closes, so this bound is where that
 * failure is caught: the process is killed and the run is reported as no run.
 * It is loose enough for a probe that shares the machine with the whole suite
 * launching browsers of its own.
 */
const RUN_EXIT = 60_000;

/**
 * How long a probe that never answers is given in the deadline test: long enough
 * to boot a browser on a busy machine, short enough for the suite to stay quick.
 */
const STUCK_EXIT = 5_000;

/**
 * How long a killed run is given for its streams to close before it is read as a
 * run that never ended. A killed process is not one that reports it.
 */
const KILLED_EXIT = 5_000;

/**
 * Kills the process group `pid` leads, if it is still there: a group that ended
 * already answers ESRCH, and there is nothing left to kill.
 */
function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The group was gone before the deadline was.
  }
}

/**
 * Runs the documented command, and answers what it left behind. pnpm's own
 * banner is silenced so the streams the run prints are the helper's alone.
 *
 * The run is started in a process group of its own, so a deadline can end the
 * probe and the browser it started and not only the pnpm that handed the pipes
 * on: a child of a killed process still holds those.
 *
 * `interrupt` sends SIGINT to the probe itself once its browser is starting and
 * the run has not announced a server: the moment a setup signal has to take the
 * browser that is still on its way. The probe receives it as a person's Ctrl+C
 * reaches it; pnpm is not the one killed, so its own death cannot race the
 * cleanup the test is about.
 *
 * `exitAfter` is how long the run has to end: a probe that never answers is one
 * the deadline has to kill and report, inside a bound of the test's own.
 */
async function helper(
  args: readonly string[],
  input?: { source: string; folder: string },
  interrupt?: 'during-setup',
  exitAfter: number = RUN_EXIT,
): Promise<Run> {
  return await new Promise((resolve, reject) => {
    const env = input && { ...process.env, TMPDIR: input.folder, TEMP: input.folder };
    const child = spawn('pnpm', ['--silent', 'probe', ...args], {
      cwd: ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    let probe: number | undefined;
    let interrupted = false;
    let finished = false;
    const duringSetup = (all: readonly Proc[], started: Set<number>): void => {
      const running = all.find((proc) => started.has(proc.pid) && proc.command.includes('probe-editor.mjs'));
      probe ??= running?.pid;
      if (interrupt === undefined || interrupted || stderr.includes('probing')) return;
      const browser = all.some((proc) => started.has(proc.pid) && isBrowser(proc.command));
      if (running === undefined || !browser) return;
      interrupted = true;
      process.kill(running.pid, 'SIGINT');
    };
    const watching = child.pid === undefined ? undefined : watchBrowsers(child.pid, duringSetup);
    /** Ends the wait once, whatever ended it: a close, an error, or the deadline. */
    const finish = (code: number): void => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      void (watching?.stop() ?? Promise.resolve()).then(() =>
        resolve({
          code,
          stdout,
          stderr,
          browsers: [...(watching?.browsers ?? [])],
          probe,
        }),
      );
    };
    const deadline = setTimeout(() => {
      stderr += `the run had not ended after ${exitAfter}ms, so it was killed\n`;
      // pnpm holds nothing of the run but the pipes it handed on: killing it
      // alone leaves the probe and the browser holding them, so `close` never
      // comes. The group goes, and the wait is bounded rather than trusted.
      killGroup(child.pid);
      setTimeout(() => finish(-1), KILLED_EXIT);
    }, exitAfter);
    child.stdin.end(input?.source);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', (error) => {
      finished = true;
      clearTimeout(deadline);
      reject(error);
    });
    child.once('close', (code) => finish(code ?? -1));
  });
}

/** One process as `ps` lists it: its pid, the pid that started it, and its command. */
interface Proc {
  pid: number;
  ppid: number;
  command: string;
}

/** Every process running now: the browser a run started is found there, without
 * the helper having to name it on a stream the probe's own output shares. */
async function processList(): Promise<Proc[]> {
  const { stdout } = await promisify(execFile)('ps', ['-A', '-o', 'pid=,ppid=,command=']);
  return stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match === null ? [] : [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? '' }];
  });
}

/** The pids `root` started, at any depth, as one reading of the process list sees them. */
function descendants(all: readonly Proc[], root: number): Set<number> {
  const children = new Map<number, number[]>();
  for (const proc of all) {
    const siblings = children.get(proc.ppid) ?? [];
    siblings.push(proc.pid);
    children.set(proc.ppid, siblings);
  }
  const found = new Set<number>();
  const queue = [root];
  while (queue.length > 0) {
    for (const pid of children.get(queue.pop()!) ?? []) {
      found.add(pid);
      queue.push(pid);
    }
  }
  return found;
}

/**
 * Whether a command is the browser itself rather than one of its helpers: the
 * browser names no `--type=`, while its zygotes, renderers and crash handler do,
 * and crashpad is a process of its own.
 */
function isBrowser(command: string): boolean {
  return /chrom/i.test(command) && !command.includes('--type=') && !command.includes('crashpad');
}

/**
 * Watches a run's process tree while it runs: every 10 ms a reading of `ps` is
 * handed to `onScan`, so a test can catch a browser while it is still starting.
 */
function watchBrowsers(
  root: number,
  onScan?: (all: readonly Proc[], started: Set<number>) => void,
): {
  browsers: Set<number>;
  stop: () => Promise<void>;
} {
  const browsers = new Set<number>();
  let scanning: Promise<void> | undefined;
  const scan = async (): Promise<void> => {
    if (scanning !== undefined) return await scanning;
    scanning = (async () => {
      try {
        const all = await processList();
        const started = descendants(all, root);
        for (const proc of all) if (started.has(proc.pid) && isBrowser(proc.command)) browsers.add(proc.pid);
        onScan?.(all, started);
      } catch {
        // A scan that raced a process exit is read again on the next tick.
      } finally {
        scanning = undefined;
      }
    })();
    return await scanning;
  };
  const timer = setInterval(() => void scan(), 10);
  return {
    browsers,
    stop: async () => {
      clearInterval(timer);
      await scan();
    },
  };
}

/** How long a run's browser is given to leave the process list. */
const BROWSER_EXIT = 5_000;

/** The pids of `pids` still running once a run's browser has had time to exit. */
async function stillRunning(pids: readonly number[]): Promise<number[]> {
  const deadline = Date.now() + BROWSER_EXIT;
  let alive = [...pids];
  while (alive.length > 0 && Date.now() < deadline) {
    const running = new Set((await processList()).map((proc) => proc.pid));
    alive = alive.filter((pid) => running.has(pid));
    if (alive.length > 0) await new Promise((done) => setTimeout(done, 50));
  }
  return alive;
}

/**
 * What a run left in the `TMPDIR` it was handed: the probe's own folder, or the
 * browser scratch Playwright opened for it. Both are a run that never cleaned up,
 * and pnpm's cache beside them is not the run's to close.
 */
async function strays(folder: string): Promise<string[]> {
  return (await readdir(folder)).filter((name) => /^(esbozo-probe-|playwright)/.test(name));
}

test('a probe reads the running editor: a held Space names the pan in the status line', async (t) => {
  const file = await probeSource(t, PAN_PROBE);
  const run = await helper([file]);

  assert.equal(run.code, 0, run.stderr);
  assert.match(JSON.parse(run.stdout), PAN_STATUS);
  assert.notEqual(run.browsers.length, 0, 'the run started no Chromium the test could see');
  assert.deepEqual(await stillRunning(run.browsers), [], `the helper left Chromium ${run.browsers} running`);
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
  assert.deepEqual(run.browsers, [], 'a run with no built page started a browser');
});

test('a folder whose editor.html is a directory is no built page: nothing boots', async (t) => {
  const empty = await mkdtemp(join(tmpdir(), 'esbozo-probe-empty-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  // A folder that has the page's name but not the page: the guard has to look
  // at what the file is, not only that something answers to the name.
  await mkdir(join(empty, 'editor.html'));
  const file = await probeSource(t, 'export default async () => null;\n');
  const run = await helper(['--folder', empty, file]);

  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /pnpm build/);
  assert.doesNotMatch(run.stderr, /probing http:\/\//);
  assert.equal(run.stdout, '');
  assert.deepEqual(run.browsers, [], 'a folder with no built page started a browser');
});

test('an interrupted setup leaves no probe folder, no server, and no browser', async (t) => {
  const empty = await mkdtemp(join(tmpdir(), 'esbozo-probe-empty-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  const run = await helper([], { source: 'export default async () => null;\n', folder: empty }, 'during-setup');

  assert.notEqual(run.code, 0, run.stderr);
  // The setup had to be where the signal landed: a run that reached the server
  // proves nothing about a resource that was still on its way.
  assert.doesNotMatch(run.stderr, /probing http:\/\//, 'the interrupt landed after setup');
  assert.notEqual(run.browsers.length, 0, 'the interrupt never caught the browser starting');
  const left = await strays(empty);
  assert.deepEqual(left, [], `the helper left ${left} behind`);
  assert.deepEqual(await stillRunning(run.browsers), [], `the helper left Chromium ${run.browsers} running`);
});

test('a probe that exits by itself leaves no temporary module', async (t) => {
  const empty = await mkdtemp(join(tmpdir(), 'esbozo-probe-empty-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  const run = await helper([], {
    source: 'export default async () => process.exit(7);\n',
    folder: empty,
  });

  assert.equal(run.code, 7, run.stderr);
  // The module a stdin probe was written from is the run's own file; a browser
  // the probe closes by exiting first is the probe author's call.
  const left = await strays(empty);
  assert.deepEqual(
    left.filter((name) => name.startsWith('esbozo-probe-')),
    [],
    `the probe left its module behind: ${left}`,
  );
});

/**
 * A probe that makes its own folder read-only before it answers: the run's last
 * act is to give that folder back, and it cannot.
 */
const BLOCKING_PROBE = `import { chmodSync } from 'node:fs';

export default async () => {
  chmodSync(new URL('.', import.meta.url), 0o500);
  return 'finished';
};
`;

test('a cleanup that fails is printed and exits non-zero, and the rest is still given back', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'esbozo-probe-blocked-'));
  t.after(async () => {
    // The probe took the write bit off its own folder: the test puts back what
    // it took before it can remove what the run could not.
    for (const name of await readdir(folder)) await chmod(join(folder, name), 0o700);
    await rm(folder, { recursive: true, force: true });
  });
  const run = await helper([], { source: BLOCKING_PROBE, folder });

  // What the probe returned is still printed: the answer came before cleanup.
  assert.equal(JSON.parse(run.stdout), 'finished');
  assert.notEqual(run.code, 0, 'a run that could not give its folder back exited as a finished run');
  assert.match(run.stderr, /cleanup failed/, 'the disposal that threw was never printed');
  assert.notEqual(run.browsers.length, 0, 'the run started no Chromium the test could see');
  assert.deepEqual(
    await stillRunning(run.browsers),
    [],
    `one failing disposal kept the browser ${run.browsers} open`,
  );
});

test('a probe that never answers is killed at its deadline, browser and all', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'esbozo-probe-stuck-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const run = await helper(
    [],
    { source: 'export default async () => new Promise(() => {});\n', folder: scratch },
    undefined,
    STUCK_EXIT,
  );

  assert.match(run.stderr, new RegExp(`had not ended after ${STUCK_EXIT}ms, so it was killed`));
  assert.notEqual(run.code, 0, 'a run killed at its deadline exited as a finished run');
  assert.notEqual(run.probe, undefined, 'the test never saw the probe process');
  assert.deepEqual(await stillRunning([run.probe!]), [], `the probe ${run.probe} outlived the deadline`);
  assert.deepEqual(await stillRunning(run.browsers), [], `the deadline left Chromium ${run.browsers} running`);
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
  assert.notEqual(run.browsers.length, 0, 'the run started no Chromium the test could see');
  assert.deepEqual(await stillRunning(run.browsers), [], `the helper left Chromium ${run.browsers} running`);
});
