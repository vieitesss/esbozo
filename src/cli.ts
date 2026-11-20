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
 *
 * Problems are plain text, one per line, on stderr, and name the Element they
 * belong to: `a: width must be at least 1 pixel, got 0`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseScene } from './scene.js';
import { renderScene } from './renderer.js';

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_INVALID_SCENE = 3;

const USAGE = 'usage: ez render <scene>';

export async function main(argv: readonly string[]): Promise<number> {
  const [command, scenePath, ...extra] = argv;
  if (command !== 'render' || scenePath === undefined || scenePath === '' || extra.length > 0) {
    process.stderr.write(`${USAGE}\n`);
    return EXIT_USAGE;
  }

  let source: string;
  try {
    source = await readFile(scenePath, 'utf8');
  } catch (error) {
    process.stderr.write(`cannot read Scene ${scenePath}: ${(error as NodeJS.ErrnoException).message}\n`);
    return EXIT_INVALID_SCENE;
  }

  const parsed = parseScene(source);
  if (!parsed.ok) {
    for (const problem of parsed.problems) {
      const where = problem.elementId === null ? '' : `${problem.elementId}: `;
      process.stderr.write(`${where}${problem.message}\n`);
    }
    return EXIT_INVALID_SCENE;
  }

  const outputPath = svgPathFor(scenePath);
  try {
    await writeFile(outputPath, renderScene(parsed.scene), 'utf8');
  } catch (error) {
    process.stderr.write(`cannot write SVG ${outputPath}: ${(error as NodeJS.ErrnoException).message}\n`);
    return EXIT_INVALID_SCENE;
  }
  process.stdout.write(`${outputPath}\n`);
  return EXIT_OK;
}

/** `<name>.svg` beside the Scene: `sketch.json` and `sketch.esbozo.json` both give `sketch.svg`. */
export function svgPathFor(scenePath: string): string {
  const fileName = basename(scenePath).replace(/\.json$/i, '').replace(/\.esbozo$/i, '');
  return resolve(dirname(scenePath), `${fileName}.svg`);
}

process.exitCode = await main(process.argv.slice(2));
