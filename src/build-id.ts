/**
 * Which build this is: the commit the code was built from, so a server someone
 * finds running can say whether it is the one they just started.
 *
 * `scripts/build.mjs` stamps the id into the bundled CLI with esbuild's
 * `define`, and only there: a run from source has no stamp, so it answers
 * `dev`. The same source renders the same SVG whether or not it is stamped.
 */
declare const STAMPED_BUILD: string;

/** The build: `<sha>`, `<sha>-dirty` or `unknown` from the build; `dev` from source. */
export const BUILD: string = typeof STAMPED_BUILD === 'string' ? STAMPED_BUILD : 'dev';

/** A git command's answer: its standard output, or `null` when git could not answer. */
type GitAnswer = (args: readonly string[]) => string | null;

/**
 * The id a build stamps, read from git: the short commit it names, `-dirty`
 * when the tree had changes, and `unknown` when git cannot answer — no checkout,
 * or no git at all — because a checkout nobody can date is still buildable.
 */
export function buildId(git: GitAnswer): string {
  const commit = git(['rev-parse', '--short', 'HEAD'])?.trim() ?? '';
  if (commit === '') {
    return 'unknown';
  }
  const changes = git(['status', '--porcelain']);
  if (changes === null) {
    return 'unknown';
  }
  return changes.trim() === '' ? commit : `${commit}-dirty`;
}
