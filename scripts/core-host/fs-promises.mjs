/**
 * `node:fs/promises`, as the core bundle reads it when a host that is not Node
 * runs it.
 *
 * The core needs one operation from the filesystem: read a font file, or read
 * the stylesheet `--css` names. Both are the host's job — `ez` in Go reads the
 * file and hands the bytes over — so this module keeps the signature
 * `src/font.ts` calls and nothing else.
 */

/** A file's text, or the host's read error, which carries Node's `message`. */
export async function readFile(path, encoding) {
  const name = String(path);
  if (encoding === 'utf8') {
    return globalThis.__ezHost.readText(name);
  }
  return new Uint8Array(globalThis.__ezHost.readBytes(name));
}
