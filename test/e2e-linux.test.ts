/**
 * Seam 1, the Linux runner: `scripts/e2e-linux.mjs` with a stub `docker` on
 * `PATH`.
 *
 * A real run needs the daemon and a built image, so it is not part of `pnpm
 * check`. What is pinned here is the contract the script has with `docker`: the
 * argv it forwards, the tag it derives from the files the image is built from,
 * and the exit code every failure leaves the shell. The suite in the container
 * is what `pnpm e2e:linux` proves; this is the seam around it.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFile, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The stub `docker`: it appends one line per call, each argument followed by a
 * unit separator, so a test reads the argv back without guessing where one
 * argument ends. `STUB_*_EXIT` is the code a subcommand answers with, so a test
 * can hand the script the daemon, image and run answers it wants.
 */
const DOCKER = `#!/bin/sh
{ printf '%s\\037' "$@"; printf '\\n'; } >> "$STUB_LOG"
case "$1" in
  version) exit "\${STUB_VERSION_EXIT:-0}" ;;
  image) exit "\${STUB_INSPECT_EXIT:-0}" ;;
  build) exit "\${STUB_BUILD_EXIT:-0}" ;;
  run) exit "\${STUB_RUN_EXIT:-0}" ;;
esac
exit 0
`;

/** The files a fake project root needs: the script, and everything the image is built from. */
const COPIED = [
  '.node-version',
  'docker/e2e.Dockerfile',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts/e2e-linux.mjs',
];

const folders: string[] = [];
after(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

interface Ended {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** One call's argv per entry, in the order `docker` received them. */
  readonly calls: readonly (readonly string[])[];
}

interface RunOptions {
  /** The root the script runs from, so a test can edit the files it reads. */
  readonly root: string;
  /** What the stub answers; a field left out is a success. */
  readonly env?: Readonly<Record<string, string>>;
  readonly args?: readonly string[];
  /** A `PATH` of its own, for the test that has no `docker` at all. */
  readonly path?: string;
}

/** A project root of its own, copied from this one so a test can edit what it reads. */
async function fakeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'esbozo-e2e-linux-'));
  folders.push(root);
  await Promise.all([
    mkdir(join(root, 'docker'), { recursive: true }),
    mkdir(join(root, 'scripts'), { recursive: true }),
    // The mount check reads this to tell a checkout from an empty mount.
    mkdir(join(root, '.git')),
  ]);
  await Promise.all(COPIED.map((file) => cp(join(ROOT, file), join(root, file))));
  // The real path, so it is the one the script's own `fileURLToPath` resolves and
  // the one Docker would mount: `/var` is a symlink to `/private/var` on macOS.
  return realpath(root);
}

/** A folder holding the stub `docker` and nothing else. */
async function stub(): Promise<string> {
  const bin = await mkdtemp(join(tmpdir(), 'esbozo-e2e-linux-bin-'));
  folders.push(bin);
  await writeFile(join(bin, 'docker'), DOCKER, { mode: 0o755 });
  return bin;
}

