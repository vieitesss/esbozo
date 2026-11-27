/** Script seam: `scripts/install.sh` against a local fake release. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Run } from './cli.ts';
import { fakeEz, release, run, startRelease, type FakeRelease } from './release.ts';
import { removeTempFolders, tempFolder } from './temp.ts';

const INSTALL = fileURLToPath(new URL('../scripts/install.sh', import.meta.url));

const SHELLS =
  spawnSync('sh', ['-c', 'command -v dash'], { stdio: 'ignore' }).status === 0
    ? ['sh', 'dash']
    : ['sh'];

let server: FakeRelease;

before(async () => {
  server = await startRelease();
});

after(async () => {
  await server.close();
  await removeTempFolders();
});

function install(
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
  shell = 'sh',
): Promise<Run> {
  return run(shell, [INSTALL, ...args], { ESBOZO_RELEASE_URL: server.url, ...env });
}

async function unreachable(): Promise<string> {
  const gone = await startRelease();
  await gone.close();
  return gone.url;
}

function runInstalled(file: string): Promise<Run> {
  return run(file, []);
}

test('when no flag is given, installs the latest Release with an esbozo symlink beside ez', async () => {
  const folder = await tempFolder();
  const bin = join(folder, 'bin');

  const run = await install(['--dir', bin], { ESBOZO_INSTALL_DIR: join(folder, 'elsewhere') });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(await readFile(join(bin, 'ez'), 'utf8'), fakeEz('9.9.9'));
  assert.deepEqual(await runInstalled(join(bin, 'ez')), { code: 0, stdout: 'ez 9.9.9\n', stderr: '' });
  assert.deepEqual(await runInstalled(join(bin, 'esbozo')), {
    code: 0,
    stdout: 'ez 9.9.9\n',
    stderr: '',
  });
  assert.equal(await stat(join(folder, 'elsewhere')).catch(() => null), null, '--dir wins');
});

test('when the folder is not on PATH, prints the line that adds it', async () => {
  const bin = join(await tempFolder(), 'bin');
  const off = await install(['--dir', bin]);
  assert.equal(off.code, 0, off.stderr);
  assert.ok(off.stdout.includes(`export PATH="${bin}:$PATH"`), off.stdout);

  const onBin = join(await tempFolder(), 'bin-on');
  const on = await install(['--dir', onBin], { PATH: `${onBin}:${process.env.PATH}` });
  assert.equal(on.code, 0, on.stderr);
  assert.match(on.stdout, /installed ez/, 'the PATH check was reached');
  assert.ok(!on.stdout.includes('export PATH='), on.stdout);
});

test('--main installs the Main build', async () => {
  const bin = join(await tempFolder(), 'bin');

  const run = await install(['--dir', bin, '--main']);

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(await runInstalled(join(bin, 'ez')), {
    code: 0,
    stdout: 'ez 9.9.9-main+abc1234\n',
    stderr: '',
  });
});

test('--version installs that Release', async () => {
  const bin = join(await tempFolder(), 'bin');

  const run = await install(['--dir', bin, '--version', '1.2.3']);

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(await runInstalled(join(bin, 'ez')), { code: 0, stdout: 'ez 1.2.3\n', stderr: '' });
});

test('reads a SHA256SUMS written in binary mode or with CRLF endings', async () => {
  const odd = await startRelease(
    new Map([
      [
        '/download/v1.0.1',
        release(Buffer.from(fakeEz('1.0.1')), { line: (digest, asset) => `${digest} *${asset}\n` }),
      ],
      [
        '/download/v1.0.2',
        release(Buffer.from(fakeEz('1.0.2')), { line: (digest, asset) => `${digest}  ${asset}\r\n` }),
      ],
    ]),
  );

  try {
    for (const shell of SHELLS) {
      for (const version of ['1.0.1', '1.0.2']) {
        const bin = join(await tempFolder(), 'bin');

        const run = await install(
          ['--dir', bin, '--version', version],
          { ESBOZO_RELEASE_URL: odd.url },
          shell,
        );

        assert.equal(run.code, 0, `${version}: ${run.stderr}`);
        assert.deepEqual(await runInstalled(join(bin, 'ez')), {
          code: 0,
          stdout: `ez ${version}\n`,
          stderr: '',
        });
      }
    }
  } finally {
    await odd.close();
  }
});

test('refuses --main with --version, naming both', async () => {
  const bin = join(await tempFolder(), 'bin');

  const run = await install(['--dir', bin, '--main', '--version', '1.2.3']);

  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /--main and --version cannot be combined/);
  assert.equal(await stat(join(bin, 'ez')).catch(() => null), null, 'nothing is installed');
});

test('refuses a --version that is not three dot-separated runs of digits', async () => {
  for (const shell of SHELLS) {
    for (const version of ['1.2.3/../main', '1a.2b.3c', '1.2', '1.2.3.4']) {
      const bin = join(await tempFolder(), 'bin');

      const run = await install(['--dir', bin, '--version', version], {}, shell);

      assert.equal(run.code, 2, `${version}: ${run.stderr}`);
      assert.match(run.stderr, /usage: install\.sh/, version);
      assert.equal(await stat(join(bin, 'ez')).catch(() => null), null, `${version} installed`);
    }
  }
});

test('refuses an unknown flag, naming it', async () => {
  const bin = join(await tempFolder(), 'bin');

  const run = await install(['--dir', bin, '--nope']);

  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /--nope/);
  assert.equal(await stat(join(bin, 'ez')).catch(() => null), null, 'nothing is installed');
});

test('refuses when ez is a folder, or a symlink to one, naming it', async () => {
  const bin = join(await tempFolder(), 'bin');
  await mkdir(join(bin, 'ez'), { recursive: true });
  await mkdir(join(bin, 'other'), { recursive: true });
  const dead = await unreachable();

  for (const shell of SHELLS) {
    const run = await install(['--dir', bin], { ESBOZO_RELEASE_URL: dead }, shell);

    assert.equal(run.code, 1, run.stderr);
    assert.ok(run.stderr.includes(join(bin, 'ez')), run.stderr);
    assert.equal(run.stdout, '', 'nothing is printed as installed');
    assert.deepEqual(await readdir(join(bin, 'ez')), [], 'the folder is left untouched');
  }

  await rm(join(bin, 'ez'), { recursive: true });
  await symlink('other', join(bin, 'ez'));

  const linked = await install(['--dir', bin], { ESBOZO_RELEASE_URL: dead });

  assert.equal(linked.code, 1, linked.stderr);
  assert.ok(linked.stderr.includes(join(bin, 'ez')), linked.stderr);
  assert.deepEqual(await readdir(join(bin, 'other')), [], 'the folder is left untouched');
});

test('refuses an esbozo that is not a symlink, and replaces one that is', async () => {
  const bin = join(await tempFolder(), 'bin');
  await mkdir(join(bin, 'esbozo'), { recursive: true });
  const dead = await unreachable();

  for (const shell of SHELLS) {
    const run = await install(['--dir', bin], { ESBOZO_RELEASE_URL: dead }, shell);

    assert.equal(run.code, 1, run.stderr);
    assert.ok(run.stderr.includes(join(bin, 'esbozo')), run.stderr);
    assert.equal(run.stdout, '', 'nothing is printed as installed');
    assert.deepEqual(await readdir(join(bin, 'esbozo')), [], 'the folder is left untouched');
    assert.equal(await stat(join(bin, 'ez')).catch(() => null), null, 'nothing is installed');
  }

  await rm(join(bin, 'esbozo'), { recursive: true });
  await symlink('gone', join(bin, 'esbozo'));

  const run = await install(['--dir', bin]);

  assert.equal(run.code, 0, run.stderr);
  assert.equal((await lstat(join(bin, 'esbozo'))).isSymbolicLink(), true, 'still a symlink');
  assert.deepEqual(await runInstalled(join(bin, 'esbozo')), {
    code: 0,
    stdout: 'ez 9.9.9\n',
    stderr: '',
  });
});

test('when the target is already installed, says so and leaves it alone', async () => {
  const bin = join(await tempFolder(), 'bin');
  assert.equal((await install(['--dir', bin])).code, 0);
  const before = await stat(join(bin, 'ez'));

  const again = await install(['--dir', bin]);

  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /already installed/);
  assert.equal((await stat(join(bin, 'ez'))).ino, before.ino, 'ez was not replaced');
});

test('when the checksum does not match, refuses and leaves the existing install untouched', async () => {
  const bin = join(await tempFolder(), 'bin');
  const installed = join(bin, 'ez');
  await mkdir(bin, { recursive: true });
  await writeFile(installed, fakeEz('0.0.0'));
  await chmod(installed, 0o755);

  const run = await install(['--dir', bin, '--version', '0.0.9']);

  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /checksum mismatch/);
  assert.equal(await readFile(installed, 'utf8'), fakeEz('0.0.0'));
  assert.deepEqual(await runInstalled(installed), { code: 0, stdout: 'ez 0.0.0\n', stderr: '' });
});
