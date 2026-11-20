/**
 * Scene file naming, shared by the CLI and the browser.
 *
 * Whole file names only: no `node:path`, no clock, no file system, so the same
 * module bundles into the editor page.
 */

/** The Scene's stem: only the `.json` suffix is replaced, so `a.esbozo.json` gives `a.esbozo`. */
export function sceneStem(sceneFileName: string): string {
  return sceneFileName.replace(/\.json$/i, '');
}

/** `<name>.svg` beside the Scene, which is the name the editor autosaves. */
export function svgFileName(sceneFileName: string): string {
  return `${sceneStem(sceneFileName)}.svg`;
}
