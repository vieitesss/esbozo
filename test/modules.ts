/**
 * The modules the editor loads, bundled for Node the way the editor loads them.
 *
 * Rough.js ships imports Node cannot resolve, and `opentype.js` is CommonJS, so
 * the module-seam tests (Scene, Renderer, Layout, glyph outlines, and the
 * Editor modules `scripts/check-rules.mjs` allows) go through one esbuild
 * bundle instead of importing `src/` directly.
 * Both seams share this helper, so a change to how the modules are loaded
 * cannot make the suites disagree.
 */
import { after } from 'node:test';
import { removeTempFolders } from './temp.ts';

/** Only `node:test` files import this module, so this module cleans its folder up. */
after(removeTempFolders);

export { loadProjectModules, type ProjectModules } from './modules-bundle.ts';
