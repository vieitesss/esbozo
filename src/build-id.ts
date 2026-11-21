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
