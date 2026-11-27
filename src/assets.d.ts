/**
 * Binary assets are bundled into `dist/core.js` by esbuild's `binary` loader:
 * the Kalam font and resvg's WebAssembly module both arrive as a Uint8Array,
 * so the core the Go binary runs is one script that needs nothing beside it.
 */
declare module '*.ttf' {
  const bytes: Uint8Array;
  export default bytes;
}

declare module '*.wasm' {
  const bytes: Uint8Array;
  export default bytes;
}
