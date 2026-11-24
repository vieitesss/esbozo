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
import { elementsById } from '../scene.js';
import type { Scene } from '../scene.js';
import { TOOLS } from './actions.js';
import type { ToolId } from './actions.js';
import { isClick } from './elements.js';
import { boxOf, overlaps, toScreen } from './geometry.js';
import type { Box, Point, View } from './geometry.js';
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

/** What the Rail needs from its host: supplied measurements and callbacks, with no DOM required. */
export interface RailHost {
  readonly scene: () => Scene;
  readonly view: () => View;
  readonly layout: () => Layout;
  readonly size: () => { readonly width: number; readonly height: number };
  readonly statusChrome: () => Box[];
  readonly outline: () => RailOutline;
  readonly outlineEachWay?: () => { readonly lying: RailOutline; readonly standing: RailOutline };
  readonly setTool: (tool: ToolId) => void;
  readonly refusePointer: (pointerId: number) => void;
  readonly readSide?: () => RailSide;
  readonly writeSide?: (side: RailSide) => void;
  readonly onSide?: (side: RailSide) => void;
  readonly onDrawArt?: () => boolean;
  readonly onHang?: (dock: RailDock, side: RailSide) => void;
  readonly onDocks?: (docks: readonly { readonly side: RailSide; readonly box: Box }[] | null) => void;
  readonly onNearDock?: (side: RailSide) => void;
  readonly onDragListeners?: (active: boolean) => void;
  readonly onCapture?: (pointerId: number | null) => void;
}

/**
 * The Rail's own state machine, dock placement, and pointer handling.
 * Measurements come in from `RailHost`, so both the browser editor and Node tests
 * drive the same state machine.
 */
export class Rail {
  readonly #host: RailHost;
  #dock: RailDock | null = null;
  #held = false;
  #side: RailSide = 'top';
  #drag: RailDrag | null = null;
  #dragged = false;
  #clickOwed: number | null = null;
  #frameOffset: Point | null = null;
  #waiting = false;
  #drawn = false;
  #placed = false;
  #docksShown = false;

  constructor(host: RailHost) {
    this.#host = host;
    this.#side = host.readSide ? host.readSide() : readRailSide();
    this.#host.onSide?.(this.#side);
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

  /** Either the strip or a status corner changed size. */
  boxResize(): void {
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
  }

  /** Draw the strip's pencil outline once the host has a box for it. */
  drawArt(): void {
    this.#drawArt();
  }

  /** Dock the rail on one of the frame's four sides (from the command palette). */
  dock(side: RailSide): void {
    this.#dockTo(side);
  }

  /** Escape or interrupt during a rail drag calls it off and keeps the Scene's tool and selection. */
  escape(): boolean {
    if (this.#drag === null) {
      return false;
    }
    this.#callOffDrag();
    return true;
  }

  /** End any active drag without owing a click (e.g. element disconnected). */
  endDrag(): void {
    this.#endDrag();
  }

  /** Whether a rail drag currently holds the pointer. */
  holding(): boolean {
    return this.#drag !== null;
  }

  /**
   * Where a left dock's own outline reaches, or null when the rail hangs
   * anywhere else.
   */
  edge(): number | null {
    const rail = this.#dock;
    return rail === null ? null : leftDockEdge(rail, this.#host.outline(), this.#side);
  }

  /** The side the rail is currently docked on. */
  side(): RailSide {
    return this.#side;
  }

  /** A pointer press on the rail. */
  press(pointer: number, at: Point, button = 0, isPrimary = true): void {
    if (this.#clickOwed === pointer) {
      this.#clickOwed = null;
    }
    if (this.#drag !== null || button !== 0 || !isPrimary) {
      return;
    }
    this.#dragged = false;
    const editor = this.#host.size();
    this.#drag = {
      pointer,
      from: at,
      at,
      moved: false,
      near: null,
      frame: this.#dockOn(this.#side).frame,
      editor,
    };
    this.#host.onDragListeners?.(true);
  }

  /** A pointer move while a press on the rail is active. */
  move(pointer: number, at: Point): void {
    const drag = this.#drag;
    if (drag === null || pointer !== drag.pointer) {
      return;
    }
    drag.at = at;
    if (!drag.moved) {
      if (isClick(drag.from, drag.at)) {
        return;
      }
      drag.moved = true;
      this.#host.onCapture?.(pointer);
    }
    this.#showDocks(drag);
  }

  /** A pointer release while a press on the rail is active. */
  release(pointer: number, at: Point): void {
    const drag = this.#drag;
    if (drag === null || pointer !== drag.pointer) {
      return;
    }
    drag.at = at;
    this.#endDrag();
    if (!drag.moved && isClick(drag.from, drag.at)) {
      this.#settle();
      return;
    }
    this.#dragged = true;
    this.#dockTo(drag.near ?? nearestDock(drag.frame, drag.at), drag);
  }

  /** A pointer cancel while a press on the rail is active. */
  cancel(pointer: number): void {
    if (this.#drag?.pointer === pointer) {
      this.#callOffDrag();
      this.#settle();
    }
  }

  /** A click on a rail tool button. */
  click(tool: ToolId | undefined, pointer: number | null, detail: number): void {
    if (this.#dragged) {
      this.#dragged = false;
      return;
    }
    if (pointer !== null && pointer === this.#clickOwed && detail !== 0) {
      this.#clickOwed = null;
      return;
    }
    const drag = this.#drag;
    if (drag !== null && detail !== 0 && pointer !== drag.pointer) {
      return;
    }
    if (tool !== undefined) {
      this.#host.setTool(tool);
    }
  }

  #drawArt(): void {
    this.#drawn = this.#host.onDrawArt ? this.#host.onDrawArt() : true;
  }

