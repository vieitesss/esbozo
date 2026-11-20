/**
 * The one seam the CLI tests share: `ez` on Scene files in temporary folders.
 *
 * Both `render.test.ts` and `elements.test.ts` drive the built CLI the same way:
 * write a Scene to a fresh folder, run `ez`, read what it wrote. Keeping the
 * three helpers here means a change to how the CLI is invoked, or to how its
 * exit code is read, cannot make the suites disagree.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The built CLI both suites exercise. */
export const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** What one `ez` run left behind: its exit code and its two streams. */
export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** A fresh, resolved temporary folder, so a test never sees another test's files. */
export async function tempFolder(prefix = 'esbozo-'): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

/** A folder holding `scene.json` (or `name`), ready for `ez render`. */
export async function sceneFolder(scene: unknown, name = 'scene.json'): Promise<string> {
  const folder = await tempFolder();
  await writeFile(join(folder, name), JSON.stringify(scene, null, 2), 'utf8');
  return folder;
}

/** `ez` with its exit code read, whether it succeeded or not. */
export async function ez(args: string[], cwd: string): Promise<Run> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string };
    return {
      code: typeof failed.code === 'number' ? failed.code : -1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    };
  }
}
