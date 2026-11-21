/**
 * Seam 3: `scripts/sweep-containers.mjs` against a docker that only records
 * what it was asked.
 *
 * Two `esbozo:test` containers outlived a killed run once, and the next run
 * should clear them without touching a container another worktree is using this
 * second. So each test writes a handful of container rows — one whose owner is
 * gone, one whose owner is alive, one from another host — and asserts on the
 * only two things that matter: which containers the sweep asked docker to
 * remove, and what it said and exited with.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../scripts/sweep-containers.mjs', import.meta.url));

/** The host this test runs on: the sweep only judges the owners it can see. */
const HERE = hostname();

/** A PATH stub is a file the operating system has to run itself, shebang and all. */
const skip = process.platform === 'win32' ? 'a PATH stub cannot be run on Windows' : undefined;

/**
 * A `docker` that answers one listing and records every call, so a test can see
 * both halves of the contract: what the sweep looked at, and what it removed.
 */
const FAKE_DOCKER = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_DOCKER_LOG, \`\${JSON.stringify(args)}\\n\`);

if (args[0] === 'ps') {
  if (process.env.FAKE_DOCKER_BROKEN === '1') {
    process.stderr.write('Cannot connect to the Docker daemon at unix:///var/run/docker.sock\\n');
    process.exit(1);
  }
  process.stdout.write(process.env.FAKE_DOCKER_PS ?? '');
  process.exit(0);
}

if (args[0] === 'rm') {
  const id = args[args.length - 1];
  if ((process.env.FAKE_DOCKER_GONE ?? '').split(' ').includes(id)) {
    process.stderr.write(\`Error response from daemon: No such container: \${id}\\n\`);
    process.exit(1);
  }
  process.exit(0);
}

process.stderr.write(\`the sweep asked for something else: \${args.join(' ')}\\n\`);
process.exit(2);
`;

/** Every folder a fixture made, removed when this file's tests are done. */
const folders: string[] = [];
after(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

interface Swept {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Each docker call's arguments, in the order the sweep made them. */
  readonly calls: string[][];
}

/**
 * A folder holding a `docker` on its own bin, and the log that docker writes.
 * Without one, the folder stands for a machine that has no docker at all.
 */
async function fixture(docker = true): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'esbozo-sweep-'));
  folders.push(folder);
  await mkdir(join(folder, 'bin'));
  if (docker) {
    const command = join(folder, 'bin', 'docker');
    await writeFile(command, FAKE_DOCKER, 'utf8');
    await chmod(command, 0o755);
  }
  return folder;
}

/** One line of what `docker ps --format` prints: id, owner pid, owner host. */
function row(id: string, pid: string, host: string): string {
  return `${id}\t${pid}\t${host}\n`;
}

/** The pid of a process that has just exited, so nothing answers for it. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const pid = child.pid;
  assert.ok(pid !== undefined, 'the helper process has a pid');
  await once(child, 'exit');
  return pid;
}

/** The sweep with the fake docker first on PATH, or with no docker at all. */
async function sweep(
  folder: string,
  env: Record<string, string>,
  options: { docker?: boolean } = {},
): Promise<Swept> {
  const bin = join(folder, 'bin');
  const log = join(folder, 'calls.log');
  await writeFile(log, '', 'utf8');
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: options.docker === false ? bin : `${bin}:${process.env.PATH ?? ''}`,
      FAKE_DOCKER_LOG: log,
      ...env,
    },
  });
  const calls = (await readFile(log, 'utf8'))
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as string[]);
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr, calls };
}

/** The containers the sweep asked docker to remove. */
function removedBy(run: Swept): string[] {
  return run.calls.filter((call) => call[0] === 'rm').map((call) => call[call.length - 1]!);
}

test('a container whose owner is gone is removed, and one whose owner answers is kept', { skip }, async () => {
  const folder = await fixture();
  const gone = await deadPid();
  const dead = 'a'.repeat(64);
  const alive = 'b'.repeat(64);
  const hosted = 'c'.repeat(64);
  const ownerless = 'd'.repeat(64);

  const run = await sweep(folder, {
    FAKE_DOCKER_PS:
      row(dead, String(gone), HERE) +
      row(alive, String(process.pid), HERE) +
      row(hosted, String(gone), 'another-host') +
      row(ownerless, '', HERE),
  });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stderr, '');
  assert.equal(
    run.stdout,
    `removed 2 stale test containers: ${dead.slice(0, 12)} ${ownerless.slice(0, 12)}\n`,
  );
  assert.deepEqual(removedBy(run), [dead, ownerless], 'only the containers whose owner is gone');

  const listing = run.calls.find((call) => call[0] === 'ps');
  assert.ok(listing !== undefined, 'docker is asked what exists');
  assert.ok(listing.includes('label=esbozo-test=1'), 'only the containers the suite started are listed');
  assert.ok(
    listing.some((argument) => argument.includes('esbozo-test-pid')),
    'the owning pid is read back',
  );
});

test('a single leftover is named in the singular', { skip }, async () => {
  const folder = await fixture();
  const gone = await deadPid();
  const one = 'f'.repeat(64);

  const run = await sweep(folder, { FAKE_DOCKER_PS: row(one, String(gone), HERE) });

  assert.equal(run.stdout, `removed 1 stale test container: ${one.slice(0, 12)}\n`);
  assert.deepEqual(removedBy(run), [one]);
});

test('a container another sweep already removed is not a failure', { skip }, async () => {
  const folder = await fixture();
  const gone = await deadPid();
  const raced = 'e'.repeat(64);

  const run = await sweep(folder, {
    FAKE_DOCKER_PS: row(raced, String(gone), HERE),
    FAKE_DOCKER_GONE: raced,
  });

  assert.deepEqual(
    { code: run.code, stdout: run.stdout, stderr: run.stderr },
    { code: 0, stdout: '', stderr: '' },
    'the container is gone, which is what the sweep wanted',
  );
});

test('without docker the sweep is a no-op, as the docker suite is', { skip }, async () => {
  const folder = await fixture(false);

  const run = await sweep(folder, {}, { docker: false });

  assert.deepEqual(
    { code: run.code, stdout: run.stdout, stderr: run.stderr },
    { code: 0, stdout: '', stderr: '' },
  );
});

test('a daemon that will not answer fails the sweep loudly', { skip }, async () => {
  const folder = await fixture();

  const run = await sweep(folder, { FAKE_DOCKER_BROKEN: '1' });

  assert.equal(run.code, 1);
  assert.equal(run.stdout, '');
  assert.equal(
    run.stderr,
    'the test container sweep could not list containers: Cannot connect to the Docker daemon at unix:///var/run/docker.sock\n',
  );
});
