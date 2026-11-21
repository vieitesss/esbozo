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

/**
 * The biggest `.json` a folder list reads to tell a Scene from another JSON
 * file. A bigger one is left out unread: a Scene is text, and reading it whole
 * would cost the whole listing more than one name is worth.
 */
export const MAX_LISTED_SCENE_BYTES = 5 * 1024 * 1024;

/**
 * Whether a folder lists this name as a Scene, the one rule both folder
 * adapters share; `readsAsScene` is the adapter's own I/O, and answers whether
 * that name's bytes parse as a Scene.
 *
 * An `.esbozo` name is this project's own, so it is a Scene however it reads: an
 * invalid one is listed, and says what is wrong when opened. A `.json` name is
 * any other JSON file's too — a `package.json`, a `tsconfig.json` — so it is
 * listed only when its bytes parse. A `.json` the reader cannot offer at all
 * (gone, unreadable, too large) is not listed.
 */
export async function listedAsScene(
  sceneFileName: string,
  readsAsScene: (sceneFileName: string) => Promise<boolean>,
): Promise<boolean> {
  const extension = sceneExtension(sceneFileName);
  return extension === '.esbozo' || (extension === '.json' && (await readsAsScene(sceneFileName)));
}
