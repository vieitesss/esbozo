/**
 * The `.ttf` import `src/font.ts` writes and the `.wasm` import `src/png.ts`
 * writes, declared so `tsc` can typecheck both files. Nothing bundles those
 * bytes into `dist/core.js`: the core's bundle resolves each import to a host
 * shim, and `ez` hands the bytes over at run time.
 */
declare module '*.ttf' {
  const bytes: Uint8Array;
  export default bytes;
}

declare module '*.wasm' {
  const bytes: Uint8Array;
  export default bytes;
}
