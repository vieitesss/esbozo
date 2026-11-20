/**
 * Renderer: a Scene in, an SVG string out.
 *
 * Pure and deterministic: the same Scene always produces byte-identical SVG.
 * Rough.js supplies the hand-drawn path data through its generator API (no DOM
 * and no canvas), and each Element draws with its own stored seed and
 * roughness, so nothing depends on Math.random or on the order of runs.
 *
 * Colours and the font are never spelled out: they come from `var(--ink)`,
 * `var(--paper)`, `var(--muted)` and `var(--font-hand)`, which hosts set. Each
 * grey step is a fixed `color-mix` of ink into paper, an opaque colour, so an
 * overlap never darkens and a host backdrop other than paper never shows
 * through. A hachure fill takes one step more ink than a solid fill so the two
 * read as the same weight. The Scene hash is written into `data-scene-hash` so
 * an SVG can always be traced back to the Scene it came from, and the root
 * `<svg role="img">` carries its accessible name as its own first-child
 * `<title>`, with no document-wide id to collide with.
 */
import { RoughGenerator } from 'roughjs/bin/generator.js';
import type { Options } from 'roughjs/bin/core.js';
import { hashScene } from './scene.js';
import type { Element, Scene } from './scene.js';

const INK = 'var(--ink)';
const MUTED = 'var(--muted)';
const PAPER = 'var(--paper)';
const FONT = 'var(--font-hand)';

/** Padding around the Scene's Elements, in whole pixels. */
const PADDING = 16;
/** Size of an empty Scene's page, in whole pixels. */
const EMPTY_PAGE = { width: 320, height: 240 };

/**
 * The seven-grey ladder, as the percentage of ink mixed into paper for each
 * step: 0 is bare paper, 6 is solid ink. #3 owns the final ladder; this one
 * only has to be readable and monotonic.
 */
const GREY_INK_PERCENT = [0, 12, 24, 38, 55, 72, 100] as const;
const GREY_LAST = GREY_INK_PERCENT.length - 1;

export function renderScene(scene: Scene): string {
  const hash = hashScene(scene);
  const page = pageBounds(scene);
  const body = scene.elements.map(renderElement).join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}"` +
      ` viewBox="${page.x} ${page.y} ${page.width} ${page.height}"` +
      ` role="img" font-family="${FONT}" data-scene-hash="sha256:${hash}">`,
    `<title>${escapeXml(scene.title)}</title>`,
    body,
    '</svg>',
    '',
  ].join('\n');
}

interface Page {
  x: number;
  y: number;
  width: number;
  height: number;
}

function pageBounds(scene: Scene): Page {
  if (scene.elements.length === 0) {
    return { x: 0, y: 0, ...EMPTY_PAGE };
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const element of scene.elements) {
    left = Math.min(left, element.x);
    top = Math.min(top, element.y);
    right = Math.max(right, element.x + element.width);
    bottom = Math.max(bottom, element.y + element.height);
  }
  const x = left - PADDING;
  const y = top - PADDING;
  return {
    x,
    y,
    width: right + PADDING - x,
    height: bottom + PADDING - y,
  };
}

/**
 * One Element: its fill first, then its outline, so the ink of the outline
 * always sits on top of the fill it belongs to.
 */
function renderElement(element: Element): string {
  const generator = new RoughGenerator();
  // Scene geometry is already whole pixels: parse rounds once, so nothing here rounds again.
  const geometry: [number, number, number, number] = [
    element.x,
    element.y,
    element.width,
    element.height,
  ];
  const strokeColour = element.tone === 'muted' ? MUTED : INK;
  const paths: string[] = [];

  if (element.fill.kind !== 'none') {
    // A hachure fill is drawn as lines, so it needs one step more ink than a
    // solid wash to read as the same grey.
    const grey =
      element.fill.kind === 'hachure'
        ? Math.min(element.fill.grey + 1, GREY_LAST)
        : element.fill.grey;
    const colour = greyColour(grey);
    const options: Options = {
      stroke: 'none',
      fill: colour,
      fillStyle: element.fill.kind === 'solid' ? 'solid' : 'hachure',
      fillWeight: Math.max(1, element.stroke.width / 2),
      roughness: element.roughness,
      seed: element.seed,
      strokeWidth: element.stroke.width,
    };
    for (const path of generator.toPaths(generator.rectangle(...geometry, options))) {
      if (path.fill !== 'none') {
        paths.push(`<path d="${pathData(path.d)}" fill="${colour}"/>`);
      } else {
        paths.push(
          `<path d="${pathData(path.d)}" fill="none" stroke="${colour}"` +
            ` stroke-width="${formatNumber(path.strokeWidth)}"/>`,
        );
      }
    }
  }

  const outlineOptions: Options = {
    stroke: strokeColour,
    strokeWidth: element.stroke.width,
    roughness: element.roughness,
    seed: element.seed,
  };
  const dash = strokeDash(element.stroke.width, element.stroke.style);
  for (const path of generator.toPaths(generator.rectangle(...geometry, outlineOptions))) {
    paths.push(
      `<path d="${pathData(path.d)}" fill="none" stroke="${path.stroke}"` +
        ` stroke-width="${formatNumber(path.strokeWidth)}"${dash}/>`,
    );
  }

  return `<g stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</g>`;
}

/**
 * One grey step as a fixed mix of ink into paper. Grey 0 is bare paper and grey
 * 6 is solid ink; the steps between are opaque colours, so two overlapping
 * fills keep one grey and a host backdrop never shows through.
 */
function greyColour(grey: number): string {
  const percent = GREY_INK_PERCENT[grey] ?? 0;
  if (percent === 0) {
    return PAPER;
  }
  if (percent === GREY_INK_PERCENT[GREY_LAST]) {
    return INK;
  }
  return `color-mix(in srgb, ${INK} ${percent}%, ${PAPER})`;
}

function strokeDash(width: number, style: Element['stroke']['style']): string {
  if (style === 'solid') {
    return '';
  }
  if (style === 'dashed') {
    return ` stroke-dasharray="${formatNumber(width * 3)} ${formatNumber(width * 3)}"`;
  }
  return ` stroke-dasharray="${formatNumber(width)} ${formatNumber(width * 2)}"`;
}

/**
 * Rough.js emits full float precision. Two decimals is plenty for a hand-drawn
 * path and keeps the SVG small; the rounding is exact, so runs stay identical.
 */
function pathData(d: string): string {
  return d.replace(/-?\d+(?:\.\d+)?/g, (token) => formatNumber(Number(token)));
}

/** Locale-free, trailing-zero-free number formatting. */
function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
