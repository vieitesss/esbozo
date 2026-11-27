/**
 * Script seam: `scripts/check-go.mjs` behind `pnpm check:go`.
 *
 * The Go toolchain is stubbed on `PATH`, so what is asserted is the script's
 * own contract: which step it names when a run fails and the lines the failing
 * tool printed. `deadcode` exits 0 whether or not it found anything, so a run
 * that prints a dead function has to fail the step on the output.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../scripts/check-go.mjs', import.meta.url));

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A `go` that answers `vet` cleanly and prints `line` when asked for `deadcode`. */
function makeStubGo(binDir: string, line: string): void {
  mkdirSync(binDir, { recursive: true });
  const goPath = join(binDir, 'go');
  writeFileSync(
    goPath,
    [
      '#!/bin/sh',
      'if [ "$1" = tool ] && [ "$2" = deadcode ]; then',
      `  printf '%s\\n' '${line}'`,
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(goPath, 0o755);
}

function runCheckGo(binDir: string): Run {
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

test('a dead function fails the deadcode step and keeps the line it named', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-go-'));
  try {
    const binDir = join(dir, 'bin');
    const line = 'cmd/ez/main.go:9:6: unreachable func: greet';
    makeStubGo(binDir, line);

    const run = runCheckGo(binDir);

    assert.notEqual(run.code, 0);
    assert.match(run.stderr, /^check:go: FAILED at deadcode$/m);
    assert.ok(run.stdout.includes(line), run.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
