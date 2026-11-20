/**
 * Binary assets are bundled into `dist/cli.js` by esbuild's `binary` loader:
 * the Kalam font and resvg's WebAssembly module both arrive as a Uint8Array,
 * so the built CLI is one file and needs nothing beside it at runtime.
 */
declare module '*.ttf' {
  const bytes: Uint8Array;
  export default bytes;
}

declare module '*.wasm' {
  const bytes: Uint8Array;
  export default bytes;
}
