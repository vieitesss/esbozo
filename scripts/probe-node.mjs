/**
 * A Node module probe: one command bundles `src/` via `loadProjectModules()`
 * and runs a probe module against it, without hand-building `/tmp/*-entry.ts`
 * or calling `esbuild` by hand.
 *
 * Usage: `pnpm probe:node [probe.mjs]`, or `pnpm probe:node < probe.mjs` to
 * read the probe from stdin.
 *
 * The probe module's default export is called with the `ProjectModules` object
 * returned by `loadProjectModules()` (`parseScene`, `serialiseScene`,
 * `drawnGeometry`, `snapTarget`, `Rail`, `Hand`, `Exits`, `KALAM`, etc.).
 *
 * If the probe returns a value other than `undefined`, it is printed as JSON
 * on stdout. Temporary bundle and stdin-probe folders are always removed
 * before exiting.
 */
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadProjectModules } from '../test/modules-bundle.ts';
import { removeTempFolders, tempFolder } from '../test/temp.ts';

function parseProbeArg(argv) {
  let probe;
  for (const arg of argv) {
    if (arg === '-') {
      probe = undefined;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option "${arg}"`);
    } else {
      probe = arg;
    }
  }
  return probe;
}

async function resolveProbeFile(path) {
  if (path !== undefined) {
    return resolve(path);
  }
  if (process.stdin.isTTY) {
    throw new Error('no probe: pass the path to one, or pipe its source in');
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const folder = await tempFolder('esbozo-probe-node-');
  const file = join(folder, 'probe.mjs');
  await writeFile(file, Buffer.concat(chunks));
  return file;
}

async function main() {
  const probePath = parseProbeArg(process.argv.slice(2));
  const file = await resolveProbeFile(probePath);
  const [modules, probeModule] = await Promise.all([
    loadProjectModules(),
    import(pathToFileURL(file).href),
  ]);
  if (typeof probeModule.default !== 'function') {
    throw new Error(`probe module "${file}" must export a default function`);
  }
  const result = await probeModule.default(modules);
  if (result !== undefined) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await removeTempFolders();
}
