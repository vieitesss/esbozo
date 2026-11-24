/**
 * `scripts/main-ci-guard.mjs` on the ref updates git hands a `pre-push` hook.
 *
 * Refuses pushing `refs/heads/main` when any merge commit in the pushed range
 * has a second parent (`M^2`, the merged branch head) without a completed,
 * successful `check` workflow run.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../scripts/main-ci-guard.mjs', import.meta.url));
const ZERO_OID = '0'.repeat(40);

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface MergeFixture {
  readonly dir: string;
  readonly binDir: string;
  readonly markerFile: string;
  readonly baseOid: string;
  readonly branchHead: string;
  readonly mergeCommit: string;
}

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function makeStubGh(binDir: string, markerFile: string, runsJson: string): void {
  mkdirSync(binDir, { recursive: true });
  const ghPath = join(binDir, 'gh');
  writeFileSync(
    ghPath,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> "${markerFile}"`,
      `printf '%s\\n' '${runsJson}'`,
      '',
    ].join('\n'),
  );
  chmodSync(ghPath, 0o755);
}

function makeMergeFixture(): MergeFixture {
  const dir = mkdtempSync(join(tmpdir(), 'main-ci-guard-'));
  const binDir = join(dir, 'bin');
  const markerFile = join(dir, 'gh-called');

  git(dir, ['init', '-b', 'main']);
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git(dir, ['add', 'a.txt']);
  git(dir, ['commit', '-m', 'init']);
  const baseOid = git(dir, ['rev-parse', 'HEAD']);

  git(dir, ['checkout', '-b', 'feat/work']);
  writeFileSync(join(dir, 'b.txt'), 'b\n');
  git(dir, ['add', 'b.txt']);
  git(dir, ['commit', '-m', 'work']);
  const branchHead = git(dir, ['rev-parse', 'HEAD']);

  git(dir, ['checkout', 'main']);
  git(dir, ['merge', '--no-ff', 'feat/work', '-m', 'Merge feat/work']);
  const mergeCommit = git(dir, ['rev-parse', 'HEAD']);

  return { dir, binDir, markerFile, baseOid, branchHead, mergeCommit };
}

function runGuard(cwd: string, binDir: string, input: string): Run {
  const result = spawnSync(process.execPath, [SCRIPT, 'origin', 'https://example.invalid/repo.git'], {
    cwd,
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

test('pushing a feature branch passes without calling gh', () => {
  const fx = makeMergeFixture();
  try {
    makeStubGh(fx.binDir, fx.markerFile, '[]');

    const run = runGuard(
      fx.dir,
      fx.binDir,
      `refs/heads/feat/work ${fx.branchHead} refs/heads/feat/work ${ZERO_OID}\n`,
    );

    assert.deepEqual(run, { code: 0, stdout: '', stderr: '' });
    assert.equal(existsSync(fx.markerFile), false, 'gh must not be invoked for non-main refs');
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('pushing a merge on main whose M^2 has a completed success run passes', () => {
  const fx = makeMergeFixture();
  try {
    makeStubGh(fx.binDir, fx.markerFile, '[{"status":"completed","conclusion":"success"}]');

    const run = runGuard(
      fx.dir,
      fx.binDir,
      `refs/heads/main ${fx.mergeCommit} refs/heads/main ${fx.baseOid}\n`,
    );

    assert.deepEqual(run, { code: 0, stdout: '', stderr: '' });
    const calledArgs = readFileSync(fx.markerFile, 'utf8');
    assert.match(calledArgs, new RegExp(`--commit ${fx.branchHead}`));
    assert.match(calledArgs, /--workflow check/);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('pushing a merge on main whose M^2 failed CI exits 1 and names the offending SHA', () => {
  const fx = makeMergeFixture();
  try {
    makeStubGh(fx.binDir, fx.markerFile, '[{"status":"completed","conclusion":"failure"}]');

    const run = runGuard(
      fx.dir,
      fx.binDir,
      `refs/heads/main ${fx.mergeCommit} refs/heads/main ${fx.baseOid}\n`,
    );

    assert.equal(run.code, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /main-ci-guard: refusing push to main/);
    assert.match(run.stderr, new RegExp(fx.branchHead));
    assert.match(run.stderr, /conclusion=failure/);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('pushing a merge on main whose M^2 is still in_progress exits 1 and names the offending SHA', () => {
  const fx = makeMergeFixture();
  try {
    makeStubGh(fx.binDir, fx.markerFile, '[{"status":"in_progress","conclusion":null}]');

    const run = runGuard(
      fx.dir,
      fx.binDir,
      `refs/heads/main ${fx.mergeCommit} refs/heads/main ${fx.baseOid}\n`,
    );

    assert.equal(run.code, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /main-ci-guard: refusing push to main/);
    assert.match(run.stderr, new RegExp(fx.branchHead));
    assert.match(run.stderr, /status=in_progress/);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});