/** The script run to completion, with the stub's log read back. */
async function run(options: RunOptions): Promise<Ended> {
  const bin = await stub();
  const log = join(bin, 'calls.log');
  await writeFile(log, '');
  const child = spawn(process.execPath, [join(options.root, 'scripts/e2e-linux.mjs'), ...(options.args ?? [])], {
    env: {
      PATH: options.path ?? `${bin}:${process.env.PATH ?? ''}`,
      STUB_LOG: log,
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise<number>((resolve) => {
    child.once('error', () => resolve(-1));
    child.once('close', (status) => resolve(status ?? -1));
  });
  const calls = (await readFile(log, 'utf8'))
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('\u001f').slice(0, -1));
  return { code, stdout, stderr, calls };
}

/** What a replayed container command printed, and the code it left. */
interface Replay {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A stand-in for the script inside the image: it answers with the arguments it was handed. */
async function probeScript(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'esbozo-e2e-linux-probe-'));
  folders.push(folder);
  const script = join(folder, 'container.sh');
  await writeFile(script, '#!/bin/sh\necho "$@"\n', { mode: 0o755 });
  return script;
}

/**
 * The command the run hands the container, replayed on this machine.
 *
 * A stub `docker` mounts nothing, so the check that command runs before the
 * suite is proved by running the command itself: `mount` stands for `/src` —
 * an empty folder when Docker cannot see the worktree — and a script of this
 * test's own for the one the image holds.
 */
async function inContainer(argv: readonly string[], mount: string): Promise<Replay> {
  const at = argv.indexOf('sh');
  assert.deepEqual(argv.slice(at, at + 2), ['sh', '-c'], 'the run hands the container a command, so a mount check can come first');
  const named = argumentsAfter(argv, '--env').find((entry) => entry.startsWith('ESBOZO_HOST_WORKTREE='));
  assert.notEqual(named, undefined, 'the run names the host worktree, or the message cannot');
  const [key, ...rest] = (named as string).split('=');
  const script = await probeScript();
  const swapped = argv.slice(at + 2).map((word) => {
    if (word === '/src') return mount;
    if (word === '/src/scripts/e2e-linux-container.sh') return script;
    return word;
  });
  const child = spawn('sh', swapped, {
    env: { ...process.env, [key as string]: rest.join('=') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise<number>((resolve) => {
    child.once('error', () => resolve(-1));
    child.once('close', (status) => resolve(status ?? -1));
  });
  return { code, stdout, stderr };
}

/** The one call whose first argument is `name`. */
function call(calls: readonly (readonly string[])[], name: string): readonly string[] {
  const found = calls.filter((args) => args[0] === name);
  assert.equal(found.length, 1, `docker ${name} runs exactly once`);
  return found[0] as readonly string[];
}

/** The argument after the one `flag` occurrence in an argv. */
function argumentAfter(argv: readonly string[], flag: string): string {
  const [value] = argumentsAfter(argv, flag);
  assert.notEqual(value, undefined, `argv carries ${flag}`);
  return value as string;
}

/** Every argument that follows a `flag` occurrence, for a flag given more than once. */
function argumentsAfter(argv: readonly string[], flag: string): string[] {
  return argv.flatMap((argument, index) => (argument === flag ? [argv[index + 1] as string] : []));
}

test('forwards the e2e arguments, the read-only mount and the image', async () => {
  const root = await fakeRoot();
  const run1 = await run({ root, args: ['tests/cdp.e2e.ts:42', '--grep', 'one title'] });

  assert.equal(run1.code, 0, run1.stderr);
  const argv = call(run1.calls, 'run');
  assert.deepEqual(argv.slice(0, 5), ['run', '--rm', '--init', '--shm-size', '1g']);
  assert.match(argumentAfter(argv, '--name'), /^esbozo-e2e-linux-\d+$/);
  assert.equal(argumentAfter(argv, '--volume'), `${root}/:/src:ro`);
  assert.match(argumentAfter(argv, '--label'), /^esbozo-e2e-linux=1$/);
  const image = argv[argv.indexOf('sh') - 1] as string;
  assert.match(image, /^esbozo:e2e-linux-[0-9a-f]{12}$/);
  assert.deepEqual(argv.slice(argv.indexOf('sh') + 3), [
    '/src/scripts/e2e-linux-container.sh',
    '/src',
    'tests/cdp.e2e.ts:42',
    '--grep',
    'one title',
  ]);
  assert.deepEqual(call(run1.calls, 'rm'), ['rm', '--force', argumentAfter(argv, '--name')]);
  assert.equal(run1.calls.filter((args) => args[0] === 'build').length, 0, 'an image already there is reused');
});

test('stops before the run when Docker cannot see the worktree', async () => {
  const root = await fakeRoot();
  const argv = call((await run({ root })).calls, 'run');
  const empty = await mkdtemp(join(tmpdir(), 'esbozo-e2e-linux-mount-'));
  folders.push(empty);

  const stopped = await inContainer(argv, empty);

  assert.equal(stopped.code, 1);
  assert.ok(stopped.stderr.includes(`Docker cannot see ${root}`), `names the host path: ${stopped.stderr}`);
  assert.match(stopped.stderr, /Docker VM/, 'names the likely cause');
  assert.match(stopped.stderr, /worktree under a shared path/, 'says what to do');
  assert.equal(stopped.stdout, '', 'the container script never runs');
});

test('runs the container script once the mount holds the checkout', async () => {
  const root = await fakeRoot();
  const argv = call((await run({ root, args: ['tests/cdp.e2e.ts:42'] })).calls, 'run');

  const started = await inContainer(argv, root);

  assert.equal(started.code, 0, started.stderr);
  assert.equal(started.stderr, '');
  assert.equal(started.stdout.trim(), 'tests/cdp.e2e.ts:42', 'the arguments reached the container script');
});

test('masks the mount node_modules with an empty tmpfs when the worktree has one', async () => {
  const root = await fakeRoot();
  await mkdir(join(root, 'node_modules'));
  const masked = await run({ root });

  assert.equal(masked.code, 0, masked.stderr);
  assert.equal(argumentAfter(call(masked.calls, 'run'), '--tmpfs'), '/src/node_modules');
});

test('masks nothing when the worktree has no node_modules, as a clean checkout does not', async () => {
  const root = await fakeRoot();
  const plain = await run({ root });

  assert.equal(plain.code, 0, plain.stderr);
  assert.deepEqual(argumentsAfter(call(plain.calls, 'run'), '--tmpfs'), []);
});

test('builds with the Node runtime and pnpm versions CI pins', async () => {
  const root = await fakeRoot();
  const built = await run({ root, env: { STUB_INSPECT_EXIT: '1' } });

  assert.equal(built.code, 0, built.stderr);
  assert.match(built.stdout, /^building esbozo:e2e-linux-[0-9a-f]{12} from docker\/e2e\.Dockerfile/m);
  const argv = call(built.calls, 'build');
  assert.equal(argumentAfter(argv, '--file'), join(root, 'docker/e2e.Dockerfile'));
  const pinned = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { packageManager: string };
  assert.deepEqual(argumentsAfter(argv, '--build-arg'), [
    `NODE_VERSION=${(await readFile(join(root, '.node-version'), 'utf8')).trim()}`,
    `PNPM_VERSION=${pinned.packageManager.replace(/^pnpm@/, '')}`,
  ]);
  assert.equal(argv[argv.length - 1], `${root}/`);
});

test('the tag changes when a file the Dockerfile copies changes, and stays when another does not', async () => {
  const root = await fakeRoot();
  const tag = async (): Promise<string> => argumentAfter(call((await run({ root, env: { STUB_INSPECT_EXIT: '1' } })).calls, 'build'), '--tag');
  const before = await tag();

  await appendFile(join(root, 'pnpm-workspace.yaml'), '\n# a dependency input changed\n');
  const afterCopy = await tag();
  assert.notEqual(afterCopy, before, 'editing a COPY input builds a new image');

  await writeFile(join(root, 'notes.txt'), 'a file the image never sees\n');
  assert.equal(await tag(), afterCopy, 'a file outside the build context leaves the tag alone');
});

test('a failed image build leaves its own exit code and says the run cannot happen', async () => {
  const root = await fakeRoot();
  const failed = await run({ root, env: { STUB_INSPECT_EXIT: '1', STUB_BUILD_EXIT: '3' } });

  assert.equal(failed.code, 3);
  assert.match(failed.stderr, /the image build failed \(3\)/);
  assert.equal(failed.calls.filter((args) => args[0] === 'run').length, 0);
});

test('a failed run exits with the suite code and still removes the container', async () => {
  const root = await fakeRoot();
  const failed = await run({ root, env: { STUB_RUN_EXIT: '7' } });

  assert.equal(failed.code, 7);
  const argv = call(failed.calls, 'run');
  assert.deepEqual(call(failed.calls, 'rm'), ['rm', '--force', argumentAfter(argv, '--name')]);
});

test('no docker on PATH stops with the reason, before building anything', async () => {
  const root = await fakeRoot();
  const empty = await mkdtemp(join(tmpdir(), 'esbozo-e2e-linux-empty-'));
  folders.push(empty);
  const stopped = await run({ root, path: empty });

  assert.equal(stopped.code, 1);
  assert.match(stopped.stderr, /the docker command is not on PATH: install Docker/);
  assert.deepEqual(stopped.calls, []);
});
