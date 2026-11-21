/**
 * Undo and redo over whole Scenes.
 *
 * A step is the Scene as autosave writes it, so undoing restores exactly the
 * bytes that were on disk: no per-Element ledger can drift from the file. The
 * editor records one step per user action, and folds a burst of nudges into the
 * newest step with `amend`, because holding an arrow key would otherwise fill
 * the history a pixel at a time.
 */
const LIMIT = 200;

export class History {
  #past: string[] = [];
  #future: string[] = [];
  #present: string;

  constructor(present: string) {
    this.#present = present;
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  /**
   * Records the Scene after a change as a new step. Returns false, and records
   * nothing, when the change left the Scene as it was.
   */
  record(after: string): boolean {
    if (after === this.#present) {
      return false;
    }
    this.#past.push(this.#present);
    if (this.#past.length > LIMIT) {
      this.#past.shift();
    }
    this.#present = after;
    this.#future = [];
    return true;
  }

  /** Folds the Scene after a change into the newest step: the same undo takes it back. */
  amend(after: string): boolean {
    if (after === this.#present) {
      return false;
    }
    if (this.#past.length === 0) {
      return this.record(after);
    }
    this.#present = after;
    this.#future = [];
    return true;
  }

  /** The Scene before the newest step, or null when there is nothing to undo. */
  undo(): string | null {
    const previous = this.#past.pop();
    if (previous === undefined) {
      return null;
    }
    this.#future.push(this.#present);
    this.#present = previous;
    return previous;
  }

  /** The Scene after the step that was undone, or null when there is nothing to redo. */
  redo(): string | null {
    const next = this.#future.pop();
    if (next === undefined) {
      return null;
    }
    this.#past.push(this.#present);
    this.#present = next;
    return next;
  }

  /** Starts again from a Scene that was opened or replaced: nothing to undo into. */
  reset(present: string): void {
    this.#past = [];
    this.#future = [];
    this.#present = present;
  }
}
