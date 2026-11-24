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
 * the work that press already does.
 *
 * The menu is one of the Notes stack's notes: the stack is what decides that this
 * press opens it, that it is on top, that it holds every key while it is, and
 * that Escape and a press beside it shut it. This module wires no listener of the
 * page's own, so nothing of it outlives the editor it is drawn in.
 *
 * The removal and the corner switch land through `Hand`: this module names no
 * change of its own, and asks the Bend point module — the one rule the removal
 * keeps, and the corner a point turns by — what each row may do, so a point a
 * self-loop must keep reads as disabled rather than failing on the press.
 */
import { bendFromHandle, cornerAt, mayRemove } from './bend-point.js';
import type { Bend } from './bend-point.js';
import type { Corner } from '../scene.js';
import type { Point } from './geometry.js';
import type { Hand } from './hand.js';

/** How far the panel keeps from the editor's edges: the tape above it still shows. */
const INSET = 12;

export interface PointMenuOptions {
  /** The panel the page's shell already holds, with its rows in it. */
  readonly root: HTMLElement;
  /** The editor the menu opens in: the box it stays inside. */
  readonly inside: HTMLElement;
  /** The canvas, whose handles the presses are on. */
  readonly canvas: SVGSVGElement;
  /**
   * Whether a secondary press may open a menu at all: a page that may only read
   * opens none, and neither does one whose words are being typed, where the
   * press means what it always did.
   */
  readonly canOpen: () => boolean;
  /** The Scene in hand: its Shaft lookup, picked Bend point, corner switch and removal. */
  readonly hand: Hand;
  /**
   * Whether the page still draws the Scene in hand: a mark the page painted for
   * another Scene names the point that Scene held, and a point's index is the
   * Scene's to give away.
   */
  readonly drawn: () => boolean;
  /** Repaint the page after picking a Bend point or after a no-op menu action. */
  readonly refresh: () => void;
  /** Shut the menu, through the stack that owns which note the page answers with. */
  readonly shut: () => void;
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
  /** The point the menu is drawn for, while it is the page's. */
  #bend: Bend | null = null;
  /** Where the press that opened it put the pointer, until the panel is drawn there. */
  #at: Point | null = null;

  constructor(options: PointMenuOptions) {
    this.#options = options;
    this.#rows = new Map([
      ['corner', options.root.querySelector<HTMLButtonElement>('[data-act="corner"]')!],
      ['delete', options.root.querySelector<HTMLButtonElement>('[data-act="delete-point"]')!],
    ]);
    options.root.addEventListener('keydown', this.#onKeyDown);
    options.root.addEventListener('click', this.#onClick);
  }

  /**
   * Take the press the menu opens on, and say whether it was the menu's: a
   * secondary press on the handle a bend point draws, on a page that may open a
   * menu at all. It picks the point and holds the place; the stack is what shows
   * the note, and `reveal` is what draws it.
   */
  press = (event: PointerEvent): boolean => {
    const target = event.target as Node | null;
    // A press on the panel is the panel's own: a row runs on its own click.
    if (target === null || this.#options.root.contains(target)) {
      return false;
    }
    const secondary = event.button === 2 || (event.button === 0 && event.ctrlKey);
    if (!secondary || !this.#options.canOpen()) {
      return false;
    }
    // A handle is the mark a point draws, so a dot — a press pulling a new point
    // out of the ink — leaves the menu shut. A mark left over from the frame
    // before is no handle either: the Scene may have given that index to another
    // point, and a menu opened for it would act on a point no press aimed at.
    const point =
      this.#options.canvas.contains(target) && this.#options.drawn()
        ? (bendFromHandle(target, (id) => this.#options.hand.shaft(id))?.bend ?? null)
        : null;
    if (point === null) {
      return false;
    }
    // The press is the menu's: the canvas would take the focus with it, and the
    // row the person means to read would lose it before it could be read.
    event.preventDefault();
    this.#bend = point;
    this.#at = { x: event.clientX, y: event.clientY };
    // The point is the selection's before the panel is drawn, so the handle the
    // menu opens over is painted the way the rows act on it.
    this.#options.hand.pickBend(point);
    this.#options.refresh();
    return true;
  };

  /** The note is on top: draw the rows for the point and put the panel by the press. */
  reveal(): void {
    const { root, inside } = this.#options;
    const bend = this.#bend;
    const at = this.#at;
    if (bend === null || at === null) {
      return;
    }
    // The removal's own rule, so the row is disabled on exactly the points the
    // key cannot remove.
    const shaft = this.#options.hand.shaft(bend.id);
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
    // The panel has a size only once it is on the page, and the editor's box is
    // where it has to fit: the pointer's place is clamped into that box, so a
    // press at the window's own corner still shows the whole row.
    const box = inside.getBoundingClientRect();
    const scaleX = inside.offsetWidth > 0 && box.width > 0 ? box.width / inside.offsetWidth : 1;
    const scaleY = inside.offsetHeight > 0 && box.height > 0 ? box.height / inside.offsetHeight : 1;
    const roomX = inside.offsetWidth || box.width;
    const roomY = inside.offsetHeight || box.height;
    const place = (want: number, room: number, size: number) =>
      Math.round(Math.max(INSET, Math.min(want, room - size - INSET)));
    root.style.left = `${place((at.x - box.left) / scaleX, roomX, root.offsetWidth)}px`;
    root.style.top = `${place((at.y - box.top) / scaleY, roomY, root.offsetHeight)}px`;
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
   * The note is the page's no more. The point stays selected — a menu leaving is
   * not a selection changing — and the keys went back with the note, through the
   * stack that shut it.
   */
  conceal(): void {
    this.#bend = null;
    this.#at = null;
  }

  /**
   * The keys the menu holds while it is open, but for the two it leaves alone:
   * Escape shuts the note on top, and Enter presses the row that holds the keys
   * in the browser's own way. Every other key is the menu's, so not one of them
   * keeps a default of its own: Space would press the row that holds the keys,
   * and Tab would carry them out of the panel. ArrowUp and ArrowDown move them
   * between the rows.
   */
  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || event.key === 'Enter') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      this.#step(event.key === 'ArrowDown' ? 1 : -1);
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
    this.#options.shut();
    if (row === 'corner') {
      if (corner !== null && !this.#options.hand.switchCorner(bend, corner)) {
        this.#options.refresh();
      }
      return;
    }
    if (!this.#options.hand.removeBend(bend)) {
      this.#options.refresh();
    }
  }

  /** The corner the corner row switches the point to: the other one it turns by. */
  #switchTo(bend: Bend): Corner | null {
    const shaft = this.#options.hand.shaft(bend.id);
    const corner = shaft === null ? null : cornerAt(shaft, bend.index);
    return corner === null ? null : other(corner);
  }
}
