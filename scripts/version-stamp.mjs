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
  const commit = gitAnswer(['rev-parse', '--short', 'HEAD'])?.trim();
  return `${release}-main+${commit === undefined || commit === '' ? 'unknown' : commit}`;
}
