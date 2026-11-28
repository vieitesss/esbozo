/**
 * The host seam: the nine things the core asks of the program around it.
 *
 * The core is one set of modules — Scene, Renderer, Layout, PNG — and it runs
 * in three places: the editor's page, the CLI's goja, and Node running the
 * bundle straight. What it cannot do for itself is touch the outside world:
 * read a file, hash bytes, or run resvg's WebAssembly, which goja has none of.
 * Each of those is a method here, and every host answers the same nine names:
 * `internal/core/host.go` for `ez`, and the Node adapter beside the shims the
 * bundle swaps in for `node:*`.
 *
 * This is the only place the type is declared, so a host cannot be
 * half-implemented: a new method here is a compile error in every TypeScript
 * host, and the shims read through the accessor below rather than reaching for
 * the global themselves.
 */
export interface EzHost {
  // Every answer is a plain value (never a promise): goja cannot await one, so
  // the core's host calls settle synchronously.
  readText(path: string): string;
  readBytes(path: string): ArrayBuffer;
  encodeUtf8(text: string): ArrayBuffer;
  decodeUtf8(bytes: ArrayBuffer): string;
  sha256(bytes: Uint8Array): ArrayBuffer;
  cwd(): string;
  bundledFont(): ArrayBuffer;
  bundledFontMetrics(): string;
  rasterise(svg: string, options: string): ArrayBuffer;
}

declare global {
  // eslint-disable-next-line no-var
  var __ezHost: EzHost;
}

/** The host this run of the core was given, before the bundle runs. */
export function host(): EzHost {
  return globalThis.__ezHost;
}
