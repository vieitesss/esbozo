/**
 * The modules the editor loads, bundled for Node the way the editor loads them.
 *
 * Rough.js ships imports Node cannot resolve, and `opentype.js` is CommonJS, so
 * the module-seam tests (Scene, Renderer, Layout, glyph outlines) go through one esbuild bundle
 * instead of importing `src/` directly. Both seams share this helper, so a
 * change to how the modules are loaded cannot make the suites disagree.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

/** What the bundled modules expose: the public Scene, Renderer and Layout functions, and Kalam. */
export interface ProjectModules {
  parseScene: typeof import('../src/scene.ts').parseScene;
  serialiseScene: typeof import('../src/scene.ts').serialiseScene;
  hashScene: typeof import('../src/scene.ts').hashScene;
  serialiseFragment: typeof import('../src/scene.ts').serialiseFragment;
  parseFragment: typeof import('../src/scene.ts').parseFragment;
  History: typeof import('../src/editor/history.ts').History;
  emptyScene: typeof import('../src/scene.ts').emptyScene;
  renderScene: typeof import('../src/renderer.ts').renderScene;
  PaintCache: typeof import('../src/editor/paint.ts').PaintCache;
  createLayout: typeof import('../src/layout.ts').createLayout;
  parseFontFile: typeof import('../src/layout.ts').parseFontFile;
  /** Kalam's bytes, so a test measures with the font the CLI measures with. */
  KALAM: Uint8Array;
}

/** Bundles the public modules once and imports them. */
export async function loadProjectModules(): Promise<ProjectModules> {
  const source = (module: string): string =>
    JSON.stringify(fileURLToPath(new URL(`../src/${module}`, import.meta.url)));
  const folder = await mkdtemp(join(tmpdir(), 'esbozo-module-'));
  const entry = join(folder, 'entry.ts');
  await writeFile(
    entry,
    [
      `export { parseScene, serialiseScene, hashScene, emptyScene, serialiseFragment, parseFragment } from ${source('scene.ts')};`,
      `export { History } from ${source('editor/history.ts')};`,
      `export { renderScene } from ${source('renderer.ts')};`,
      `export { PaintCache } from ${source('editor/paint.ts')};`,
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
