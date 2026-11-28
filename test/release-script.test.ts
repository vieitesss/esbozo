/**
 * Script seam: `scripts/release.mjs` writing the asset `scripts/install.sh`
 * installs, and the install of it.
 *
 * The asset's name and the line `SHA256SUMS` carries are the whole contract
 * between the two scripts, so the test builds the host's asset, checks the
 * archive against the sums the way an install does, and then installs it from a
 * release serving those very files.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { arch, platform } from 'node:process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run, startRelease, type FakeRelease } from './release.ts';
import { removeTempFolders, tempFolder } from './temp.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RELEASE = join(ROOT, 'scripts/release.mjs');
const INSTALL = join(ROOT, 'scripts/install.sh');

const GOOS = platform === 'darwin' ? 'darwin' : 'linux';
const GOARCH = arch === 'x64' ? 'amd64' : 'arm64';
const ASSET = `ez-${GOOS}-${arch}.gz`;

let version: string;
let stamp: string;
let outdir: string;
let server: FakeRelease;

before(async () => {
  const declared = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };
  version = declared.version;
  stamp = (await readFile(join(ROOT, 'dist/version'), 'utf8')).trim();

  outdir = await tempFolder();
  const built = spawnSync(process.execPath, [RELEASE, outdir, `${GOOS}/${GOARCH}`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(built.status, 0, built.stderr);

  const files = new Map<string, Buffer>();
  for (const name of await readdir(outdir)) {
    files.set(name, await readFile(join(outdir, name)));
  }
  server = await startRelease(new Map([[`/download/v${version}`, files]]));
});

after(async () => {
  await server.close();
  await removeTempFolders();
});

test('writes the asset the install script asks for and one SHA256SUMS line naming it', async () => {
  assert.deepEqual((await readdir(outdir)).sort(), ['SHA256SUMS', ASSET].sort());

  const sums = (await readFile(join(outdir, 'SHA256SUMS'), 'utf8')).trimEnd().split('\n');
  assert.equal(sums.length, 1, 'one target was built');
  assert.equal(
    sums[0],
    `${createHash('sha256').update(await readFile(join(outdir, ASSET))).digest('hex')}  ${ASSET}`,
  );
});

test('installs the archive, and the installed ez prints the version this build stamped', async () => {
  const bin = join(await tempFolder(), 'bin');

  const installed = await run('sh', [INSTALL, '--dir', bin, '--version', version], {
    ESBOZO_RELEASE_URL: server.url,
  });

  assert.equal(installed.code, 0, installed.stderr);
  assert.deepEqual(await run(join(bin, 'ez'), ['--version']), {
    code: 0,
    stdout: `${stamp}\n`,
    stderr: '',
  });
});
