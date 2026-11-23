/**
 * The notes the editor opens over the Scene, and which one is on top.
 *
 * The palette, the shortcuts sheet and the Scenes note are one kind of thing: a
 * note a person asks for, draws over the page, and puts away. This module is the
 * one place that decides which of them is on top, and with it which note answers
 * Escape and keeps its own keys, which one a press outside shuts, and where the
 * focus goes when it shuts. The editor registers the three and asks; the note
 * that is not on top never answers for the page.
 *
 * Ties to the editor are callbacks only, and a note's own element stays its own:
 * the stack shows and hides it, and the note draws what it holds.
 */

/** The notes the page opens over the Scene, in no order of their own. */
export type NoteId = 'commands' | 'shortcuts' | 'scenes';

/** One note: what it draws, the keys it keeps, and what its own marks do. */
export interface Note {
  /** The element the note draws, which the stack shows and hides. */
  readonly root: HTMLElement;
  /** The keys it takes from the Scene: every one of them, or Escape alone. */
  readonly keys: 'all' | 'escape';
  /** The control the note belongs to, where one press must not shut it and open it again. */
  readonly opener?: () => Element | null;
  /**
   * Whether a press here is a press on the note. A note whose root is the felt
   * around what it draws names the part a press has to reach; every other note
   * is its own box.
   */
  readonly holds?: (target: Node) => boolean;
  /** Told once it is the page's again, so what it draws is drawn before it shows. */
  readonly shown?: () => void;
  /** Told once it is shut, so the marks it put on its own controls go back. */
  readonly shut?: () => void;
}

/**
 * A note being read for: a listing whose answer is still on its way. It carries
 * the note it is for, the open that held the page when the read began, and the
 * number of the ask, so an answer that is no longer the one waited for lands
 * nowhere.
 */
export interface Ask {
  readonly id: NoteId;
  readonly at: NoteId | null;
  readonly n: number;
}

export interface NotesOptions {
  /** The paper the focus goes back to when a note shuts. */
  readonly canvas: HTMLElement | SVGSVGElement;
}

export class Notes {
  readonly #canvas: HTMLElement | SVGSVGElement;
  readonly #notes = new Map<NoteId, Note>();
  /** The open notes, the one on top last. */
  #open: NoteId[] = [];
  /** The last ask each note made, so a slow answer can tell it is no longer the one. */
  #asks = new Map<NoteId, number>();
  /** True once the stack's press is on the page, so it is taken off once. */
  #listening = false;

  constructor(options: NotesOptions) {
    this.#canvas = options.canvas;
  }

  /** Register a note the editor opens. It is not shown until it is asked for. */
  add(id: NoteId, note: Note): void {
    this.#notes.set(id, note);
  }

  /** Whether this note is one of the open ones. */
  shows(id: NoteId): boolean {
    return this.#open.includes(id);
  }

  /**
   * Open a note, or bring it back on top: the note a person asked for last is
   * the one whose keys and Escape the page answers with.
   */
  show(id: NoteId): void {
    const note = this.#notes.get(id);
    if (note === undefined) {
      return;
    }
    this.#open = [...this.#open.filter((one) => one !== id), id];
    note.root.hidden = false;
    note.shown?.();
  }

  /**
   * Shut the note named, or the one on top when none is: Escape and the palette's
   * own actions answer the top alone, and the Scene's selection is never theirs.
   *
   * The keys are the canvas's again once it shuts — a note is a detour, not a
   * place — and the focus is handed back without scrolling, because a scroll
   * would move the Scene out from under the pointer that just shut it.
   */
  shut(id: NoteId | null = this.#open.at(-1) ?? null): void {
    this.#shut(id, true);
  }

  #shut(id: NoteId | null, keysBack: boolean): void {
    if (id === null || !this.shows(id)) {
      return;
    }
    const note = this.#notes.get(id)!;
    this.#open = this.#open.filter((one) => one !== id);
    note.root.hidden = true;
    const focus = document.activeElement;
    if (focus instanceof HTMLElement && note.root.contains(focus)) {
      focus.blur();
    }
    note.shut?.();
    if (keysBack) {
      this.#canvas.focus({ preventScroll: true });
    }
  }

  /** Start reading for a note: what the page holds now is what its answer may land on. */
  asking(id: NoteId): Ask {
    const ask: Ask = { id, at: this.#open.at(-1) ?? null, n: (this.#asks.get(id) ?? 0) + 1 };
    this.#asks.set(id, ask.n);
    return ask;
  }

  /**
   * Whether an answer still belongs to the page: nothing has asked again since,
   * and nothing else has taken the top. A listing that answers after its note
   * shut, or after another note came over it, paints nothing and opens nothing.
   */
  waits(ask: Ask): boolean {
    return this.#asks.get(ask.id) === ask.n && (this.#open.at(-1) ?? null) === ask.at;
  }

  /**
   * What the note on top does with this key: shut itself, keep the key to
   * itself, or leave it to the Scene.
   */
  answer(event: KeyboardEvent): 'shut' | 'hold' | null {
    const top = this.#open.at(-1);
    if (top === undefined) {
      return null;
    }
    if (event.key === 'Escape') {
      return 'shut';
    }
    return this.#notes.get(top)?.keys === 'all' ? 'hold' : null;
  }

  /** Take the note's presses, once, while the element is on the page. */
  listen(): void {
    if (this.#listening) {
      return;
    }
    this.#listening = true;
    // The bubble path, so a press outside the note still lands where it was
    // aimed: the target's own handlers run first, and the browser's focus with
    // them.
    document.addEventListener('pointerdown', this.#onPress);
  }

  /** Give every listener back, so no note answers for an element off the page. */
  unlisten(): void {
    document.removeEventListener('pointerdown', this.#onPress);
    this.#listening = false;
  }

  /** A press outside the note on top shuts it, and is otherwise the press it was. */
  #onPress = (event: PointerEvent): void => {
    const top = this.#open.at(-1);
    const note = top === undefined ? undefined : this.#notes.get(top);
    const target = event.target as Node | null;
    if (top === undefined || note === undefined || target === null) {
      return;
    }
    if (this.#holds(note, target)) {
      return;
    }
    // The press itself says where the focus goes: it may have opened a note of
    // its own, or a control of the page's, and a handback here would take the
    // keys away from what the press was aimed at. Only an Escape hands them back.
    this.#shut(top, false);
  };

  /** Whether a press on `target` is a press on this note rather than beside it. */
  #holds(note: Note, target: Node): boolean {
    if (note.opener?.()?.contains(target) === true) {
      return true;
    }
    return note.holds === undefined ? note.root.contains(target) : note.holds(target);
  }
}
