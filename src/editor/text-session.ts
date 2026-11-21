/**
 * The in-place input a Text or a Label is typed into.
 *
 * The canvas is what shows the words as they will save: every keystroke is
 * handed to the caller, which repaints the Scene through the Renderer, the
 * Element grown for its words included. The input itself is only a sink for
 * what a browser gives an editable field and a drawing cannot: the focus, the
 * keyboard, the selection keys, the clipboard, undo, an input method and the
 * accessibility tree. Its words, its caret and its selection are never shown:
 * it is transparent, it takes no pointer, and it is placed over the caret so
 * the candidate window of an input method opens at the words.
 *
 * Everything it holds is answered by `state`: the words, where the caret and
 * the selection are in them, and the preedit an input method is still
 * composing. The caller maps those offsets onto the glyphs the same Layout
 * placed, draws the caret and the highlight there, and asks for a redraw
 * through `moved` whenever they change — a keystroke, an arrow key, a press
 * inside the words, a composition. The keys that walk a line, Up, Down, Home
 * and End, are the caller's too, through `line`: the field's own lines are not
 * the drawn ones. Nothing here measures or draws, so nothing here can drift
 * from the drawing.
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
import type { Box } from './geometry.js';

/** The keys whose caret walks the lines the words are drawn on. */
export type LineKey = 'up' | 'down' | 'home' | 'end';

/** The key a `KeyboardEvent` names, when it is one of those. */
const LINE_KEYS: Record<string, LineKey | undefined> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
};

/** What the field holds now: the words, the caret, the selection and a preedit still open. */
export interface TextSessionState {
  /** The field's value, exactly as typed: the words before the Scene trims them. */
  readonly words: string;
  /** Where the caret is, and where the selection ends, as offsets into `words`. */
  readonly start: number;
  readonly end: number;
  /**
   * The end of the selection the caret is on: `start` after a selection made
   * right to left, and `end` otherwise, where the caret is drawn.
   */
  readonly caret: number;
  /**
   * The run an input method is composing, or null when it is composing nothing.
   * Its words are already the field's — a preedit is drawn, not hidden — but
   * they are underlined until they are confirmed.
   */
  readonly preedit: { readonly from: number; readonly to: number } | null;
}

interface TextSessionOptions {
  /** Where the field is put: the editor, above the canvas. */
  readonly host: HTMLElement;
  /** What the field holds, as it is called: "Label" or "Text". */
  readonly name: string;
  /** The words it opens with, and where the caret goes: after them. */
  readonly words: string;
  /** Called with the words as typed, on every keystroke, so the page can draw them. */
  readonly typed?: (words: string) => void;
  /** Called whenever what the field holds or where its caret is changes, so the page can draw it. */
  readonly moved?: () => void;
  /**
   * Where a key that walks the lines the words are drawn on puts the caret, as
   * an offset into the field's words, or null to leave the key to the field. A
   * drawn line is not the field's line: a Label wraps into several with no
   * newline in the value, so only the caller that laid the words out knows
   * where they are.
   */
  readonly line?: (key: LineKey, state: TextSessionState) => number | null;
  /** Called once, with the field's value as it stands, untrimmed: true when the words may land. */
  readonly commit: (words: string) => boolean;
  /** Called once the session is over, by any way out: the caller drops what it drew. */
  readonly ended: () => void;
}

export class TextSession {
  readonly #input: HTMLTextAreaElement;
  readonly #moved: () => void;
  readonly #line: ((key: LineKey, state: TextSessionState) => number | null) | null;
  readonly #commit: (words: string) => boolean;
  readonly #ended: () => void;
  #open = true;
  /** True while an input method is composing: the value holds a preedit, not words yet. */
  #composing = false;
  /** What the field held before the composition started: the words a finish would keep. */
  #confirmed = '';
  /** Where in the value the preedit an input method is composing begins. */
  #preeditFrom: number | null = null;

