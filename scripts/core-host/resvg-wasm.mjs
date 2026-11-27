/**
 * `@resvg/resvg-wasm`, as the core sees it inside `ez`.
 *
 * The real module runs resvg's WebAssembly build inside the JavaScript engine,
 * and goja has no WebAssembly. `ez` runs those very bytes in wazero instead
 * (`internal/resvg`), so this shim is the seam: the constructor hands the SVG
 * and the module's own options JSON to the host, and `render().asPng()` answers
 * the PNG it drew, which keeps `src/png.ts` exactly what the CLI runs.
 *
 * No font crosses this seam: `src/png.ts` turns the Scene's words into outlines
 * before resvg sees them, so resvg is never asked to lay text out.
 */

export default new Uint8Array(0);

let ready = false;

export async function initWasm() {
  ready = true;
}

export class Resvg {
  constructor(svg, options) {
    if (!ready) throw new Error('Wasm has not been initialized. Call `initWasm()` function.');
    this.png = new Uint8Array(globalThis.__ezHost.rasterise(String(svg), JSON.stringify(options)));
  }

  render() {
    const png = this.png;
    return { asPng: () => png };
  }

  free() {
    this.png = new Uint8Array(0);
  }
}
