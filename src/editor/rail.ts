/**
 * The tool rail: the hand-drawn strip along the editor's top edge with the tools
 * on it.
 *
 * One static list, in rail order, from `actions.ts`, so a button, the key that
 * picks it and the palette's row for it can never disagree. Each button names
 * every key that picks it in its tooltip and wears its letter on the tile,
 * because the left hand is what picks a tool. The
 * outline is drawn by Rough.js, twice, so the strip reads as two pencil passes.
 */
import { RoughGenerator } from 'roughjs/bin/generator.js';
import type { Layout } from '../layout.js';
import type { Scene } from '../scene.js';
import { TOOLS } from './actions.js';
import type { ToolId } from './actions.js';
import { isClick } from './elements.js';
import {
  dockBox,
  dockOnFrame,
  leftDockEdge,
  nearestDock,
  placedDock,
  railFrame,
} from './geometry.js';
import type { Box, Point, RailDock, RailFrame, RailOutline, RailSide, View } from './geometry.js';
import { readRailSide, writeRailSide } from './rail-preference.js';

/** One icon per tool. Typed by tool id, so a tool without an icon cannot be added. */
const ICONS: Record<ToolId, string> = {
  select: '<path d="M5 3l6 17 2.6-7L21 10z" fill="currentColor" stroke="currentColor" stroke-width="1.1"/>',
  rectangle: '<rect x="4" y="6.5" width="16" height="11" rx="2"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  diamond: '<path d="M12 3.5L20.5 12 12 20.5 3.5 12z"/>',
  arrow: '<path d="M4 19L19.5 4.5M19.5 4.5h-5.5M19.5 4.5V10"/>',
  line: '<path d="M4 19L20 5"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
};

/** The rail's buttons, each icon drawn twice so it looks pencilled over. */
export function railMarkup(): string {
  return TOOLS.map((tool) => {
    const icon = ICONS[tool.id];
    const pressed = tool.id === 'select' ? 'true' : 'false';
    return (
      `<button type="button" data-tool="${tool.id}" aria-label="${tool.name}"` +
      ` aria-pressed="${pressed}" title="${tool.name} — ${tool.shortcut}">` +
      `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}<g class="ghost">${icon}</g></svg>` +
      `<span class="key">${tool.primary}</span>` +
      `</button>`
    );
  }).join('');
}

/**
 * The pencil outline of the rail, sized to whatever the rail measured. Returned
 * as SVG source because the rail is plain markup plus this one drawn strip.
 */
function railArt(width: number, height: number): string {
  if (width <= 0 || height <= 0) {
    return '';
  }
  const generator = new RoughGenerator();
  const d = roundRectPath(4.5, 4.5, width - 9, height - 9, 17);
  const passes = [
    { seed: 7, roughness: 1.8, bowing: 2, width: 1.45, opacity: 1 },
    { seed: 23, roughness: 2.3, bowing: 2.6, width: 0.8, opacity: 0.55 },
  ];
  return passes
    .map((pass) => {
      const paths = generator.toPaths(
        generator.path(d, {
          roughness: pass.roughness,
          bowing: pass.bowing,
          seed: pass.seed,
          stroke: 'currentColor',
          strokeWidth: pass.width,
        }),
      );
      const markup = paths
        .map((path) => `<path d="${path.d}" fill="none" stroke="currentColor" stroke-width="${pass.width}"/>`)
        .join('');
      return `<g opacity="${pass.opacity}">${markup}</g>`;
    })
    .join('');
}

function roundRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  return (
    `M ${x + r} ${y} L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r}` +
    ` L ${x + width} ${y + height - r} Q ${x + width} ${y + height} ${x + width - r} ${y + height}` +
    ` L ${x + r} ${y + height} Q ${x} ${y + height} ${x} ${y + height - r}` +
    ` L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`
  );
}

/**
 * How far the rail's pencil outline hangs outside the rail's own box on every
 * side, which the rail's measured box cannot say: `rail-art` in the sheet is
 * drawn `-7px` out, and `railArt` draws it in a box `2 × 7` bigger.
 */
