/**
 * The one thing a rebase must never do to this branch: fold several commits into
 * one.
 *
 * Git hands a `post-rewrite` hook one line per rewritten commit — `old new`, on
 * stdin — and the reason it ran as the first argument (`rebase` or `amend`). A
 * plain rebase maps each old commit to a commit of its own; a `squash`, `fixup`
 * or `--squash` todo entry maps several old commits onto the same new one, and
 * the per-commit history a green-each-step branch is built from is gone.
 *
 * A hook cannot undo the rewrite it is told about, so the loud part is the exit
 * code every tool in the chain sees, the commits named, and the reflog entry to
 * restore them from.
 *
 * Usage: `.githooks/post-rewrite` runs `node scripts/squash-guard.mjs "$1"`.
 *        Enable both hooks once per clone: `git config core.hooksPath .githooks`.
 */
import { readFileSync } from 'node:fs';

/** The short object name a person recognises in git's own output. */
const SHORT = 7;

const action = process.argv[2] ?? 'rebase';
if (action === 'rebase') judge(readFileSync(0, 'utf8'));

/** Fails when any new commit received more than one old commit. */
function judge(pairs) {
  const olds = new Map();
  for (const line of pairs.split('\n')) {
    const [old, rewritten] = line.trim().split(/\s+/);
    if (old === undefined || rewritten === undefined) continue;
    olds.set(rewritten, [...(olds.get(rewritten) ?? []), old]);
  }

  const squashed = [...olds].filter(([, lost]) => lost.length > 1);
  if (squashed.length === 0) return;

  const lost = squashed.reduce((count, [, commits]) => count + commits.length, 0);
  const groups = squashed
    .map(([rewritten, commits]) =>
      `${commits.map((commit) => commit.slice(0, SHORT)).join(' ')} -> ${rewritten.slice(0, SHORT)}`,
    )
    .join(', ');

  process.stderr.write(
    [
      `rebase squashed ${lost} commits into ${squashed.length}: ${groups}`,
      '',
      'This branch keeps one commit per green step, so a rebase must not squash,',
      'fixup or --squash. The rewrite already happened; restore it and rebase again',
      'without a squash:',
      '',
      '  git reset --hard ORIG_HEAD',
      '  git rebase <base>',
      '',
    ].join('\n'),
  );
  process.exitCode = 1;
}
