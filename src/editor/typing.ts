/**
 * The words being typed: one Text or Label session, from the press that opens
 * it to the one way it ends.
 *
 * The page draws the words as they will save. The session holds the field, the
 * Element shown in the preview, and the step between typed and drawn words.
 * A click away, a blur or an Escape commits valid words as one undo step and
 * one write: Escape discards the words only when the page refuses them. A lost
 * connection and a Scene switch discard the preview.
 */
import type { Layout } from '../layout.js';
import { hasXmlInvalidChars, parseScene, serialiseScene } from '../scene.js';
import type { Element as SceneElement, Scene, TextElement } from '../scene.js';
import { freshId, idsOf, newText, without } from './elements.js';
import type { Point } from './geometry.js';
import type { Page } from './page.js';
import { TextSession } from './text-session.js';
import { keptWords, withWords, wordsOf, wordsShift } from './words.js';
import type { WordsShift } from './words.js';

/** The words being typed, as the page draws them. */
interface TypingWords {
  /** The Element the words belong to, as the page shows it. */
  readonly element: SceneElement;
  /** The field the words are typed into: the caret it reports is the one drawn. */
  readonly text: Pick<TextSession, 'state' | 'spot'>;
  /** The step between the field's words and the drawn ones. */
  readonly shift: WordsShift;
}

/** The page the words are drawn on: the frame, the drawn lines, the room they need. */
type TypingPage = Pick<Page, 'paint' | 'paintWords' | 'wordsLine' | 'clearOfNote'>;

/**
 * What the words ask of the editor, and the one place a session becomes a
 * change. The editor owns the Scene and selection; the session owns the field
 * and the preview.
 */
interface TypingHost {
  /** Where the field is put: the editor, above the canvas. */
  readonly field: HTMLElement;
  /**
   * The page the words are drawn on. The words come first — the page and the
   * pointer both read them — so the page is asked for, not held.
   */
  page(): TypingPage;

  /** The Scene in hand, and the measurement its Labels break with. */
  scene(): Scene;
  layout(): Layout;
  /** True when this page may change the Scene at all: the one gate on opening a session. */
  writable(): boolean;

  /** Disarm the drawing tool before the field opens. */
  useSelectTool(): void;
  /** Select the Element being edited and make room for its words before focusing the field. */
  selectElement(id: string): void;
  /** The status line says why the Scene would not hold the words. */
  refused(problem: string): void;

  /** A Scene change lands, as one history step and one write. */
  applyScene(next: Scene, selected: readonly string[]): void;
  /** The words are closed, so the press that selected a word in them pairs with nothing. */
  forgetWordClick(): void;
}

export class Typing {
  readonly #host: TypingHost;
  /** The in-place input a Text or a Label is typed into, while it is open. */
  #text: TextSession | null = null;
  /**
   * The Element the open in-place editor is editing, as it shows it: the Scene
   * keeps what was there until the words are committed, so Escape can leave it
   * alone and a half-typed Label is never a history step.
   */
  #editing: SceneElement | null = null;
  /**
   * The Text being typed for the first time, as it will land: it is drawn on the
   * page but it is not in the Scene until the words are committed.
   */
  #draft: TextElement | null = null;
  /**
   * The step between the field's words and the drawn ones, made whenever the page
   * accepts a preview: a caret is mapped through the very words its Block was
   * drawn from, and input the page refused maps through the last it accepted.
   */
  #shift: WordsShift = wordsShift('', '');

  constructor(host: TypingHost) {
    this.#host = host;
  }

