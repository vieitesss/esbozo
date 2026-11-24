import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/check.mjs', import.meta.url));

async function makeRunner(t: TestContext, body: string): Promise<{ dir: string; runner: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'esbozo-check-script-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const runner = join(dir, 'runner.mjs');
  await writeFile(runner, body);
  return { dir, runner };
}

function runCheck(runner: string, cwd: string) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ESBOZO_CHECK_RUNNER: runner },
  });
}

test('when all steps succeed, prints check: ok summary on the last line and exits 0', async (t) => {
  const { dir, runner } = await makeRunner(
    t,
    `const step = process.argv[2];
process.stdout.write(\`ran \${step}\\n\`);
`,
  );

  const run = runCheck(runner, dir);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const lines = run.stdout.trimEnd().split('\n');
  assert.equal(lines.at(-1), 'check: ok (typecheck, lint, knip, check-rules, test)');
});

test('when a step fails, stops immediately, preserves exit code, and prints FAILED summary on last line', async (t) => {
  const { dir, runner } = await makeRunner(
    t,
    `import { appendFileSync } from 'node:fs';
const step = process.argv[2];
appendFileSync('ran.log', step + '\\n');
if (step === 'lint') {
  process.stdout.write('> esbozo@0.0.0 lint /repo\\n');
  process.stderr.write('src/foo.ts:12:5 error: unused variable\\n');
  process.stderr.write(' ELIFECYCLE  Command failed with exit code 2.\\n');
  process.exit(2);
}
process.stdout.write(\`ok \${step}\\n\`);
`,
  );

  const run = runCheck(runner, dir);
  assert.equal(run.status, 2);
  const combined = (run.stdout + run.stderr).trimEnd().split('\n');
  assert.equal(combined.at(-1), 'check: FAILED at lint — src/foo.ts:12:5 error: unused variable');

  const { readFile } = await import('node:fs/promises');
  const ran = (await readFile(join(dir, 'ran.log'), 'utf8')).trim().split('\n');
  assert.deepEqual(ran, ['typecheck', 'lint']);
});

test('through the real pnpm check wrapper, the ok summary is still the last line', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'esbozo-check-wrapper-ok-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const runner = join(dir, 'runner.mjs');
  await writeFile(runner, '');
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'probe',
      version: '0.0.0',
      private: true,
      scripts: { check: `node ${SCRIPT}` },
    }),
  );

  // Merge streams through a shell so line order is chronological, exactly as
  // in the documented `pnpm check 2>&1 | tail -1`.
  const run = spawnSync('sh', ['-c', 'pnpm check 2>&1'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ESBOZO_CHECK_RUNNER: runner },
  });
  assert.equal(run.status, 0, run.stdout);
  const lines = run.stdout.trimEnd().split('\n');
  assert.equal(lines.at(-1), 'check: ok (typecheck, lint, knip, check-rules, test)');
});

test('through the real pnpm check wrapper, the FAILED summary sits within the last three lines', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'esbozo-check-wrapper-fail-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const runner = join(dir, 'runner.mjs');
  await writeFile(
    runner,
    `if (process.argv[2] === 'lint') {
  process.stderr.write('src/foo.ts:12:5 error: unused variable\\n');
  process.exit(2);
}
`,
  );
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'probe',
      version: '0.0.0',
      private: true,
      scripts: { check: `node ${SCRIPT}` },
    }),
  );

  const run = spawnSync('sh', ['-c', 'pnpm check 2>&1'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ESBOZO_CHECK_RUNNER: runner },
  });
  assert.equal(run.status, 2);
  const lines = run.stdout.trimEnd().split('\n');
  // pnpm appends its own ELIFECYCLE footer after a failing script, so the
  // summary is second-to-last, not last.
  assert.match(lines.at(-1) ?? '', /Command failed with exit code 2/);
  assert.ok(
    lines
      .slice(-3)
      .some((line) => line === 'check: FAILED at lint — src/foo.ts:12:5 error: unused variable'),
    lines.slice(-3).join('\n'),
  );
});

test('extracts decisive error line over earlier info output', async (t) => {
  const { dir, runner } = await makeRunner(
    t,
    `const step = process.argv[2];
if (step === 'test') {
  process.stdout.write('Building dist...\\n');
  process.stdout.write('✔ passing test\\n');
  process.stdout.write('✖ broken behavior (12ms)\\n');
  process.stdout.write('ℹ tests 2\\n');
  process.exit(1);
}
`,
  );

  const run = runCheck(runner, dir);
  assert.equal(run.status, 1);
  const combined = (run.stdout + run.stderr).trimEnd().split('\n');
  assert.equal(combined.at(-1), 'check: FAILED at test — ✖ broken behavior (12ms)');
});
