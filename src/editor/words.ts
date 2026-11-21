/**
 * The words an Element holds, as the in-place editor reads and writes them.
 *
 * A Text is only words (`content`); every other Element may carry a Label. Both
 * live in the Scene, so this module only answers where the words sit, what they
 * say now, and what the Element becomes once a person has typed: the words
 * themselves, and the room a container needs for them, from the same Layout the
 * Renderer and `ez check` measure with. Nothing here paints or saves.
 */
import type { Layout, Shaft } from '../layout.js';
import { drawnShaft } from '../renderer.js';
import type { ArrowOrLineElement, Element, TextAlign } from '../scene.js';

/** `Label` for words that belong to an Element, `Text` for words that are one. */
export type WordsKind = 'Label' | 'Text';

/** Where the in-place editor opens, and what it opens on. */
export interface Field {
  /** The Scene point the field's top-left corner sits at. */
  readonly at: { x: number; y: number };
  /** The width the words wrap in, in Scene units, or null when they never wrap. */
  readonly wrap: number | null;
  /** Where the words sit in that width. */
  readonly align: TextAlign;
  readonly kind: WordsKind;
  /** The words the field opens with. */
  readonly words: string;
}

/** The words an Element holds now. */
export function wordsOf(element: Element): string {
  return element.type === 'text' ? element.content : (element.label ?? '');
}

/**
 * Where a person types this Element's words: over the box a Label fills, over
 * the words of a Text, and beside the middle of an arrow's or line's shaft. A
 * shaft with no Label yet is measured as an empty one, so its field opens
 * exactly where the words will land.
 */
export function fieldFor(
  element: Element,
  byId: ReadonlyMap<string, Element>,
  layout: Layout,
): Field {
  if (element.type === 'text') {
    const block = layout.text(element);
    return {
      at: { x: block.x, y: block.y },
      wrap: null,
      align: element.textAlign,
      kind: 'Text',
      words: element.content,
    };
  }
  if (element.type === 'arrow' || element.type === 'line') {
    const shaft: Shaft = shaftOf(element, byId);
    const block =
      layout.label(element, shaft) ?? layout.label({ ...element, label: '' }, shaft);
    return {
      at: { x: block?.x ?? shaft.start.x, y: block?.y ?? shaft.start.y },
      wrap: null,
      align: 'center',
      kind: 'Label',
      words: wordsOf(element),
    };
  }
  const area = layout.area(element);
  return {
    // A Label wraps in the box its Element gives it, which is also where its
    // lines sit: the field opens over that box, not over the words it holds now.
    at: area === null ? { x: element.x, y: element.y } : { x: area.x, y: area.y },
    wrap: area === null ? null : area.width,
    align: element.textAlign,
    kind: 'Label',
    words: wordsOf(element),
  };
}

/**
 * The Element with these words in it: a Label on everything but a Text, and the
 * room a container needs to hold it. The words a person cleared are gone, so a
 * Label that is not words stops being a Label; a Text's own words are the
 * caller's to keep or to delete.
 */
export function withWords(element: Element, words: string, layout: Layout): Element {
  if (element.type === 'text') {
    return { ...element, content: words };
  }
  const labelled =
    words === ''
      ? stripLabel(element)
      : { ...element, label: words };
  return layout.grow(labelled);
}

/**
 * The Element with the room its words need but not the words: while they are
 * typed, the field in front of the page shows them, and painting them twice
 * would put two copies on the screen, one of them a few pixels off.
 */
export function withoutWords(element: Element): Element {
  return element.type === 'text' ? { ...element, content: '' } : stripLabel(element);
}

/** The two ends an arrow or line draws, with Snap resolved: the shaft its Label belongs to. */
function shaftOf(
  element: ArrowOrLineElement,
  byId: ReadonlyMap<string, Element>,
): Shaft {
  const [start, end] = drawnShaft(element, byId);
  return { start, end };
}

/** The Element without its Label: an emptied Label leaves no `label` key behind. */
function stripLabel<T extends Element>(element: T): T {
  const { label: _dropped, ...rest } = element as Element & { label?: string };
  return rest as T;
}
