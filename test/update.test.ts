/**
 * Script seam: `ez update` re-running the install script the binary carries.
 *
 * `ez update` is the Go binary's alone — the TS CLI never grows the command — so
 * these cases run `dist/ez` itself, not the `EZ_BIN` seam. Every case but the
 * clone runs a copy of the binary in a folder of its own, as an installed `ez`
 * is: `update` sets the script's `--dir` to the folder the binary runs from, so
 * what it installs lands beside the copy and what the test then runs is what the
 * release shipped. The releases are `test/release.ts`'s, the same ones
 * `test/install.test.ts` serves, and the assertions are what a person sees: the
 * exit code, the two streams, and the `ez` left in the folder.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { release, startRelease, type FakeRelease } from './release.ts';
import { removeTempFolders, tempFolder } from './temp.ts';

/** The built binary, as `pnpm build` leaves it: the clone's own `dist/ez`. */
const BIN = fileURLToPath(new URL('../dist/ez', import.meta.url));

let server: FakeRelease;
let releaseUrl: string;

before(async () => {
  // A Release of this very build: updating to it finds the bytes already in
  // place, which is what "already on the target" means to the script.
  server = await startRelease(new Map([['/download/v2.0.0', release(await readFile(BIN))]]));
  releaseUrl = server.url;
});

after(async () => {
  await server.close();
  await removeTempFolders();
});

/** What one run left: its exit code and its two streams. */
interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** One command run with `env` on top of this process's own. */
function run(file: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<Run> {
  return new Promise((ended) => {
    execFile(file, [...args], { env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : -1;
      ended({ code, stdout, stderr });
    });
  });
}

/** A copy of `dist/ez` in a folder of its own, as an installed `ez` sits. */
async function installed(): Promise<{ folder: string; ez: string }> {
  const folder = join(await tempFolder(), 'bin');
  await mkdir(folder, { recursive: true });
  await copyFile(BIN, join(folder, 'ez'));
  await chmod(join(folder, 'ez'), 0o755);
  return { folder, ez: join(folder, 'ez') };
}

test('with no flag, installs the latest Release into its own folder', async () => {
  const { ez } = await installed();

  const update = await run(ez, ['update'], { ESBOZO_RELEASE_URL: releaseUrl });

  assert.equal(update.code, 0, update.stderr);
  assert.match(update.stdout, /installed ez \(latest Release\)/);
  assert.deepEqual(await run(ez, []), { code: 0, stdout: 'ez 9.9.9\n', stderr: '' });
});

test('--main installs the Main build', async () => {
  const { ez } = await installed();

  const update = await run(ez, ['update', '--main'], { ESBOZO_RELEASE_URL: releaseUrl });

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
    ESBOZO_RELEASE_URL: releaseUrl,
  });

  assert.equal(update.code, 0, update.stderr);
  assert.match(update.stdout, /installed ez \(Release v1\.2\.3\)/);
  assert.deepEqual(await run(ez, []), { code: 0, stdout: 'ez 1.2.3\n', stderr: '' });
});

test('when the folder already holds the target, says so and leaves it alone', async () => {
  const { ez } = await installed();
  const before = await stat(ez);

  const update = await run(ez, ['update', '--version', '2.0.0'], {
    ESBOZO_RELEASE_URL: releaseUrl,
  });

  assert.equal(update.code, 0, update.stderr);
  assert.match(update.stdout, /already installed/);
  assert.equal((await stat(ez)).ino, before.ino, 'ez was not replaced');
});

test('the upgrade alias updates like update', async () => {
  const { ez } = await installed();

  const update = await run(ez, ['upgrade'], { ESBOZO_RELEASE_URL: releaseUrl });

  assert.equal(update.code, 0, update.stderr);
  assert.match(update.stdout, /installed ez \(latest Release\)/);
  assert.deepEqual(await run(ez, []), { code: 0, stdout: 'ez 9.9.9\n', stderr: '' });
});

test('refuses the flags it cannot read itself, before any refusal of the folder', async () => {
  const { ez } = await installed();
  const cases = [
    { args: ['--version'], says: 'a --version with no version' },
    { args: ['--version', '1.2.3/../main'], says: 'a --version that is not X.Y.Z' },
    { args: ['--dir', 'x'], says: 'a --dir, which ez update sets itself' },
    { args: ['--main', '--version', '1.2.3'], says: 'both channels at once' },
    { args: ['--upgrade'], says: 'an unknown flag' },
  ];

  for (const { args, says } of cases) {
    // Docker is where a refusal would print first if the flags were read after it.
    const update = await run(ez, ['update', ...args], {
      ESBOZO_DOCKER: '1',
      ESBOZO_RELEASE_URL: releaseUrl,
    });

    assert.equal(update.code, 2, `${says}: ${update.stderr}`);
    assert.match(update.stderr, /usage: ez update/, says);
    assert.equal(update.stdout, '', says);
  }
});

test('refuses in a clone, pointing at git pull and pnpm build instead', async () => {
  const before = await stat(BIN);
  // Nothing to download, so a refusal that leaked would fail on the fetch rather
  // than replace the binary this checkout builds.
  const update = await run(BIN, ['update'], { ESBOZO_RELEASE_URL: 'http://127.0.0.1:1' });

  assert.notEqual(update.code, 0);
  assert.match(update.stderr, /clone/);
  assert.match(update.stderr, /git pull && pnpm build/);
  assert.equal((await stat(BIN)).size, before.size, 'dist/ez was not replaced');
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
      ESBOZO_RELEASE_URL: releaseUrl,
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

  const update = await run(ez, ['update'], { ESBOZO_RELEASE_URL: releaseUrl });

  assert.notEqual(update.code, 0);
  assert.ok(update.stderr.includes(folder), update.stderr);
  assert.match(update.stderr, /--dir/);
});
