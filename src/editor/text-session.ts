/**
 * The in-place input a Text or a Label is typed into.
 *
 * The words are typed where the words will sit, in the hand font and at the size
 * they draw, so the page never has to guess what they will look like. A Label
 * wraps in the box its Element gives it and the box widens the field to match;
 * a Text and the Label of an arrow or a line never wrap, so their field grows
 * with what is typed instead.
 *
 * A newline the person types is a line break the Scene keeps. Enter on an empty
 * line, Escape and a click away end the session; what it holds is handed to the
 * caller exactly once, trimmed, or empty when nothing was typed. Every keystroke
 * is also handed over as it happens, so what holds the words can grow with them.
 * While it is open its keys are the input's, not the editor's.
 */
import type { Point } from './geometry.js';

/** Where the input sits and how big its words are. */
interface TextSessionPlace {
  /** The page point the words' top-left corner sits at. */
  readonly page: Point;
  /** The zoom the page is at, so the words read at the size they will draw. */
  readonly zoom: number;
  /** The size the words draw at, in Scene units. */
  readonly fontSize: number;
  /** The width the words wrap in, in Scene units, or null when they never wrap. */
  readonly wrap: number | null;
  /** Where the words sit in that width. */
  readonly align: 'left' | 'center' | 'right';
}

interface TextSessionOptions {
  /** Where the input is put: the editor, above the canvas. */
  readonly host: HTMLElement;
  /** What the field holds, as it is called: "Label" or "Text". */
  readonly name: string;
  readonly place: TextSessionPlace;
  /** The words it opens with, and where the caret goes: after them. */
  readonly words: string;
  /** Called with the words as typed, on every keystroke, so they can grow what holds them. */
  readonly typed?: (words: string) => void;
  /** Called once, with the words trimmed, or '' when a person typed none. */
  readonly commit: (words: string) => void;
}

export class TextSession {
  readonly #input: HTMLTextAreaElement;
  readonly #commit: (words: string) => void;
  #open = true;

  constructor(options: TextSessionOptions) {
    const { host, name, place, words, typed, commit } = options;
    const input = document.createElement('textarea');
    input.className = 'text-input';
    input.classList.toggle('wrap', place.wrap !== null);
    input.setAttribute('aria-label', name);
    input.rows = 1;
    input.spellcheck = false;
    input.style.left = `${place.page.x}px`;
    input.style.top = `${place.page.y}px`;
    input.style.fontSize = `${place.fontSize * place.zoom}px`;
    input.style.textAlign = place.align;
    if (place.wrap !== null) {
      // A Label wraps where its Element wraps it: the field is that box, in page
      // pixels, so a line breaks where the Scene will break it.
      input.style.width = `${place.wrap * place.zoom}px`;
    }
    input.value = words;
    input.addEventListener('keydown', this.#onKeyDown);
    input.addEventListener('blur', this.#onBlur);
    if (typed !== undefined) {
      input.addEventListener('input', () => {
        this.#fit();
        typed(input.value);
      });
    }
    this.#input = input;
    this.#commit = commit;
    host.append(input);
    input.focus();
    // The caret goes after the words, where a person adding to them looks for it.
    input.setSelectionRange(input.value.length, input.value.length);
    this.#fit();
  }

  /**
   * End the session: the words, or nothing, and the input goes. The click that
   * takes the focus off the words is followed by a blur that ends the same
   * session again, so a second call does nothing.
   */
  finish(): void {
    if (!this.#open) {
      return;
    }
    const words = this.#close();
    this.#commit(words);
  }

  /**
   * End the session without its words: the Scene moved on under the input, so
   * what was typed into it belongs to nothing.
   */
  cancel(): void {
    if (!this.#open) {
      return;
    }
    this.#close();
  }

  /** The input goes, and is read once: whatever asked for the end gets the words. */
  #close(): string {
    this.#open = false;
    const words = this.#input.value.trim();
    this.#input.remove();
    return words;
  }

  /** A wrapping field is as tall as the lines it holds; a field that never wraps grows by itself. */
  #fit(): void {
    if (!this.#input.classList.contains('wrap')) {
      return;
    }
    // The lines have to be laid out before they can be counted: a field that
    // still holds the old height measures the old wrapping.
    this.#input.style.height = 'auto';
    this.#input.style.height = `${this.#input.scrollHeight}px`;
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.finish();
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
    this.finish();
  };
}
