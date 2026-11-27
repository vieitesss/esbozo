import opentype from 'opentype.js';
import { fontOf, isBundled } from './font-measurements.mjs';

let table;

function metrics() {
  if (table === undefined) {
    table = JSON.parse(globalThis.__ezHost.bundledFontMetrics());
  }
  return table;
}

export function parse(buffer) {
  const written = metrics();
  if (written === null || !isBundled(written, buffer)) {
    return opentype.parse(buffer);
  }
  return fontOf(written, buffer, opentype.parse);
}
