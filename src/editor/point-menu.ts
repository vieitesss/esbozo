/**
 * The point menu: the note a right-click on a bend point opens, and the two rows
 * it offers — the corner the point would switch to, and `Delete point`.
 *
 * A secondary press — the right button, or the Ctrl+click macOS reads as one —
 * on a bend handle picks that point and opens the note by the pointer, wholly
 * inside the editor. The corner row names the corner the point would turn by
 * next, so it reads `Sharp corner` on a round point and `Round corner` on a sharp
 * one, and running it switches the point to it. Enter runs the row that holds the
 * keys, ArrowUp and ArrowDown move them between the rows, Escape shuts the menu
 * and leaves the point selected, and a press anywhere else shuts it and then does
 * the work that press already does. While it is open it holds the keys, so
 * nothing else edits the Scene from under it; every key that would is the menu's
 * or nobody's.
 *
 * The removal is `#removeBend`'s and the corner is `#switchCorner`'s: this module
 * names no change of its own, and asks the Bend point module — the one rule the
 * removal keeps, and the corner a point turns by — what each row may do, so a
 * point a self-loop must keep reads as disabled rather than failing on the press.
 * Ties to the editor are callbacks only, so the menu knows nothing about the
 * Scene and cannot change it by itself.
 */
import { bendFromHandle, cornerAt, mayRemove } from './bend-point.js';
import type { Bend, ShaftOf } from './bend-point.js';
import type { Corner } from '../scene.js';
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
  /** The Shaft a mark names, which is what makes a press on it a bend point's. */
  readonly shaft: ShaftOf;
  /** Make the point the selection's, and paint it: the editor's own selection. */
  readonly selectBend: (bend: Bend) => void;
  /** Switch the point to its other corner, through the editor's one corner step. */
  readonly switchCorner: (bend: Bend, corner: Corner) => void;
  /** Remove the point, through the editor's one removal: a step and a write. */
  readonly remove: (bend: Bend) => void;
}

/** The row that switches the point's corner, and the one that removes it. */
type Row = 'corner' | 'delete';

/** The corner the other one, which is what the corner row offers. */
function other(corner: Corner): Corner {
  return corner === 'round' ? 'sharp' : 'round';
}

/** What each corner is called, in the words its row carries. */
const CORNER_NAMES: Record<Corner, string> = { round: 'Round corner', sharp: 'Sharp corner' };

export class PointMenu {
  readonly #options: PointMenuOptions;
  /** The rows this menu holds, in the order they are drawn: corner, then removal. */
  readonly #rows: ReadonlyMap<Row, HTMLButtonElement>;
  /** The point the menu was opened on, for as long as it is open. */
  #bend: Bend | null = null;

  constructor(options: PointMenuOptions) {
    this.#options = options;
    this.#rows = new Map([
      ['corner', options.root.querySelector<HTMLButtonElement>('[data-act="corner"]')!],
      ['delete', options.root.querySelector<HTMLButtonElement>('[data-act="delete-point"]')!],
    ]);
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
    const shaft = this.#options.shaft(bend.id);
    this.#bend = bend;
    // The removal's own rule, so the row is disabled on exactly the points the
    // key cannot remove.
    const removal = this.#rows.get('delete')!;
    removal.disabled = shaft === null || !mayRemove(shaft);
    // The corner the point turns by today names the one its row offers: the
    // other. A point the Scene no longer draws has neither to offer.
    const next = this.#switchTo(bend);
    const switchTo = this.#rows.get('corner')!;
    switchTo.disabled = next === null;
    if (next !== null) {
      switchTo.textContent = CORNER_NAMES[next];
    }
    this.#options.selectBend(bend);
    root.hidden = false;
    // The panel has a size only once it is on the page, and the editor's box is
    // where it has to fit: the pointer's place is clamped into that box, so a
    // press at the window's own corner still shows the whole row.
    const box = inside.getBoundingClientRect();
    const place = (want: number, room: number, size: number) =>
      Math.round(Math.max(INSET, Math.min(want, room - size - INSET)));
    root.style.left = `${place(at.x - box.left, box.width, root.offsetWidth)}px`;
    root.style.top = `${place(at.y - box.top, box.height, root.offsetHeight)}px`;
    // The menu opens on the row Enter ran when it was the only one — the removal
    // — so that key goes on doing what it did. A point it cannot remove leaves no
    // row holding the keys: the arrows are how that point's corner is reached.
    if (!removal.disabled) {
      removal.focus({ preventScroll: true });
      return;
    }
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
    // A handle is the mark a point draws, so a dot — a press pulling a new point
    // out of the ink — leaves the menu shut.
    const point = this.#options.canvas.contains(target)
      ? (bendFromHandle(target, this.#options.shaft)?.bend ?? null)
      : null;
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
   * The keys the menu holds while it is open: Escape shuts it, the arrows move
   * between its rows, and Enter runs the row that holds the keys. Every key is
   * the menu's, so not one of them keeps a default of its own: Space would press
   * the row that holds the keys, and Tab would carry them out of the panel. And
   * nothing else on the page hears the key at all.
   */
  #onKeyDown = (event: KeyboardEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      this.close();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      this.#step(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter') {
      const row = this.#held();
      if (row !== null) {
        this.#run(row);
      }
    }
  };

  #onClick = (event: Event): void => {
    const row = this.#rowOf(event.target as Element | null);
    if (row !== null && !this.#rows.get(row)!.disabled) {
      this.#run(row);
    }
  };

  /** The row a node belongs to, or null where it belongs to no row of this menu. */
  #rowOf(target: Element | null): Row | null {
    const button = target?.closest('[role="menuitem"]') ?? null;
    for (const [row, node] of this.#rows) {
      if (node === button) {
        return row;
      }
    }
    return null;
  }

  /** The row that holds the keys, or null where the menu's panel holds them. */
  #held(): Row | null {
    return this.#rowOf(document.activeElement instanceof Element ? document.activeElement : null);
  }

  /**
   * Move the keys to the next row a person may run, by one and around the ends:
   * a row the point cannot run is stepped over rather than focused, and a panel
   * that holds the keys hands them to the first row the keys meet.
   */
  #step(by: number): void {
    const runnable = [...this.#rows].filter(([, node]) => !node.disabled);
    if (runnable.length === 0) {
      return;
    }
    const held = this.#held();
    const at = runnable.findIndex(([row]) => row === held);
    const next =
      at === -1
        ? runnable[by > 0 ? 0 : runnable.length - 1]
        : runnable[(at + by + runnable.length) % runnable.length];
    next?.[1].focus({ preventScroll: true });
  }

  /**
   * Run a row on the point the menu was opened on, and shut it first. The corner
   * row switches the point to the corner it named; the removal takes the point.
   */
  #run(row: Row): void {
    const bend = this.#bend;
    if (bend === null) {
      return;
    }
    const corner = row === 'corner' ? this.#switchTo(bend) : null;
    this.close();
    if (row === 'corner') {
      if (corner !== null) {
        this.#options.switchCorner(bend, corner);
      }
      return;
    }
    this.#options.remove(bend);
  }

  /** The corner the corner row switches the point to: the other one it turns by. */
  #switchTo(bend: Bend): Corner | null {
    const shaft = this.#options.shaft(bend.id);
    const corner = shaft === null ? null : cornerAt(shaft, bend.index);
    return corner === null ? null : other(corner);
  }
}
