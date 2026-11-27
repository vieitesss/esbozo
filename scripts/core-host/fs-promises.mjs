/**
 * `node:fs/promises`, as the core bundle reads it when a host that is not Node
 * runs it: `src/font.ts` reads a font file and the `--css` stylesheet, and both
 * are the host's to read.
 */

/** A file's text, or the host's read error, which carries Node's `message`. */
export async function readFile(path, encoding) {
  const name = String(path);
  if (encoding === 'utf8') {
    return globalThis.__ezHost.readText(name);
  }
  return new Uint8Array(globalThis.__ezHost.readBytes(name));
}