  #showDocks(drag: RailDrag): void {
    const near = nearestDock(drag.frame, drag.at);
    drag.near = near;
    if (!this.#docksShown) {
      this.#drawDocks(drag);
      this.#docksShown = true;
    }
    this.#host.onNearDock?.(near);
  }

  #drawDocks(drag: RailDrag): void {
    const each = this.#host.outlineEachWay?.();
    if (each === undefined) {
      return;
    }
    const chrome = this.#host.statusChrome();
    const size = this.#host.size();
    const marks: { side: RailSide; box: Box }[] = [];
    for (const side of DOCK_SIDES) {
      const lying = side === 'top' || side === 'bottom';
      const outline = lying ? each.lying : each.standing;
      const frameDock = dockOnFrame(drag.frame, drag.editor, side, outline);
      const carried = this.#pointOf(this.#offsetOf(frameDock.dock, drag.editor), size);
      const placed = placedDock(
        { dock: carried, stopped: frameDock.stopped },
        side,
        outline,
        chrome,
        size,
      );
      marks.push({ side, box: dockBox(placed, side, outline) });
    }
    this.#host.onDocks?.(marks);
  }

  #redrawDocks(): void {
    const drag = this.#drag;
    if (drag === null || !this.#docksShown) {
      return;
    }
    this.#drawDocks(drag);
  }

  #hideDocks(): void {
    this.#docksShown = false;
    this.#host.onDocks?.(null);
  }

  #place(pressed?: MeasuredFrame): void {
    this.#waiting = false;
    const size = pressed?.editor ?? this.#host.size();
    const frameDock =
      pressed === undefined
        ? this.#dockOn(this.#side)
        : dockOnFrame(pressed.frame, pressed.editor, this.#side, this.#host.outline());
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
      this.#host.outline(),
      this.#host.statusChrome(),
      size,
    );
    const before = this.#dock;
    this.#dock = placed;
    if (
      before !== null &&
      before.dock.x === placed.dock.x &&
      before.dock.y === placed.dock.y &&
      this.#placed
    ) {
      return;
    }
    this.#placed = true;
    this.#host.onHang?.(placed, this.#side);
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
      this.#host.outline(),
      this.#host.layout(),
    );
  }

  #dockTo(side: RailSide, pressed?: MeasuredFrame): void {
    this.#side = side;
    this.#host.onSide?.(side);
    this.#drawArt();
    this.#place(pressed);
    if (this.#host.writeSide) {
      this.#host.writeSide(side);
    } else {
      writeRailSide(side);
    }
  }

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
    this.#host.onDragListeners?.(false);
    this.#host.onCapture?.(null);
    this.#hideDocks();
  }
}

