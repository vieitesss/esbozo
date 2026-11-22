/**
 * The temporary folders the tests make, and the one place that removes them.
 *
 * A folder is recorded by the exact path `mkdtemp` returned, so teardown removes
 * only what this run created: other worktrees run these suites at the same
 * time, and a folder that was already in the temporary directory is not ours.
 *
 * The runner that made the folders registers `removeTempFolders` itself —
 * `node:test`'s `after` in the CLI suites, e2e's `afterAll` in `tests/` — because
 * one module serves both runners and neither hook may run under the other.
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The folders this run made, in the order it made them. */
const made: string[] = [];

/** A fresh, resolved temporary folder, which teardown removes. */
export async function tempFolder(prefix = 'esbozo-'): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  made.push(folder);
  return folder;
}

/** Remove every folder the tests made, however their tests ended. */
export async function removeTempFolders(): Promise<void> {
  const folders = made.splice(0);
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
}
