/** CLI seam: `ez update` re-running the install script the binary carries. */
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run, startRelease, type FakeRelease } from './release.ts';
import { removeTempFolders, tempFolder } from './temp.ts';

const BIN = fileURLToPath(new URL('../dist/ez', import.meta.url));
const UNREACHABLE_RELEASE_URL = 'http://127.0.0.1:1';

let server: FakeRelease;

before(async () => {
  server = await startRelease();
});

after(async () => {
  await server.close();
  await removeTempFolders();
});

async function installed(): Promise<{ folder: string; ez: string }> {
  const folder = join(await tempFolder(), 'bin');
  await mkdir(folder, { recursive: true });
  await copyFile(BIN, join(folder, 'ez'));
  await chmod(join(folder, 'ez'), 0o755);
  return { folder, ez: join(folder, 'ez') };
}

test('with no flag, installs the latest Release into its own folder', async () => {
  const { ez } = await installed();

  const update = await run(ez, ['update'], { ESBOZO_RELEASE_URL: server.url });

  assert.equal(update.code, 0, update.stderr);
  assert.match(update.stdout, /installed ez \(latest Release\)/);
  assert.deepEqual(await run(ez, []), { code: 0, stdout: 'ez 9.9.9\n', stderr: '' });
});

test('--main installs the Main build', async () => {
  const { ez } = await installed();

  const update = await run(ez, ['update', '--main'], { ESBOZO_RELEASE_URL: server.url });

  assert.equal(update.code, 0, update.stderr);
  assert.match(update.stdout, /installed ez \(Main build\)/);
  assert.deepEqual(await run(ez, []), {
    code: 0,
    stdout: 'ez 9.9.9-main+abc1234\n',
    stderr: '',
  });
});

test('--version installs that Release', async () => {
  const { ez } = await installed();

  const update = await run(ez, ['update', '--version', '1.2.3'], {
    ESBOZO_RELEASE_URL: server.url,
  });

  assert.equal(update.code, 0, update.stderr);
  assert.match(update.stdout, /installed ez \(Release v1\.2\.3\)/);
  assert.deepEqual(await run(ez, []), { code: 0, stdout: 'ez 1.2.3\n', stderr: '' });
});

test('the upgrade alias updates like update', async () => {
  const { ez } = await installed();

  const update = await run(ez, ['upgrade'], { ESBOZO_RELEASE_URL: server.url });

  assert.equal(update.code, 0, update.stderr);
  assert.match(update.stdout, /installed ez \(latest Release\)/);
  assert.deepEqual(await run(ez, []), { code: 0, stdout: 'ez 9.9.9\n', stderr: '' });
});

test('refuses bad flags before Docker or folder checks', async () => {
  const { ez } = await installed();
  const cases = [
    { args: ['--version'], says: 'a --version with no version' },
    { args: ['--version', '1.2.3/../main'], says: 'a --version that is not X.Y.Z' },
    { args: ['--dir', 'x'], says: 'a --dir, which ez update sets itself' },
    { args: ['--main', '--version', '1.2.3'], says: 'both channels at once' },
    { args: ['--upgrade'], says: 'an unknown flag' },
  ];

  for (const { args, says } of cases) {
    const update = await run(ez, ['update', ...args], {
      ESBOZO_DOCKER: '1',
      ESBOZO_RELEASE_URL: server.url,
    });

    assert.equal(update.code, 2, `${says}: ${update.stderr}`);
    assert.match(update.stderr, /usage: ez update/, says);
    assert.equal(update.stdout, '', says);
  }
});

test('refuses in a clone, pointing at git pull and pnpm build instead', async () => {
  const before = await stat(BIN);
  const update = await run(BIN, ['update'], { ESBOZO_RELEASE_URL: UNREACHABLE_RELEASE_URL });

  assert.notEqual(update.code, 0);
  assert.match(update.stderr, /clone/);
  assert.match(update.stderr, /git pull && pnpm build/);
  assert.equal((await stat(BIN)).size, before.size, 'dist/ez was not replaced');
});

test('updates a folder that is no dist, even beside an esbozo go.mod', async () => {
  const { folder, ez } = await installed();
  await writeFile(join(dirname(folder), 'go.mod'), 'module esbozo\n', 'utf8');

  const update = await run(ez, ['update'], {
    ESBOZO_RELEASE_URL: server.url,
  });

  assert.equal(update.code, 0, update.stderr);
  assert.match(update.stdout, /installed ez \(latest Release\)/);
  assert.deepEqual(await run(ez, []), { code: 0, stdout: 'ez 9.9.9\n', stderr: '' });
});

test('refuses in Docker, printing the docker pull line for the channel asked for', async () => {
  const cases = [
    { args: [] as string[], tag: 'latest' },
    { args: ['--main'], tag: 'main' },
    { args: ['--version', '1.2.3'], tag: '1.2.3' },
  ];

  for (const { args, tag } of cases) {
    const { ez } = await installed();
    const before = await stat(ez);

    const update = await run(ez, ['update', ...args], {
      ESBOZO_DOCKER: '1',
      ESBOZO_RELEASE_URL: server.url,
    });

    assert.notEqual(update.code, 0);
    assert.match(update.stderr, new RegExp(`docker pull ghcr\\.io/vieitesss/esbozo:${tag}`));
    assert.equal(update.stdout, '', 'nothing was printed as installed');
    assert.equal((await stat(ez)).ino, before.ino, 'ez was not replaced');
  }
});

test('refuses in a folder it cannot write to, pointing at the one-liner with --dir', async (t) => {
  const { folder, ez } = await installed();
  await chmod(folder, 0o555);
  t.after(() => chmod(folder, 0o755));
  if (process.getuid?.() === 0) {
    t.skip('root writes into a folder nothing may write to');
    return;
  }

  const update = await run(ez, ['update'], { ESBOZO_RELEASE_URL: server.url });

  assert.notEqual(update.code, 0);
  assert.ok(update.stderr.includes(folder), update.stderr);
  assert.match(update.stderr, /--dir/);
});
