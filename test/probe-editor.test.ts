/**
 * The probe helper, run as a probe writer runs it: `pnpm probe`, against the
 * built page.
 *
 * Probes run through a real Chromium against the built editor: one reads the
 * status line while a Space pan runs, one is interrupted while its browser is
 * still starting, one throws. Each run is a child process of its own, so what is
 * asserted is what the documented command prints and the code it exits with —
 * and that the browser it started, the port it served on, and the module it wrote
 * are gone once the process is gone, however the run ended.
 *
 * `pnpm test` builds first, so `dist/` is there for these runs.
 */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
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

/** What one run of the helper left behind: its exit code, its two streams, and
 * the browser processes it started. */
interface Run {
  code: number;
  stdout: string;
  stderr: string;
  /** The pids of the Chromium processes the run started, watched as it ran. */
  browsers: number[];
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
 *
 * `interrupt` sends SIGINT to the probe itself once its browser is starting and
 * the run has not announced a server: the moment a setup signal has to take the
 * browser that is still on its way. The probe receives it as a person's Ctrl+C
 * reaches it; pnpm is not the one killed, so its own death cannot race the
 * cleanup the test is about.
 */
async function helper(
  args: readonly string[],
  input?: { source: string; folder: string },
  interrupt?: 'during-setup',
): Promise<Run> {
  return await new Promise((resolve, reject) => {
    const env = input && { ...process.env, TMPDIR: input.folder, TEMP: input.folder };
    const child = spawn('pnpm', ['--silent', 'probe', ...args], {
      cwd: ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let interrupted = false;
    const duringSetup =
      interrupt === undefined
        ? undefined
        : (all: readonly Proc[], started: Set<number>): void => {
            if (interrupted || stderr.includes('probing')) return;
            const probe = all.find((proc) => started.has(proc.pid) && proc.command.includes('probe-editor.mjs'));
            const browser = all.some((proc) => started.has(proc.pid) && isBrowser(proc.command));
            if (probe === undefined || !browser) return;
            interrupted = true;
            process.kill(probe.pid, 'SIGINT');
          };
    const watching = child.pid === undefined ? undefined : watchBrowsers(child.pid, duringSetup);
    child.stdin.end(input?.source);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      void (watching?.stop() ?? Promise.resolve()).then(() =>
        resolve({
          code: code ?? -1,
          stdout,
          stderr,
          browsers: [...(watching?.browsers ?? [])],
        }),
      );
    });
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
  assert.notEqual(run.browsers.length, 0, 'the run started no Chromium the test could see');
  assert.deepEqual(await stillRunning(run.browsers), [], `the helper left Chromium ${run.browsers} running`);
});
