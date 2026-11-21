/**
 * The editor page's entry: fetch the font the page draws with, measure it, and
 * let the element read it.
 *
 * Kalam is served beside the page (`fonts/Kalam-Regular.ttf`), so the browser
 * measures the Scene's words with exactly the font the CSS draws them in. The
 * Layout is built here, once, and handed to the element: the Renderer stays
 * pure and never reads a file.
 *
 * A page that draws a font of its own has to measure with that same file, which
 * is the font URL ticket (#13): this page always serves and draws Kalam. A font
 * that cannot be read leaves the page its shell and an error in the status
 * line — the words cannot be placed without its metrics, so there is no editor
 * to show.
 */
import { createLayout, measureFont } from '../layout.js';
import { defineEditorElement } from './editor.js';
import type { PageFont } from './editor.js';

const FONT_URL = 'fonts/Kalam-Regular.ttf';
const font = await loadFont();

defineEditorElement(async () => font);

/** The page's font, measured, or the plain-text reason it has none. */
async function loadFont(): Promise<PageFont> {
  try {
    const response = await fetch(FONT_URL);
    if (!response.ok) {
      return { ok: false, problem: `cannot load ${FONT_URL}: ${response.status} ${response.statusText}` };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { ok: true, layout: createLayout(measureFont(bytes)) };
  } catch (error) {
    return { ok: false, problem: `cannot load ${FONT_URL}: ${(error as Error).message}` };
  }
}
