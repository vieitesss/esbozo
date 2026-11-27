/**
 * CLI seam: one `ez` run, the exit code it left, and the words it printed.
 *
 * A helper that goes on to read what a command should have written reports only
 * the file that is not there, and the refusal behind it is lost. So the shared
 * seam fails its caller on a run that failed, and this is where a real refusing
 * `ez` proves it arrives as its exit code and what it said.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ez, ezOrThrow, sceneFolder } from './cli.ts';

test('a refused ez render is its exit code and what it said, not the file it never wrote', async () => {
  const folder = await sceneFolder({ version: 1 });

  // The seam without the throw, so a suite can assert on a refusal itself.
  const refused = await ez(['render', 'scene.json'], folder);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, /elements must be a JSON array/);

  await assert.rejects(ezOrThrow(['render', 'scene.json'], folder), (error: Error) => {
    assert.match(error.message, /exited 3/);
    assert.match(error.message, /elements must be a JSON array/);
    return true;
  });
});
