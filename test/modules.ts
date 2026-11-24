/**
 * The modules the editor loads, bundled for Node the way the editor loads them.
 *
 * Rough.js ships imports Node cannot resolve, and `opentype.js` is CommonJS, so
 * the module-seam tests (Scene, Renderer, Layout, glyph outlines, and the five
 * Editor modules `scripts/check-rules.mjs` allows — history, words, geometry,
 * paint, bend-point) go through one esbuild bundle instead of importing `src/`
 * directly.
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
  elementsById: typeof import('../src/scene.ts').elementsById;
  History: typeof import('../src/editor/history.ts').History;
  wordsShift: typeof import('../src/editor/words.ts').wordsShift;
  emptyScene: typeof import('../src/scene.ts').emptyScene;
  renderScene: typeof import('../src/renderer.ts').renderScene;
  renderElement: typeof import('../src/renderer.ts').renderElement;
  drawnGeometry: typeof import('../src/renderer.ts').drawnGeometry;
  pageBounds: typeof import('../src/renderer.ts').pageBounds;
  bendDots: typeof import('../src/editor/bend-point.ts').bendDots;
  snapTarget: typeof import('../src/editor/snap.ts').snapTarget;
  withEnd: typeof import('../src/editor/snap.ts').withEnd;
  withSnapSwitch: typeof import('../src/editor/snap.ts').withSnapSwitch;
  freedEnds: typeof import('../src/editor/snap.ts').freedEnds;
  anchoredEnds: typeof import('../src/editor/snap.ts').anchoredEnds;
  elementAt: typeof import('../src/editor/geometry.ts').elementAt;
  caretLine: typeof import('../src/editor/geometry.ts').caretLine;
  railFrame: typeof import('../src/editor/rail.ts').railFrame;
  clampedDock: typeof import('../src/editor/rail.ts').clampedDock;
  leftDockEdge: typeof import('../src/editor/rail.ts').leftDockEdge;
  nearestDock: typeof import('../src/editor/rail.ts').nearestDock;
  anchorPoint: typeof import('../src/geometry.ts').anchorPoint;
  anchorOf: typeof import('../src/geometry.ts').anchorOf;
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
      `export { parseScene, serialiseScene, hashScene, emptyScene, serialiseFragment, parseFragment, elementsById } from ${source('scene.ts')};`,
      `export { History } from ${source('editor/history.ts')};`,
      `export { wordsShift } from ${source('editor/words.ts')};`,
      `export { renderScene, renderElement, drawnGeometry, pageBounds } from ${source('renderer.ts')};`,
      `export { bendDots } from ${source('editor/bend-point.ts')};`,
      `export { snapTarget, withEnd, withSnapSwitch, freedEnds, anchoredEnds } from ${source('editor/snap.ts')};`,
      `export { elementAt, caretLine } from ${source('editor/geometry.ts')};`,
      `export { railFrame, clampedDock, leftDockEdge, nearestDock } from ${source('editor/rail.ts')};`,
      `export { anchorPoint, anchorOf } from ${source('geometry.ts')};`,
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
