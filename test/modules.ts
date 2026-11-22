/**
 * The modules the editor loads, bundled for Node the way the editor loads them.
 *
 * Rough.js ships imports Node cannot resolve, and `opentype.js` is CommonJS, so
 * the module-seam tests (Scene, Renderer, Layout, glyph outlines, and the four
 * Editor modules `scripts/check-rules.mjs` allows — history, words, geometry,
 * paint) go through one esbuild bundle instead of importing `src/` directly.
 * Both seams share this helper, so a change to how the modules are loaded
 * cannot make the suites disagree.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { removeTempFolders, tempFolder } from './temp.ts';

/** Only `node:test` files import this module, so this module cleans its folder up. */
after(removeTempFolders);

/** What the bundled modules expose: the public Scene, Renderer and Layout functions, and Kalam. */
export interface ProjectModules {
  parseScene: typeof import('../src/scene.ts').parseScene;
  serialiseScene: typeof import('../src/scene.ts').serialiseScene;
  hashScene: typeof import('../src/scene.ts').hashScene;
  serialiseFragment: typeof import('../src/scene.ts').serialiseFragment;
  parseFragment: typeof import('../src/scene.ts').parseFragment;
  History: typeof import('../src/editor/history.ts').History;
  wordsShift: typeof import('../src/editor/words.ts').wordsShift;
  emptyScene: typeof import('../src/scene.ts').emptyScene;
  renderScene: typeof import('../src/renderer.ts').renderScene;
  renderElement: typeof import('../src/renderer.ts').renderElement;
  pageBounds: typeof import('../src/renderer.ts').pageBounds;
  elementBounds: typeof import('../src/renderer.ts').elementBounds;
  elementAt: typeof import('../src/editor/geometry.ts').elementAt;
  caretLine: typeof import('../src/editor/geometry.ts').caretLine;
  railFrame: typeof import('../src/editor/geometry.ts').railFrame;
  clampedDock: typeof import('../src/editor/geometry.ts').clampedDock;
  PaintCache: typeof import('../src/editor/paint.ts').PaintCache;
  sceneFile: typeof import('../src/editor/paint.ts').sceneFile;
  createLayout: typeof import('../src/layout.ts').createLayout;
  parseFontFile: typeof import('../src/layout.ts').parseFontFile;
  /** Kalam's bytes, so a test measures with the font the CLI measures with. */
  KALAM: Uint8Array;
}

/** Bundles the public modules once and imports them. */
export async function loadProjectModules(): Promise<ProjectModules> {
  const source = (module: string): string =>
    JSON.stringify(fileURLToPath(new URL(`../src/${module}`, import.meta.url)));
  const folder = await tempFolder('esbozo-module-');
  const entry = join(folder, 'entry.ts');
  await writeFile(
    entry,
    [
      `export { parseScene, serialiseScene, hashScene, emptyScene, serialiseFragment, parseFragment } from ${source('scene.ts')};`,
      `export { History } from ${source('editor/history.ts')};`,
      `export { wordsShift } from ${source('editor/words.ts')};`,
      `export { renderScene, renderElement, pageBounds, elementBounds } from ${source('renderer.ts')};`,
      `export { elementAt, caretLine, railFrame, clampedDock } from ${source('editor/geometry.ts')};`,
      `export { PaintCache, sceneFile } from ${source('editor/paint.ts')};`,
      `export { createLayout, parseFontFile } from ${source('layout.ts')};`,
      `export { default as KALAM } from ${JSON.stringify(
        fileURLToPath(new URL('../fonts/Kalam-Regular.ttf', import.meta.url)),
      )};`,
      '',
    ].join('\n'),
    'utf8',
  );
  const outfile = join(folder, 'entry.mjs');
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    loader: { '.ttf': 'binary' },
    logLevel: 'silent',
  });
  return (await import(pathToFileURL(outfile).href)) as ProjectModules;
}
