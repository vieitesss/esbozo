/**
 * `pnpm e2e:linux [e2e arguments]`: the browser suite in the Ubuntu image CI
 * runs it on.
 *
 * A failure that shows only in CI is a Linux Chromium's, not this Mac's, so the
 * fix is proved where it broke. The image is `docker/e2e.Dockerfile`, built
 * once and tagged with a hash of that file and the Node and pnpm versions CI
 * resolves from `package.json`, so a second run reuses it and a change to any of
 * the three builds a new one instead of silently testing the old.
 *
 * The worktree is mounted at `/src` and copied over the image's dependencies at
 * run time (see `scripts/e2e-linux-container.sh`): a source change costs a copy,
 * never a rebuild, and the host's macOS `node_modules` never crosses in.
 *
 * The arguments go to `e2e run`, so `tests/<file>.e2e.ts:<line>`, `--grep` and
 * `--last-failed` work as they do locally; with none it runs what `pnpm e2e`
 * runs. The container is removed on every exit path, Ctrl-C included, and the
 * run ends with the suite's own exit code, so a failure reaches the shell that
 * asked for it.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { constants } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCKERFILE = join(ROOT, 'docker/e2e.Dockerfile');

/** The shape of a range in `engines.node` this script can read: a floor, or one version. */
const FLOOR = /^>=\s*v?(\d+)\.(\d+)\.(\d+)$/;
const EXACT = /^=?v?(\d+)\.(\d+)\.(\d+)$/;

/** Every environment variable a run may want: the suite's own switches, and the agent key. */
const PASSED = /^(?:ESBOZO_|OPENCODE_API_KEY$)/;

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const pnpmVersion = pnpmOf(pkg.packageManager);
const nodeVersion = await nodeVersionFor(pkg.engines?.node ?? '');
const image = await imageFor(nodeVersion, pnpmVersion);

await dockerOrStop();
if (!(await imageExists())) {
  process.stdout.write(`building ${image} from docker/e2e.Dockerfile\n`);
  const built = await live('docker', [
    'build',
    '--file',
    DOCKERFILE,
    '--tag',
    image,
    '--build-arg',
    `NODE_VERSION=${nodeVersion}`,
    '--build-arg',
    `PNPM_VERSION=${pnpmVersion}`,
    ROOT,
  ]);
  if (built !== 0) {
    process.stderr.write(`the image build failed (${built}): pnpm e2e:linux cannot run\n`);
    process.exit(built);
  }
}

const name = `esbozo-e2e-linux-${process.pid}`;
const args = [
  'run',
  '--rm',
  '--init',
  '--shm-size',
  '1g',
  '--name',
  name,
  '--label',
  'esbozo-e2e-linux=1',
  '--volume',
  `${ROOT}:/src:ro`,
  ...Object.entries(process.env)
    .filter(([key]) => PASSED.test(key))
    .flatMap(([key, value]) => ['--env', `${key}=${value ?? ''}`]),
  ...(process.stdout.isTTY ? ['--tty'] : []),
  image,
  'sh',
  '/src/scripts/e2e-linux-container.sh',
  ...process.argv.slice(2),
];

const child = spawn('docker', args, { stdio: 'inherit' });

/**
 * The signal this run was interrupted with, so the exit says what happened. A
 * terminal's interrupt is already on its way to `docker`, which passes it into
 * the container; a second copy would cut the suite's cleanup short, so this run
 * only records it. A SIGTERM is never sent to the group by a terminal, so that
 * one is passed on.
 */
let interrupted;
process.on('SIGINT', () => {
  interrupted ??= 'SIGINT';
});
process.on('SIGTERM', () => {
  interrupted ??= 'SIGTERM';
  child.kill('SIGTERM');
});

const ended = await new Promise((resolve) => {
  let settled = false;
  const settle = (answer) => {
    if (settled) return;
    settled = true;
    resolve(answer);
  };
  child.once('error', (error) => {
    process.stderr.write(`docker: ${error.message}\n`);
    settle({ code: 1, signal: null });
  });
  child.once('close', (code, signal) => settle({ code, signal }));
});

// `--rm` removes the container the moment `docker` sees it end; a killed client
// may not have seen it, so the name is removed whatever happened. No such
// container is the usual answer, not a failure.
await removed(name);