const RAIL_OUTLINE = 7;

/** The frame's four sides: each dock a drag draws is one of them. */
const DOCK_SIDES: readonly RailSide[] = ['top', 'bottom', 'left', 'right'];

/**
 * The frame a rail hangs on, measured when it was pressed: the diagram's frame in
 * the editor's own pixels, and the room the editor had when it was measured.
 */
interface MeasuredFrame {
  readonly frame: Box;
  readonly editor: { readonly width: number; readonly height: number };
}

/**
 * A press on the rail that may still become a drag of it: the pointer the press
 * belongs to, where it landed and where it is now, and the frame measured when it
 * landed (D3), which is what a release docks against.
 */
interface RailDrag extends MeasuredFrame {
  readonly pointer: number;
  readonly from: Point;
  at: Point;
  /** Whether the pointer has left the click's slop: past it, the press is a drag. */
  moved: boolean;
  /** The side whose dock the drag is showing, or null until it has shown one (D6). */
  near: RailSide | null;
}

/** What the editor hands the Rail: its DOM, its measurements, and the two things a Rail can ask back. */
export interface RailHost {
  readonly rail: HTMLElement;
  readonly railArt: SVGSVGElement;
  readonly docks: HTMLElement;
  readonly statusCorners: () => HTMLElement[];
  readonly scene: () => Scene;
  readonly view: () => View;
  readonly layout: () => Layout;
  readonly size: () => { readonly width: number; readonly height: number };
  readonly screenPoint: (event: PointerEvent) => Point;
  readonly statusChrome: () => Box[];
  readonly setTool: (tool: ToolId) => void;
  readonly refusePointer: (pointerId: number) => void;
}

/**
 * The Rail's own state machine, dock placement, and pointer handling.
 */
export class Rail {
  readonly #host: RailHost;
  /**
   * Where the rail hangs now, in screen pixels: the strip's own left edge and the
   * middle of the side it is on, as the last clamp left it, or null until the page
   * has measured a frame. This is the one answer to where the rail is; nothing
   * measures the frame again to ask it (D5).
   */
  #dock: RailDock | null = null;
  /**
   * Whether the frame itself left no room for the rail beside it, as the last
   * measure found it (D2). A resize clears the rail from the frame's own dock
   * without measuring the frame, so the stop the frame asked for travels with it.
   */
  #held = false;
  /**
   * The side of the frame the rail is docked on: the side the page kept for its
   * next editor, or the top when it kept none, until a palette move takes it
   * elsewhere (D10, I8).
   */
  #side: RailSide = 'top';
  /**
   * The press on the rail that may become a drag of it, from the press to the
   * release: the one drag the rail has at a time (D6).
   */
  #drag: RailDrag | null = null;
  /**
   * Whether the release just committed a drag, so the click that follows it is
   * the drag's and picks no tool. The next press clears it.
   */
  #dragged = false;
  /**
   * The pointer a called-off press left down still owes the rail the click its
   * release sends, or null. That click lands on the tile the press landed on and
   * picks no tool: the person called the press off. The debt is that pointer's
   * alone, so another pointer's click, or a key's, still picks its own tool, and a
   * fresh press by the same pointer pays it (D6, D7).
   */
  #clickOwed: number | null = null;
  /**
   * The dock the frame asked for before the status corners moved the strip in, as an
   * offset from the editor's middle: what a corner that shrinks gives back, and what a
   * corner that grows is cleared from (O2).
   */
  #frameOffset: Point | null = null;
  /**
   * Whether a status corner changed size while a press held the strip, so the
   * placement it asks for waits for that press to end rather than moving the
   * strip out from under the pointer (D6, O2).
   */
  #waiting = false;
  /**
   * True once the strip was drawn in a box this editor had, which is the only box the
   * frame around the diagram is measured in: an editor the page gave no box has none
   * to measure, and nothing drawn with one (#64).
   */
  #drawn = false;
  /**
   * The boxes the strip is drawn from and measured against, watched: its own, so an
   * editor the page gave no box draws the outline as soon as it has one (D11, #64),
   * and the status bar's corners, which are as wide and as tall as the words they
   * hold — a Scene's name, the mode the page is in and the answer a folder gave
   * (O2).
   */
  readonly #boxWatch = new ResizeObserver(() => this.#onBoxResize());

