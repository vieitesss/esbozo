/**
 * The editor page's entry: fetch the font the page draws with, measure it, put
 * it on the page, and put one editor on the page.
 *
 * Kalam is served beside the page (`fonts/Kalam-Regular.ttf`), so the browser
 * measures the Scene's words with exactly the font the CSS draws them in. The
 * bytes are fetched once: the same ArrayBuffer is measured by `Layout` and
 * installed as the page's `FontFace`, so there is no second `@font-face`
 * request for the file the page already holds. The Layout is built here, once,
 * and handed to the element: the Renderer stays pure and never reads a file.
 *
 * A page that draws a font of its own has to measure with that same file, which
 * is the font URL ticket (#13): this page always serves and draws Kalam. A font
 * that cannot be read leaves the page its shell and an error in the status
 * line — the words cannot be placed without its metrics, so there is no editor
 * to show. That one parse also carries the glyph outlines an exported PNG is
 * drawn with, so the words are never measured with one file and drawn from
 * another.
 */
import { createLayout, parseFontFile } from '../layout.js';
import { defineEditorElement } from './editor.js';
import type { PageFont } from './editor.js';
import { exportPng } from './export.js';
import { servedFolder } from './server-folder.js';

const FONT_URL = 'fonts/Kalam-Regular.ttf';
/** The family the page's CSS names the hand font by, which the SVG is drawn in. */
const FONT_FAMILY = 'Kalam';

const font = await loadFont();

defineEditorElement(async () => font, servedFolder, { exportPng });

/** The page's font, measured, or the plain-text reason it has none. */
async function loadFont(): Promise<PageFont> {
  try {
    const response = await fetch(FONT_URL);
    if (!response.ok) {
      return { ok: false, problem: `cannot load ${FONT_URL}: ${response.status} ${response.statusText}` };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    // One file, two uses: its metrics place the words, and its outlines are the
    // face the page draws the page's chrome in. Loaded before the editor is
    // defined, so nothing is painted in a fallback face first.
    const face = new FontFace(FONT_FAMILY, bytes);
    await face.load();
    document.fonts.add(face);
    return { ok: true, layout: createLayout(parseFontFile(bytes)), family: FONT_FAMILY };
  } catch (error) {
    return { ok: false, problem: `cannot load ${FONT_URL}: ${(error as Error).message}` };
  }
}
