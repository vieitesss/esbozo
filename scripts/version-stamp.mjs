/**
 * The stamp `ez --version` prints, written where the build names it:
 * `package.json`'s version for a Release, and `<version>-main+<short sha of HEAD>`
 * for every build this build made itself, so a binary built anywhere but release
 * CI says it is a Main build. Release CI sets `ESBOZO_RELEASE=1`.
 *
 * `scripts/build.mjs` writes `dist/version` with it, which `assets.go` embeds in
 * the binary, and `test/version.test.ts` writes one elsewhere to hold a Release
 * to the version alone without building the binary again.
 *
 * Usage: node scripts/version-stamp.mjs <outfile>
 */
import { readFile, writeFile } from 'node:fs/promises';
import { gitAnswer } from './git.mjs';

const [outfile] = process.argv.slice(2);
if (outfile === undefined) {
  console.error('usage: version-stamp.mjs <outfile>');
  process.exit(2);
}

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await writeFile(outfile, `${stampOf(version)}\n`);

/** The stamp for `version`, as the Release switch and the commit decide it. */
function stampOf(release) {
  if (process.env.ESBOZO_RELEASE === '1') {
    return release;
  }
  const commit = gitAnswer(['rev-parse', '--short', 'HEAD'])?.trim();
  return `${release}-main+${commit === undefined || commit === '' ? 'unknown' : commit}`;
}