  constructor(host: RailHost) {
    this.#host = host;
    // Nothing in the strip is a press or a focus until it has a dock to hang on:
    // `inert` is what a host's rule about what is inside the strip cannot undo, so
    // an undocked tile takes no press whatever the page says about its glyphs
    // (#62). `#hang` lifts it with the dock.
    this.#host.rail.inert = true;
    // The side this origin's editor was last moved to is read once, here, before
    // the frame is measured for the first time: the first placement is already on
    // that side, and a move made in another tab is waited for, not followed (D10).
    this.#side = readRailSide();
    this.#host.rail.dataset['side'] = this.#side;
  }

  listen(): void {
    this.#host.rail.addEventListener('pointerdown', this.#onDown);
    this.#host.rail.addEventListener('click', this.#onClick);
    for (const corner of this.#host.statusCorners()) {
      this.#boxWatch.observe(corner);
    }
    this.#boxWatch.observe(this.#host.rail);
    requestAnimationFrame(() => this.#drawArt());
  }

  unlisten(): void {
    this.#host.rail.removeEventListener('pointerdown', this.#onDown);
    this.#host.rail.removeEventListener('click', this.#onClick);
    this.#endDrag();
    this.#boxWatch.disconnect();
  }

  /** No Scene in hand: drop any active drag and forget the frame the rail hung on. */
  forget(): void {
    this.#endDrag();
    this.#frameOffset = null;
    this.#dock = null;
    this.#held = false;
  }

  /** Measure the frame around the diagram and hang the rail on it (Scene open or view fit). */
  place(): void {
    this.#place();
  }

  /** The editor window resized: carry the rail along and move a held drag's marks with it. */
  resize(): void {
    this.#drawArt();
    this.#hang();
    this.#redrawDocks();
  }

  /** Dock the rail on one of the frame's four sides (from the command palette). */
  dock(side: RailSide): void {
    this.#dockTo(side);
  }

  /** Escape during a rail drag calls it off and keeps the Scene's tool and selection. */
  escape(): boolean {
    if (this.#drag === null) {
      return false;
    }
    this.#callOffDrag();
    return true;
  }

  /** Window blur or hidden tab: call off any active rail drag. */
  interrupt(): void {
    this.#callOffDrag();
  }

  /** Whether a rail drag currently holds the pointer. */
  holding(): boolean {
    return this.#drag !== null;
  }

  /**
   * Where a left dock's own outline reaches, or null when the rail hangs
   * anywhere else: read from where the rail hangs and what stopped it there,
   * never measured again, so the view moves for the note alone (D5).
   */
  edge(): number | null {
    const rail = this.#dock;
    return rail === null ? null : leftDockEdge(rail, this.#outline(), this.#side);
  }

  /** Mark the active tool's button as pressed. */
  setTool(tool: ToolId): void {
    for (const button of this.#host.rail.querySelectorAll('[data-tool]')) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-tool') === tool));
    }
  }

  #onBoxResize = (): void => {
    const measured = this.#drawn;
    this.#drawArt();
    if (!measured) {
      this.#place();
      return;
    }
    if (this.#drag !== null) {
      this.#waiting = true;
      this.#redrawDocks();
      return;
    }
    this.#hang();
  };

  #drawArt(): void {
    const width = this.#host.rail.offsetWidth + RAIL_OUTLINE * 2;
    const height = this.#host.rail.offsetHeight + RAIL_OUTLINE * 2;
    if (width <= 14 || height <= 14) {
      this.#drawn = false;
      return;
    }
    this.#drawn = true;
    this.#host.railArt.setAttribute('width', String(width));
    this.#host.railArt.setAttribute('height', String(height));
    this.#host.railArt.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.#host.railArt.innerHTML = railArt(width, height);
  }

