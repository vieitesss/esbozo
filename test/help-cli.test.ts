/**
 * CLI seam: `ez --help`, `ez help`, and per-command `--help`.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { ez, tempFolder } from './cli.ts';
import { removeTempFolders } from './temp.ts';

after(removeTempFolders);

const ESC = String.fromCharCode(0x1b);

test('ez --help and ez help show grouped commands, CSS subset, exit codes, and examples', async () => {
  const folder = await tempFolder();

  const flag = await ez(['--help'], folder);
  const sub = await ez(['help'], folder);

  assert.equal(flag.code, 0, flag.stderr);
  assert.equal(flag.stderr, '');
  assert.equal(sub.code, 0, sub.stderr);
  assert.equal(sub.stdout, flag.stdout);

  for (const heading of ['MAKE', 'CHECK', 'EDIT', 'AGENTS', 'MAINTAIN', 'CSS SUBSET', 'EXIT CODES', 'EXAMPLES']) {
    assert.match(flag.stdout, new RegExp(`^${heading}$`, 'm'), `missing heading ${heading}`);
  }
  assert.match(flag.stdout, /^  ez --version$/m, 'missing --version in USAGE');
  for (const command of ['render', 'png', 'bundle', 'check', 'anchor', 'snap', 'serve', 'skill', 'update']) {
    assert.match(flag.stdout, new RegExp(`^  ${command}\\s+\\S`, 'm'), `missing command ${command}`);
  }
  for (const code of ['0', '1', '2', '3', '4', '5', '6']) {
    assert.match(flag.stdout, new RegExp(`^  ${code}  \\S`, 'm'), `missing exit code ${code}`);
  }
  assert.match(flag.stdout, /:root` and `html` declarations are the light theme/);
  assert.equal(flag.stdout.includes(`${ESC}[`), false);
});

test('ez --help emits no ANSI when NO_COLOR is set', async () => {
  const folder = await tempFolder();
  const { code, stdout, stderr } = await ez(['--help'], folder, { NO_COLOR: '1' });

  assert.equal(code, 0, stderr);
  assert.equal(stderr, '');
  assert.equal(stdout.includes(`${ESC}[`), false);
});

test('ez <command> --help prints usage, flags/defaults, and an example with exit 0', async () => {
  const folder = await tempFolder();
  const cases: readonly {
    readonly args: string[];
    readonly expected: readonly RegExp[];
  }[] = [
    {
      args: ['render', '--help'],
      expected: [/ez render <scene> \[--font <file>\]/, /--font <file>/, /Kalam/, /^EXAMPLE$/m],
    },
    {
      args: ['png', '--help'],
      expected: [
        /ez png <scene> --theme light\|dark/,
        /--theme light\|dark/,
        /--css <stylesheet>/,
        /--ink <colour>/,
        /--paper <colour>/,
        /--muted <colour>/,
        /--font <file>/,
        /^EXAMPLE$/m,
      ],
    },
    {
      args: ['bundle', '--help'],
      expected: [/ez bundle <dir>/, /esbozo-<version>\.js/, /^EXAMPLE$/m],
    },
    {
      args: ['check', '--help'],
      expected: [
        /ez check <scene> \[--font <file>\] \[--css <stylesheet>\]/,
        /--font <file>/,
        /--css <stylesheet>/,
        /^EXAMPLE$/m,
      ],
    },
    {
      args: ['anchor', '--help'],
      expected: [
        /ez anchor <scene> <element> <start\|end> <place>/,
        /ez anchor <scene> --all/,
        /bottom-right/,
        /--all/,
        /^EXAMPLE$/m,
      ],
    },
    {
      args: ['snap', '--help'],
      expected: [/ez snap <scene> <element> <start\|end> <target\|off>/, /^EXAMPLE$/m],
    },
    {
      args: ['serve', '--help'],
      expected: [
        /ez serve <dir> \[--host 127\.0\.0\.1\] \[--port N\] \[--read-only\]/,
        /--host <host>/,
        /127\.0\.0\.1/,
        /--port <N>/,
        /4320/,
        /--read-only/,
        /^EXAMPLE$/m,
      ],
    },
    {
      args: ['skill', '--help'],
      expected: [/ez skill \[install \[--dir /, /~\/\.agents\/skills/, /^EXAMPLE$/m],
    },
    {
      args: ['skill', 'install', '--help'],
      expected: [/ez skill install \[--dir /, /--dir /, /~\/\.agents\/skills/, /^EXAMPLE$/m],
    },
    {
      args: ['update', '--help'],
      expected: [
        /ez update \[--main \| --version <X\.Y\.Z>\]/,
        /--main/,
        /--version <X\.Y\.Z>/,
        /^EXAMPLE$/m,
      ],
    },
  ];

  for (const { args, expected } of cases) {
    const res = await ez(args, folder);
    assert.equal(res.code, 0, `${args.join(' ')}: ${res.stderr}`);
    assert.equal(res.stderr, '', args.join(' '));
    assert.equal(res.stdout.includes(`${ESC}[`), false, `${args.join(' ')} emitted ANSI`);
    for (const pattern of expected) {
      assert.match(res.stdout, pattern, `${args.join(' ')} missing ${pattern}`);
    }
  }
});

test('ez help <command> prints the same help as ez <command> --help', async () => {
  const folder = await tempFolder();
  const commands: readonly (readonly string[])[] = [
    ['render'],
    ['png'],
    ['bundle'],
    ['check'],
    ['anchor'],
    ['snap'],
    ['serve'],
    ['skill'],
    ['skill', 'install'],
    ['update'],
    ['upgrade'],
  ];

  for (const command of commands) {
    const direct = await ez([...command, '--help'], folder);
    const viaHelp = await ez(['help', ...command], folder);
    const name = command.join(' ');

    assert.equal(direct.code, 0, `${name} --help: ${direct.stderr}`);
    assert.equal(viaHelp.code, 0, `help ${name}: ${viaHelp.stderr}`);
    assert.equal(viaHelp.stderr, '', `help ${name}`);
    assert.equal(viaHelp.stdout, direct.stdout, `help ${name} differs from ${name} --help`);
  }
});

test('ez help <unknown> prints the top-level help to stderr and exits 2', async () => {
  const folder = await tempFolder();
  const top = await ez(['--help'], folder);

  const res = await ez(['help', 'bogus'], folder);

  assert.equal(res.code, 2, res.stderr);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, top.stdout);
});

test('usage errors still print usage on stderr and exit 2', async () => {
  const folder = await tempFolder();
  const cases: readonly (readonly [string[], RegExp])[] = [
    [['unknown-cmd'], /^USAGE$/m],
    [['render'], /^usage: ez render <scene>/],
    [['png'], /^usage: ez png <scene>/],
    [['bundle'], /^usage: ez bundle <dir>/],
    [['check'], /^usage: ez check <scene>/],
    [['anchor'], /^usage: ez anchor <scene>/],
    [['snap'], /^usage: ez snap <scene>/],
    [['serve'], /^usage: ez serve <dir>/],
    [['skill', 'bogus'], /^usage: ez skill \[install \[--dir /m],
    [['update', '--bogus'], /^usage: ez update \[--main \| --version <X\.Y\.Z>\]/],
  ];

  for (const [args, pattern] of cases) {
    const res = await ez(args, folder);
    assert.equal(res.code, 2, `${args.join(' ')}: ${res.stderr}`);
    assert.equal(res.stdout, '', args.join(' '));
    assert.match(res.stderr, pattern, args.join(' '));
    assert.equal(res.stderr.includes(`${ESC}[`), false, `${args.join(' ')} stderr emitted ANSI`);
  }
});