  /** The words being typed, while a session is open. */
  words(): TypingWords | null {
    if (this.#text === null) {
      return null;
    }
    return {
      element: (this.#editing ?? this.#draft)!,
      text: this.#text,
      shift: this.#shift,
    };
  }

  /** The field the words are typed into, while a session is open. */
  text(): Pick<TextSession, 'finish' | 'select' | 'state'> | null {
    return this.#text;
  }

  /** The Element of the Scene whose words are being typed, or null for a new Text. */
  editingId(): string | null {
    return this.#editing?.id ?? null;
  }

  /** An offset among the drawn glyphs, read back into the field's own words. */
  typedOffset(drawn: number): number {
    return this.#shift.typed(drawn);
  }

  /**
   * The Elements the page draws while a session is open: the Scene's own, with
   * the Element being edited as the session shows it, and the new Text appended
   * before it is in the Scene. Null when nothing is being typed, so a page with
   * no session draws the Scene and draws it settled.
   */
  preview(elements: readonly SceneElement[]): readonly SceneElement[] | null {
    const editing = this.#editing;
    const draft = this.#draft;
    if (editing === null && draft === null) {
      return null;
    }
    const words =
      editing === null
        ? elements
        : elements.map((element) => (element.id === editing.id ? editing : element));
    return draft === null ? words : [...words, draft];
  }

  /** A Text is placed: the words are typed where the Text will sit. */
  openTextInput(at: Point): void {
    const host = this.#host;
    // A page that may not write has nowhere to put a Text, however the gesture
    // that placed it began: the refusal may have landed while the button was
    // still down. One gate, asked at the moment the field would open.
    if (!host.writable()) {
      return;
    }
    host.useSelectTool();
    // The Text the words will make, drawn on the page as they arrive: the page
    // shows what saving would render, and the field is only the caret and the keys.
    const scene = host.scene();
    this.#draft = newText(at, '', freshId('text', idsOf(scene.elements)), scene.defaults);
    this.#shift = wordsShift('', '');
    this.#text = new TextSession({
      host: host.field,
      name: 'Text',
      words: '',
      typed: (words) => this.#showTyped(words),
      moved: () => this.#host.page().paintWords(),
      line: (key, state) => this.#host.page().wordsLine(key, state),
      commit: (words) => this.#commitText(words),
      ended: () => this.end(),
    });
    host.page().paint();
  }

  /**
   * Open the in-place editor on an Element's words. The page draws them at once,
   * where they will save, and the caret sits on those glyphs; nothing of the
   * Scene changes until the words are committed.
   */
  openWords(element: SceneElement): void {
    const host = this.#host;
    // A page with nowhere to save the words opens none, by either way in: one
    // gate, on the one question every Scene change asks.
    if (!host.writable()) {
      return;
    }
    host.useSelectTool();
    const words = wordsOf(element);
    // The page paints the Element with the room its words need from the first
    // frame, not from the first keystroke, so the words are in one place.
    this.#editing = withWords(element, words, host.layout());
    this.#shift = wordsShift(words, words);
    // The note follows the selection, and the view makes room for it before the
    // field takes the focus: the words stay clear of the note under the caret.
    host.selectElement(element.id);
    this.#text = new TextSession({
      host: host.field,
      name: element.type === 'text' ? 'Text' : 'Label',
      words,
      typed: (words) => this.#showWords(element, words),
      moved: () => this.#host.page().paintWords(),
      line: (key, state) => this.#host.page().wordsLine(key, state),
      commit: (words) => this.#commitWords(element, words),
      ended: () => this.end(),
    });
  }

  /**
   * What the page shows while a Label or a Text is typed: the Element grown so
   * its words fit, with those words, drawn by the Renderer like any other. It is
   * a preview, not the Scene: only the commit makes it a change.
   */
  #showWords(element: SceneElement, words: string): void {
    const host = this.#host;
    // Words the Scene cannot hold are never drawn: the page keeps the last it
    // could, and the words that were typed are refused when they are committed.
    if (!hasXmlInvalidChars(words)) {
      // The Scene keeps the words without their outer blank lines, and the page
      // shows that: what is drawn while typing is what the commit will save.
      // Words nobody changed are no edit at all — the Element keeps them as it
      // holds them — so the page goes on drawing exactly those, and the ink does
      // not move when the session ends.
      const kept = words === wordsOf(element) ? words : keptWords(words);
      this.#editing = withWords(element, kept, host.layout());
      this.#shift = wordsShift(words, kept);
      // The grown Element is what the note must not cover.
      host.page().clearOfNote();
    } else if (this.#editing !== null) {
      // The page refuses these words and goes on drawing the ones it has: the
      // step is measured through them all the same, so a character the Scene
      // cannot hold is one more offset in the field and no glyph under the caret.
      this.#shift = wordsShift(words, wordsOf(this.#editing));
    }
    host.page().paint();
  }

  /** The Text being typed, with the words it has so far. */
  #showTyped(words: string): void {
    const draft = this.#draft;
    if (draft === null) {
      return;
    }
    if (!hasXmlInvalidChars(words)) {
      const kept = keptWords(words);
      this.#draft = { ...draft, content: kept };
      this.#shift = wordsShift(words, kept);
    } else {
      // Refused words are no edit: the step through them is still the step to
      // the words on the page, so the caret stays on the glyph it was typed at.
      this.#shift = wordsShift(words, draft.content);
    }
    this.#host.page().paint();
  }

  /**
   * Commit the words typed in place: one undo step for the whole session, the
   * Element's growth included. Words nobody changed are not an edit and write
   * nothing; an emptied Label stops being one, and an emptied Text goes; words a
   * Scene could not hold are refused in the status line, and the field keeps them
   * so the person can fix them.
   */
  #commitWords(element: SceneElement, raw: string): boolean {
    // The comparison is the raw value against the words the Element held before
    // anything is trimmed: words nobody touched are the same words, whatever
    // spaces the author wrote them with.
    if (raw === wordsOf(element)) {
      return true;
    }
    // A character XML cannot hold is refused as typed, before a trim can hide
    // it; everything else the Scene checks is the words it would keep.
    const words = hasXmlInvalidChars(raw) ? raw : keptWords(raw);
    return this.#land(
      this.#wordsScene(element, words),
      words === '' && element.type === 'text' ? [] : [element.id],
    );
  }

  /**
   * Commit a new Text's words: a Text with words in them, or nothing. A control
   * character a person typed is refused rather than trimmed away, and words that
   * are only whitespace are no words, so they make no Text and are no problem.
   */
  #commitText(raw: string): boolean {
    const draft = this.#draft;
    if (draft === null) {
      return true;
    }
    const words = hasXmlInvalidChars(raw) ? raw : keptWords(raw);
    if (words === '') {
      return true;
    }
    const elements = [...this.#host.scene().elements, { ...draft, content: words }];
    return this.#land(elements, [draft.id]);
  }

  /**
   * The one way a text session ends: the field goes, and so do the words it drew
   * on the page. A commit, an Escape, a click away, a blur, a lost connection and
   * a page that takes the editor off its DOM all end here, so no path can leave
   * half a session behind for the next press to trip over.
   */
  end(): void {
    const text = this.#text;
    this.#text = null;
    this.#editing = null;
    this.#draft = null;
    this.#host.forgetWordClick();
    this.#shift = wordsShift('', '');
    text?.discard();
    this.#host.page().paint();
  }

  /** The Scene these words would make, with this Element's words replaced. */
  #wordsScene(element: SceneElement, words: string): SceneElement[] {
    const scene = this.#host.scene();
    if (words === '' && element.type === 'text') {
      return without(scene.elements, new Set([element.id]));
    }
    return scene.elements.map((candidate) =>
      candidate.id === element.id ? withWords(candidate, words, this.#host.layout()) : candidate,
    );
  }

  /**
   * Land the Scene the parser reads back as one step and one write. If the Scene
   * cannot hold the words, show its first problem without applying the edit.
   */
  #land(elements: SceneElement[], selected: readonly string[]): boolean {
    const parsed = parseScene(serialiseScene({ ...this.#host.scene(), elements }));
    if (!parsed.ok) {
      this.#host.refused(parsed.problems[0]?.message ?? 'the Scene cannot hold these words');
      return false;
    }
    this.#host.applyScene(parsed.scene, selected);
    return true;
  }
}
