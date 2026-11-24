/**
 * Script seam: `pnpm probe:node` runs a Node probe against `loadProjectModules()`.
 *
 * Each test spawns `node scripts/probe-node.mjs` with a fresh `TMPDIR` so it
 * proves the CLI contract end-to-end: file and stdin probes, JSON output from
 * bundled `src/` modules (`parseScene`, `drawnGeometry`), temp-folder cleanup,
 * and non-zero exit on error.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/probe-node.mjs');

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProbe(args: string[], options: { stdin?: string; tmp: string }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: { ...process.env, TMPDIR: options.tmp },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }
  });
}

test('runs a probe file, prints JSON from parseScene and drawnGeometry, and cleans temp folders', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'esbozo-probe-node-test-'));
  try {
    const probePath = join(tmp, 'probe.mjs');
    await writeFile(
      probePath,
      `export default async ({ parseScene, elementsById, drawnGeometry, createLayout, parseFontFile, KALAM }) => {
        const parsed = parseScene(JSON.stringify({
          version: 1,
          elements: [{ id: 'a', type: 'ellipse', x: 10, y: 20, width: 100, height: 60 }],
        }));
        if (!parsed.ok) throw new Error('failed to parse scene');
        const layout = createLayout(parseFontFile(KALAM));
        const geometry = drawnGeometry(
          parsed.scene.elements[0],
          elementsById(parsed.scene.elements),
          layout,
        );
        return { count: parsed.scene.elements.length, box: geometry.box };
      };\n`,
      'utf8',
    );
    const result = await runProbe([probePath], { tmp });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      count: 1,
      box: { x: 10, y: 20, width: 100, height: 60 },
    });
    const remaining = (await readdir(tmp)).filter((name) => name.startsWith('esbozo-'));
    assert.deepEqual(remaining, []);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('reads a probe from stdin and cleans temp folders', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'esbozo-probe-node-test-'));
  try {
    const source = `export default ({ emptyScene, serialiseScene }) => {
      const text = serialiseScene(emptyScene());
      return { hasVersion: text.includes('"version"') };
    };\n`;
    const result = await runProbe([], { stdin: source, tmp });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { hasVersion: true });
    const remaining = (await readdir(tmp)).filter((name) => name.startsWith('esbozo-'));
    assert.deepEqual(remaining, []);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('exits non-zero and cleans temp folders when the probe throws', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'esbozo-probe-node-test-'));
  try {
    const source = `export default () => {
      throw new Error('boom from probe');
    };\n`;
    const result = await runProbe([], { stdin: source, tmp });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /boom from probe/);
    const remaining = (await readdir(tmp)).filter((name) => name.startsWith('esbozo-'));
    assert.deepEqual(remaining, []);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
