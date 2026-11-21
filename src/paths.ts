/**
 * Scene file naming, shared by the CLI and the browser.
 *
 * Whole file names only: no `node:path`, no clock, no file system, so the same
 * module bundles into the editor page.
 */

/**
 * The extensions a Scene file takes, primary first: `.esbozo` is what a new
 * Scene is written as, and `.json` stays a Scene name because that is what every
 * Scene was called before the extension existed.
 */
const SCENE_EXTENSIONS = ['.esbozo', '.json'] as const;

type SceneExtension = (typeof SCENE_EXTENSIONS)[number];

/** The extension this name ends in, in any letter case, or `null` for any other file. */
export function sceneExtension(sceneFileName: string): SceneExtension | null {
  const folded = sceneFileName.toLowerCase();
  return SCENE_EXTENSIONS.find((extension) => folded.endsWith(extension)) ?? null;
}

/**
 * The Scene's stem: only the trailing extension is replaced, so `a.esbozo.json`
 * gives `a.esbozo`.
 */
export function sceneStem(sceneFileName: string): string {
  const extension = sceneExtension(sceneFileName);
  return extension === null ? sceneFileName : sceneFileName.slice(0, -extension.length);
}

/** `<name>.svg` beside the Scene, which is the name the editor autosaves. */
export function svgFileName(sceneFileName: string): string {
  return `${sceneStem(sceneFileName)}.svg`;
}
