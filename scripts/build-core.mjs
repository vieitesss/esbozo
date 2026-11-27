/**
 * Build the core bundle the Go binary embeds: the Scene, Layout and Renderer the
 * CLI and the editor run, as one script with no Node API.
 *
 * It differs from what `scripts/build.mjs` builds in three ways only: the entry
 * point, the module format (an IIFE that leaves its surface on `__ezCore`,
 * because goja has no modules), and the two Node builtins `src/font.ts` imports,
 * which `scripts/core-host/` answers from the host. It also measures the bundled
 * font once here, instead of in every cold start, and copies resvg's WebAssembly
 * module beside the bundle for `internal/resvg` to run in wazero, which is also
 * why the core's import of that package is answered by a host shim.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import opentype from 'opentype.js';
import { measurementsOf } from './measure-font.mjs';

const hostDir = fileURLToPath(new URL('./core-host/', import.meta.url));

/** Where the core's measurement of the bundled font is written. */
const FONT_METRICS = 'dist/font-metrics.json';

/** The one font the core imports; the bundle takes its bytes from the host. */
const BUNDLED_FONT = resolve('fonts/Kalam-Regular.ttf');

/** The host shim that answers the core's `opentype.js` import. */
const OPENTYPE_SHIM = resolve(hostDir, 'opentype.mjs');

/**
 * The host shim that answers the core's `@resvg/resvg-wasm` import, for both the
 * module and the wasm it loads: `ez` runs those bytes in wazero, so the bundle
 * carries neither.
 */
const RESVG_SHIM = resolve(hostDir, 'resvg-wasm.mjs');

/**
 * resvg's WebAssembly build, which `internal/resvg` runs in wazero to make a
 * PNG. Copied rather than embedded from `node_modules`, because pnpm makes that
 * package a symbolic link and `go:embed` does not follow one.
 */
const RESVG_WASM = resolve('node_modules/@resvg/resvg-wasm/index_bg.wasm');

/**
 * The one global goja does not implement, which a roughjs dependency reads. It
 * is the bundle's banner so it is in place before any module body runs.
 */
const legacyRegExp = await readFile(`${hostDir}legacy-regexp.mjs`, 'utf8');

/** The Node builtins the core reaches, and the shim that answers in their place. */
const SHIMS = {
  'node:fs/promises': 'fs-promises.mjs',
  'node:path': 'path.mjs',
};

/**
 * Answers a Node builtin with its shim, and the bundled font with the bytes the
 * host hands over: an unresolved builtin or font fails the build, rather than
 * shipping a bundle that only works in Node.
 *
 * `opentype.js` is the same seam one level down: the core's own import is
 * answered by `scripts/core-host/opentype.mjs`, which keeps the real parser for
 * every other font — including its own import of it, which is why the shim's
 * importer is left alone. `@resvg/resvg-wasm` is that seam too, answered whole:
 * `ez` runs the module in wazero, so neither the glue nor its wasm belongs in
 * the bundle.
 */
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

/**
 * Measure the bundled font, so no cold start has to. A font this cannot model is
 * written as `null`, and the core parses it at run time as it always did.
 *
 * The line goes to stderr: `npm pack --json` reads `prepack`'s stdout as the
 * manifest it prints, so a build that writes progress there breaks it.
 */
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
