/**
 * git's answer to one command, or `null` when git is missing or this is no
 * checkout: a build then names itself `unknown` instead of failing, because a
 * tarball of the sources still has to build.
 *
 * `scripts/build.mjs` stamps the CLI's build id with it, and
 * `scripts/version-stamp.mjs` names the commit `ez --version` prints.
 */
import { execFileSync } from 'node:child_process';

export function gitAnswer(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}
