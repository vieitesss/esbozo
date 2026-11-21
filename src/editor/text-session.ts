/**
 * The in-place input a new Text is typed into.
 *
 * The words are typed where the Text will sit, in the hand font and at the size
 * the Text draws, so the page never has to guess what the Text will look like.
 * Enter on an empty line, Escape and a click away end the session; what it
 * holds is handed to the caller exactly once, trimmed, or empty when nothing
 * was typed. While it is open its keys are the input's, not the editor's.
 */
import type { Point } from './geometry.js';

/** Where the input sits and how big its words are. */
interface TextSessionPlace {
  /** The page point the Text's top-left corner sits at. */
  readonly page: Point;
  /** The zoom the page is at, so the words read at the size they will draw. */
  readonly zoom: number;
  /** The size the Text draws at, in Scene units. */
  readonly fontSize: number;
}

interface TextSessionOptions {
  /** Where the input is put: the editor, above the canvas. */
  readonly host: HTMLElement;
  readonly place: TextSessionPlace;
  /** Called once, with the words trimmed, or '' when a person typed none. */
  readonly commit: (content: string) => void;
}

export class TextSession {
  readonly #input: HTMLTextAreaElement;
  readonly #commit: (content: string) => void;
  #open = true;

  constructor(options: TextSessionOptions) {
    const { host, place, commit } = options;
    const input = document.createElement('textarea');
    input.className = 'text-input';
    input.setAttribute('aria-label', 'Text');
    input.rows = 1;
    input.spellcheck = false;
    input.style.left = `${place.page.x}px`;
    input.style.top = `${place.page.y}px`;
    input.style.fontSize = `${place.fontSize * place.zoom}px`;
    input.addEventListener('keydown', this.#onKeyDown);
    input.addEventListener('blur', this.#onBlur);
    this.#input = input;
    this.#commit = commit;
    host.append(input);
    input.focus();
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
    this.#open = false;
    const content = this.#input.value.trim();
    this.#input.remove();
    this.#commit(content);
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
    // Enter on an empty line is the end of the Text; anywhere else it is a
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
