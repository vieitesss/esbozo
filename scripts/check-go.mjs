/**
 * The Go half of `pnpm check`: the `ez` binary is Go, and the CLI suites can be
 * pointed at the built one, so both are checked here.
 *
 * In order: `go vet ./...`, then `gofmt -l` over the Go tree — any name it
 * prints is a file that is not formatted — then `go test ./...`, and last the
 * CLI suites with `EZ_BIN` naming the built binary. That last one needs
 * `dist/ez` to exist: `pnpm build` writes it, and `pnpm check` runs this after
 * the step whose build does.
 *
 * `test/help-cli.test.ts` is left out on purpose: its usage-errors case names
 * `anchor`, `snap`, `bundle` and `skill`, which the Go binary does not answer
 * until T4 ports them. T4 puts it back in the list below.
 *
 * Exit status is the first failing step's, and the step is named on stderr, so
 * `scripts/check.mjs` can report it as `check: FAILED at check:go — ...`.
 */
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The binary the suites drive, and the one `pnpm build` writes. */
const BIN = join(ROOT, 'dist', 'ez');

/** The Go tree `gofmt` reads: both packages, and the file the root one is. */
const GOFMT_PATHS = ['cmd', 'internal', 'assets.go'];

/** The suites that reach the CLI through `EZ_BIN`, in the order they run. */
const SUITES = [
  'test/render.test.ts',
  'test/elements.test.ts',
  'test/check.test.ts',
  'test/exits.test.ts',
  'test/png.test.ts',
];

/** One command, its output streamed through and collected, and its exit status. */
function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '';

    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      out += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      out += chunk;
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ status: code ?? (signal ? 1 : 0), out }));
  });
}

/** Name the step that failed and leave with its status. */
function failed(step, status) {
  process.stderr.write(`check:go: FAILED at ${step}\n`);
  process.exitCode = status === 0 ? 1 : status;
}

async function main() {
  const vet = await run('go', ['vet', './...']);
  if (vet.status !== 0) return failed('go vet', vet.status);

  const gofmt = await run('gofmt', ['-l', ...GOFMT_PATHS]);
  const unformatted = gofmt.out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (gofmt.status !== 0) return failed('gofmt', gofmt.status);
  if (unformatted.length > 0) {
    process.stderr.write(`check:go: gofmt would rewrite ${unformatted.join(', ')}\n`);
    return failed('gofmt', 1);
  }

  const tested = await run('go', ['test', './...']);
  if (tested.status !== 0) return failed('go test', tested.status);

  const built = await access(BIN).then(
    () => true,
    () => false,
  );
  if (!built) {
    process.stderr.write(`check:go: ${BIN} is not built — run \`pnpm build\` first\n`);
    return failed('the CLI suites', 1);
  }

  const suites = await run(process.execPath, ['--test', ...SUITES], { ...process.env, EZ_BIN: BIN });
  if (suites.status !== 0) return failed('the CLI suites', suites.status);
}

await main();
