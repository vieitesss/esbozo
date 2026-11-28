/** Script seam: `scripts/same-bytes.mjs`, the core held to the same bytes in Node and Go. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('the Go core answers every fixture exactly as the bundle does in V8', async () => {
  const { stdout } = await run(process.execPath, [join(ROOT, 'scripts/same-bytes.mjs')], {
    cwd: ROOT,
  });

  assert.match(stdout, /^\d+\/\d+ fixtures byte-identical$/m);
});
