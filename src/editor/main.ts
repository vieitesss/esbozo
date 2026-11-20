/**
 * The editor page's entry: fetch the font the page draws with, measure it, and
 * put one editor on the page.
 *
 * Kalam is served beside the page (`fonts/Kalam-Regular.ttf`), so the browser
 * measures the Scene's words with exactly the font the CSS draws them in. The
 * Layout is built here, once, and handed to the element: the Renderer stays
 * pure and never reads a file.
 */
import { createLayout, measureFont } from '../layout.js';
import { defineEditorElement } from './editor.js';

const FONT_URL = 'fonts/Kalam-Regular.ttf';

const response = await fetch(FONT_URL);
if (!response.ok) {
  throw new Error(`cannot load ${FONT_URL}: ${response.status} ${response.statusText}`);
}
defineEditorElement(createLayout(measureFont(new Uint8Array(await response.arrayBuffer()))));
