/**
 * The in-place input a Text or a Label is typed into.
 *
 * The canvas is what shows the words as they will save: every keystroke is
 * handed to the caller, which repaints the Scene through the Renderer, the
 * Element grown for its words included. The input itself is only a small plain
 * box beside the Element — a place for the caret, the selection and an input
 * method's preedit — so it never claims to be the words and never has to match
 * how they break or where they land.
 *
 * The caller asks for a place as the Element grows and the view moves, and the
 * box keeps itself on the page and off the Style note from what it measures of
 * itself. It does not wrap at the Element's width, size its words, or line them
 * up: nothing here can drift from the drawing, because nothing here draws.
 *
 * A newline the person types is a line break the Scene keeps. Enter on an empty
 * line, Escape and a click away end the session; the raw value is handed to the
 * caller exactly once, untrimmed, so it can decide what an unchanged field
 * means and what the Scene will accept. The caller answers whether the words
 * may land: refused words keep the field open with them, so a person can fix
 * what the Scene would not hold. While it is open its keys are the input's, not
 * the editor's, and an input method's preedit is not words until it is
 * confirmed: keys do not end a composition, and finishing mid-composition keeps
 * only what was confirmed.
 */
import { overlaps } from './geometry.js';
import type { Box } from './geometry.js';

/** Room between the box and what it edits, and between the box and the page's edges, in page pixels. */
const FIELD_GAP = 6;
const FIELD_MARGIN = 12;

/** Where the input sits and what room the page has for it. */
export interface TextSessionPlace {
  /** The page box of what is being edited: the grown Element, or where a new Text's words will be. */
  readonly area: Box;
  /** The page's own size, in page pixels: the box stays on it. */
  readonly page: { readonly width: number; readonly height: number };
  /** The Style note's page box, which the box must not sit under, or null when there is none. */
  readonly note: Box | null;
}

interface TextSessionOptions {
  /** Where the input is put: the editor, above the canvas. */
  readonly host: HTMLElement;
  /** What the field holds, as it is called: "Label" or "Text". */
  readonly name: string;
  /** Where the box goes: asked once it is on the page, so it can measure itself. */
  readonly place: () => TextSessionPlace;
  /** The words it opens with, and where the caret goes: after them. */
  readonly words: string;
  /** Called with the words as typed, on every keystroke, so the page can draw them. */
  readonly typed?: (words: string) => void;
  /** Called once, with the field's value as it stands, untrimmed: true when the words may land. */
  readonly commit: (words: string) => boolean;
}

export class TextSession {
  readonly #input: HTMLTextAreaElement;
  readonly #commit: (words: string) => boolean;
  #open = true;
  /** True while an input method is composing: the value holds a preedit, not words yet. */
  #composing = false;
  /** What the field held before the composition started: the words a finish would keep. */
  #confirmed = '';

  constructor(options: TextSessionOptions) {
    const { host, name, place, words, typed, commit } = options;
    const input = document.createElement('textarea');
    input.className = 'text-input';
    input.setAttribute('aria-label', name);
    input.rows = 1;
    input.spellcheck = false;
    input.value = words;
    input.addEventListener('keydown', this.#onKeyDown);
    input.addEventListener('blur', this.#onBlur);
    input.addEventListener('compositionstart', this.#onCompositionStart);
    input.addEventListener('compositionend', this.#onCompositionEnd);
    if (typed !== undefined) {
      input.addEventListener('input', () => typed(input.value));
    }
    this.#input = input;
    this.#commit = commit;
    host.append(input);
    // On the page before it is placed: its own size is what the place is measured from.
    this.place(place());
    input.focus();
    // The caret goes after the words, where a person adding to them looks for it.
    input.setSelectionRange(input.value.length, input.value.length);
  }

  /**
   * Put the box beside what it edits: under it when the page has room, above it
   * when it has not, always on the page, and to the left of the Style note when
   * it would sit under it. The caller asks again on every keystroke and on every
   * move of the view, so the box follows the Element and the page.
   */
  place(place: TextSessionPlace): void {
    const input = this.#input;
    const width = input.offsetWidth;
    const height = input.offsetHeight;
    const { area, page, note } = place;
    const under = area.y + area.height + FIELD_GAP;
    const over = area.y - FIELD_GAP - height;
    const y =
      under + height <= page.height - FIELD_MARGIN
        ? under
        : over >= FIELD_MARGIN
          ? over
          : Math.max(FIELD_MARGIN, page.height - FIELD_MARGIN - height);
    let x = Math.max(FIELD_MARGIN, Math.min(area.x, page.width - FIELD_MARGIN - width));
    if (note !== null && overlaps({ x, y, width, height }, note)) {
      const left = note.x - FIELD_GAP - width;
      if (left >= FIELD_MARGIN) {
        x = left;
      }
    }
    input.style.left = `${Math.round(x)}px`;
    input.style.top = `${Math.round(y)}px`;
  }

  /** Whether this press is the field's own: a press in it moves its caret, and nothing else. */
  holds(target: Node | null): boolean {
    return this.#input.contains(target);
  }

  /**
   * End the session: the words, or nothing, and the input goes. The click that
   * takes the focus off the words is followed by a blur that ends the same
   * session again, so a second call does nothing. Words the caller will not
   * keep leave the field open with them, and no answer of that kind closes it.
   */
  finish(): boolean {
    if (!this.#open) {
      return true;
    }
    // A composition still open has not been confirmed: its preedit is not words
    // a person wrote yet, so what the field held before it is what is kept.
    const words = this.#composing ? this.#confirmed : this.#input.value;
    if (!this.#commit(words)) {
      return false;
    }
    this.#open = false;
    this.#input.remove();
    return true;
  }

  /** Give up on the words: the field goes and the caller keeps the Scene it had. */
  discard(): void {
    if (!this.#open) {
      return;
    }
    this.#open = false;
    this.#input.remove();
  }

  #onCompositionStart = (): void => {
    this.#composing = true;
    this.#confirmed = this.#input.value;
  };

  #onCompositionEnd = (): void => {
    this.#composing = false;
  };

  #onKeyDown = (event: KeyboardEvent): void => {
    // An input method owns the keys while it composes: Escape and Enter belong
    // to the candidate list, and ending the session on them would take the
    // words away from under the person still choosing them.
    if (event.isComposing || this.#composing) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      // Escape leaves the words when they cannot land: refused words are the
      // one thing a person must still be able to walk away from.
      if (!this.finish()) {
        this.discard();
      }
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    // Enter on an empty line is the end of the words; anywhere else it is a
    // line break, which the textarea inserts itself.
    const before = this.#input.value.slice(0, this.#input.selectionStart);
    if (before.slice(before.lastIndexOf('\n') + 1).trim() === '') {
      event.preventDefault();
      this.finish();
    }
  };

  #onBlur = (): void => {
    // Words the Scene refused keep the field, so the person can fix them: the
    // focus goes back to what they were typing.
    if (!this.finish()) {
      this.#input.focus();
    }
  };
}
