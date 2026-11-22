/**
 * The words being typed: one Text or Label session, from the press that opens
 * it to the one way it ends.
 *
 * The page draws the words as they will save, so the session never measures or
 * paints: it holds what is being typed — the field, the Element as it shows it,
 * the new Text before it is in the Scene, and the step between the field's words
 * and the drawn ones — and asks the host for the one thing that changes, a Scene
 * that lands as a step and a write. Nothing here is a Scene until the words are
 * committed: Escape, a click away, a blur, a lost connection and a Scene switch
 * all end the session and leave the Scene exactly as it was.
 */
import type { Layout } from '../layout.js';
import { hasXmlInvalidChars, parseScene, serialiseScene } from '../scene.js';
import type { Element as SceneElement, Scene, TextElement } from '../scene.js';
import type { ToolId } from './actions.js';
import { freshId, idsOf, newText, without } from './elements.js';
import type { Point } from './geometry.js';
import { TextSession } from './text-session.js';
import type { LineKey, TextSessionState } from './text-session.js';
import { keptWords, withWords, wordsOf, wordsShift } from './words.js';
import type { WordsShift } from './words.js';

/** The words being typed, as the page draws them. */
export interface TypingWords {
  /** The Element the words belong to, as the page shows it. */
  readonly element: SceneElement;
  /** The field the words are typed into: the caret it reports is the one drawn. */
  readonly text: TextSession;
  /** The step between the field's words and the drawn ones. */
  readonly shift: WordsShift;
}

/** The page the words are drawn on: the frame, the drawn lines, the room they need. */
interface TypingPage {
  /** Repaint the whole page, the words' own layer included. */
  paint(): void;
  /** Repaint the words' layer alone: a caret that moved asks for no Scene at all. */
  paintWords(): void;
  /** Where Up, Down, Home and End put the caret in the words being typed. */
  wordsLine(key: LineKey, state: TextSessionState): number | null;
  /** Keep the Element grown for its words clear of the note and the rail above it. */
  clearOfNote(): void;
}

/**
 * What the words ask of the editor, and the one place a session becomes a
 * change. The editor answers with what the page holds; nothing here keeps a
 * copy of the Scene, the selection or the field.
 */
export interface TypingHost {
  /** Where the field is put: the editor, above the canvas. */
  readonly field: HTMLElement;
  /** The page the words are drawn on. */
  readonly page: TypingPage;

  /** The Scene in hand, and the measurement its Labels break with. */
  scene(): Scene;
  layout(): Layout;
  /** True when this page may change the Scene at all: the one gate on opening a session. */
  writable(): boolean;

  /** The Select tool stands down while words are typed. */
  setTool(tool: ToolId): void;
  select(ids: readonly string[]): void;
  /** The note follows the selection, and the view makes room for it. */
  refresh(): void;
  /** The status line says why the Scene would not hold the words. */
  refused(problem: string): void;

  /** A Scene change lands, as one history step and one write. */
  applyScene(next: Scene, options?: { select?: readonly string[] }): void;
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
  #editing: { id: string; element: SceneElement } | null = null;
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
      element: (this.#editing?.element ?? this.#draft)!,
      text: this.#text,
      shift: this.#shift,
    };
  }

  /** The field the words are typed into, while a session is open. */
  text(): TextSession | null {
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
        : elements.map((element) => (element.id === editing.id ? editing.element : element));
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
    host.setTool('select');
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
      moved: () => this.#host.page.paintWords(),
      line: (key, state) => this.#host.page.wordsLine(key, state),
      commit: (words) => this.#commitText(words),
      ended: () => this.end(),
    });
    host.page.paint();
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
    host.setTool('select');
    host.select([element.id]);
    // The page paints the Element with the room its words need from the first
    // frame, not from the first keystroke, so the words are in one place.
    this.#editing = {
      id: element.id,
      element: withWords(element, wordsOf(element), host.layout()),
    };
    this.#shift = wordsShift(wordsOf(element), wordsOf(element));
    // The note follows the selection, and the view makes room for it before the
    // field takes the focus: the words stay clear of the note under the caret.
    host.refresh();
    this.#text = new TextSession({
      host: host.field,
      name: element.type === 'text' ? 'Text' : 'Label',
      words: wordsOf(element),
      typed: (words) => this.#showWords(element, words),
      moved: () => this.#host.page.paintWords(),
      line: (key, state) => this.#host.page.wordsLine(key, state),
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
      this.#editing = { id: element.id, element: withWords(element, kept, host.layout()) };
      this.#shift = wordsShift(words, kept);
      // The grown Element is what the note must not cover.
      host.page.clearOfNote();
    } else if (this.#editing !== null) {
      // The page refuses these words and goes on drawing the ones it has: the
      // step is measured through them all the same, so a character the Scene
      // cannot hold is one more offset in the field and no glyph under the caret.
      this.#shift = wordsShift(words, wordsOf(this.#editing.element));
    }
    host.page.paint();
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
    this.#host.page.paint();
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
    const problem = this.#problem(this.#wordsScene(element, words));
    if (problem !== null) {
      this.#host.refused(problem);
      return false;
    }
    this.#land(
      this.#wordsScene(element, words),
      words === '' && element.type === 'text' ? [] : [element.id],
    );
    return true;
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
    const problem = this.#problem(elements);
    if (problem !== null) {
      this.#host.refused(problem);
      return false;
    }
    this.#land(elements, [draft.id]);
    return true;
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
    this.#host.page.paint();
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
   * The Scene's own verdict on a Scene holding these Elements: the Scene its
   * parser reads back, or the first thing it cannot hold. Nothing is applied:
   * the caller decides whether the edit lands.
   */
  #verdict(elements: readonly SceneElement[]): { scene: Scene } | { problem: string } {
    const parsed = parseScene(serialiseScene({ ...this.#host.scene(), elements: [...elements] }));
    if (parsed.ok) {
      return { scene: parsed.scene };
    }
    const first = parsed.problems[0];
    return { problem: first === undefined ? 'the Scene cannot hold these words' : first.message };
  }

  /** What the Scene says about these Elements: its first problem, or null when it can hold them. */
  #problem(elements: readonly SceneElement[]): string | null {
    const verdict = this.#verdict(elements);
    return 'problem' in verdict ? verdict.problem : null;
  }

  /**
   * The one way typed words land: the Scene's own verdict first, then one step
   * and one write. A refusal says why in the status line and leaves the Scene
   * exactly as it was, on the page and on disk.
   */
  #land(elements: readonly SceneElement[], selected: string[]): void {
    const verdict = this.#verdict(elements);
    if ('problem' in verdict) {
      this.#host.refused(verdict.problem);
      this.#host.page.paint();
      return;
    }
    this.#host.applyScene(verdict.scene, { select: selected });
  }
}
