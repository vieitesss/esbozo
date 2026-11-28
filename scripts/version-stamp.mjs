import { readFile, writeFile } from 'node:fs/promises';
import { gitAnswer } from './git.mjs';

const [outfile] = process.argv.slice(2);
if (outfile === undefined) {
  console.error('usage: version-stamp.mjs <outfile>');
  process.exit(2);
}

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await writeFile(outfile, `${stampOf(version)}\n`);

function stampOf(release) {
  if (process.env.ESBOZO_RELEASE === '1') {
    return release;
  }
  // The Docker build has no `.git` to ask — `.dockerignore` keeps it out of the
  // context — so the workflow that builds the image names the commit instead.
  // A build nobody names either way stays `unknown`.
  const commit = (
    gitAnswer(['rev-parse', '--short', 'HEAD']) ??
    process.env.ESBOZO_COMMIT ??
    ''
  ).trim();
  return `${release}-main+${commit === '' ? 'unknown' : commit}`;
}
