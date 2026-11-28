import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import opentype from 'opentype.js';
import { measurementsOf } from './measure-font.mjs';

const hostDir = fileURLToPath(new URL('./core-host/', import.meta.url));

const FONT_METRICS = 'dist/font-metrics.json';
const BUNDLED_FONT = resolve('fonts/Kalam-Regular.ttf');
const OPENTYPE_SHIM = resolve(hostDir, 'opentype.mjs');
const RESVG_SHIM = resolve(hostDir, 'resvg-wasm.mjs');

/**
 * resvg's WebAssembly build, which `internal/resvg` runs in wazero to make a
 * PNG. Copied rather than embedded from `node_modules`, because pnpm makes that
 * package a symbolic link and `go:embed` does not follow one.
 */
const RESVG_WASM = resolve('node_modules/@resvg/resvg-wasm/index_bg.wasm');

const legacyRegExp = await readFile(`${hostDir}legacy-regexp.mjs`, 'utf8');

const SHIMS = {
  'node:fs/promises': 'fs-promises.mjs',
  'node:path': 'path.mjs',
};

const hostShims = {
  name: 'host-shims',
  setup(bundle) {
    bundle.onResolve({ filter: /^node:/ }, (args) => {
      const shim = SHIMS[args.path];
      if (shim === undefined) {
        return { errors: [{ text: `${args.path} has no host shim: the core cannot use it` }] };
      }
      return { path: hostDir + shim };
    });
    bundle.onResolve({ filter: /\.ttf$/ }, (args) => {
      if (resolve(args.resolveDir, args.path) !== BUNDLED_FONT) {
        return { errors: [{ text: `${args.path} is not the bundled font: the host has no bytes for it` }] };
      }
      return { path: `${hostDir}font.mjs` };
    });
    bundle.onResolve({ filter: /^opentype\.js$/ }, (args) => {
      if (resolve(args.importer) === OPENTYPE_SHIM) {
        return null;
      }
      return { path: OPENTYPE_SHIM };
    });
    bundle.onResolve({ filter: /^@resvg\/resvg-wasm(\/index_bg\.wasm)?$/ }, () => ({
      path: RESVG_SHIM,
    }));
  },
};

const metrics = measurementsOf(opentype.parse, await readFile(BUNDLED_FONT));
await mkdir('dist', { recursive: true });
await copyFile(RESVG_WASM, 'dist/resvg.wasm');
await writeFile(FONT_METRICS, JSON.stringify(metrics.table ?? null));
if (metrics.table === undefined) {
  process.stderr.write(`font metrics  none: ${metrics.refused}\n`);
} else {
  process.stderr.write(
    `font metrics  ${metrics.verified}/${metrics.points} characters, ` +
      `${metrics.table.glyphCount} glyphs, ` +
      `${JSON.stringify(metrics.table).length} bytes\n`,
  );
}

await build({
  entryPoints: ['src/core-entry.ts'],
  outfile: 'dist/core.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: '__ezCore',
  target: 'es2022',
  plugins: [hostShims],
  banner: { js: legacyRegExp },
  legalComments: 'inline',
  minify: true,
  logLevel: 'info',
});
