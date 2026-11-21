/**
 * The words an Element holds, as the in-place editor reads and writes them.
 *
 * A Text is only words (`content`); every other Element may carry a Label. Both
 * live in the Scene, so this module only answers what they say now and what the
 * Element becomes once a person has typed: the words themselves, the room a
 * container needs for them, from the same Layout the Renderer and `ez check`
 * measure with — and where a caret sits in words that are already drawn.
 * Nothing here paints, places a field or saves.
 */
import type { Layout } from '../layout.js';
import type { Element } from '../scene.js';

/** The words an Element holds now. */
export function wordsOf(element: Element): string {
  return element.type === 'text' ? element.content : (element.label ?? '');
}

/**
 * The Element as the page draws it while its words are typed: a Label that is
 * empty for now stays one, so the words being typed have a place for a caret
 * even when they are none. Nothing of the Scene changes here.
 */
export function shownWords<T extends Element>(element: T): T {
  if (element.type === 'text' || element.label !== undefined) {
    return element;
  }
  return { ...element, label: '' };
}

/**
 * The words a Scene keeps from what a person typed: blank lines and spaces at
 * the ends are not words. The live preview and the commit both read the field
 * through here, so the ink on the page while typing is the ink that saves.
 */
export function keptWords(typed: string): string {
  return typed.trim();
}

/**
 * How much of what a person typed is not drawn: the blank space at the start,
 * which `keptWords` trims off the words the page shows. Zero when the page is
 * drawing the very words the field holds.
 */
function trimmedStart(typed: string, drawn: string): number {
  return drawn === typed ? 0 : typed.length - typed.trimStart().length;
}

/**
 * Where a caret offset in what a person typed lands in the words the page draws.
 * The field is the truth about the caret and the drawing is the truth about the
 * glyphs; this is the one step between them.
 */
export function drawnOffset(typed: string, drawn: string, offset: number): number {
  return clamp(offset - trimmedStart(typed, drawn), 0, drawn.length);
}

/** The other way: where a caret offset among the drawn glyphs lands in the field. */
export function typedOffset(typed: string, drawn: string, offset: number): number {
  return clamp(offset + trimmedStart(typed, drawn), 0, typed.length);
}

/** What a double-click counts as one word: letters, digits and the marks that go with them. */
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}_]/u;

/**
 * The word a double-click at an offset takes in. A caret just past a word is
 * still on it, so a double-click at the end of a word selects that word, and a
 * double-click on the space between two words takes the one before it. A click
 * on no word at all selects nothing.
 */
export function wordAt(words: string, offset: number): { from: number; to: number } {
  const isWord = (at: number): boolean => at >= 0 && at < words.length && WORD_CHARACTER.test(words[at]!);
  const at = !isWord(offset) && isWord(offset - 1) ? offset - 1 : offset;
  if (!isWord(at)) {
    return { from: offset, to: offset };
  }
  let from = at;
  let to = at + 1;
  while (isWord(from - 1)) {
    from -= 1;
  }
  while (isWord(to)) {
    to += 1;
  }
  return { from, to };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
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
