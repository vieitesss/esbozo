/** CLI seam: `ez --version`, the stamp `pnpm build` embeds in the binary. */
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

test('ez --version prints the version package.json declares and the commit it was built from', async () => {
  const folder = await tempFolder();
  const { version } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };
  const head = (await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT })).stdout.trim();

  const result = await ez(['--version'], folder);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${version}-main+${head}\n`);
});

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
