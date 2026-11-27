/**
 * Script seam: `scripts/check-steps.mjs` against a fixture repository whose four
 * static checks are one cheap script.
 *
 * A reviewer found a commit that was only green once the next one landed, so
 * the branch is walked one commit at a time and the run has to say which commit
 * fails and still leave the caller's checkout exactly as it was: same `HEAD`,
 * same `git status`, and one worktree in `git worktree list` — the one the
 * person is standing in. The fixture is three commits long, the middle one
 * breaking the checks, so a green range and a red one both come out of the same
 * repository.
 *
 * Each test makes its own fixture and removes it in that test's own teardown: a
 * name filter that matches none of a file's tests skips the file's `before` and
 * `after` on Node 26, and a folder made there would outlive the run.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../scripts/check-steps.mjs', import.meta.url));

/** Four static checks, each failing when a `broken` file sits beside it. */
const PACKAGE_JSON = `${JSON.stringify(
  {
    name: 'fixture',
    private: true,
    scripts: {
      typecheck: 'node check.mjs',
      lint: 'node check.mjs',
      knip: 'node check.mjs',
      'check-rules': 'node check.mjs',
    },
  },
  null,
  2,
)}\n`;

const CHECK = `import { existsSync } from 'node:fs';

process.exit(existsSync('broken') ? 1 : 0);
`;

const GO_MOD = 'module fixture\n\ngo 1.21\n';

const MAIN_GO = `package main

import "fmt"

func main() {
\tfmt.Println("hello")
}
`;

const MAIN_GO_UNFORMATTED = MAIN_GO.replace('\tfmt.Println', '    fmt.Println');

const MAIN_GO_VET_BROKEN = MAIN_GO.replace('fmt.Println("hello")', 'fmt.Printf("%d\\n", "hello")');

/** One Go file embedding the files only `pnpm build` writes, so the stand-in has work to do. */
const MAIN_GO_EMBEDS = `package main

import (
\t_ "embed"
\t"fmt"
)

//go:embed dist/version
var version string

//go:embed dist/embed.js
var bundle []byte

func main() {
\tfmt.Print(version, len(bundle))
}
`;

/** One git command in the fixture, its answer returned or the test stopped. */
function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** One commit, with the identity a bare temporary repository has to be told. */
function commit(cwd: string, message: string): void {
  git(
    cwd,
    '-c',
    'user.name=fixture',
    '-c',
    'user.email=fixture@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '--allow-empty-message',
    '-m',
    message,
  );
}

/** `check:steps` as a person runs it: the script, the base, and the repository. */
function checkSteps(cwd: string, base: string) {
  return spawnSync(process.execPath, [SCRIPT, base], { cwd, encoding: 'utf8' });
}

/** The fixture repository one test runs against, and the three commits in it. */
interface Fixture {
  readonly repo: string;
  readonly base: string;
  readonly broken: string;
  readonly clean: string;
}

/** A green commit, a red one and a green one again, in a folder this test removes. */
async function fixture(t: TestContext): Promise<Fixture> {
  const repo = await mkdtemp(join(tmpdir(), 'esbozo-check-steps-'));
  t.after(() => rm(repo, { recursive: true, force: true }));

  git(repo, 'init', '--quiet', '--initial-branch=main');
  await writeFile(join(repo, 'package.json'), PACKAGE_JSON);
  await writeFile(join(repo, 'check.mjs'), CHECK);
  git(repo, 'add', '--all');
  commit(repo, 'the checks are green');
  const base = git(repo, 'rev-parse', 'HEAD');

  await writeFile(join(repo, 'broken'), '');
  git(repo, 'add', '--all');
  commit(repo, 'break the checks');
  const broken = git(repo, 'rev-parse', 'HEAD');

  await rm(join(repo, 'broken'));
  git(repo, 'add', '--all');
  commit(repo, 'put them back');
  const clean = git(repo, 'rev-parse', 'HEAD');

  return { repo, base, broken, clean };
}