  constructor(options: TextSessionOptions) {
    const { host, name, words, typed, moved, line, commit, ended } = options;
    const input = document.createElement('textarea');
    input.className = 'text-input';
    input.setAttribute('aria-label', name);
    input.rows = 1;
    // The field is a sink for the keys, not a view of the words: a field this
    // narrow would soft-wrap one letter per line, and the browser's own caret
    // arithmetic would walk those rows instead of the lines that are drawn.
    input.wrap = 'off';
    input.spellcheck = false;
    input.value = words;
    input.addEventListener('keydown', this.#onKeyDown);
    // A caret walked along the words moves while the key repeats, so the page is
    // asked to draw it on the way down as well as on the way up.
    input.addEventListener('keydown', this.#onMoved);
    input.addEventListener('keyup', this.#onMoved);
    input.addEventListener('blur', this.#onBlur);
    input.addEventListener('select', this.#onMoved);
    input.addEventListener('compositionstart', this.#onCompositionStart);
    input.addEventListener('compositionupdate', this.#onMoved);
    input.addEventListener('compositionend', this.#onCompositionEnd);
    input.addEventListener('input', this.#onInput);
    if (typed !== undefined) {
      input.addEventListener('input', () => typed(input.value));
    }
    this.#input = input;
    this.#moved = moved ?? ((): void => {});
    this.#line = line ?? null;
    this.#commit = commit;
    this.#ended = ended;
    host.append(input);
    input.focus({ preventScroll: true });
    // The caret goes after the words, where a person adding to them looks for it.
    input.setSelectionRange(input.value.length, input.value.length);
    // The page draws the caret from the first frame, not from the first key.
    this.#moved();
  }

  /** What the field holds now: the words, the caret and the selection in them, and any preedit. */
  state(): TextSessionState {
    const input = this.#input;
    const from = this.#preeditFrom;
    return {
      words: input.value,
      start: input.selectionStart,
      end: input.selectionEnd,
      caret: input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd,
      preedit:
        this.#composing && from !== null
          ? { from, to: Math.max(from, input.selectionEnd) }
          : null,
    };
  }

  /**
   * Put the field over the caret, in page pixels. It draws nothing and takes no
   * pointer, so this is only about where a browser thinks the person is
   * looking: the candidate window of an input method opens here, at the words.
   */
  spot(at: Box): void {
    const style = this.#input.style;
    style.left = `${Math.round(at.x)}px`;
    style.top = `${Math.round(at.y)}px`;
    style.width = `${Math.max(1, Math.round(at.width))}px`;
    style.height = `${Math.max(1, Math.round(at.height))}px`;
  }

  /**
   * Select a run of the field's words, as a press or a drag inside the drawn
   * words places it. The field keeps the focus: a press on the canvas is
   * cancelled before it can take the focus off, so nothing here is a blur.
   */
  select(from: number, to: number): void {
    if (!this.#open) {
      return;
    }
    const input = this.#input;
    input.focus({ preventScroll: true });
    input.setSelectionRange(from, to, to < from ? 'backward' : 'forward');
    this.#moved();
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
    this.#close();
    return true;
  }

  /** Give up on the words: the field goes and the caller keeps the Scene it had. */
  discard(): void {
    this.#close();
  }

  /** The one way out: the field goes, and the caller hears it once, whichever way it was. */
  #close(): void {
    if (!this.#open) {
      return;
    }
    this.#open = false;
    this.#input.remove();
    this.#ended();
  }

  #onInput = (): void => {
    this.#moved();
  };

  #onMoved = (): void => {
    if (this.#open) {
      this.#moved();
    }
  };

  #onCompositionStart = (): void => {
    this.#composing = true;
    this.#confirmed = this.#input.value;
    // The preedit begins where the caret was: a composition replaces nothing on
    // the way in, and everything an input method adds is drawn from here.
    this.#preeditFrom = this.#input.selectionStart;
    this.#moved();
  };

  #onCompositionEnd = (): void => {
    this.#composing = false;
    this.#preeditFrom = null;
    this.#moved();
  };

  #onKeyDown = (event: KeyboardEvent): void => {
    // An input method owns the keys while it composes: Escape and Enter belong
    // to the candidate list, and ending the session on them would take the
    // words away from under the person still choosing them.
    if (event.isComposing || this.#composing) {
      return;
    }
    if (this.#keydownLine(event)) {
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

  /**
   * Where a line key takes the caret among the drawn lines, asked of the caller
   * that laid them out; false when the key is the field's own after all.
   */
  #keydownLine(event: KeyboardEvent): boolean {
    const key = LINE_KEYS[event.key];
    if (key === undefined || this.#line === null) {
      return false;
    }
    // A chord is not a walk: Cmd+Left and Ctrl+End belong to the field.
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }
    const at = this.#line(key, this.state());
    if (at === null) {
      return false;
    }
    event.preventDefault();
    // Shift keeps the end of the selection that is not the caret, so the walk
    // grows the selection instead of throwing it away.
    const state = this.state();
    const anchor = state.caret === state.end ? state.start : state.end;
    this.select(event.shiftKey ? anchor : at, at);
    return true;
  }

  #onBlur = (): void => {
    if (!this.#open) {
      return;
    }
    // A field the page takes off its document blurs too, and it does so before
    // the removal has gone through: whether these words land is answered once
    // the task that blurred them is over, when a removal has left the input
    // detached and a person leaving has not. Words the page took stay unsaved.
    queueMicrotask(() => {
      if (!this.#input.isConnected) {
        this.discard();
        return;
      }
      // Words the Scene refused keep the field, so the person can fix them: the
      // focus goes back to what they were typing.
      if (!this.finish()) {
        this.#input.focus({ preventScroll: true });
      }
    });
  };
}
