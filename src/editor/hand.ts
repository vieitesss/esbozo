/**
 * The Scene in hand: the current Scene, the selected Element ids, the picked
 * Bend point, and the undo/redo History.
 *
 * Every Scene edit lands here behind the read-only gate, no-op byte check,
 * nudge-burst amend window, and selection contract. Saving and DOM updates stay
 * outside, supplied as callbacks so the rules can be proved without a browser.
 */
import { emptyScene, parseScene, serialiseScene } from '../scene.js';
import type { Scene } from '../scene.js';
import { PickedBend } from './bend-point.js';
import type { Bend } from './bend-point.js';
import { edited, nudged } from './edits.js';
import type { Edited } from './edits.js';
import { History } from './history.js';
import { sceneFile } from './paint.js';

export { edited };

/** Nudges closer together than this are one undo step: a held arrow key is one gesture. */
const NUDGE_BURST_MS = 800;

export interface HandHost {
  /** Whether the active Scene may be written; read-only refuses edits and undo/redo. */
  readonly writable: () => boolean;
  /** Persist a Scene that changed (an edit or an undo/redo step). */
  readonly save: (scene: Scene) => void;
  /** Notify the page after a landed edit or restored history step. */
  readonly onChange?: () => void;
  /** Notify the page when the selection changes (e.g. to shut the point menu). */
  readonly onSelect?: () => void;
  /** Clock for nudge-burst folding; defaults to `Date.now`. */
  readonly now?: () => number;
}

export class Hand {
  #scene: Scene = emptyScene();
  #selected: string[] = [];
  /** The one bend point the selection holds, and the presses that take it. */
  #picked = new PickedBend();
  #history = new History(serialiseScene(this.#scene));
  /** When the last nudge landed, so a burst of them folds into one undo step. */
  #nudgedAt = 0;
  readonly #host: HandHost;
  readonly #now: () => number;

  constructor(host: HandHost) {
    this.#host = host;
    this.#now = host.now ?? (() => Date.now());
  }

  get scene(): Scene {
    return this.#scene;
  }

  get selected(): readonly string[] {
    return this.#selected;
  }

  get bend(): Bend | null {
    return this.#picked.bend;
  }

  get canUndo(): boolean {
    return this.#history.canUndo;
  }

  get canRedo(): boolean {
    return this.#history.canRedo;
  }

  /** Replace the Scene in hand and reset selection, picked Bend point, and History. */
  load(scene: Scene): void {
    this.#scene = scene;
    this.#selected = [];
    this.#picked.letGo();
    this.#history.reset(serialiseScene(scene));
    this.#nudgedAt = 0;
  }

  /**
   * The one owner of the selection: the Elements it holds, and the bend point it
   * may hold with one of them. A change of the selection lets the point go, so a
   * point outlives no selection and its index outlives no point.
   */
  select(ids: readonly string[]): void {
    this.#selected = [...ids];
    this.#picked.letGo();
    this.#host.onSelect?.();
  }

  pickBend(bend: Bend | null): void {
    this.#picked.pick(bend);
  }

  letGoBend(): void {
    this.#picked.letGo();
  }

  pressDelete(repeated: boolean): boolean {
    return this.#picked.pressDelete(repeated);
  }

  spendBend(): Bend | null {
    return this.#picked.spend();
  }

  /**
   * Land one Scene edit: the Scene it returns and the selection that comes with
   * it. Read-only refuses before the Scene is touched. Unchanged bytes record no
   * history step and write nothing. A `null` selection leaves the selection — and
   * the bend point a press may hold — exactly where it is.
   */
  land(edit: Edited | null, amend = false): void {
    if (edit === null || !this.#host.writable()) {
      return;
    }
    const after = sceneFile(edit.scene);
    const changed = after !== sceneFile(this.#scene);
    if (changed) {
      this.#scene = edit.scene;
    }
    if (edit.selection !== null) {
      this.select(edit.selection);
    }
    this.#host.onChange?.();
    if (changed) {
      this.#record(amend, after);
    }
  }

  /**
   * Move the selected Elements by a step: a burst of nudges within
   * `NUDGE_BURST_MS` folds into one undo step.
   */
  nudge(dx: number, dy: number): void {
    const amend = this.#now() - this.#nudgedAt < NUDGE_BURST_MS;
    const edit = nudged(this.#scene, this.#selected, dx, dy);
    if (edit === null || !this.#host.writable()) {
      return;
    }
    this.land(edit, amend);
    this.#nudgedAt = this.#now();
  }

  /** Undo one step if writable; never consumes a step when read-only. */
  undo(): void {
    this.#restore(() => this.#history.undo());
  }

  /** Redo one step if writable; never consumes a step when read-only. */
  redo(): void {
    this.#restore(() => this.#history.redo());
  }

  #record(amend: boolean, after: string): void {
    const changed = amend ? this.#history.amend(after) : this.#history.record(after);
    if (!amend) {
      this.#nudgedAt = 0;
    }
    if (changed) {
      this.#host.save(this.#scene);
    }
  }

  #restore(step: () => string | null): void {
    if (!this.#host.writable()) {
      return;
    }
    const source = step();
    if (source === null) {
      return;
    }
    const parsed = parseScene(source);
    if (!parsed.ok) {
      return;
    }
    this.#scene = parsed.scene;
    this.select(
      this.#selected.filter((id) => this.#scene.elements.some((element) => element.id === id)),
    );
    this.#nudgedAt = 0;
    this.#host.onChange?.();
    this.#host.save(this.#scene);
  }
}
