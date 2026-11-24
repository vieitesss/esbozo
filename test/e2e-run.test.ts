import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = resolve(ROOT, 'scripts/e2e-run.mjs');
const SUITE_ARGS = ['--suite', 'tests/a.e2e.ts', 'tests/b.e2e.ts', '--'];

function runScript(extraArgs: string[], envOverrides: Record<string, string | undefined> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CI;
  delete env.E2E_RUN_DRY_RUN;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return spawnSync(process.execPath, [SCRIPT, ...SUITE_ARGS, ...extraArgs], {
    env,
    encoding: 'utf8',
  });
}

describe('scripts/e2e-run.mjs', () => {
  it('refuses a bare local run with exit 2 and a clear message', () => {
    const result = runScript([]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /refuse to run all 2 suites locally/i);
    assert.match(result.stderr, /--all/);
  });

  it('runs the full suite when CI=1', () => {
    const result = runScript([], { CI: '1', E2E_RUN_DRY_RUN: '1' });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), [
      'scripts/queue.mjs',
      'e2e',
      'node',
      'scripts/fresh-tmp.mjs',
      'e2e',
      'run',
      'tests/a.e2e.ts',
      'tests/b.e2e.ts',
    ]);
  });

  it('runs the full suite when --all is passed and strips --all', () => {
    const result = runScript(['--all'], { E2E_RUN_DRY_RUN: '1' });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), [
      'scripts/queue.mjs',
      'e2e',
      'node',
      'scripts/fresh-tmp.mjs',
      'e2e',
      'run',
      'tests/a.e2e.ts',
      'tests/b.e2e.ts',
    ]);
  });

  it('runs only the named file and flags when a file argument is given', () => {
    const result = runScript(['tests/snap.e2e.ts', '-g', 'foo'], { E2E_RUN_DRY_RUN: '1' });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), [
      'scripts/queue.mjs',
      'e2e',
      'node',
      'scripts/fresh-tmp.mjs',
      'e2e',
      'run',
      'tests/snap.e2e.ts',
      '-g',
      'foo',
    ]);
  });
});
