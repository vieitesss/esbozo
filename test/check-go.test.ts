/** Script seam: `scripts/check-go.mjs` behind `pnpm check:go`. */
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

function makeStubGo(binDir: string, line: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
  mkdirSync(binDir, { recursive: true });
  const goPath = join(binDir, 'go');
  writeFileSync(
    goPath,
    [
      '#!/bin/sh',
      'if [ "$1" = tool ] && [ "$2" = deadcode ]; then',
      `  printf '%s\\n' '${line}'${stream === 'stderr' ? ' >&2' : ''}`,
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(goPath, 0o755);
}

function makeStubGofmt(binDir: string, file: string): void {
  mkdirSync(binDir, { recursive: true });
  const gofmtPath = join(binDir, 'gofmt');
  writeFileSync(gofmtPath, ['#!/bin/sh', `printf '%s\\n' '${file}'`, 'exit 0', ''].join('\n'));
  chmodSync(gofmtPath, 0o755);
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

test('module download chatter on stderr passes the deadcode step', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-go-'));
  try {
    const binDir = join(dir, 'bin');
    const chatter = 'go: downloading golang.org/x/tools v0.44.0';
    makeStubGo(binDir, chatter, 'stderr');
    makeStubGofmt(binDir, 'cmd/ez/main.go');

    const run = runCheckGo(binDir);

    assert.match(run.stderr, /^check:go: FAILED at gofmt$/m);
    assert.doesNotMatch(run.stderr, /FAILED at deadcode/);
    assert.ok(run.stderr.includes(chatter), run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
