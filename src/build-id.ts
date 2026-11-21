/**
 * Which build this is: the commit the code was built from, and when, so a
 * server someone finds running can say whether it is the one they just started.
 *
 * `scripts/build.mjs` stamps both into the bundled CLI with esbuild's `define`,
 * and only there: a run from source has no stamp, so it answers `dev` and dates
 * nothing. The same source renders the same SVG whether or not it is stamped.
 */
declare const STAMPED_BUILD: string;
declare const STAMPED_BUILT_AT: string;

/** The build: `<sha>`, `<sha>-dirty` or `unknown` from the build; `dev` from source. */
export const BUILD: string = typeof STAMPED_BUILD === 'string' ? STAMPED_BUILD : 'dev';

/**
 * When the build was made, ISO-8601 UTC to the second, or `null` from source:
 * a run from source is no build, so it has no time to report.
 */
export const BUILT_AT: string | null =
  typeof STAMPED_BUILT_AT === 'string' ? STAMPED_BUILT_AT : null;

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

/**
 * The time a build stamps: the moment it ran, in ISO-8601 UTC, to the second.
 * A build is dated by the second it finished, and milliseconds would make two
 * builds of one commit look further apart than the id alone already shows.
 */
export function buildTime(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