  #showDocks(drag: RailDrag): void {
    const near = nearestDock(drag.frame, drag.at);
    drag.near = near;
    if (this.#host.docks.hidden) {
      this.#drawDocks(drag);
      this.#host.docks.hidden = false;
    }
    for (const side of DOCK_SIDES) {
      const mark = this.#dockMark(side);
      if (side === near) {
        mark.dataset['near'] = '';
      } else {
        delete mark.dataset['near'];
      }
    }
  }

  #drawDocks(drag: RailDrag): void {
    const outlines = this.#outlineEachWay();
    const chrome = this.#host.statusChrome();
    const size = this.#host.size();
    for (const side of DOCK_SIDES) {
      const lying = side === 'top' || side === 'bottom';
      const outline = lying ? outlines.lying : outlines.standing;
      const frameDock = dockOnFrame(drag.frame, drag.editor, side, outline);
      const carried = this.#pointOf(this.#offsetOf(frameDock.dock, drag.editor), size);
      const placed = placedDock(
        { dock: carried, stopped: frameDock.stopped },
        side,
        outline,
        chrome,
        size,
      );
      const box = dockBox(placed, side, outline);
      const mark = this.#dockMark(side);
      mark.setAttribute('width', String(box.width));
      mark.setAttribute('height', String(box.height));
      mark.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
      mark.style.left = `${box.x}px`;
      mark.style.top = `${box.y}px`;
      mark.innerHTML = railArt(box.width, box.height);
    }
  }

  #redrawDocks(): void {
    const drag = this.#drag;
    if (drag === null || this.#host.docks.hidden) {
      return;
    }
    this.#drawDocks(drag);
  }

  #dockMark(side: RailSide): SVGSVGElement {
    return this.#host.docks.querySelector<SVGSVGElement>(`.dock[data-side="${side}"]`)!;
  }

  #hideDocks(): void {
    this.#host.docks.hidden = true;
  }

  #outlineEachWay(): { lying: RailOutline; standing: RailOutline } {
    const kept = this.#side;
    const lying = kept === 'top' || kept === 'bottom';
    const here = this.#outline();
    this.#host.rail.dataset['side'] = lying ? 'left' : 'top';
    const there = this.#outline();
    this.#host.rail.dataset['side'] = kept;
    return lying ? { lying: here, standing: there } : { lying: there, standing: here };
  }

  #place(pressed?: MeasuredFrame): void {
    this.#waiting = false;
    const size = pressed?.editor ?? this.#host.size();
    const frameDock =
      pressed === undefined
        ? this.#dockOn(this.#side)
        : dockOnFrame(pressed.frame, pressed.editor, this.#side, this.#outline());
    this.#held = frameDock.stopped;
    this.#frameOffset = this.#offsetOf(frameDock.dock, size);
    this.#hang();
  }

  #hang(): void {
    const offset = this.#frameOffset;
    if (offset === null) {
      return;
    }
    const size = this.#host.size();
    const placed = placedDock(
      { dock: this.#pointOf(offset, size), stopped: this.#held },
      this.#side,
      this.#outline(),
      this.#host.statusChrome(),
      size,
    );
    const before = this.#dock;
    this.#dock = placed;
    if (
      before !== null &&
      before.dock.x === placed.dock.x &&
      before.dock.y === placed.dock.y &&
      this.#host.rail.dataset['placed'] === ''
    ) {
      return;
    }
    this.#host.rail.style.setProperty('--rail-left', `${placed.dock.x}px`);
    this.#host.rail.style.setProperty('--rail-top', `${placed.dock.y}px`);
    this.#host.rail.inert = false;
    this.#host.rail.dataset['placed'] = '';
  }

  #pointOf(offset: Point, size: { readonly width: number; readonly height: number }): Point {
    return { x: size.width / 2 + offset.x, y: size.height / 2 + offset.y };
  }

  #offsetOf(at: Point, size: { readonly width: number; readonly height: number }): Point {
    return { x: at.x - size.width / 2, y: at.y - size.height / 2 };
  }

  #dockOn(side: RailSide): RailFrame {
    return railFrame(
      this.#host.scene(),
      this.#host.view(),
      this.#host.size(),
      side,
      this.#outline(),
      this.#host.layout(),
    );
  }

  #dockTo(side: RailSide, pressed?: MeasuredFrame): void {
    this.#side = side;
    this.#host.rail.dataset['side'] = side;
    this.#drawArt();
    this.#place(pressed);
    writeRailSide(side);
  }

  #outline(): RailOutline {
    return {
      width: this.#host.rail.offsetWidth + RAIL_OUTLINE * 2,
      height: this.#host.rail.offsetHeight + RAIL_OUTLINE * 2,
      overhang: RAIL_OUTLINE,
    };
  }

  #onClick = (event: MouseEvent): void => {
    if (this.#dragged) {
      this.#dragged = false;
      return;
    }
    if (event instanceof PointerEvent && event.pointerId === this.#clickOwed && event.detail !== 0) {
      this.#clickOwed = null;
      return;
    }
    const drag = this.#drag;
    if (
      drag !== null &&
      event.detail !== 0 &&
      !(event instanceof PointerEvent && event.pointerId === drag.pointer)
    ) {
      return;
    }
    const button = (event.target as Element | null)?.closest('[data-tool]') as HTMLElement | null;
    const tool = button?.dataset['tool'];
    if (tool !== undefined) {
      this.#host.setTool(tool as ToolId);
    }
  };

  #onDown = (event: PointerEvent): void => {
    if (this.#clickOwed === event.pointerId) {
      this.#clickOwed = null;
    }
    if (this.#drag !== null || event.button !== 0 || !event.isPrimary) {
      return;
    }
    this.#dragged = false;
    const at = this.#host.screenPoint(event);
    const editor = this.#host.size();
    this.#drag = {
      pointer: event.pointerId,
      from: at,
      at,
      moved: false,
      near: null,
      frame: this.#dockOn(this.#side).frame,
      editor,
    };
    window.addEventListener('pointermove', this.#onMove);
    window.addEventListener('pointerup', this.#onUp);
    window.addEventListener('pointercancel', this.#onCancel);
  };

  #onMove = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (drag === null || event.pointerId !== drag.pointer) {
      return;
    }
    drag.at = this.#host.screenPoint(event);
    if (!drag.moved) {
      if (isClick(drag.from, drag.at)) {
        return;
      }
      drag.moved = true;
      this.#host.rail.setPointerCapture(event.pointerId);
    }
    this.#showDocks(drag);
  };

  #onUp = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (drag === null || event.pointerId !== drag.pointer) {
      return;
    }
    drag.at = this.#host.screenPoint(event);
    this.#endDrag();
    if (!drag.moved && isClick(drag.from, drag.at)) {
      this.#settle();
      return;
    }
    this.#dragged = true;
    this.#dockTo(drag.near ?? nearestDock(drag.frame, drag.at), drag);
  };

  #onCancel = (event: PointerEvent): void => {
    if (this.#drag?.pointer === event.pointerId) {
      this.#callOffDrag();
      this.#settle();
    }
  };

  #callOffDrag(): void {
    const drag = this.#drag;
    if (drag === null) {
      return;
    }
    this.#endDrag();
    this.#host.refusePointer(drag.pointer);
    this.#clickOwed = drag.pointer;
    this.#hang();
  }

  #settle(): void {
    if (this.#waiting) {
      this.#hang();
    }
  }

  #endDrag(): void {
    const drag = this.#drag;
    if (drag === null) {
      return;
    }
    this.#drag = null;
    window.removeEventListener('pointermove', this.#onMove);
    window.removeEventListener('pointerup', this.#onUp);
    window.removeEventListener('pointercancel', this.#onCancel);
    if (this.#host.rail.hasPointerCapture(drag.pointer)) {
      this.#host.rail.releasePointerCapture(drag.pointer);
    }
    this.#hideDocks();
  }
}
