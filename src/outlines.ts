/**
 * Outlines: a Renderer's SVG with its words drawn as the font's own curves.
 *
 * The Renderer writes each line of a Text or Label as one `<text>`, because a
 * host draws it and a person can select it. A PNG cannot keep it: the text
 * engine that rasterises an SVG lays the line out again — with its own shaping,
 * hinting and antialiasing — so a page of words comes out visibly different
 * from the drawing the CLI's rasteriser makes from the same file. This pass
 * replaces each `<text>` with the glyph outlines of the same font at the same
 * place, and both rasterisers are left with the same curves.
 *
 * The pass is deliberately strict: an SVG it cannot fully outline is a problem,
 * never a drawing that quietly keeps its words in another typeface or loses the
 * words it could not place.
 */
import type { Glyphs, TextAnchor } from './glyphs.js';

export type OutlinedSvg =
  | { ok: true; svg: string }
  | { ok: false; problems: string[] };

/** One `<text>` element of the Renderer's SVG, as the pass reads it. */
const TEXT = /<text([^>]*)>([\s\S]*?)<\/text>/g;
/** The attributes a line is placed by, as the Renderer writes them. */
const ATTRIBUTE = /([\w:-]+)="([^"]*)"/g;

/** The words of a Renderer's SVG, as the glyph outlines of the font. */
export function outlineText(svg: string, glyphs: Glyphs): OutlinedSvg {
  const drawn: string[] = [];
  let problem: string | null = null;
  let line = TEXT.exec(svg);
  while (line !== null) {
    const attributes = attributesOf(line[1] ?? '');
    const text = unescapeXml(line[2] ?? '');
    const size = Number(attributes['font-size']);
    const x = Number(attributes['x']);
    const baseline = Number(attributes['y']);
    if (!Number.isFinite(size) || !Number.isFinite(x) || !Number.isFinite(baseline)) {
      return { ok: false, problems: ['a line of words has no place to be drawn at'] };
    }
    const path = glyphs.path(text, size, x, baseline, anchorOf(attributes['text-anchor']));
    if (path === null) {
      problem ??= 'a line of words cannot be drawn from the font the Scene was measured with';
      drawn.push('');
    } else {
      drawn.push(
        path === '' ? '' : `<path d="${path}" fill="${attributes['fill'] ?? 'currentColor'}"/>`,
      );
    }
    line = TEXT.exec(svg);
  }
  if (problem !== null) {
    return { ok: false, problems: [problem] };
  }
  const outlined = svg.replace(TEXT, () => drawn.shift() ?? '');
  if (outlined.includes('<text')) {
    return { ok: false, problems: ['the drawing has words this page cannot outline'] };
  }
  return { ok: true, svg: outlined };
}

function attributesOf(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let match = ATTRIBUTE.exec(source);
  while (match !== null) {
    attributes[match[1] ?? ''] = match[2] ?? '';
    match = ATTRIBUTE.exec(source);
  }
  ATTRIBUTE.lastIndex = 0;
  return attributes;
}

function anchorOf(anchor: string | undefined): TextAnchor {
  return anchor === 'middle' || anchor === 'end' ? anchor : 'start';
}

/** The text of an element, as the author wrote it. */
function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}
