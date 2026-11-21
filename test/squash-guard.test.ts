/**
 * Seam 3: `scripts/squash-guard.mjs` on the pairs git hands a `post-rewrite`
 * hook.
 *
 * A rebase failed this way once already: the whole branch arrived as one commit,
 * and every green step in between was gone. So what is asserted is the script's
 * whole behaviour — what it prints on stdin it is given, and the exit code the
 * hook fails with.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../scripts/squash-guard.mjs', import.meta.url));

/** Three commits, as the full object names git prints in a rewrite's pairs. */
const FIRST = '1'.repeat(40);
const SECOND = '2'.repeat(40);
const THIRD = '3'.repeat(40);

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The script as `post-rewrite` runs it: the reason first, the pairs on stdin. */
function guard(action: string, input: string): Run {
  const result = spawnSync(process.execPath, [SCRIPT, action], { input, encoding: 'utf8' });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

test('a rebase that folds two commits into one is refused, and names what it lost', () => {
  const run = guard('rebase', `${FIRST} ${THIRD}\n${SECOND} ${THIRD}\n`);

  assert.equal(run.code, 1, 'the squash is reported, not passed');
  assert.equal(run.stdout, '', 'nothing is printed on the stream a person may pipe');
  assert.match(
    run.stderr,
    /^rebase squashed 2 commits into 1: 1111111 2222222 -> 3333333$/m,
    'the commits are named, old ones whole, the one they became short',
  );
  assert.match(run.stderr, /git reflog/, 'the message points at the log that holds the prior tip');
  assert.match(
    run.stderr,
    /git reset --hard <that tip>/,
    'and says to reset to the tip a person found there, not to a name git guessed',
  );
  assert.doesNotMatch(
    run.stderr,
    /ORIG_HEAD/,
    'ORIG_HEAD is the rewritten commit after a rebase, so it is never the one to go back to',
  );
});

test('a rebase that keeps every commit says nothing', () => {
  const run = guard('rebase', `${FIRST} ${FIRST}\n${SECOND} ${SECOND}\n`);

  assert.deepEqual(run, { code: 0, stdout: '', stderr: '' });
});

test('an amend is not a rebase, so the guard stays quiet on one', () => {
  const run = guard('amend', `${FIRST} ${THIRD}\n${SECOND} ${THIRD}\n`);

  assert.deepEqual(run, { code: 0, stdout: '', stderr: '' });
});

test('a rebase that dropped every commit has no pairs to judge', () => {
  const run = guard('rebase', '');

  assert.deepEqual(run, { code: 0, stdout: '', stderr: '' });
});
