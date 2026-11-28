/**
 * CLI seam: `ez --help` restates the exit codes `src/exit.ts` owns, and the
 * anchor and snap help restate the place words `src/ends.ts` owns.
 */
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { ez, tempFolder } from './cli.ts';
import { loadProjectModules } from './modules.ts';
import type { ProjectModules } from './modules.ts';

let M: ProjectModules;

before(async () => {
  M = await loadProjectModules();
});

test('ez --help names every exit code src/exit.ts knows, plus update’s 1', async () => {
  const folder = await tempFolder();
  const help = await ez(['--help'], folder);

  assert.equal(help.code, 0, help.stderr);
  for (const code of new Set([...Object.values(M.EXIT), 1])) {
    assert.match(help.stdout, new RegExp(`^  ${code}  \\S`, 'm'), `missing exit code ${code}`);
  }
});

test('ez anchor --help lists exactly the place words src/ends.ts knows, and ez snap --help lists none', async () => {
  const folder = await tempFolder();
  const anchor = await ez(['anchor', '--help'], folder);
  const snap = await ez(['snap', '--help'], folder);

  assert.equal(anchor.code, 0, anchor.stderr);
  assert.equal(snap.code, 0, snap.stderr);
  const placeRow = /^ {2}<place> {2}(.+?), a pair of fractions/m.exec(anchor.stdout);
  assert.ok(placeRow !== null, 'anchor --help has no <place> row');
  assert.equal(placeRow[1], M.PLACE_WORDS.join(', '));
  for (const word of M.PLACE_WORDS) {
    assert.doesNotMatch(snap.stdout, new RegExp(`\\b${word}\\b`), `snap --help names ${word}`);
  }
});
