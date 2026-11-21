/**
 * PNG export: the Scene's own SVG, rasterised by the browser, downloaded.
 *
 * The bytes rasterised are the Renderer's SVG for the saved Scene — the same
 * document `ez render` writes and `ez png` draws — with one change the browser
 * needs and the CLI does not: its colours are resolved first, because an SVG
 * loaded as an image has no page around it and would paint `var(--ink)` black;
 * they come from the page's own variables, so the PNG shows the paper and ink
 * the person is looking at.
 *
 * The words are drawn as the font's own outlines (`../glyphs.ts`), not as
 * `<text>`: a browser would shape and hint a line its own way, and a page of
 * dense words would not be the CLI's drawing. Paths leave both rasterisers the
 * same curves to fill, and they come from the font Layout measured with, so an
 * export reads the font once rather than once more.
 *
 * The canvas draws at one pixel per Scene unit, which is the scale `ez png`
 * rasterises at, so the PNG has the CLI's size and, within the rasteriser's
 * antialiasing, its pixels. A page too large for a canvas is neither shrunk nor
 * tiled here: the status line names the CLI command that draws it instead.
 * Whether a page is too large is the browser's answer, not a limit written down
 * in this file — the canvas is asked for the page at 1:1, and only an
 * allocation or an encode that really fails makes the export refuse.
 */
import { colourText, readColour, resolveSvgColours, resolveVariables } from '../css.js';
import type { Theme, Variables } from '../css.js';
import type { Layout } from '../layout.js';
import { outlineText } from '../outlines.js';
import { renderScene } from '../renderer.js';
import type { Scene } from '../scene.js';

/** One pixel per Scene unit: what `ez png` draws at, so a PNG is the CLI's size. */
const SCALE = 1;

/** The colours the page's stylesheet declares for the theme, before any mixing. */
const COLOURS = ['--ink', '--paper', '--muted'] as const;
type ColourVariable = (typeof COLOURS)[number];

export interface PngExport {
  readonly scene: Scene;
  /** The page's measurement, so the words break where the saved SVG breaks them. */
  readonly layout: Layout;
  /** The family the page's CSS names, and the one the outlined SVG is resolved in. */
  readonly family: string;
  readonly theme: Theme;
  /** The file name without its extension: `sketch` writes `sketch.light.png`. */
  readonly name: string;
  /** The Scene's own file name, which the too-large message's CLI command names. */
  readonly file: string;
}

/**
 * Draw the Scene as a PNG and hand it to the download: `<name>.<theme>.png`,
 * the same name `ez png` gives the same Scene and theme.
 */
export async function exportPng(options: PngExport): Promise<void> {
  const page = pageVariables(options.theme);
  const variables: Variables = { ...page, '--font-hand': options.family };
  const resolved = resolveSvgColours(renderScene(options.scene, options.layout), variables);
  if (!resolved.ok) {
    throw new Error(resolved.problems[0] ?? 'the drawing cannot be resolved');
  }
  const outlined = outlineText(resolved.value, options.layout.glyphs);
  if (!outlined.ok) {
    throw new Error(outlined.problems[0] ?? 'the drawing cannot be outlined');
  }
  const size = sizeOf(outlined.svg);
  const drawing = await rasterise(outlined.svg, page['--paper'], size, options);
  download(drawing, `${options.name}.${options.theme}.png`);
}

/** A page a canvas of this browser cannot hold at 1:1, so the CLI draws it. */
class TooBigForCanvas extends Error {}

/**
 * The plain reason a page cannot come out of this one: its size, and the CLI
 * command that draws it at 1:1 instead.
 */
function tooBig(options: PngExport, page: { width: number; height: number }): TooBigForCanvas {
  return new TooBigForCanvas(
    `${options.file} is ${page.width}×${page.height}: too big for this page to draw ` +
      `at one pixel per unit. Run \`ez png ${shellQuote(options.file)} --theme ${options.theme}\` instead.`,
  );
}

/**
 * A Scene's file name as a shell reads it: bare when every character of it is
 * one the shell leaves alone, and in single quotes when it is not, so a name
 * with a space in it stays one argument. A single quote inside the name ends
 * the quoted run and comes back as `\'`: that is how a shell writes one.
 */
