/**
 * Seam 1, packaging: what `npm pack` would publish.
 *
 * The CLI embeds Kalam, so the font's OFL licence has to travel with the
 * tarball, not just sit in the repository. Packing runs `prepack`, which
 * rewrites `dist` — the folder every other suite in this run is spawning
 * `dist/cli.js` from — so this listing skips the scripts; `embed-bundle.test.ts`
 * runs the real pack and the real install, on a copy of the sources.
 */
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface PackManifest {
  files: { path: string }[];
}

test('the published package carries Kalam and its OFL licence', async () => {
  const { stdout } = await run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT });
  const [manifest] = JSON.parse(stdout) as PackManifest[];
  assert.ok(manifest !== undefined, 'npm pack printed no manifest');

  const paths = manifest.files.map((file) => file.path);

  assert.ok(paths.includes('dist/cli.js'), 'the bundled CLI is published');
  assert.ok(paths.includes('fonts/Kalam-Regular.ttf'), 'the bundled font is published');
  assert.ok(paths.includes('fonts/OFL.txt'), 'Kalam’s OFL licence is published');
});
