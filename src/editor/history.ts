/**
 * Undo and redo over whole Scenes.
 *
 * A step is the Scene as autosave writes it, so undoing restores exactly the
 * bytes that were on disk: no per-Element ledger can drift from the file. The
 * editor records one step per user action, and folds a burst of nudges into the
 * newest step with `amend`, because holding an arrow key would otherwise fill
 * the history a pixel at a time.
 */
/** How many steps the history keeps. */
const LIMIT = 200;

/**
 * What the whole history may cost, in UTF-8 bytes, so 200 Scenes of any size
 * cannot hold the tab's memory. 4 MiB is a few hundred ordinary Scenes: a
 * session that reaches it loses its oldest undo, not its newest.
 */
const BYTE_BUDGET = 4 * 1024 * 1024;

const ENCODER = new TextEncoder();

function bytesOf(source: string): number {
  return ENCODER.encode(source).length;
}

export class History {
  #past: string[] = [];
  #future: string[] = [];
  #present: string;
  #pastBytes = 0;
  #futureBytes = 0;
  #presentBytes: number;

  constructor(present: string) {
    this.#present = present;
    this.#presentBytes = bytesOf(present);
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
    this.#pastBytes += this.#presentBytes;
    this.#setPresent(after);
    this.#future = [];
    this.#futureBytes = 0;
    this.#trim();
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
    this.#setPresent(after);
    this.#future = [];
    this.#futureBytes = 0;
    this.#trim();
    return true;
  }

  /** The Scene before the newest step, or null when there is nothing to undo. */
  undo(): string | null {
    const previous = this.#past.pop();
    if (previous === undefined) {
      return null;
    }
    this.#pastBytes -= bytesOf(previous);
    this.#future.push(this.#present);
    this.#futureBytes += this.#presentBytes;
    this.#setPresent(previous);
    return previous;
  }

  /** The Scene after the step that was undone, or null when there is nothing to redo. */
  redo(): string | null {
    const next = this.#future.pop();
    if (next === undefined) {
      return null;
    }
    this.#futureBytes -= bytesOf(next);
    this.#past.push(this.#present);
    this.#pastBytes += this.#presentBytes;
    this.#setPresent(next);
    this.#trim();
    return next;
  }

  /** Starts again from a Scene that was opened or replaced: nothing to undo into. */
  reset(present: string): void {
    this.#past = [];
    this.#future = [];
    this.#pastBytes = 0;
    this.#futureBytes = 0;
    this.#setPresent(present);
  }

  #setPresent(source: string): void {
    this.#present = source;
    this.#presentBytes = bytesOf(source);
  }

  /** The oldest steps go first: a long session keeps the undo it is about to need. */
  #trim(): void {
    while (
      this.#past.length > LIMIT ||
      this.#pastBytes + this.#futureBytes + this.#presentBytes > BYTE_BUDGET
    ) {
      const dropped = this.#past.shift();
      if (dropped === undefined) {
        return;
      }
      this.#pastBytes -= bytesOf(dropped);
    }
  }
}
