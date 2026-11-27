/**
 * Script seam: `scripts/install.sh` against a local fake release.
 *
 * The script is run as a person runs it — `sh scripts/install.sh` with the flags
 * and the environment `ez update` would pass — and what is asserted is what they
 * would see: the exit code, the two streams, the `ez` that ends up in the folder
 * and whether running it prints what the release shipped. The release itself is
 * a folder of bytes served over HTTP on the port the operating system picks, so
 * no test reaches GitHub.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { arch, platform } from 'node:process';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { removeTempFolders, tempFolder } from './temp.ts';

const INSTALL = fileURLToPath(new URL('../scripts/install.sh', import.meta.url));

/** The asset the script asks for on this machine. */
const OS = platform === 'darwin' ? 'darwin' : 'linux';
const ARCH = arch === 'x64' ? 'x64' : 'arm64';
const ASSET = `ez-${OS}-${ARCH}.gz`;

/** A tiny shell script standing in for `ez`: running it says which release it is. */
const EZ = (version: string): string => `#!/bin/sh\necho "ez ${version}"\n`;

/** One release folder served to the script: a `SHA256SUMS` and the asset. */
function release(version: string, options: { sums?: string } = {}): Map<string, Buffer> {
  const body = gzipSync(EZ(version));
  const digest = options.sums ?? createHash('sha256').update(body).digest('hex');
  return new Map([
    ['SHA256SUMS', Buffer.from(`${digest}  ${ASSET}\n`)],
    [ASSET, body],
  ]);
}

/** Every folder the run can ask for: latest, the Main build, and two Releases. */
const RELEASES = new Map<string, Map<string, Buffer>>([
  ['/latest/download', release('9.9.9')],
  ['/download/main', release('9.9.9-main+abc1234')],
  ['/download/v1.2.3', release('1.2.3')],
  ['/download/v0.0.9', release('0.0.9', { sums: '0'.repeat(64) })],
]);

/** Every file the fake release serves, by the path the script asks for. */
const FILES = new Map<string, Buffer>();
for (const [prefix, files] of RELEASES) {
  for (const [name, body] of files) {
    FILES.set(`${prefix}/${name}`, body);
  }
}

let server: Server;
let releaseUrl: string;

before(async () => {
  server = createServer((request, response) => {
    const file = FILES.get(request.url ?? '');
    if (file === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-length': file.length });
    response.end(file);
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  releaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((closed) => server.close(() => closed()));
  await removeTempFolders();
});

/** What one run of the script left: its exit code and its two streams. */
interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** `sh scripts/install.sh` with `args`, pointed at the fake release. */
function install(args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<Run> {
  const options = {
    env: { ...process.env, ESBOZO_RELEASE_URL: releaseUrl, ...env },
  };
  return new Promise((ended) => {
    execFile('sh', [INSTALL, ...args], options, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : -1;
      ended({ code, stdout, stderr });
    });
  });
}

/** What running one installed `ez` prints, and what it exits with. */
function runInstalled(file: string): Promise<Run> {
  return new Promise((ended) => {
    execFile(file, [], (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : -1;
      ended({ code, stdout, stderr });
    });
  });
}

test('when no flag is given, installs the latest Release with an esbozo symlink beside ez', async () => {
  const folder = await tempFolder();
  const bin = join(folder, 'bin');

  const run = await install(['--dir', bin], { ESBOZO_INSTALL_DIR: join(folder, 'elsewhere') });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(await readFile(join(bin, 'ez'), 'utf8'), EZ('9.9.9'));
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

  const on = await install(['--dir', bin], { PATH: `${bin}:${process.env.PATH}` });
  assert.equal(on.code, 0, on.stderr);
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

test('refuses --main with --version, naming both', async () => {
  const bin = join(await tempFolder(), 'bin');

  const run = await install(['--dir', bin, '--main', '--version', '1.2.3']);

  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /--main and --version cannot be combined/);
  assert.equal(await stat(join(bin, 'ez')).catch(() => null), null, 'nothing is installed');
});

test('refuses an unknown flag, naming it', async () => {
  const bin = join(await tempFolder(), 'bin');

  const run = await install(['--dir', bin, '--nope']);

  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /--nope/);
  assert.equal(await stat(join(bin, 'ez')).catch(() => null), null, 'nothing is installed');
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
  await writeFile(installed, EZ('0.0.0'));
  await chmod(installed, 0o755);

  const run = await install(['--dir', bin, '--version', '0.0.9']);

  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /checksum mismatch/);
  assert.equal(await readFile(installed, 'utf8'), EZ('0.0.0'));
  assert.deepEqual(await runInstalled(installed), { code: 0, stdout: 'ez 0.0.0\n', stderr: '' });
});
