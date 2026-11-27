/**
 * `@resvg/resvg-wasm`, as the core sees it inside `ez`.
 *
 * The real module runs resvg's WebAssembly build inside the JavaScript engine,
 * and goja has no WebAssembly. `ez` runs those very bytes in wazero instead
 * (`internal/resvg`), so this shim is the seam: the constructor hands the SVG
 * and the module's own options JSON to the host, and `render().asPng()`
 * answers the PNG it drew. That way `src/png.ts` stays exactly what the CLI
 * runs — same palette, same outlines, same two calls — and only the rasteriser
 * behind them differs.
 *
 * No font crosses this seam: `src/png.ts` turns the Scene's words into outlines
 * before resvg sees them, so resvg is never asked to lay text out.
 */

/** The module's bytes, which the host already carries: `initWasm` has nothing to load. */
export default new Uint8Array(0);

let ready = false;

/**
 * The one-time start `src/png.ts` awaits. It is kept rather than dropped so the
 * module still says what the real one says: a call before it is a bug.
 */
export async function initWasm() {
  ready = true;
}

/** The PNG one SVG draws, taken when it is constructed because the host owns the module. */
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
