/**
 * The bundled font, as `src/font.ts` imports it when a host that is not Node
 * runs the core.
 *
 * The CLI bundles Kalam's bytes into `dist/cli.js` as base64; that copy is a
 * megabyte of text goja would have to decode on every cold start. `ez` already
 * carries the very same file, so this module asks the host for it instead and
 * the bundle keeps only this stub. The read happens once, at bundle load, after
 * the host has installed `__ezHost`.
 */

/** Kalam's bytes, as the `Uint8Array` a binary import would have given. */
export default new Uint8Array(globalThis.__ezHost.bundledFont());
