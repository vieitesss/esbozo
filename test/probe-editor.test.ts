/**
 * The probe helper, run as a probe writer runs it: `pnpm probe`, against the
 * built page.
 *
 * Probes run through a real Chromium against the built editor: one reads the
 * status line while a Space pan runs, one is interrupted while it is still
 * setting up, one while its page is live, one throws. Each run is a child
 * process of its own, so what is asserted is what the documented command prints,
 * the code it exits with, and that the run ended inside a bound — a server or
 * browser left holding the loop open never gets there — with the browser it
 * started, and the module it wrote, gone once the process is gone, however the
 * run ended.
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
 * The file a run's scan writes in the `TMPDIR` the run was handed, once a
 * reading of the process list has seen the browser it started. A probe whose
 * source waits for it answers nothing until the test's own look at the process
 * list has seen that browser, so the look is never a race with how fast the
 * probe answers. The browser is held open by the probe while it waits.
 */
const SEEN = 'browser-seen';

/**
 * A probe whose own work starts only once the run's scan has seen its browser: a
 * probe module is imported before the browser is launched, so the wait belongs
 * in the default export, on the page that launch produced. `imports` is what the
 * body needs above the export.
 */
function heldByScan(body: string, imports = ''): string {
  return `import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
${imports}
export default async ({ page }) => {
  // The browser this probe runs in is held open until the run's own reading of
  // the process list has seen it: what the test reads is never a browser the run
  // had already closed.
  while (!existsSync(join(process.env.TMPDIR, ${JSON.stringify(SEEN)}))) await wait(5);
${body}};
`;
}

/**
 * A probe that holds Space and answers the status line: `Panning` is a word only
 * the running editor writes, so a page that never ran its JS cannot answer it.
 */
const PAN_PROBE = heldByScan(`  await page.getByRole('button', { name: 'Select' }).waitFor();
  await page.keyboard.down(' ');
  const status = await page.getByRole('contentinfo').innerText();
  await page.keyboard.up(' ');
  return status;
`);

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
 * `interrupt` sends SIGINT to the probe itself, at the point the run is told to
 * wait at: `during-setup` while the module a stdin probe is run from is written
 * and the run cannot get past importing it, `while-probing` once the page's URL
 * is announced and the browser it runs in is in the process list. Both are
 * states a run sits in, so the signal is never racing the line the run would
 * print next. The probe receives it as a person's Ctrl+C reaches it; pnpm is not
 * the one killed, so its own death cannot race the cleanup the test is about.
 *
 * `input` is what the run is handed instead of a probe file: the probe module a
 * piped source is written from, and the `TMPDIR` the run's scratch lives in. The
 * first reading of the process list that sees a browser writes `browser-seen`
 * there, which is what a `heldByScan` source waits for before it answers.
 *
 * `exitAfter` is how long the run has to end: a probe that never answers is one
 * the deadline has to kill and report, inside a bound of the test's own.
 */
