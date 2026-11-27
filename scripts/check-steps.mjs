/**
 * Every commit in a range, checked on its own.
 *
 * Review kept finding a commit that only went green once the next one landed —
 * an export `knip` reported until a later import pointed at it — so the branch
 * is walked oldest first and each commit gets the static half of `pnpm check`:
 * `typecheck`, `lint`, `knip`, `check-rules`, and the Go half, `go vet` and
 * `gofmt`. The node tests, `go test`, the CLI suites and the build are left
 * out: they are slow, and none of them is what a single commit broke.
 *
 * Usage: pnpm check:steps <base>
 *
 * The caller's working tree, index and branch are never touched. The commits are
 * checked in one detached temporary worktree, with this checkout's
 * `node_modules` symlinked in so nothing is installed, and both are removed
 * again whether the run passes, fails or is interrupted. A commit that moves
 * `package.json` or `pnpm-lock.yaml` gets its own `pnpm install
 * --frozen-lockfile` inside the worktree instead, because the symlinked modules
 * would be the wrong ones.
 *
 * One line per commit — `<sha> <subject>: ok`, or the name of the first check
 * that failed with that check's output printed underneath — and the run carries
 * on, so one pass names every commit that is not green. Exit `1` when any commit
 * fails, and `2` for a missing base or a base `HEAD` does not descend from.
 */
import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** The static half of `pnpm check`, in the order `pnpm check` runs them. */
const CHECKS = ['typecheck', 'lint', 'knip', 'check-rules'];

/**
 * The files the root Go package embeds that `pnpm build` writes and git does not
 * carry: `go vet` resolves `//go:embed` patterns, so they are stood in for empty.
 * A new built embed is red here until it is listed.
 */
const BUILT_EMBEDS = ['dist/core.js', 'dist/font-metrics.json', 'dist/resvg.wasm'];

/** The two files whose change makes this checkout's modules the wrong ones. */
const MANIFEST = ['package.json', 'pnpm-lock.yaml'];

const USAGE = 'Usage: pnpm check:steps <base>  (base must be a commit HEAD descends from)';

/** One command, its two streams collected, resolved with what it exited with. */
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (out += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (err += chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, out, err }));
  });
}

/** A git command that has to work: its output, or the reason this run stops. */
async function git(cwd, args) {
  const { status, out, err } = await run('git', args, cwd);
  if (status !== 0) throw new Error(`git ${args.join(' ')}: ${(err || out).trim()}`);
  return out;
}

/** Whether a path is there at all — a dangling symlink counts, and does exist. */
async function present(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Unlink this checkout's linked modules, never remove anything through them. */
async function unlinkModules(tree) {
  const modules = join(tree, 'node_modules');
  const info = await lstat(modules).catch(() => null);
  if (info?.isSymbolicLink()) await unlink(modules);
}

async function standInForBuiltEmbeds(tree) {
  for (const path of BUILT_EMBEDS) {
    const file = join(tree, path);
    if (await present(file)) continue;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, '');
  }
}

/** The Go half of `pnpm check` in one commit's tree. */
async function goChecks(tree) {
  if (!(await present(join(tree, 'go.mod')))) return null;

  await standInForBuiltEmbeds(tree);
  const vet = await run('go', ['vet', './...'], tree);
  if (vet.status !== 0) return { name: 'go vet', ...vet };

  const files = (await git(tree, ['ls-files', '--', '*.go'])).trim().split('\n');
  const goFiles = files.filter((file) => file !== '');
  // `gofmt -l` with no file reads stdin and waits.
  if (goFiles.length === 0) return null;

  const gofmt = await run('gofmt', ['-l', ...goFiles], tree);
  if (gofmt.status !== 0) return { name: 'gofmt', ...gofmt };
  if (gofmt.out.trim() === '') return null;
  return { name: 'gofmt', status: 1, out: `not formatted: ${gofmt.out.trim()}`, err: '' };
}

async function main() {
  const [base] = process.argv.slice(2);
  const root = process.cwd();

  if (base === undefined || base.startsWith('-')) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }

  const commit = await run('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], root);
  const descendant =
    commit.status === 0 &&
    (await run('git', ['merge-base', '--is-ancestor', commit.out.trim(), 'HEAD'], root)).status === 0;
  if (!descendant) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }

  const range = `${commit.out.trim()}..HEAD`;
  const listed = (await git(root, ['log', '--reverse', '--format=%H%x00%s', range])).trim();
  const steps = listed
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha, subject] = line.split('\0');
      return { sha, subject };
    });

  const scratch = await mkdtemp(join(tmpdir(), 'esbozo-check-steps-'));
  const tree = join(scratch, 'tree');
  let failed = false;

  /** Take the worktree and the scratch folder away, however the run ended. */
  const cleanUp = async () => {
    await unlinkModules(tree);
    await run('git', ['worktree', 'remove', '--force', tree], root);
    await rm(scratch, { recursive: true, force: true });
  };

  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    process.once(signal, () => {
      cleanUp().finally(() => process.exit(code));
    });
  }

  try {
    await git(root, ['worktree', 'add', '--detach', '--quiet', tree, steps[0]?.sha ?? 'HEAD']);

    for (const { sha, subject } of steps) {
      await git(tree, ['checkout', '--detach', '--quiet', sha]);

      // The modules this commit's own manifest and lockfile call for.
      const touched = (await git(root, ['diff-tree', '-r', '--name-only', '--no-commit-id', sha]))
        .trim()
        .split('\n');
      let broke = null;
      if (MANIFEST.some((file) => touched.includes(file))) {
        await unlinkModules(tree);
        const installed = await run('pnpm', ['install', '--frozen-lockfile'], tree);
        if (installed.status !== 0) broke = { name: 'pnpm install', ...installed };
      } else if (!(await present(join(tree, 'node_modules'))) && (await present(join(root, 'node_modules')))) {
        await symlink(join(root, 'node_modules'), join(tree, 'node_modules'), 'dir');
      }

      for (const check of CHECKS) {
        if (broke !== null) break;
        // pnpm would install first if it thought the modules were stale, and
        // through the symlink those are the caller's own `node_modules`.
        const result = await run('pnpm', ['run', '--config.verify-deps-before-run=false', check], tree);
        if (result.status !== 0) broke = { name: check, ...result };
      }

      if (broke === null) broke = await goChecks(tree);

      if (broke === null) {
        process.stdout.write(`${sha} ${subject}: ok\n`);
        continue;
      }
      failed = true;
      process.stdout.write(`${sha} ${subject}: ${broke.name}\n`);
      process.stdout.write(`${(broke.out + broke.err).trim()}\n`);
    }
  } finally {
    await cleanUp();
  }

  if (failed) process.exitCode = 1;
}

await main();
