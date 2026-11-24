import { spawnSync } from 'node:child_process';

function planE2eRun(argv, env = process.env) {
  const suiteIdx = argv.indexOf('--suite');
  const sepIdx = suiteIdx === -1 ? -1 : argv.indexOf('--', suiteIdx + 1);
  if (suiteIdx === -1 || sepIdx === -1) {
    return {
      ok: false,
      exitCode: 2,
      error: 'scripts/e2e-run.mjs: expected --suite <files...> -- [args...]\n',
    };
  }

  const suiteFiles = argv.slice(suiteIdx + 1, sepIdx);
  const rawCallerArgs = argv.slice(sepIdx + 1);
  const callerArgs = rawCallerArgs[0] === '--' ? rawCallerArgs.slice(1) : rawCallerArgs;

  if (callerArgs.length === 0 && !env.CI) {
    return {
      ok: false,
      exitCode: 2,
      error:
        `pnpm e2e: refuse to run all ${suiteFiles.length} suites locally without a file filter. ` +
        `Pass the suite(s) you touched (e.g. pnpm e2e tests/snap.e2e.ts), or pass --all to run the full suite.\n`,
    };
  }

  const hasAll = callerArgs.includes('--all');
  const remainingArgs = callerArgs.filter((arg) => arg !== '--all');
  const runArgs = hasAll || callerArgs.length === 0 ? [...suiteFiles, ...remainingArgs] : callerArgs;

  return {
    ok: true,
    command: process.execPath,
    args: ['scripts/queue.mjs', 'e2e', 'node', 'scripts/fresh-tmp.mjs', 'e2e', 'run', ...runArgs],
  };
}

const plan = planE2eRun(process.argv.slice(2), process.env);
if (!plan.ok) {
  process.stderr.write(plan.error);
  process.exit(plan.exitCode);
}

if (process.env.E2E_RUN_DRY_RUN) {
  process.stdout.write(`${JSON.stringify(plan.args)}\n`);
  process.exit(0);
}

const result = spawnSync(plan.command, plan.args, { stdio: 'inherit' });
if (result.error) {
  process.stderr.write(`pnpm e2e: ${result.error.message}\n`);
  process.exit(1);
}
if (result.signal) {
  process.kill(process.pid, result.signal);
}
process.exit(result.status ?? 1);
