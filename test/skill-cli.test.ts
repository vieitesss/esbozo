/**
 * CLI seam: `ez skill` and `ez skill install` in temporary folders.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { ez, tempFolder } from './cli.ts';
import { removeTempFolders } from './temp.ts';

after(removeTempFolders);

const SHIPPED_SKILL = fileURLToPath(new URL('../skills/esbozo/SKILL.md', import.meta.url));

test('ez skill prints the shipped SKILL.md to stdout', async () => {
  const folder = await tempFolder();
  const expected = await readFile(SHIPPED_SKILL, 'utf8');

  const run = await ez(['skill'], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, expected);
});

test('ez --help names the skill command', async () => {
  const folder = await tempFolder();

  const run = await ez(['--help'], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /^  skill\s+\S/m);
});

test('ez skill install --dir copies SKILL.md into a missing folder and prints the path', async () => {
  const folder = await tempFolder();
  const targetDir = join(folder, 'custom', 'skills');
  const expected = await readFile(SHIPPED_SKILL, 'utf8');

  const run = await ez(['skill', 'install', '--dir', targetDir], folder);

  const writtenPath = join(targetDir, 'esbozo', 'SKILL.md');
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, `${writtenPath}\n`);
  assert.equal(await readFile(writtenPath, 'utf8'), expected);
});

test('ez skill install overwrites only esbozo/SKILL.md and leaves other skills untouched', async () => {
  const folder = await tempFolder();
  const esbozoFile = join(folder, 'esbozo', 'SKILL.md');
  const siblingFile = join(folder, 'other', 'SKILL.md');
  await mkdir(join(folder, 'esbozo'), { recursive: true });
  await mkdir(join(folder, 'other'), { recursive: true });
  await writeFile(esbozoFile, 'old content\n', 'utf8');
  await writeFile(siblingFile, 'keep me\n', 'utf8');
  const expected = await readFile(SHIPPED_SKILL, 'utf8');

  const run = await ez(['skill', 'install', '--dir', folder], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, `${esbozoFile}\n`);
  assert.equal(await readFile(esbozoFile, 'utf8'), expected);
  assert.equal(await readFile(siblingFile, 'utf8'), 'keep me\n');
});

test('ez skill rejects bad flags and arguments with exit 2 and usage', async () => {
  const folder = await tempFolder();
  const cases: string[][] = [
    ['skill', 'remove'],
    ['skill', '--dir', folder],
    ['skill', 'install', `--dir=${folder}`],
    ['skill', 'install', '--dir'],
    ['skill', 'install', '--dir', ''],
    ['skill', 'install', '--dir', '--other'],
    ['skill', 'install', '--unknown', folder],
    ['skill', 'install', '--dir', folder, 'extra'],
  ];

  for (const args of cases) {
    const run = await ez(args, folder);
    assert.equal(run.code, 2, `${args.join(' ')}: ${run.stderr}`);
    assert.equal(run.stderr, 'usage: ez skill [install [--dir <path>]]\n', args.join(' '));
  }
});
