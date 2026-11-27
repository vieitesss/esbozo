/**
 * The bundled font, as `src/font.ts` imports it when a host that is not Node runs
 * the core: the CLI bundles Kalam's bytes as a megabyte of base64, and `ez`
 * already carries the same file, so the bundle asks the host for it instead.
 *
 * The read happens once, at bundle load, after the host has installed
 * `__ezHost`.
 */

/** Kalam's bytes, as the `Uint8Array` a binary import would have given. */
export default new Uint8Array(globalThis.__ezHost.bundledFont());
