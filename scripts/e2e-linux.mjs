/**
 * `pnpm e2e:linux [e2e arguments]`: the browser suite in an Ubuntu image like
 * the one CI runs it on.
 *
 * A failure that shows only in CI is a Linux Chromium's, not this Mac's, so the
 * fix is proved where it broke. The image is `docker/e2e.Dockerfile`, built
 * once and tagged with a hash of every input it is built from: that file, the
 * files it copies in, and the Node and pnpm versions. A second run reuses it,
 * and a change to any of them builds a new one instead of silently testing the
 * old.
 *
 * The worktree is mounted at `/src` and copied over the image's dependencies at
 * run time (see `scripts/e2e-linux-container.sh`): a source change costs a copy,
 * never a rebuild, and the host's macOS `node_modules` is masked out of the
 * mount when there is one, so it never crosses in.
 *
 * The arguments go to `e2e run`, so `tests/<file>.e2e.ts:<line>` and `--grep`
 * work as they do locally; with none it runs what `pnpm e2e` runs. The
 * container is removed on every exit path, Ctrl-C included, and the run ends
 * with the suite's own exit code, so a failure reaches the shell that asked for
 * it.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { constants } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCKERFILE = join(ROOT, 'docker/e2e.Dockerfile');
const NODE_VERSION_FILE = join(ROOT, '.node-version');

/** A `major.minor.patch` version, the only shape the image can install by name. */
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** Every environment variable a run may want: the suite's own switches, and the agent key. */
const PASSED = /^(?:ESBOZO_|OPENCODE_API_KEY$)/;

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const pnpmVersion = pnpmOf(pkg.packageManager);
const nodeVersion = await nodeVersionCI();
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

/**
 * Whether the mount hands Docker a `node_modules` to mask: the host worktree
 * has one, or it is a clean checkout that never installed.
 */
async function hostsNodeModules() {
  try {
    return (await stat(join(ROOT, 'node_modules'))).isDirectory();
  } catch {
    return false;
  }
}

const name = `esbozo-e2e-linux-${process.pid}`;
const maskNodeModules = await hostsNodeModules();
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
  // The mount is the host's worktree, `node_modules` included. Masking that one
  // path with an empty tmpfs hides the macOS binaries from every reader inside
  // the container, so nothing can load them by accident; the copy in
  // `scripts/e2e-linux-container.sh` builds `/work` from the image instead.
  // A clean checkout has no `node_modules` to mask, and Docker refuses to mount
  // a tmpfs where the read-only `/src` has no such directory: there the flag is
  // left out, since there is nothing to hide.
  ...(maskNodeModules ? ['--tmpfs', '/src/node_modules'] : []),
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
 * The Node release CI installs, read from `.node-version`, the one file CI's
 * `actions/setup-node` reads too. Sharing the file is the point: the `engines`
 * floor in `package.json` still says what the project needs, and this number
 * pins what is proved, so both place cannot drift into two different Nodes.
 */
async function nodeVersionCI() {
  let said;
  try {
    said = (await readFile(NODE_VERSION_FILE, 'utf8')).trim();
  } catch (error) {
    fail(`cannot read .node-version, the Node version CI installs: ${error.message}`);
  }
  const version = VERSION.exec(said);
  if (version === null) {
    fail(`.node-version reads "${said}": it must hold one major.minor.patch version, as CI's setup-node reads it`);
  }
  return version.slice(1, 4).join('.');
}

/**
 * The image name for this Dockerfile and everything it is built from: the same
 * inputs produce the same tag, so its presence is the whole answer to "reuse or
 * build". A different one leaves the old image for `docker image rm` to judge.
 */
async function imageFor(node, pnpm) {
  const dockerfile = await readFile(DOCKERFILE);
  const fingerprint = createHash('sha256').update(dockerfile);
  // Every file the Dockerfile copies into the image: the lockfile decides the
  // dependencies, and a manifest or workspace change is just as real a rebuild
  // as a line of the Dockerfile. Hashing the Dockerfile alone would keep the old
  // tag and test an image built from dependencies that no longer exist.
  for (const source of await copiedSources()) {
    fingerprint.update(`\ncopy ${source}\n`);
    try {
      fingerprint.update(await readFile(join(ROOT, source)));
    } catch (error) {
      fail(`docker/e2e.Dockerfile copies ${source}, which cannot be read: ${error.message}`);
    }
  }
  fingerprint.update(`\nnode ${node}\npnpm ${pnpm}\n`);
  return `esbozo:e2e-linux-${fingerprint.digest('hex').slice(0, 12)}`;
}

/**
 * Every file a `COPY` instruction of the Dockerfile takes from the build
 * context, in a stable order. `COPY --from` copies out of another build stage,
 * which is that stage's own fingerprint, so it is not a file of this context;
 * a glob or a folder cannot be fingerprinted here, and stops rather than
 * silently leaving the input out.
 */
async function copiedSources() {
  const text = await readFile(DOCKERFILE, 'utf8');
  const sources = new Set();
  // A continuation line is the same instruction, so join before splitting.
  for (const line of text.replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
    const copy = /^\s*COPY\s+(.*)$/i.exec(line);
    if (copy === null || copy[1].includes('--from=')) continue;
    const words = copy[1].trim().split(/\s+/).filter((word) => !word.startsWith('--'));
    for (const source of words.slice(0, -1)) {
      if (/[?*]/.test(source) || source.includes('[')) {
        fail(`docker/e2e.Dockerfile copies "${source}", which is not one file: the image fingerprint cannot cover it`);
      }
      sources.add(source);
    }
  }
  if (sources.size === 0) {
    fail('docker/e2e.Dockerfile copies no files in: the image fingerprint has no input to cover');
  }
  return [...sources].sort();
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
