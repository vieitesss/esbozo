/**
 * Where the glyphs the page draws really are.
 *
 * Layout places a Block from the font file's metrics, and the page draws its
 * lines as `<text>`: the browser lays those glyphs out with whatever fallback
 * font the hand font lacks, and in the direction the words read. So the only
 * truthful answer to where a boundary sits comes from the element that drew it,
 * and this reads that element — boundary by boundary, and glyph by glyph — for
 * the caret, the selection and the press.
 *
 * The positions are the ones the element is drawn at, in Scene coordinates: an
 * ancestor's transform moves the ink and the caret on the page together, and is
 * no part of where the glyphs are in the words.
 */
import type { Block, Box, DrawnLine, GlyphBox, Line, LineGlyphs } from '../layout.js';

/**
 * The drawn glyphs of every line of a Block, read from the `<text>` elements of
 * the group that drew it, in the order the lines were drawn. A line the page
 * draws nothing for — the empty slot an emptied Label keeps — has no glyphs, and
 * its caret stands where the words would start.
 */
export function drawnGlyphs(group: Element | null, block: Block): LineGlyphs {
  const nodes = group === null ? [] : [...group.querySelectorAll('text')];
  const drawn = new Map<Line, DrawnLine>();
  let at = 0;
  for (const line of block.lines) {
    if (line.text === '') {
      // An empty line draws no glyph to answer with, so its one boundary is the
      // edge it anchors on: the left one, the centre or the right one, whatever
      // the other lines are wide. The widest line's left edge is none of those.
      drawn.set(line, { boundaries: [line.x], glyphs: [] });
      continue;
    }
    const node = nodes[at];
    at += 1;
    if (node !== undefined && node.textContent === line.text) {
      drawn.set(line, drawnLine(node, line));
    }
  }
  return (line) => drawn.get(line) ?? { boundaries: [line.x], glyphs: [] };
}

/** The box the drawn glyphs cover: their own boxes, on the lines they were drawn on. */
export function drawnBox(block: Block, glyphs: LineGlyphs): Box {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const line of block.lines) {
    for (const glyph of glyphs(line).glyphs) {
      left = Math.min(left, glyph.left);
      right = Math.max(right, glyph.right);
    }
  }
  if (left > right) {
    return { x: block.x, y: block.y, width: 0, height: block.height };
  }
  return { x: left, y: block.y, width: right - left, height: block.height };
}

/**
 * One drawn line, in the words' own order: the start of each glyph, the end of
 * the last one, and the box each of them covers. A right-to-left run starts at
 * its right edge and steps left, and the glyph at its end stops where no
 * boundary of the line does — which is why the boxes are read as well.
 */
function drawnLine(node: SVGTextElement, line: Line): DrawnLine {
  const chars = node.getNumberOfChars();
  // A browser counts one character per offset, as the Layout did. A line where
  // the two disagree has no boundaries that a caret offset could name.
  if (chars !== line.text.length) {
    return { boundaries: [line.x], glyphs: [] };
  }
  const boundaries: number[] = [];
  const glyphs: GlyphBox[] = [];
  for (let index = 0; index < chars; index += 1) {
    const start = node.getStartPositionOfChar(index).x;
    const end = node.getEndPositionOfChar(index).x;
    boundaries.push(start);
    glyphs.push({ left: Math.min(start, end), right: Math.max(start, end) });
  }
  boundaries.push(node.getEndPositionOfChar(chars - 1).x);
  return { boundaries, glyphs };
}
