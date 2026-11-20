/**
 * The `ez` command line.
 *
 * Surface: `ez render <scene>` reads a Scene, writes `<name>.svg` beside it and
 * prints that path on stdout.
 *
 * Exit codes:
 *   0  the Scene rendered
 *   2  wrong arguments (unknown command, missing or extra arguments)
 *   3  the Scene could not be read or parsed
 *   4  the SVG could not be written
 *
 * The codes live in one place, `EXIT`, so a caller can tell a bad Scene from a
 * failed write.
 *
 * Problems are plain text, one per line, on stderr, and name the Element they
 * belong to: `a: width must be at least 1 pixel, got 0`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseScene } from './scene.js';
import { renderScene } from './renderer.js';

const EXIT = {
  ok: 0,
  usage: 2,
  invalidScene: 3,
  writeFailed: 4,
} as const;

const USAGE = 'usage: ez render <scene>';

export async function main(argv: readonly string[]): Promise<number> {
  const [command, scenePath, ...extra] = argv;
  if (command !== 'render' || scenePath === undefined || scenePath === '' || extra.length > 0) {
    process.stderr.write(`${USAGE}\n`);
    return EXIT.usage;
  }

  let source: string;
  try {
    source = await readFile(scenePath, 'utf8');
  } catch (error) {
    process.stderr.write(`cannot read Scene ${scenePath}: ${(error as NodeJS.ErrnoException).message}\n`);
    return EXIT.invalidScene;
  }

  const parsed = parseScene(source);
  if (!parsed.ok) {
    for (const problem of parsed.problems) {
      const where = problem.elementId === null ? '' : `${problem.elementId}: `;
      process.stderr.write(`${where}${problem.message}\n`);
    }
    return EXIT.invalidScene;
  }

  const outputPath = svgPathFor(scenePath);
  try {
    await writeFile(outputPath, renderScene(parsed.scene), 'utf8');
  } catch (error) {
    process.stderr.write(`cannot write SVG ${outputPath}: ${(error as NodeJS.ErrnoException).message}\n`);
    return EXIT.writeFailed;
  }
  process.stdout.write(`${outputPath}\n`);
  return EXIT.ok;
}

/** `<name>.svg` beside the Scene: only the `.json` suffix is replaced, so `a.esbozo.json` gives `a.esbozo.svg`. */
export function svgPathFor(scenePath: string): string {
  const fileName = basename(scenePath).replace(/\.json$/i, '');
  return resolve(dirname(scenePath), `${fileName}.svg`);
}

process.exitCode = await main(process.argv.slice(2));