process.exitCode =
  interrupted === undefined
    ? (ended.code ?? 128 + (constants.signals[ended.signal] ?? 0))
    : 128 + (constants.signals[interrupted] ?? 0);

/** The `pnpm` version `package.json`'s `packageManager` names, or a loud stop. */
function pnpmOf(packageManager) {
  const named = /^pnpm@(\S+)$/.exec(String(packageManager ?? '').trim());
  if (named === null) {
    fail(`package.json has no "packageManager": "pnpm@<version>", so the image cannot match CI`);
  }
  return named[1];
}

/**
 * The Node release CI's `actions/setup-node` resolves from `engines.node`.
 *
 * CI installs the newest release that satisfies the range, and this repository's
 * range is a floor, so the newest release is the answer; a range this script
 * cannot read that way stops here rather than guessing at a major. The index is
 * nodejs.org's own list, newest first.
 *
 * `ESBOZO_E2E_NODE` pins one version for a run that has to match something else.
 */
async function nodeVersionFor(range) {
  const pinned = String(process.env.ESBOZO_E2E_NODE ?? '').trim();
  if (pinned !== '') return pinned;

  let index;
  try {
    const response = await fetch('https://nodejs.org/dist/index.json');
    index = await response.json();
  } catch (error) {
    fail(
      `could not read https://nodejs.org/dist/index.json to resolve Node "${range}": ${error.message}\n` +
        'Set ESBOZO_E2E_NODE to a version to build the image without it.',
    );
  }

  const floor = FLOOR.exec(String(range).trim());
  const exact = floor === null ? EXACT.exec(String(range).trim()) : null;
  if (floor === null && exact === null) {
    fail(
      `package.json engines.node is "${range}": pnpm e2e:linux resolves a floor (">=x.y.z") or one version.\n` +
        'Set ESBOZO_E2E_NODE to the version the image should carry.',
    );
  }

  const wanted = (floor ?? exact).slice(1, 4).map(Number);
  for (const release of index) {
    const version = String(release?.version ?? '').replace(/^v/, '');
    // A pre-release is not something CI installs for a version range.
    if (version === '' || version.includes('-')) continue;
    if (floor !== null && atLeast(version, wanted)) return version;
    if (exact !== null && version === wanted.join('.')) return version;
  }
  fail(`no Node release on nodejs.org satisfies package.json engines.node "${range}"`);
}

/** Whether a `major.minor.patch` version is at or above a floor of the same shape. */
function atLeast(version, floor) {
  const parts = version.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (parts[index] > floor[index]) return true;
    if (parts[index] < floor[index]) return false;
  }
  return true;
}

/**
 * The image name for this Dockerfile and its two versions: the same three
 * produce the same tag, so its presence is the whole answer to "reuse or build".
 * A different one leaves the old image for `docker image prune` to judge.
 */
async function imageFor(node, pnpm) {
  const dockerfile = await readFile(DOCKERFILE);
  const fingerprint = createHash('sha256')
    .update(dockerfile)
    .update(`\nnode ${node}\npnpm ${pnpm}\n`)
    .digest('hex')
    .slice(0, 12);
  return `esbozo:e2e-linux-${fingerprint}`;
}

/** Stop with a message a person can act on. */
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** The daemon answering, or a loud stop: the image cannot be built without it. */
async function dockerOrStop() {
  const answer = await quiet('docker', ['version', '--format', '{{.Server.Version}}']);
  if (answer.code === 0) return;
  const said = answer.stderr.trim().split('\n')[0];
  if (answer.code === 127 || /not found|ENOENT/.test(said)) {
    fail('the docker command is not on PATH: install Docker to run pnpm e2e:linux');
  }
  fail(`the Docker daemon does not answer${said === '' ? '' : `: ${said}`} (start Docker to run pnpm e2e:linux)`);
}

/** Whether the image is already built for this Dockerfile and these versions. */
async function imageExists() {
  return (await quiet('docker', ['image', 'inspect', image])).code === 0;
}

/** `docker rm --force`, its answer ignored: the container is usually already gone. */
async function removed(container) {
  await quiet('docker', ['rm', '--force', container]);
}

/** A command run to completion with both streams captured. */
function quiet(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** A command run to completion with the terminal's own streams, as its exit code. */
function live(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', (error) => {
      process.stderr.write(`${command}: ${error.message}\n`);
      resolve(1);
    });
    child.once('close', (code) => resolve(code ?? 1));
  });
}
