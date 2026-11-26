/**
 * Build the core bundle the Go binary embeds: the Scene, Layout and Renderer the
 * CLI and the editor run, as one script with no Node API.
 *
 * `scripts/build.mjs` builds what a person runs; this builds what `ez` carries.
 * The two differ in three ways only: the entry point, the module format (an IIFE
 * that leaves its surface on `__ezCore`, because goja has no modules), and the
 * two Node builtins `src/font.ts` imports, which `scripts/core-host/` answers
 * from the host. The font is the same seam: the bundle asks the host for Kalam's
 * bytes instead of carrying a base64 copy of them. Nothing under `src/` changes,
 * so the bundle is today's core.
 *
 * It also measures the bundled font once, here, instead of in every cold start:
 * `dist/font-metrics.json` is what `opentype.js` makes of Kalam, which the core
 * answers its measurements from.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import opentype from 'opentype.js';
import { measurementsOf } from './measure-font.mjs';

const hostDir = fileURLToPath(new URL('./core-host/', import.meta.url));

/** Where the core's measurement of the bundled font is written for `ez` to embed. */
const FONT_METRICS = 'dist/font-metrics.json';

/**
 * The one font the core imports. `ez` embeds this very file, so the bundle takes
 * its bytes from the host instead of shipping a base64 copy of its own, and the
 * measurements above are this file's.
 */
const BUNDLED_FONT = resolve('fonts/Kalam-Regular.ttf');

/** The host shim that answers the core's `opentype.js` import. */
const OPENTYPE_SHIM = resolve(hostDir, 'opentype.mjs');

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
 * host hands over. A builtin with no shim stays unresolved, and so does any
 * other font, so the build fails loudly instead of shipping a bundle that only
 * works in Node or carries a font the host does not have.
 *
 * `opentype.js` is the same seam one level down: the core's own import is
 * answered by `scripts/core-host/opentype.mjs`, which reads the measurements
 * above and keeps the real parser for every other font — including its own
 * import of it, which is why the shim's importer is left alone.
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
  },
};

/**
 * Measure the bundled font, so no cold start has to. A font this cannot model
 * is written as `null`, and the core parses it at run time as it always did.
 */
const metrics = measurementsOf(opentype.parse, await readFile(BUNDLED_FONT));
await mkdir('dist', { recursive: true });
await writeFile(FONT_METRICS, JSON.stringify(metrics.table ?? null));
if (metrics.table === undefined) {
  process.stdout.write(`font metrics  none: ${metrics.refused}\n`);
} else {
  process.stdout.write(
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
