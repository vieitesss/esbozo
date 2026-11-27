/**
 * Run the six `pnpm check` steps in order, streaming their output live and
 * printing a one-line summary (`check: ok (...)` or
 * `check: FAILED at <step> — <error>`) as the script's own last line. Through
 * `pnpm check`, pnpm appends its own `[ELIFECYCLE] Command failed...` footer
 * after a failing script, so read the summary from `pnpm check 2>&1 | tail -3`
 * (or `pnpm --silent check 2>&1 | tail -1`).
 */
import { spawn } from 'node:child_process';

/** In this order: `test` builds `dist/ez` and runs the CLI suites against it, and `check:go` needs nothing built. */
const STEPS = ['typecheck', 'lint', 'knip', 'check-rules', 'test', 'check:go'];

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

const BOILERPLATE_PATTERNS = [
  /^[>$]\s/,
  /\bELIFECYCLE\b/,
  /\bERR_PNPM_/,
  /^Command failed with exit code\b/,
  /^pnpm\s/,
];

const ERROR_PATTERNS = [
  /✖/,
  /^not ok\b/,
  /\bFAIL\b/,
  /\berror TS\d+:/,
  /\b(?:Assertion|Syntax|Type|Reference|Range)?Error:/,
  /^\S+:\d+:\d+/,
  /^\S+\(\d+,\d+\):/,
  /^×\s/,
];

function firstErrorLine(output, status) {
  const lines = output
    .replace(ANSI_PATTERN, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !BOILERPLATE_PATTERNS.some((pattern) => pattern.test(line)));

  const match = lines.find((line) => ERROR_PATTERNS.some((pattern) => pattern.test(line)));
  return match ?? lines[0] ?? `exit code ${status}`;
}

function runStep(step) {
  const runner = process.env.ESBOZO_CHECK_RUNNER;
  const command = runner ? process.execPath : 'pnpm';
  const args = runner ? [runner, step] : [step];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'] });
    let combined = '';

    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      combined += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      combined += chunk;
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      const status = code ?? (signal ? 1 : 0);
      resolve({ status, combined });
    });
  });
}

async function main() {
  for (const step of STEPS) {
    const { status, combined } = await runStep(step);
    if (status !== 0) {
      const summary = firstErrorLine(combined, status);
      process.stderr.write(`check: FAILED at ${step} — ${summary}\n`);
      process.exitCode = status;
      return;
    }
  }
  process.stdout.write(`check: ok (${STEPS.join(', ')})\n`);
}

await main();