/** The same three commits as one Go file's edits. */
async function goFixture(t: TestContext, brokenSource: string): Promise<Fixture> {
  const repo = await mkdtemp(join(tmpdir(), 'esbozo-check-steps-go-'));
  t.after(() => rm(repo, { recursive: true, force: true }));

  git(repo, 'init', '--quiet', '--initial-branch=main');
  await writeFile(join(repo, 'package.json'), PACKAGE_JSON);
  await writeFile(join(repo, 'check.mjs'), CHECK);
  await writeFile(join(repo, 'go.mod'), GO_MOD);
  await writeFile(join(repo, 'main.go'), MAIN_GO);
  git(repo, 'add', '--all');
  commit(repo, 'the Go is clean');
  const base = git(repo, 'rev-parse', 'HEAD');

  await writeFile(join(repo, 'main.go'), brokenSource);
  git(repo, 'add', '--all');
  commit(repo, 'break the Go');
  const broken = git(repo, 'rev-parse', 'HEAD');

  await writeFile(join(repo, 'main.go'), MAIN_GO);
  git(repo, 'add', '--all');
  commit(repo, 'put it back');
  const clean = git(repo, 'rev-parse', 'HEAD');

  return { repo, base, broken, clean };
}

/** A green commit, and one that embeds files the build writes, in a folder this test removes. */
async function embedFixture(t: TestContext): Promise<{ repo: string; base: string; embed: string }> {
  const repo = await mkdtemp(join(tmpdir(), 'esbozo-check-steps-embeds-'));
  t.after(() => rm(repo, { recursive: true, force: true }));

  git(repo, 'init', '--quiet', '--initial-branch=main');
  await writeFile(join(repo, 'package.json'), PACKAGE_JSON);
  await writeFile(join(repo, 'check.mjs'), CHECK);
  await writeFile(join(repo, 'go.mod'), GO_MOD);
  await writeFile(join(repo, 'main.go'), MAIN_GO);
  git(repo, 'add', '--all');
  commit(repo, 'the Go is clean');
  const base = git(repo, 'rev-parse', 'HEAD');

  await writeFile(join(repo, 'main.go'), MAIN_GO_EMBEDS);
  git(repo, 'add', '--all');
  commit(repo, 'embed what the build writes');
  const embed = git(repo, 'rev-parse', 'HEAD');

  return { repo, base, embed };
}

test('a base that is not a commit HEAD descends from is a usage error', async (t) => {
  const { repo } = await fixture(t);
  const run = checkSteps(repo, 'no-such-commit');
  assert.equal(run.status, 2);
  assert.match(run.stdout + run.stderr, /^Usage: pnpm check:steps <base>/m);
});

test('check:steps names the commit that fails, keeps going and cleans up after itself', async (t) => {
  const { repo, base, broken, clean } = await fixture(t);
  const worktrees = git(repo, 'worktree', 'list', '--porcelain');
  const run = checkSteps(repo, base);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.deepEqual(
    run.stdout.split('\n').filter((line) => /^[0-9a-f]{40} .*: /.test(line)),
    [`${broken} break the checks: typecheck`, `${clean} put them back: ok`],
  );
  assert.equal(git(repo, 'worktree', 'list', '--porcelain'), worktrees);
});

test('check:steps passes a green range and leaves the caller where it was', async (t) => {
  const { repo, broken, clean } = await fixture(t);
  const head = git(repo, 'rev-parse', 'HEAD');
  const status = git(repo, 'status', '--porcelain');
  const worktrees = git(repo, 'worktree', 'list', '--porcelain');

  const run = checkSteps(repo, broken);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.stdout.trim(), `${clean} put them back: ok`);

  assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
  assert.equal(git(repo, 'status', '--porcelain'), status);
  assert.equal(git(repo, 'worktree', 'list', '--porcelain'), worktrees);
});

test('a commit gofmt would rewrite fails on its own, and the range carries on', async (t) => {
  const { repo, base, broken, clean } = await goFixture(t, MAIN_GO_UNFORMATTED);
  const run = checkSteps(repo, base);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.deepEqual(
    run.stdout.split('\n').filter((line) => /^[0-9a-f]{40} .*: /.test(line)),
    [`${broken} break the Go: gofmt`, `${clean} put it back: ok`],
  );
});

test('a commit that embeds a file only the build writes is green on its own', async (t) => {
  const { repo, base, embed } = await embedFixture(t);
  const run = checkSteps(repo, base);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.stdout.trim(), `${embed} embed what the build writes: ok`);
});

test('a commit go vet refuses fails on its own, and the range carries on', async (t) => {
  const { repo, base, broken, clean } = await goFixture(t, MAIN_GO_VET_BROKEN);
  const run = checkSteps(repo, base);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.deepEqual(
    run.stdout.split('\n').filter((line) => /^[0-9a-f]{40} .*: /.test(line)),
    [`${broken} break the Go: go vet`, `${clean} put it back: ok`],
  );
});
