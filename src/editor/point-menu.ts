/**
 * The point menu: the note a right-click on a bend point opens, and the one row
 * it offers — `Delete point`.
 *
 * A secondary press — the right button, or the Ctrl+click macOS reads as one —
 * on a bend handle picks that point and opens the note by the pointer, wholly
 * inside the editor. Enter runs the row, Escape shuts the menu and leaves the
 * point selected, and a press anywhere else shuts it and then does the work that
 * press already does. While it is open it holds the keys, so nothing else edits
 * the Scene from under it; every key that would is the menu's or nobody's.
 *
 * The point is `#removeBend`'s alone: this module names no removal of its own,
 * and asks the editor whether the point may go before it offers the row, so a
 * point a self-loop must keep reads as disabled rather than failing on the press.
 * Ties to the editor are callbacks only, so the menu knows nothing about the
 * Scene and cannot change it by itself.
 */
import type { Bend } from './gestures.js';
import type { Point } from './geometry.js';

/** How far the panel keeps from the editor's edges: the tape above it still shows. */
const INSET = 12;

export interface PointMenuOptions {
  /** The panel the page's shell already holds, with its rows in it. */
  readonly root: HTMLElement;
  /** The editor the menu opens in: the box it stays inside. */
  readonly inside: HTMLElement;
  /** The canvas, which the presses are on and which takes the keys back. */
  readonly canvas: SVGSVGElement;
  /**
   * Whether a secondary press may open a menu at all: a page that may only read
   * opens none, and neither does one whose words are being typed, where the
   * press means what it always did.
   */
  readonly canOpen: () => boolean;
  /** Whether the point may go, which is the one rule the removal keeps. */
  readonly removable: (bend: Bend) => boolean;
  /** Make the point the selection's, and paint it: the editor's own selection. */
  readonly selectBend: (bend: Bend) => void;
  /** Remove the point, through the editor's one removal: a step and a write. */
  readonly remove: (bend: Bend) => void;
}

export class PointMenu {
  readonly #options: PointMenuOptions;
  /** The row this menu holds, which is the one Enter runs. */
  readonly #row: HTMLButtonElement;
  /** The point the menu was opened on, for as long as it is open. */
  #bend: Bend | null = null;

  constructor(options: PointMenuOptions) {
    this.#options = options;
    this.#row = options.root.querySelector('[role="menuitem"]')!;
    options.root.addEventListener('keydown', this.#onKeyDown);
    options.root.addEventListener('click', this.#onClick);
    // The press that opens the menu and the press that shuts it are the same
    // one, seen from the page: a press on the panel is the panel's own.
    document.addEventListener('pointerdown', this.#onPress);
  }

  get open(): boolean {
    return !this.#options.root.hidden;
  }

  /** Open over a point, by the pointer, wholly inside the editor. */
  show(bend: Bend, at: Point): void {
    const { root, inside } = this.#options;
    this.#bend = bend;
    this.#row.disabled = !this.#options.removable(bend);
    this.#options.selectBend(bend);
    root.hidden = false;
    // The panel has a size only once it is on the page, and the editor's box is
    // where it has to fit: the pointer's place is clamped into that box, so a
    // press at the window's own corner still shows the whole row.
    const box = inside.getBoundingClientRect();
    root.style.left = `${placed(at.x - box.left, box.width, root.offsetWidth)}px`;
    root.style.top = `${placed(at.y - box.top, box.height, root.offsetHeight)}px`;
    root.focus({ preventScroll: true });
  }

  /**
   * Shut the menu. The point stays selected — Escape is a menu leaving, not a
   * selection changing — and the keys go back to the paper that holds them.
   */
  close(): void {
    if (!this.open) {
      return;
    }
    this.#bend = null;
    this.#options.root.hidden = true;
    this.#options.canvas.focus({ preventScroll: true });
  }

  /**
   * The bend point a press landed on, or null where it landed on anything else:
   * a handle is the mark a point draws, and a dot is a press pulling a new one.
   */
  #pointAt(target: EventTarget | null): Bend | null {
    const handle = target instanceof Element ? target.closest('[data-handle="bend"]') : null;
    const id = handle?.getAttribute('data-element');
    const index = Number(handle?.getAttribute('data-point'));
    return id == null || !Number.isInteger(index) ? null : { id, index };
  }

  /**
   * A press anywhere on the page. A secondary press on a bend handle opens the
   * menu over that point; every press outside the panel shuts the menu the page
   * had open and goes on to do what it already does.
   */
  #onPress = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (target !== null && this.#options.root.contains(target)) {
      return;
    }
    const secondary = event.button === 2 || (event.button === 0 && event.ctrlKey);
    if (!secondary || !this.#options.canOpen()) {
      this.close();
      return;
    }
    const point = this.#options.canvas.contains(target) ? this.#pointAt(target) : null;
    if (point === null) {
      this.close();
      return;
    }
    // The press is the menu's: the canvas would take the focus with it, and the
    // row the person means to read would lose it before it could be read.
    event.preventDefault();
    this.show(point, { x: event.clientX, y: event.clientY });
  };

  /**
   * The keys the menu holds while it is open: Escape shuts it and Enter runs its
   * row, and nothing else on the page hears the key at all.
   */
  #onKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.#run();
    }
  };

  #onClick = (event: Event): void => {
    const row = (event.target as Element | null)?.closest('[role="menuitem"]');
    if (row === null || row !== this.#row) {
      return;
    }
    this.#run();
  };

  /** Run the row on the point the menu was opened on, and shut it first. */
  #run(): void {
    const bend = this.#bend;
    if (bend === null || this.#row.disabled) {
      return;
    }
    this.close();
    this.#options.remove(bend);
  }
}

/** Where a box of `size` starts so that it starts at `want` and stays inside the editor. */
function placed(want: number, room: number, size: number): number {
  return Math.round(Math.max(INSET, Math.min(want, room - size - INSET)));
}