function shellQuote(name: string): string {
  if (/^[A-Za-z0-9._/@%+-]+$/.test(name)) {
    return name;
  }
  return `'${name.replaceAll("'", "'\\''")}'`;
}

/**
 * The page's colours for one theme, resolved the way `ez png` resolves them: the
 * stylesheet's own declarations are read off the root for that theme and mixed
 * with the same resolver both use, so the PNG's paper and washes are the CLI's
 * numbers, not the browser's rounding of them. The theme attribute is set and
 * put back inside one task, so no frame is painted in between and the page never
 * flickers on its way to a PNG.
 */
function pageVariables(theme: Theme): Readonly<Record<ColourVariable, string>> {
  const declared = declaredColours(theme);
  const ink = resolvedColour('--ink', declared);
  const paper = resolvedColour('--paper', declared);
  const muted = resolvedColour('--muted', { ...declared, '--ink': ink, '--paper': paper });
  return { '--ink': ink, '--paper': paper, '--muted': muted };
}

/** What the stylesheet declares for the theme, as the root reads it. */
function declaredColours(theme: Theme): Readonly<Record<ColourVariable, string>> {
  const root = document.documentElement;
  const chosen = root.dataset['theme'];
  root.dataset['theme'] = theme;
  try {
    const style = getComputedStyle(root);
    const read = (name: ColourVariable): string => style.getPropertyValue(name).trim();
    return { '--ink': read('--ink'), '--paper': read('--paper'), '--muted': read('--muted') };
  } finally {
    if (chosen === undefined) {
      delete root.dataset['theme'];
    } else {
      root.dataset['theme'] = chosen;
    }
  }
}

/** One declared colour as `rgb()`, or the plain reason it is not one. */
function resolvedColour(name: ColourVariable, variables: Variables): string {
  const resolved = resolveVariables(variables[name] ?? '', variables);
  if (!resolved.ok) {
    throw new Error(`the page's ${name} is unresolved: ${resolved.unresolved}`);
  }
  const colour = readColour(resolved.value);
  if (colour === null) {
    throw new Error(`the page's ${name} is not a colour: ${resolved.value.trim()}`);
  }
  return colourText(colour);
}

/**
 * Rasterise the SVG on a canvas the size of its page, over the theme's paper.
 *
 * The page is asked for at 1:1 and the browser decides: a canvas too large for
 * it comes back at another size, or with no drawing context, or with nothing to
 * encode, and only then is the page too big for this export. A page this
 * browser can hold — 33,170×142, past the 32,767 a side an older canvas limit
 * had — is drawn whole.
 */
async function rasterise(
  svg: string,
  paper: string,
  page: { width: number; height: number },
  options: PngExport,
): Promise<Blob> {
  const width = Math.round(page.width * SCALE);
  const height = Math.round(page.height * SCALE);
  const source = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = source;
    // The drawing itself has to be readable whatever its size: a failure here
    // is the SVG's, not the canvas's.
    await image.decode();
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context =
        canvas.width === width && canvas.height === height ? canvas.getContext('2d') : null;
      if (context === null) {
        throw tooBig(options, page);
      }
      // The SVG carries the drawing, not the page: the paper is the canvas's.
      context.fillStyle = paper;
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      });
      if (blob === null) {
        throw tooBig(options, page);
      }
      return blob;
    } catch (error) {
      // Allocating the canvas and writing the PNG are the two steps a page too
      // large for this browser cannot do: anything else they throw is that.
      throw error instanceof TooBigForCanvas ? error : tooBig(options, page);
    }
  } finally {
    URL.revokeObjectURL(source);
  }
}

/** The page the SVG draws into, in Scene units: the size the Renderer wrote. */
function sizeOf(svg: string): { width: number; height: number } {
  const width = Number(/\bwidth="([\d.]+)"/.exec(svg)?.[1]);
  const height = Number(/\bheight="([\d.]+)"/.exec(svg)?.[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('the Renderer wrote no page size to draw');
  }
  return { width, height };
}

/** Hand the PNG to the browser's download, under the name `ez png` would give it. */
function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // The download reads the URL after this event, so it is released later.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