/** Browser DOM host for `mountRail`. */
export interface RailDomHost {
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

/** The browser-mounted Rail interface `editor.ts` holds. */
export interface MountedRail {
  listen(): void;
  unlisten(): void;
  forget(): void;
  place(): void;
  resize(): void;
  dock(side: RailSide): void;
  escape(): boolean;
  endDrag(): void;
  holding(): boolean;
  edge(): number | null;
  markTool(tool: ToolId): void;
}

/** Mount a `Rail` onto the editor's DOM elements, pointer listeners, and `ResizeObserver`. */
export function mountRail(dom: RailDomHost): MountedRail {
  dom.rail.inert = true;
  let captured: number | null = null;

  const outline = (): RailOutline => ({
    width: dom.rail.offsetWidth + RAIL_OUTLINE * 2,
    height: dom.rail.offsetHeight + RAIL_OUTLINE * 2,
    overhang: RAIL_OUTLINE,
  });

  const dockMark = (side: RailSide): SVGSVGElement =>
    dom.docks.querySelector<SVGSVGElement>(`.dock[data-side="${side}"]`)!;

  const onMove = (event: PointerEvent): void => {
    rail.move(event.pointerId, dom.screenPoint(event));
  };
  const onUp = (event: PointerEvent): void => {
    rail.release(event.pointerId, dom.screenPoint(event));
  };
  const onCancel = (event: PointerEvent): void => {
    rail.cancel(event.pointerId);
  };
  const onDown = (event: PointerEvent): void => {
    rail.press(event.pointerId, dom.screenPoint(event), event.button, event.isPrimary);
  };
  const onClick = (event: MouseEvent): void => {
    const button = (event.target as Element | null)?.closest('[data-tool]') as HTMLElement | null;
    const tool = button?.dataset['tool'] as ToolId | undefined;
    const pointer = event instanceof PointerEvent ? event.pointerId : null;
    rail.click(tool, pointer, event.detail);
  };

  const rail: Rail = new Rail({
    scene: dom.scene,
    view: dom.view,
    layout: dom.layout,
    size: dom.size,
    statusChrome: dom.statusChrome,
    outline,
    outlineEachWay: () => {
      const kept = rail.side();
      const lying = kept === 'top' || kept === 'bottom';
      const here = outline();
      dom.rail.dataset['side'] = lying ? 'left' : 'top';
      const there = outline();
      dom.rail.dataset['side'] = kept;
      return lying ? { lying: here, standing: there } : { lying: there, standing: here };
    },
    setTool: dom.setTool,
    refusePointer: dom.refusePointer,
    onSide: (side) => {
      dom.rail.dataset['side'] = side;
    },
    onDrawArt: () => {
      const width = dom.rail.offsetWidth + RAIL_OUTLINE * 2;
      const height = dom.rail.offsetHeight + RAIL_OUTLINE * 2;
      if (width <= 14 || height <= 14) {
        return false;
      }
      dom.railArt.setAttribute('width', String(width));
      dom.railArt.setAttribute('height', String(height));
      dom.railArt.setAttribute('viewBox', `0 0 ${width} ${height}`);
      dom.railArt.innerHTML = railArt(width, height);
      return true;
    },
    onHang: (placed) => {
      dom.rail.style.setProperty('--rail-left', `${placed.dock.x}px`);
      dom.rail.style.setProperty('--rail-top', `${placed.dock.y}px`);
      dom.rail.inert = false;
      dom.rail.dataset['placed'] = '';
    },
    onDocks: (marks) => {
      if (marks === null) {
        dom.docks.hidden = true;
        return;
      }
      for (const { side, box } of marks) {
        const mark = dockMark(side);
        mark.setAttribute('width', String(box.width));
        mark.setAttribute('height', String(box.height));
        mark.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
        mark.style.left = `${box.x}px`;
        mark.style.top = `${box.y}px`;
        mark.innerHTML = railArt(box.width, box.height);
      }
      dom.docks.hidden = false;
    },
    onNearDock: (near) => {
      for (const side of DOCK_SIDES) {
        const mark = dockMark(side);
        if (side === near) {
          mark.dataset['near'] = '';
        } else {
          delete mark.dataset['near'];
        }
      }
    },
    onDragListeners: (active) => {
      if (active) {
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
      } else {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      }
    },
    onCapture: (pointerId) => {
      if (pointerId !== null) {
        captured = pointerId;
        dom.rail.setPointerCapture(pointerId);
      } else if (captured !== null) {
        if (dom.rail.hasPointerCapture(captured)) {
          dom.rail.releasePointerCapture(captured);
        }
        captured = null;
      }
    },
  });

  const boxWatch = new ResizeObserver(() => rail.boxResize());

  return {
    listen() {
      dom.rail.addEventListener('pointerdown', onDown);
      dom.rail.addEventListener('click', onClick);
      for (const corner of dom.statusCorners()) {
        boxWatch.observe(corner);
      }
      boxWatch.observe(dom.rail);
      requestAnimationFrame(() => rail.drawArt());
    },
    unlisten() {
      dom.rail.removeEventListener('pointerdown', onDown);
      dom.rail.removeEventListener('click', onClick);
      boxWatch.disconnect();
    },
    forget: () => rail.forget(),
    place: () => rail.place(),
    resize: () => rail.resize(),
    dock: (side) => rail.dock(side),
    escape: () => rail.escape(),
    endDrag: () => rail.endDrag(),
    holding: () => rail.holding(),
    edge: () => rail.edge(),
    markTool(tool) {
      for (const button of dom.rail.querySelectorAll('[data-tool]')) {
        button.setAttribute('aria-pressed', String(button.getAttribute('data-tool') === tool));
      }
    },
  };
}

/**
 * The frame a tool rail hangs on: the diagram on screen, grown to at least the
 * minimum size, cut to the editor's box, and the dock one side of it asks for.
 */
interface RailFrame extends RailDock {
  /** The diagram's frame on screen: what a dock sits outside of. */
  readonly frame: Box;
}

/** A dock the sheet hangs the strip by, and whether the editor's inset is what stopped it there. */
interface RailDock {
  /**
   * The dock, as the sheet hangs the strip there: the middle of the side the
   * strip turns about, and its own near edge. The pencil outline that hangs
   * outside the strip clears the frame by the gap.
   */
  readonly dock: Point;
  /**
   * An inset of the editor stopped the strip on the axis its side stands across
   * — the edge it is held against — because the place it was asked for had no
   * room for its outline (D2, D3). A dock that reaches that inset with room
   * either side was stopped by nothing, and the note's clearance reads the
   * editor's edge past it (O1).
   */
  readonly stopped: boolean;
}

/** The side of the frame the rail docks on: top and bottom lie along it, left and right stand up it (D1). */
export type RailSide = 'top' | 'bottom' | 'left' | 'right';

/**
 * The pencil outline the rail wears, as the rail box cannot measure it: the
 * strip is wider and taller than the box it turns about.
 */
interface RailOutline {
  /** How wide the outline is, in screen pixels. */
  readonly width: number;
  /** How tall the outline is, in screen pixels. */
  readonly height: number;
  /** How far the outline hangs outside the rail's box on every side. */
  readonly overhang: number;
}

/** The smallest frame a diagram gets on screen (D2). */
const FRAME_MIN_WIDTH = 960;
const FRAME_MIN_HEIGHT = 600;

/** The gap between a frame's side and the rail's pencil outline: the note's own (I2). */
const RAIL_GAP = 16;

/**
 * How far inside the editor's edges the rail stops: inside the edge the frame
 * leaves no room at (D2), and inside an edge a resize has carried it past (D3).
 */
const RAIL_INSET = 15;

/**
 * The frame around a Scene's diagram, and where that side's dock sits on it.
 */
export function railFrame(
  scene: Scene,
  view: View,
  viewport: { width: number; height: number },
  side: RailSide,
  outline: RailOutline,
  layout: Layout,
): RailFrame {
  const editor: Box = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const diagram = boxOf(scene.elements, elementsById(scene.elements), layout);
  const shown = diagram === null ? null : grown(onScreen(diagram, view));
  const frame = (shown === null ? null : cutTo(shown, editor)) ?? emptyFrame(editor);
  return { frame, ...dockOnFrame(frame, editor, side, outline) };
}

/**
 * The dock a release takes on one side, as the editor stands now: the dock the frame
 * asked for, moved in clear of the page's status chrome (O2) and clamped inside the
 * editor's own edges (D2, D3).
 */
function placedDock(
  frameDock: RailDock,
  side: RailSide,
  outline: RailOutline,
  chrome: readonly Box[],
  viewport: { width: number; height: number },
): RailDock {
  const cleared = clearOfStatus(frameDock, side, outline, chrome, viewport);
  const strip = { width: outline.width - outline.overhang * 2, height: outline.height - outline.overhang * 2 };
  const clamped = clampedDock(cleared.dock, { ...strip, overhang: outline.overhang }, viewport, side);
  return { dock: clamped.dock, stopped: clamped.stopped || cleared.stopped };
}

/**
 * The dock on one side of the frame: the strip's outline one gap outside it,
 * centred on that side, or the strip just inside the editor's edge where the
 * frame leaves no room for the gap (D1, D2).
 */
function dockOnFrame(
  frame: Box,
  editor: { width: number; height: number },
  side: RailSide,
  outline: RailOutline,
): RailDock {
  const strip = { width: outline.width - outline.overhang * 2, height: outline.height - outline.overhang * 2 };
  const middleX = frame.x + frame.width / 2;
  const middleY = frame.y + frame.height / 2;
  switch (side) {
    case 'top': {
      const outlineTop = frame.y - RAIL_GAP - outline.height;
      return {
        dock: { x: middleX, y: outlineTop < 0 ? RAIL_INSET : outlineTop + outline.overhang },
        stopped: outlineTop < 0,
      };
    }
    case 'bottom': {
      const outlineTop = frame.y + frame.height + RAIL_GAP;
      const stopped = outlineTop + outline.height > editor.height;
      return {
        dock: { x: middleX, y: stopped ? editor.height - RAIL_INSET - strip.height : outlineTop + outline.overhang },
        stopped,
      };
    }
    case 'left': {
      const outlineLeft = frame.x - RAIL_GAP - outline.width;
      const stopped = outlineLeft < 0;
      return {
        dock: { x: stopped ? RAIL_INSET : outlineLeft + outline.overhang, y: middleY },
        stopped,
      };
    }
    case 'right': {
      const outlineLeft = frame.x + frame.width + RAIL_GAP;
      const stopped = outlineLeft + outline.width > editor.width;
      return {
        dock: { x: stopped ? editor.width - RAIL_INSET - strip.width : outlineLeft + outline.overhang, y: middleY },
        stopped,
      };
    }
  }
}

/**
 * Which of the frame's four docks a drag of the rail was released nearest.
 */
export function nearestDock(frame: Box, at: Point): RailSide {
  let nearest: RailSide = 'top';
  let distance = Infinity;
  for (const side of DOCK_SIDES) {
    const squared = squaredToSide(frame, side, at);
    if (squared < distance) {
      nearest = side;
      distance = squared;
    }
  }
  return nearest;
}

/** The square of the distance from a pointer to one side of the frame, as that side's own segment. */
function squaredToSide(frame: Box, side: RailSide, at: Point): number {
  const lying = side === 'top' || side === 'bottom';
  const across = lying
    ? at.y - (side === 'top' ? frame.y : frame.y + frame.height)
    : at.x - (side === 'left' ? frame.x : frame.x + frame.width);
  const along = lying
    ? outside(at.x, frame.x, frame.width)
    : outside(at.y, frame.y, frame.height);
  return across * across + along * along;
}

/** How far past one axis of a box a value lies, and nothing between that axis's two ends. */
function outside(at: number, start: number, size: number): number {
  return Math.max(0, start - at, at - (start + size));
}

/**
 * A dock moved inward just far enough to clear the page's status chrome (O2).
 */
function clearOfStatus(
  rail: RailDock,
  side: RailSide,
  outline: RailOutline,
  chrome: readonly Box[],
  viewport: { width: number; height: number },
): RailDock {
  const strip = { width: outline.width - outline.overhang * 2, height: outline.height - outline.overhang * 2 };
  const start = stripBox(rail.dock, strip, side);
  const wornAt = (travel: number): Box => {
    const box = movedInland(start, side, travel);
    return {
      x: box.x - outline.overhang,
      y: box.y - outline.overhang,
      width: outline.width,
      height: outline.height,
    };
  };
  const held = wornAt(0);
  if (chrome.every((corner) => !overlaps(held, corner))) {
    return rail;
  }
  const limit = inlandRoom(held, side, viewport);
  const asks = chrome.map((corner) => clearOfCorner(held, corner, side));
  const travels = [...new Set([0, ...asks.map((ask) => Math.max(0, Math.min(ask, limit)))])].sort(
    (one, other) => one - other,
  );
  const clear = travels.find((travel) => chrome.every((corner) => !overlaps(wornAt(travel), corner)));
  const travel =
    clear ??
    travels.reduce((best, one) =>
      covered(wornAt(one), chrome) < covered(wornAt(best), chrome) ? one : best,
    );
  return { dock: dockOf(movedInland(start, side, travel), strip, side), stopped: rail.stopped };
}

/** A strip box moved `travel` toward the editor's middle, across the side it hangs on. */
function movedInland(box: Point, side: RailSide, travel: number): Point {
  switch (side) {
    case 'top':
      return { x: box.x, y: box.y + travel };
    case 'bottom':
      return { x: box.x, y: box.y - travel };
    case 'left':
      return { x: box.x + travel, y: box.y };
    case 'right':
      return { x: box.x - travel, y: box.y };
  }
}

/** How far inward a strip box must move to come out from under one corner. */
function clearOfCorner(worn: Box, corner: Box, side: RailSide): number {
  switch (side) {
    case 'top':
      return corner.y + corner.height - worn.y;
    case 'bottom':
      return worn.y + worn.height - corner.y;
    case 'left':
      return corner.x + corner.width - worn.x;
    case 'right':
      return worn.x + worn.width - corner.x;
  }
}

/** How far inward a strip box can move before its far end leaves the editor. */
function inlandRoom(worn: Box, side: RailSide, viewport: { width: number; height: number }): number {
  switch (side) {
    case 'top':
      return viewport.height - RAIL_INSET - worn.height - worn.y;
    case 'bottom':
      return worn.y - RAIL_INSET;
    case 'left':
      return viewport.width - RAIL_INSET - worn.width - worn.x;
    case 'right':
      return worn.x - RAIL_INSET;
  }
}

/** How much of the chrome's boxes a strip box covers, in square pixels. */
function covered(worn: Box, chrome: readonly Box[]): number {
  let area = 0;
  for (const corner of chrome) {
    const width = Math.min(worn.x + worn.width, corner.x + corner.width) - Math.max(worn.x, corner.x);
    const height = Math.min(worn.y + worn.height, corner.y + corner.height) - Math.max(worn.y, corner.y);
    if (width > 0 && height > 0) {
      area += width * height;
    }
  }
  return area;
}

/**
 * Where a left dock reaches, in screen units, or null when the rail is held
 * anywhere else.
 */
export function leftDockEdge(rail: RailDock, outline: RailOutline, side: RailSide): number | null {
  if (side !== 'left' || !rail.stopped || rail.dock.x !== RAIL_INSET) {
    return null;
  }
  return rail.dock.x + outline.width - outline.overhang;
}

/**
 * A dock pulled inside the editor's box: one whose pencilled outline already
 * fits is left exactly where the frame measured it, and one carried out of the
 * box is pulled to the top edge's own inset.
 */
export function clampedDock(
  dock: Point,
  strip: { width: number; height: number; overhang: number },
  viewport: { width: number; height: number },
  side: RailSide,
): RailDock {
  const box = stripBox(dock, strip, side);
  const held = {
    x: placed(box.x, viewport.width, strip.width, strip.overhang),
    y: placed(box.y, viewport.height, strip.height, strip.overhang),
  };
  const across = side === 'top' || side === 'bottom' ? held.y : held.x;
  return {
    dock: dockOf({ x: held.x.at, y: held.y.at }, strip, side),
    stopped: across.stopped,
  };
}

/** A dock as the strip's own box: its left and top, whatever side it is on. */
function stripBox(dock: Point, strip: { width: number; height: number }, side: RailSide): Point {
  return side === 'top' || side === 'bottom'
    ? { x: dock.x - strip.width / 2, y: dock.y }
    : { x: dock.x, y: dock.y - strip.height / 2 };
}

/** A strip box back as the dock the sheet hangs: the side's own edge and the middle of the other. */
function dockOf(box: Point, strip: { width: number; height: number }, side: RailSide): Point {
  return side === 'top' || side === 'bottom'
    ? { x: box.x + strip.width / 2, y: box.y }
    : { x: box.x, y: box.y + strip.height / 2 };
}

/**
 * The box a dock's pencil outline covers in the editor's own pixels: the strip's
 * own box, grown by the overhang the outline hangs outside it on every side.
 */
function dockBox(dock: RailDock, side: RailSide, outline: RailOutline): Box {
  const strip = { width: outline.width - outline.overhang * 2, height: outline.height - outline.overhang * 2 };
  const box = stripBox(dock.dock, strip, side);
  return {
    x: box.x - outline.overhang,
    y: box.y - outline.overhang,
    width: outline.width,
    height: outline.height,
  };
}

/** One axis of a dock: where the strip sits on it, and whether an inset stopped it there. */
interface Placed {
  readonly at: number;
  readonly stopped: boolean;
}

/**
 * One side of the rail: where the frame measured it while its outline fits the
 * editor, or inside the edge the carried place crossed.
 */
function placed(start: number, extent: number, size: number, overhang: number): Placed {
  if (start - overhang >= 0 && start + size + overhang <= extent) {
    return { at: start, stopped: false };
  }
  const pulled = Math.max(RAIL_INSET, Math.min(start, extent - RAIL_INSET - size));
  const held = pulled - overhang >= 0 && pulled + size + overhang <= extent;
  if (!held && size + overhang * 2 <= extent) {
    return { at: (extent - size) / 2, stopped: false };
  }
  const stopped = pulled === RAIL_INSET || pulled === extent - RAIL_INSET - size;
  return { at: pulled, stopped };
}

/** A box grown about its own centre to at least the frame's minimum size. */
function grown(box: Box): Box {
  const width = Math.max(box.width, FRAME_MIN_WIDTH);
  const height = Math.max(box.height, FRAME_MIN_HEIGHT);
  return {
    x: box.x - (width - box.width) / 2,
    y: box.y - (height - box.height) / 2,
    width,
    height,
  };
}

/** A Scene box, in the pixels the page draws in. */
function onScreen(box: Box, view: View): Box {
  return { ...toScreen(view, box), width: box.width * view.zoom, height: box.height * view.zoom };
}

/** What of a box the editor's own box leaves, or null when it leaves nothing. */
function cutTo(box: Box, editor: Box): Box | null {
  const left = Math.max(box.x, editor.x);
  const top = Math.max(box.y, editor.y);
  const right = Math.min(box.x + box.width, editor.x + editor.width);
  const bottom = Math.min(box.y + box.height, editor.y + editor.height);
  if (right <= left || bottom <= top) {
    return null;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The empty Scene's frame: the minimum size about the editor's middle, inside its box. */
function emptyFrame(editor: Box): Box {
  const width = Math.min(FRAME_MIN_WIDTH, editor.width);
  const height = Math.min(FRAME_MIN_HEIGHT, editor.height);
  return {
    x: editor.x + (editor.width - width) / 2,
    y: editor.y + (editor.height - height) / 2,
    width,
    height,
  };
}
