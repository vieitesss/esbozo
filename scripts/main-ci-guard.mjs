/**
 * Refuses pushing `refs/heads/main` when any merge commit in the pushed range
 * has a second parent (`M^2`, the merged branch head) without a completed,
 * successful `check` workflow run on GitHub Actions.
 *
 * Git invokes a `pre-push` hook with `<remote> <url>` and feeds one line per
 * ref update on stdin: `<local-ref> <local-oid> <remote-ref> <remote-oid>`.
 * Pushes to any ref other than `refs/heads/main` (feature branches, deletions)
 * pass immediately without calling `gh`.
 *
 * Usage: `.githooks/pre-push` runs `node scripts/main-ci-guard.mjs "$@"`.
 *        Enable hooks once per clone: `git config core.hooksPath .githooks`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SHORT = 7;
const MAIN_REF = 'refs/heads/main';

judge(readFileSync(0, 'utf8'));

function isZeroOid(oid) {
  return /^0+$/.test(oid);
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function queryCheckRuns(commit) {
  const result = spawnSync(
    'gh',
    ['run', 'list', '--commit', commit, '--workflow', 'check', '--json', 'conclusion,status'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'gh exited non-zero').trim();
    return { ok: false, summary: `gh run list failed: ${detail}` };
  }

  let runs;
  try {
    runs = JSON.parse(result.stdout);
  } catch {
    return { ok: false, summary: `unexpected gh output: ${result.stdout.trim()}` };
  }

  if (!Array.isArray(runs)) {
    return { ok: false, summary: `unexpected gh output: ${result.stdout.trim()}` };
  }

  const hasGreen = runs.some((run) => run.status === 'completed' && run.conclusion === 'success');
  if (hasGreen) return { ok: true, summary: '' };

  const summary =
    runs.length === 0
      ? 'no runs found'
      : runs.map((run) => `status=${run.status ?? 'unknown'} conclusion=${run.conclusion ?? 'none'}`).join(', ');
  return { ok: false, summary };
}

function judge(stdin) {
  const failures = [];

  for (const line of stdin.split('\n')) {
    const [localRef, localOid, remoteRef, remoteOid] = line.trim().split(/\s+/);
    if (!localRef || !localOid || !remoteRef || !remoteOid) continue;
    if (remoteRef !== MAIN_REF || isZeroOid(localOid)) continue;

    const range = isZeroOid(remoteOid) ? localOid : `${remoteOid}..${localOid}`;
    const mergesOutput = git(['rev-list', '--merges', range]);
    if (!mergesOutput) continue;

    for (const mergeCommit of mergesOutput.split('\n')) {
      if (!mergeCommit) continue;
      const branchHead = git(['rev-parse', `${mergeCommit}^2`]);
      const check = queryCheckRuns(branchHead);
      if (!check.ok) {
        failures.push(
          `main-ci-guard: refusing push to main: merge ${mergeCommit.slice(0, SHORT)} merged commit ${branchHead.slice(0, SHORT)} (${branchHead}) has no successful check workflow run (${check.summary})`,
        );
      }
    }
  }

  if (failures.length === 0) return;

  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
}
