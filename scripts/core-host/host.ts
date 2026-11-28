/**
 * The core's host, as Node answers it.
 *
 * `scripts/same-bytes.mjs` runs the built bundle here to compare its answers
 * with the Go CLI's, and `test/core-entry.test.ts` runs it to reach `begin` and
 * `answer`. Both need the same nine answers, so the host lives here once, beside
 * the shims the bundle swaps in for `node:*`, and both install it before the
 * bundle runs.
 *
 * Nothing here is a stand-in: the rasteriser is the real resvg WebAssembly build
 * and the digest is OpenSSL's, so a run here exercises the same two paths the Go
 * host answers through wazero and `crypto/sha256`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { EzHost } from '../../src/core-host.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const KALAM = join(ROOT, 'fonts/Kalam-Regular.ttf');
const FONT_METRICS = join(ROOT, 'dist/font-metrics.json');
const RESVG_WASM = join(ROOT, 'node_modules/@resvg/resvg-wasm/index_bg.wasm');

/**
 * resvg's `initWasm` refuses a second call in one process, so its promise is
 * kept here: a second `installHost()` reuses the wasm that is already up.
 */
let wasmReady: ReturnType<typeof initWasm> | undefined;

/** Install this host as the core's, and answer it. */
export async function installHost(): Promise<EzHost> {
  await (wasmReady ??= initWasm(readFileSync(RESVG_WASM)));
  const font = readFileSync(KALAM);
  const metrics = readFileSync(FONT_METRICS, 'utf8');
  const installed: EzHost = {
    readText: (path) => readFileSync(String(path), 'utf8'),
    readBytes: (path) => arrayBufferOf(readFileSync(String(path))),
    encodeUtf8: (text) => arrayBufferOf(Buffer.from(String(text), 'utf8')),
    decodeUtf8: (bytes) => Buffer.from(new Uint8Array(bytes)).toString('utf8'),
    sha256: (bytes) => arrayBufferOf(createHash('sha256').update(bytes).digest()),
    cwd: () => process.cwd(),
    bundledFont: () => arrayBufferOf(font),
    bundledFontMetrics: () => metrics,
    rasterise: (svg, options) => {
      const resvg = new Resvg(String(svg), JSON.parse(String(options)));
      try {
        return arrayBufferOf(Buffer.from(resvg.render().asPng()));
      } finally {
        resvg.free();
      }
    },
  };
  globalThis.__ezHost = installed;
  return installed;
}

export function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
