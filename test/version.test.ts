/**
 * CLI seam: `ez --version`, the stamp `pnpm build` embeds in the binary.
 *
 * The TypeScript CLI has no `--version` until T7, so the Main case skips unless
 * `EZ_BIN` names the other `ez` — the Go binary, which carries the stamp the
 * build wrote. The stamp is `package.json`'s version for a Release, and
 * `<version>-main+<short sha of HEAD>` for every build the build made itself.
 * A Release is the switch `scripts/version-stamp.mjs` reads, so the Release case
 * writes the stamp there and reads it back rather than building a second binary.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { ez, tempFolder } from './cli.ts';
import { removeTempFolders } from './temp.ts';

after(removeTempFolders);

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = 'the TypeScript CLI has no --version until T7; set EZ_BIN to the Go binary';

test(
  'ez --version prints the version package.json declares and the commit it was built from',
  { skip: process.env.EZ_BIN === undefined ? SKIP : undefined },
  async () => {
    const folder = await tempFolder();
    const { version } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    const head = (await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT })).stdout.trim();

    const result = await ez(['--version'], folder);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, `${version}-main+${head}\n`);
  },
);

test('a Release build stamps the version alone, with no Main suffix', async () => {
  const folder = await tempFolder();
  const stamp = join(folder, 'version');
  const { version } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };

  await run(process.execPath, ['scripts/version-stamp.mjs', stamp], {
    cwd: ROOT,
    env: { ...process.env, ESBOZO_RELEASE: '1' },
  });

  assert.equal(await readFile(stamp, 'utf8'), `${version}\n`);
});
