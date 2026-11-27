/**
 * The Go half of `pnpm check`: `go vet`, `gofmt`, `staticcheck`, `go test`, then
 * the CLI suites with `EZ_BIN` naming `dist/ez`, which must be newer than the
 * files it is built from.
 *
 * `test/help-cli.test.ts` stays out until the Go binary answers the commands it
 * names.
 */
import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The binary the suites drive, and the one `pnpm build` writes. */
const BIN = join(ROOT, 'dist', 'ez');

/** The directories `dist/ez` is compiled from; the root package's files come from `linkedIn`. */
const BIN_TREE = ['cmd', 'internal'];

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

function failed(step, status) {
  process.stderr.write(`check:go: FAILED at ${step}\n`);
  process.exitCode = status === 0 ? 1 : status;
}

async function everyFile(dir) {
  const entries = await readdir(join(ROOT, dir), { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

/**
 * The files `dist/ez` is built from outside the Go tree: the module it is
 * compiled against, and what `assets.go` embeds, read from its `//go:embed` lines.
 */
async function linkedIn() {
  const assets = await readFile(join(ROOT, 'assets.go'), 'utf8');
  const embedded = [...assets.matchAll(/^\/\/go:embed (.+)$/gm)].flatMap(([, files]) => files.trim().split(/\s+/));
  return ['assets.go', 'go.mod', 'go.sum', ...embedded].map((file) => join(ROOT, file));
}

async function stale(built) {
  const tree = await Promise.all(BIN_TREE.map(everyFile));
  const sources = [...tree.flat(), ...(await linkedIn())];
  for (const source of sources) {
    const changed = await stat(source).then(
      (file) => file.mtimeMs,
      () => built,
    );
    if (changed > built) return relative(ROOT, source);
  }
  return undefined;
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

  const linted = await run('go', ['tool', 'staticcheck', './...']);
  if (linted.status !== 0) return failed('go tool staticcheck', linted.status);

  const tested = await run('go', ['test', './...']);
  if (tested.status !== 0) return failed('go test', tested.status);

  const built = await stat(BIN).then(
    (file) => file.mtimeMs,
    () => undefined,
  );
  if (built === undefined) {
    process.stderr.write(`check:go: ${BIN} is not built — run \`pnpm build\` first\n`);
    return failed('the CLI suites', 1);
  }

  const changed = await stale(built);
  if (changed !== undefined) {
    process.stderr.write(`check:go: ${changed} is newer than ${BIN} — run \`pnpm build\` first\n`);
    return failed('the CLI suites', 1);
  }

  const suites = await run(process.execPath, ['--test', ...SUITES], { ...process.env, EZ_BIN: BIN });
  if (suites.status !== 0) return failed('the CLI suites', suites.status);
}

await main();
