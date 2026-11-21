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
 * This element's font: fetched, measured, and given a family of its own so two
 * elements on one page can name two different files without either winning.
 * The face is installed with the measurement, by the element that accepts it,
 * so a font that arrived after a newer one never draws the words it did not
 * measure. A missing attribute or a font that will not load is the plain-text
 * reason the element shows in its status line.
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
    const layout = createLayout(measureFontBytes(new Uint8Array(await response.arrayBuffer())));
    return { ok: true, layout, face: () => useFace(element, url) };
  } catch (error) {
    return { ok: false, problem: `cannot load ${url}: ${(error as Error).message}` };
  }
}

/** The single Scene the element names, read through the URLs its attributes give now. */
async function folderAt(element: HTMLElement): Promise<SceneFolder | null> {
  const scene = attributeOf(element, 'scene');
  if (scene === null) {
    throw new Error('esbozo-editor needs a scene attribute: a URL that answers a Scene');
  }
  return sceneFolder(() => ({
    scene: attributeOf(element, 'scene') ?? scene,
    save: attributeOf(element, 'save'),
  }));
}

/** How many faces this page has made: each one is a family of its own. */
let faces = 0;
const faceStyles = new WeakMap<Element, HTMLStyleElement>();

/**
 * Give the element the face its `font` attribute names: one family per element,
 * so two elements on one page never draw with each other's file, and the sheet
 * that names it is replaced when the attribute changes.
 */
function useFace(element: HTMLElement, url: string): void {
  faces += 1;
  const family = `esbozo-font-${faces}`;
  const style = document.createElement('style');
  style.textContent = `@font-face {
  font-family: "${family}";
  src: url(${JSON.stringify(url)}) format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
esbozo-editor[data-esbozo-font="${family}"] { --font-hand: "${family}", cursive; }`;
  faceStyles.get(element)?.remove();
  faceStyles.set(element, style);
  document.head.append(style);
  element.setAttribute('data-esbozo-font', family);
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
