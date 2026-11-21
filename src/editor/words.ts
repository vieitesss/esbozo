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
import type { Element, TextAlign } from '../scene.js';
/** Where the in-place editor opens, and what it opens on. */
interface Field {
  /** The Scene point the field's top-left corner sits at. */
  readonly at: { x: number; y: number };
  /** The width the words wrap in, in Scene units, or null when they never wrap. */
  readonly wrap: number | null;
  /** Where the words sit in that width. */
  readonly align: TextAlign;
  /** The words the field opens with. */
  readonly words: string;
}

/** The words an Element holds now. */
export function wordsOf(element: Element): string {
  return element.type === 'text' ? element.content : (element.label ?? '');
}

/**
 * Where a person types this Element's words: over the box a Label fills, over
 * the words of a Text, and beside the middle of an arrow's or line's shaft.
 *
 * The place comes from the words the Element holds *now*, so asking again as
 * they change is asking the Layout the Renderer would draw. A shaft with no
 * Label yet, and a box with no Label, are measured as holding one empty line,
 * so their field opens exactly where the first words will land rather than at
 * a corner that would jump on the first keystroke.
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
      words: element.content,
    };
  }
  if (element.type === 'arrow' || element.type === 'line') {
    const [start, end] = drawnShaft(element, byId);
    const shaft: Shaft = { start, end };
    const block =
      layout.label(element, shaft) ?? layout.label({ ...element, label: ' ' }, shaft);
    return {
      at: { x: block?.x ?? start.x, y: block?.y ?? start.y },
      wrap: null,
      align: 'center',
      words: wordsOf(element),
    };
  }
  const area = layout.area(element);
  if (area === null) {
    return { at: { x: element.x, y: element.y }, wrap: null, align: element.textAlign, words: wordsOf(element) };
  }
  // The words wrap in the box the Element gives them, and their first line
  // sits where the Renderer puts it inside that box, not at its top edge.
  const block = layout.label(element) ?? layout.label({ ...element, label: ' ' });
  return {
    at: { x: area.x, y: block?.y ?? area.y },
    wrap: area.width,
    align: element.textAlign,
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
  const labelled = words === '' ? stripLabel(element) : { ...element, label: words };
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

/** The Element without its Label: an emptied Label leaves no `label` key behind. */
function stripLabel<T extends Element>(element: T): T {
  const { label: _dropped, ...rest } = element as Element & { label?: string };
  return rest as T;
}
