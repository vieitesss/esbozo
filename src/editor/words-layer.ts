/**
 * Where the caret, the selection and an input method's preedit are drawn.
 *
 * The page is the only ink: the field a person types into is transparent, takes
 * no pointer, and its own caret and highlight are never on screen. It is moved
 * over the caret instead, which is where a browser opens the candidate window of
 * an input method — so the words a person sees are the Renderer's glyphs, and a
 * caret is mapped through the very words the drawing placed.
 *
 * Two layers, because they scale differently. The washes go into the Element's
 * own drawing, above the fill it was painted with and under its glyphs, in Scene
 * coordinates, so the ink inside them keeps its own colour. The caret and the
 * preedit's rule go into the overlay, in screen pixels, so they keep their width
 * at every zoom. Nothing here measures: the Block and its glyphs are handed in,
 * already the ones the page drew.
 */
import type { Block, Layout, LineGlyphs } from '../layout.js';
import { caretLine } from './geometry.js';
import type { Box } from './geometry.js';
import type { TextSessionState } from './text-session.js';
import type { WordsShift } from './words.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** How thick the rule under a preedit is, in screen pixels. */
const PREEDIT_RULE = 1.5;

/** What the words being typed are, and where they were drawn. */
export interface WordsInk {
  /** The measurement the words were laid out with. */
  readonly layout: Layout;
  /** The Block the drawing placed the words in. */
  readonly block: Block;
  /** Where the glyphs came out. */
  readonly glyphs: LineGlyphs;
  /** The step from the field's words to the drawn ones. */
  readonly shift: WordsShift;
  /** What the field holds: the words, the selection, the caret and a preedit. */
  readonly state: TextSessionState;
  /** The Element's own drawing, which the washes go inside. */
  readonly group: SVGGElement | null;
  /** A Scene box, in the pixels the overlay draws in. */
  readonly pageBox: (box: Box) => Box;
  /** Move the field over the caret, so an input method opens its candidates there. */
  readonly spot: (slot: Box) => void;
}

/** One frame of the words: the layer that holds them, and the washes it put in an Element. */
export interface DrawnWords {
  readonly layer: SVGGElement;
  /** The washes, in the Element's own group, which the next frame has to take out. */
  readonly washes: SVGRectElement[];
}

/**
 * Draw the words being typed into the overlay, and wash the runs they hold. The
 * caller drops the previous frame's layer and washes before the page changes.
 */
export function drawWords(overlay: SVGGElement, ink: WordsInk): DrawnWords {
  const { layout, block, glyphs, shift, state, pageBox } = ink;
  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('class', 'words');
  overlay.append(layer);
  const at = (offset: number): number => shift.drawn(offset);
  const washes: SVGRectElement[] = [];
  const wash = (box: Box, name: 'words-selection' | 'preedit'): void => {
    const node = rect({ ...box, class: name });
    const group = ink.group;
    if (group === null) {
      return;
    }
    const glyph = [...group.children].find((child) => child.tagName.toLowerCase() === 'text');
    group.insertBefore(node, glyph ?? null);
    washes.push(node);
  };

  for (const box of layout.selection(block, at(state.start), at(state.end), glyphs)) {
    wash(box, 'words-selection');
  }

  const preedit = state.preedit;
  if (preedit !== null) {
    for (const box of layout.selection(block, at(preedit.from), at(preedit.to), glyphs)) {
      wash(box, 'preedit');
      const page = pageBox(box);
      layer.append(
        rect({
          x: page.x,
          y: page.y + page.height - PREEDIT_RULE,
          width: page.width,
          height: PREEDIT_RULE,
          class: 'preedit-rule',
        }),
      );
    }
  }

  const caret = layout.caret(block, at(state.caret), glyphs);
  const slot = pageBox({ x: caret.x, y: caret.y, width: 0, height: caret.height });
  layer.append(caretPath(slot));
  ink.spot(slot);
  return { layer, washes };
}

/** Take the previous frame's washes out of the Element that held them. */
export function clearWashes(washes: readonly SVGRectElement[]): void {
  for (const wash of washes) {
    wash.remove();
  }
}

/** One rectangle of the page's own drawing, at the place it was measured. */
export function rect(attributes: {
  x: number;
  y: number;
  width: number;
  height: number;
  class: string;
}): SVGRectElement {
  const node = document.createElementNS(SVG_NS, 'rect');
  node.setAttribute('x', String(attributes.x));
  node.setAttribute('y', String(attributes.y));
  node.setAttribute('width', String(Math.max(attributes.width, 0)));
  node.setAttribute('height', String(Math.max(attributes.height, 0)));
  node.setAttribute('class', attributes.class);
  return node;
}

/**
 * The caret on the page, as the drawing gives it: the line and the stroke its
 * slot takes, made into the one path the overlay holds.
 */
function caretPath(slot: Box): SVGPathElement {
  const line = caretLine(slot);
  const node = document.createElementNS(SVG_NS, 'path');
  node.setAttribute('class', 'caret');
  node.setAttribute('stroke-width', String(line.stroke));
  node.setAttribute('d', line.path);
  return node;
}
