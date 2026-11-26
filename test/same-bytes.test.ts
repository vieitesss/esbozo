/**
 * Script seam: `scripts/same-bytes.mjs`, the core held to the same bytes in Node
 * and in Go.
 *
 * The comparison is the script's: it renders and checks every Scene in
 * `test/fixtures/` through `dist/core.js` in its own process and through
 * `internal/core` in Go, and fails on the first fixture whose SVG, problem
 * lines, notes or exit code disagree. `pnpm build` writes the bundle the script
 * loads, so this suite puts the comparison in front of every `pnpm check`.
 */
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
