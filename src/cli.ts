/**
 * The `ez` command line. Only `ez render <scene>` is wired up for now.
 */
const USAGE = 'usage: ez render <scene>';

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 0) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
