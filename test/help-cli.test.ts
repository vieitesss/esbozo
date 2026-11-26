/**
 * CLI seam: `ez --help`, `ez help`, and per-command `--help`.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { after, test } from 'node:test';
import { CLI, ez, tempFolder } from './cli.ts';
import { removeTempFolders } from './temp.ts';

after(removeTempFolders);

const run = promisify(execFile);
const ESC = String.fromCharCode(0x1b);

test('ez --help and ez help show grouped commands, CSS subset, exit codes, and examples', async () => {
  const folder = await tempFolder();

  const flag = await ez(['--help'], folder);
  const sub = await ez(['help'], folder);

  assert.equal(flag.code, 0, flag.stderr);
  assert.equal(flag.stderr, '');
  assert.equal(sub.code, 0, sub.stderr);
  assert.equal(sub.stdout, flag.stdout);

  for (const heading of ['MAKE', 'CHECK', 'EDIT', 'AGENTS', 'CSS SUBSET', 'EXIT CODES', 'EXAMPLES']) {
    assert.match(flag.stdout, new RegExp(`^${heading}$`, 'm'), `missing heading ${heading}`);
  }
  for (const command of ['render', 'png', 'bundle', 'check', 'anchor', 'snap', 'serve', 'skill']) {
    assert.match(flag.stdout, new RegExp(`^  ${command}\\s+\\S`, 'm'), `missing command ${command}`);
  }
  for (const code of ['0', '2', '3', '4', '5', '6']) {
    assert.match(flag.stdout, new RegExp(`^  ${code}  \\S`, 'm'), `missing exit code ${code}`);
  }
  assert.match(flag.stdout, /:root` and `html` declarations are the light theme/);
  assert.equal(flag.stdout.includes(`${ESC}[`), false);
});

test('ez --help emits no ANSI when NO_COLOR is set', async () => {
  const folder = await tempFolder();
  const { stdout, stderr } = await run(process.execPath, [CLI, '--help'], {
    cwd: folder,
    env: { ...process.env, NO_COLOR: '1' },
  });

  assert.equal(stderr, '');
  assert.equal(stdout.includes(`${ESC}[`), false);
});
