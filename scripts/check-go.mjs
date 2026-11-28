import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const GOFMT_PATHS = ['cmd', 'internal', 'assets.go'];

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';

    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ status: code ?? (signal ? 1 : 0), stdout }));
  });
}

function failed(step, status) {
  process.stderr.write(`check:go: FAILED at ${step}\n`);
  process.exitCode = status === 0 ? 1 : status;
}

async function main() {
  const vet = await run('go', ['vet', './...']);
  if (vet.status !== 0) return failed('go vet', vet.status);

  const dead = await run('go', ['tool', 'deadcode', './cmd/ez']);
  if (dead.status !== 0) return failed('deadcode', dead.status);
  // A cold module cache prints its downloads to stderr; only stdout names a dead function.
  if (dead.stdout.trim() !== '') return failed('deadcode', 1);

  const gofmt = await run('gofmt', ['-l', ...GOFMT_PATHS]);
  const unformatted = gofmt.stdout
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
}

await main();