async function helper(
  args: readonly string[],
  input?: { source?: string; folder: string },
  interrupt?: 'during-setup' | 'while-probing',
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
    let seen = false;
    /** Tells a probe that waits for it that a reading has seen its browser. */
    const markSeen = async (folder: string): Promise<void> => {
      try {
        await writeFile(join(folder, SEEN), '');
      } catch {
        // The run's own scratch is the run's to remove: a folder gone already
        // has a probe that ended without waiting.
      }
    };
    /** Sends the signal once the run has reached the point it is waiting at. */
    const atInterruptPoint = async (all: readonly Proc[], started: Set<number>): Promise<void> => {
      const running = all.find((proc) => started.has(proc.pid) && proc.command.includes('probe-editor.mjs'));
      probe ??= running?.pid;
      if (!seen && input !== undefined && all.some((proc) => started.has(proc.pid) && isBrowser(proc.command))) {
        seen = true;
        await markSeen(input.folder);
      }
      if (interrupt === undefined || interrupted || running === undefined) return;
      if (interrupt === 'during-setup') {
        // Setting up is where the URL is not announced yet, and the module is
        // already on disk: the signal takes something the run has taken.
        if (input === undefined || stderr.includes('probing')) return;
        if (!(await moduleLanded(input.folder))) return;
      } else {
        // The page is up, and the browser it was opened in is still there: what
        // the signal takes is a run already holding all of it.
        const browser = all.some((proc) => started.has(proc.pid) && isBrowser(proc.command));
        if (!stderr.includes('probing') || !browser) return;
      }
      interrupted = true;
      process.kill(running.pid, 'SIGINT');
    };
    const watching = child.pid === undefined ? undefined : watchBrowsers(child.pid, atInterruptPoint);
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
  onScan?: (all: readonly Proc[], started: Set<number>) => Promise<void> | void,
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
        await onScan?.(all, started);
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

/**
 * Whether the module a stdin probe is run from is already on disk. The setup's
 * first acquisition, and the one a signal during setup has to give back.
 */
async function moduleLanded(folder: string): Promise<boolean> {
  try {
    return (await readdir(folder)).some((name) => name.startsWith('esbozo-probe-'));
  } catch {
    // The folder being read is the run's own scratch: gone is nothing landed.
    return false;
  }
}

test('a probe reads the running editor: a held Space names the pan in the status line', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'esbozo-probe-run-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const file = await probeSource(t, PAN_PROBE);
  const run = await helper([file], { folder: scratch });

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

/**
 * A probe module that never finishes evaluating: the run is still setting up
 * when the signal lands, and cannot leave setup on its own, so where the signal
 * lands does not depend on how fast the machine reads the process list.
 */
const SETUP_BLOCKING_PROBE = `await new Promise(() => {});

export default async () => null;
`;

test('an interrupted setup leaves no probe folder, no server, and no browser', async (t) => {
  const empty = await mkdtemp(join(tmpdir(), 'esbozo-probe-empty-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  const run = await helper([], { source: SETUP_BLOCKING_PROBE, folder: empty }, 'during-setup');

  // The run ended where the person ended it, not at the deadline: a setup that
  // never got the signal sits in its module until the test kills it.
  assert.notEqual(run.code, 0, run.stderr);
  assert.doesNotMatch(run.stderr, /had not ended/, 'the run was ended by the deadline, not the signal');
  // The setup had to be where the signal landed: a run that reached the server
  // is a run that got past setting up.
  assert.doesNotMatch(run.stderr, /probing http:\/\//, 'the interrupt landed after setup');
  assert.deepEqual(run.browsers, [], 'a setup interrupt started a browser');
  const left = await strays(empty);
  assert.deepEqual(left, [], `the helper left ${left} behind`);
});

test('an interrupt with the page live leaves no probe folder, no server, and no browser', async (t) => {
  const empty = await mkdtemp(join(tmpdir(), 'esbozo-probe-empty-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  // A probe that answers nothing: the page is live and the run waits in it, so
  // the signal takes a browser and a server the run already holds.
  const run = await helper(
    [],
    { source: 'export default async () => new Promise(() => {});\n', folder: empty },
    'while-probing',
  );

  assert.notEqual(run.code, 0, run.stderr);
  assert.match(run.stderr, /probing http:\/\//, 'the interrupt landed before the page was up');
  assert.notEqual(run.browsers.length, 0, 'the interrupt never caught the browser');
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
const BLOCKING_PROBE = heldByScan(
  `  chmodSync(new URL('.', import.meta.url), 0o500);
  return 'finished';
`,
  `import { chmodSync } from 'node:fs';`,
);

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
  const scratch = await mkdtemp(join(tmpdir(), 'esbozo-probe-run-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const file = await probeSource(
    t,
    heldByScan(`  throw new Error('probe on purpose');\n`),
  );
  const run = await helper([file], { folder: scratch });

  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /probe on purpose/);
  assert.equal(run.stdout, '');
  assert.notEqual(run.browsers.length, 0, 'the run started no Chromium the test could see');
  assert.deepEqual(await stillRunning(run.browsers), [], `the helper left Chromium ${run.browsers} running`);
});
