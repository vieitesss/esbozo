/**
 * The words an Element holds, as the in-place editor reads and writes them.
 *
 * A Text is only words (`content`); every other Element may carry a Label. Both
 * live in the Scene, so this module only answers what they say now and what the
 * Element becomes once a person has typed: the words themselves, and the room a
 * container needs for them, from the same Layout the Renderer and `ez check`
 * measure with. Nothing here paints, places a field or saves.
 */
import type { Layout } from '../layout.js';
import type { Element } from '../scene.js';

/** The words an Element holds now. */
export function wordsOf(element: Element): string {
  return element.type === 'text' ? element.content : (element.label ?? '');
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

/** The Element without its Label: an emptied Label leaves no `label` key behind. */
function stripLabel<T extends Element>(element: T): T {
  const { label: _dropped, ...rest } = element as Element & { label?: string };
  return rest as T;
}
