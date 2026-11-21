/**
 * Where the glyphs the page draws really are.
 *
 * Layout places a Block from the font file's metrics, and the page draws its
 * lines as `<text>`: the browser lays those glyphs out with whatever fallback
 * font the hand font lacks, and in the direction the words read. So the only
 * truthful answer to where a boundary sits comes from the element that drew it,
 * and this reads that element — boundary by boundary — for the caret, the
 * selection and the press.
 *
 * The positions are the ones the element is drawn at, in Scene coordinates: an
 * ancestor's transform moves the ink and the caret on the page together, and is
 * no part of where the glyphs are in the words.
 */
import type { Block, Box, GlyphBoundaries, Line } from '../layout.js';

/**
 * The drawn boundaries of every line of a Block, read from the `<text>` elements
 * of the group that drew it, in the order the lines were drawn. A line the page
 * draws nothing for — the empty slot an emptied Label keeps — has no glyphs, and
 * its caret stands where the words would start.
 */
export function drawnGlyphs(group: Element | null, block: Block): GlyphBoundaries {
  const nodes = group === null ? [] : [...group.querySelectorAll('text')];
  const xs = new Map<Line, readonly number[]>();
  let drawn = 0;
  for (const line of block.lines) {
    if (line.text === '') {
      // An empty line is no ink wide, so every anchor puts its edge in one place.
      xs.set(line, [block.x]);
      continue;
    }
    const node = nodes[drawn];
    drawn += 1;
    if (node !== undefined && node.textContent === line.text) {
      xs.set(line, boundaryXs(node, line));
    }
  }
  return (line) => xs.get(line) ?? [line.x];
}

/** The box the drawn glyphs cover: their own boundaries, on the lines they were drawn. */
export function drawnBox(block: Block, glyphs: GlyphBoundaries): Box {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const line of block.lines) {
    for (const x of glyphs(line)) {
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  if (left > right) {
    return { x: block.x, y: block.y, width: 0, height: block.height };
  }
  return { x: left, y: block.y, width: right - left, height: block.height };
}

/**
 * The x of each boundary of one drawn line, in the words' own order: the start
 * of each glyph, and the end of the last one. Left to right they rise, and a
 * right-to-left run puts them the other way round, which is the point of asking
 * the drawing rather than measuring a prefix.
 */
function boundaryXs(node: SVGTextElement, line: Line): readonly number[] {
  const chars = node.getNumberOfChars();
  // A browser counts one character per offset, as the Layout did. A line where
  // the two disagree has no boundaries that a caret offset could name.
  if (chars !== line.text.length) {
    return [line.x];
  }
  const xs = Array.from({ length: chars }, (_, index) => node.getStartPositionOfChar(index).x);
  xs.push(node.getEndPositionOfChar(chars - 1).x);
  return xs;
}
