import opentype from 'opentype.js';
import { fontOf, isBundled } from './font-measurements.mjs';
import { host } from '../../src/core-host.js';

let table;

function metrics() {
  if (table === undefined) {
    table = JSON.parse(host().bundledFontMetrics());
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
