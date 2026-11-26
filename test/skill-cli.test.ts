/**
 * CLI seam: `ez skill` and `ez skill install` in temporary folders.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  assert.match(run.stdout, /usage: ez skill/);
});
