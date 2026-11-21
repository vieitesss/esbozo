/**
 * PNG export: the Scene's own SVG, rasterised by the browser, downloaded.
 *
 * The bytes rasterised are the Renderer's SVG for the saved Scene — the same
 * document `ez render` writes and `ez png` draws — with two additions the
 * browser needs and the CLI does not. Its colours are resolved first, because
 * an SVG loaded as an image has no page around it and would paint `var(--ink)`
 * black; they come from the page's own variables, so the PNG shows the paper and
 * ink the person is looking at. And the hand font travels inside the SVG as a
 * data URL, because an SVG image cannot read the page's `@font-face`.
 *
 * The canvas draws at one pixel per Scene unit, which is the scale `ez png`
 * rasterises at, so the PNG has the CLI's size and, within the rasteriser's
 * antialiasing, its pixels.
 */
import { colourText, readColour, resolveSvgColours, resolveVariables } from '../css.js';
import type { Theme, Variables } from '../css.js';
import type { Layout } from '../layout.js';
import { renderScene } from '../renderer.js';
import type { Scene } from '../scene.js';

/** One pixel per Scene unit: what `ez png` draws at, so a PNG is the CLI's size. */
const SCALE = 1;

/** The colours the page's stylesheet declares for the theme, before any mixing. */
const COLOURS = ['--ink', '--paper', '--muted'] as const;
type ColourVariable = (typeof COLOURS)[number];

/** The hand font the page draws with, as the bytes an SVG can carry. */
export interface SceneFont {
  /** The family the page's CSS names, and the one the SVG is drawn in. */
  readonly family: string;
  readonly bytes: Uint8Array;
}

export interface PngExport {
  readonly scene: Scene;
  /** The page's measurement, so the words break where the saved SVG breaks them. */
  readonly layout: Layout;
  readonly font: SceneFont;
  readonly theme: Theme;
  /** The file name without its extension: `sketch` writes `sketch.light.png`. */
  readonly name: string;
}

/**
 * Draw the Scene as a PNG and hand it to the download: `<name>.<theme>.png`,
 * the same name `ez png` gives the same Scene and theme.
 */
export async function exportPng(options: PngExport): Promise<void> {
  const page = pageVariables(options.theme);
  const variables: Variables = { ...page, '--font-hand': options.font.family };
  const resolved = resolveSvgColours(renderScene(options.scene, options.layout), variables);
  if (!resolved.ok) {
    throw new Error(resolved.problems[0] ?? 'the drawing cannot be resolved');
  }
  const svg = withFont(resolved.value, options.font);
  const drawing = await rasterise(svg, page['--paper'], sizeOf(svg));
  download(drawing, `${options.name}.${options.theme}.png`);
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
 * The page's font inside the SVG. An image is drawn with no stylesheet and no
 * fonts of its own, so without this every word would fall back to a system font
 * and the PNG would not be the drawing.
 */
function withFont(svg: string, font: SceneFont): string {
  const face =
    `@font-face{font-family:"${font.family}";` +
    `src:url(${dataUrl(font)}) format("truetype");}`;
  return svg.replace(/(<svg\b[^>]*>)/, `$1<defs><style>${face}</style></defs>`);
}

/** The font bytes as the `data:` URL an SVG can carry with it. */
function dataUrl(font: SceneFont): string {
  const chunks: string[] = [];
  const CHUNK = 0x8000;
  for (let at = 0; at < font.bytes.length; at += CHUNK) {
    chunks.push(String.fromCharCode(...font.bytes.subarray(at, at + CHUNK)));
  }
  return `data:font/ttf;base64,${btoa(chunks.join(''))}`;
}

/** Rasterise the SVG on a canvas the size of its page, over the theme's paper. */
async function rasterise(
  svg: string,
  paper: string,
  page: { width: number; height: number },
): Promise<Blob> {
  const source = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(page.width * SCALE);
    canvas.height = Math.round(page.height * SCALE);
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('this browser cannot draw a PNG');
    }
    // The SVG carries the drawing, not the page: the paper is the canvas's.
    context.fillStyle = paper;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob === null) {
          reject(new Error('this browser cannot write a PNG'));
        } else {
          resolve(blob);
        }
      }, 'image/png');
    });
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
