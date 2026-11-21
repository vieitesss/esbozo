/**
 * The bundle's entry: `<esbozo-editor>` on a page that is not esbozo's own.
 *
 *   <esbozo-editor scene="scene.json" save="save" font="Kalam-Regular.ttf"></esbozo-editor>
 *   <script type="module" src="esbozo-0.0.0.js"></script>
 *
 * Three attributes, and nothing else:
 *
 *   scene  a URL a GET answers the Scene's source on
 *   save   a URL a PUT takes the write `ez serve`'s API takes, `{ scene, svg }`.
 *          Without it the editor is read-only, and the status line says so.
 *   font   the URL of the Kalam file the page draws and measures with. The
 *          bundle never carries the font, so the page decides where it lives.
 *
 * The element is the served editor, not a copy of it: same Renderer, same
 * Layout, same keyboard and pointer, same storage seam with a single-Scene
 * implementation behind it (`scene-url.ts`). The one thing this module adds is
 * what a plain page has no way to say for itself: the stylesheet, since the
 * element draws in the host document, and the measured font, since the page's
 * words have to be placed with the same bytes it draws them in.
 *
 * The font is measured with `font-metrics.ts`, which reads the tables Layout
 * needs instead of shipping a font library: a full OpenType parser is bigger
 * than the whole bundle is allowed to be.
 *
 * The stylesheet is the editor page's (`editor.css`), whose every rule is rooted
 * at `esbozo-editor`: the host page keeps its own margins, its own scrolling and
 * its own variables, and the element is a box in its content. The light and dark
 * variables come with the sheet, so a host that wants the dark theme sets
 * `data-theme="dark"` on its `<html>`, and a host that wants the element a
 * different size overrides its height with a rule of its own.
 *
 * The element is registered here, once, whatever the page holds: an element
 * parsed later upgrades like any other custom element, and each one reads its
 * own attributes, again whenever they change.
 */
import { createLayout } from '../layout.js';
import { measureFontBytes } from '../font-metrics.js';
import { defineEditorElement } from './editor.js';
import type { PageFont } from './editor.js';
import type { SceneFolder } from './files.js';
import { sceneFolder } from './scene-url.js';
import STYLES from './editor.css';

defineEditorElement(pageFont, folderAt, { focusInside: true });
addStylesheet();

/** The element's `scene`, or null when the attribute does not name one. */
function attributeOf(element: Element, name: string): string | null {
  const value = element.getAttribute(name);
  return value === null || value.trim() === '' ? null : value;
}

/**
 * This element's font: fetched once, measured from those same bytes, and given
 * a family of its own so two elements on one page can name two different files
 * without either winning. The face is installed with the measurement, by the
 * element that accepts it, so a font that arrived after a newer one never draws
 * the words it did not measure — and nothing fetches the file a second time. A
 * missing attribute or a font that will not load is the plain-text reason the
 * element shows in its status line.
 */
async function pageFont(element: HTMLElement): Promise<PageFont> {
  const url = attributeOf(element, 'font');
  if (url === null) {
    return { ok: false, problem: 'esbozo-editor needs a font attribute: the URL of Kalam' };
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, problem: `cannot load ${url}: ${response.status} ${response.statusText}` };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    // One set of bytes for both: the metrics every word is placed with and the
    // face it is drawn in are the same file, and neither is fetched again. The
    // face is loaded before it is offered, so the words are never drawn in a
    // fallback while the file is still being read.
    const face = new FontFace(`esbozo-font-${++families}`, bytes);
    await face.load();
    // The bundle reads the tables Layout needs and nothing else, so it has the
    // metrics and the family but not the outlines a PNG is drawn from.
    const layout = createLayout({ family: face.family, metrics: measureFontBytes(bytes) });
    return { ok: true, layout, family: face.family, face: () => useFace(element, face) };
  } catch (error) {
    return { ok: false, problem: `cannot load ${url}: ${(error as Error).message}` };
  }
}

/** The single Scene the element names, read and written through the URLs it has now. */
async function folderAt(element: HTMLElement): Promise<SceneFolder | null> {
  const scene = attributeOf(element, 'scene');
  if (scene === null) {
    throw new Error('esbozo-editor needs a scene attribute: a URL that answers a Scene');
  }
  return sceneFolder({ scene, save: attributeOf(element, 'save') });
}

/** How many faces this page has made: each one is a family of its own. */
let families = 0;
const faces = new WeakMap<Element, FontFace>();

/**
 * Give the element the face its request made, and take the one it had away: one
 * family per request, so two elements on one page never draw with each other's
 * file, and the element's words name the font they were measured with.
 */
function useFace(element: HTMLElement, face: FontFace): void {
  const previous = faces.get(element);
  if (previous !== undefined) {
    document.fonts.delete(previous);
  }
  faces.set(element, face);
  document.fonts.add(face);
  element.style.setProperty('--font-hand', face.family);
}

/**
 * The editor's own look, first in the head so a host's own rules win, with the
 * two handles a page with a single Scene has no use for hidden: there is no
 * folder to browse and no second Scene to make.
 */
function addStylesheet(): void {
  const single = `esbozo-editor .status [data-act="open"],
esbozo-editor .note { display: none; }`;
  const style = document.createElement('style');
  style.textContent = `${STYLES}\n${single}`;
  document.head.prepend(style);
}
