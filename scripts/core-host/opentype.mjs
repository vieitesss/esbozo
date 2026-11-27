/**
 * `opentype.js`, as the core bundle reaches it: the bundled font is measured
 * from the table `scripts/measure-font.mjs` wrote, and every other font is
 * parsed by opentype.js itself.
 *
 * `scripts/build-core.mjs` resolves this module in place of `opentype.js` for the
 * bundle's own import (`src/layout.ts`) and leaves this module's import of
 * `opentype.js` alone, which is how the real parser stays reachable from here.
 */
import opentype from 'opentype.js';
import { fontOf, isBundled } from './font-measurements.mjs';

let table;

/** The measurements the build took, or null when it took none. */
function metrics() {
  if (table === undefined) {
    // The host answers the text `scripts/build-core.mjs` wrote, which is `null`
    // when the build could not prove a table.
    table = JSON.parse(globalThis.__ezHost.bundledFontMetrics());
  }
  return table;
}

/**
 * Parse these bytes as opentype.js parses them, from the table when they are the
 * bundled font the table was taken from. `src/font.ts` reaches this for the
 * bundled Kalam, for a `--font` a person names and for a stylesheet's face; only
 * the first one is answered without a parse.
 */
export function parse(buffer) {
  const written = metrics();
  if (written === null || !isBundled(written, buffer)) {
    return opentype.parse(buffer);
  }
  return fontOf(written, buffer, opentype.parse);
}
