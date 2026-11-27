/** CLI seam: one `ez` run, the exit code it left, and the words it printed. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { ez, ezOrThrow, sceneFolder } from './cli.ts';
import { removeTempFolders } from './temp.ts';

after(removeTempFolders);

test('a refused ez render is its exit code and what it said, not the file it never wrote', async () => {
  const folder = await sceneFolder({ version: 1 });

  const refused = await ez(['render', 'scene.json'], folder);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, /elements must be a JSON array/);

  await assert.rejects(ezOrThrow(['render', 'scene.json'], folder), (error: Error) => {
    assert.match(error.message, /exited 3/);
    assert.match(error.message, /elements must be a JSON array/);
    return true;
  });
});
