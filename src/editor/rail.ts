/**
 * The tool rail: the hand-drawn strip of tools floating over the paper.
 *
 * One static list, in rail order, from `actions.ts`, so a button, the key that
 * picks it and the palette's row for it can never disagree. Each button names
 * every key that picks it in its tooltip and wears its letter on the tile,
 * because the left hand is what picks a tool. The outline is drawn by Rough.js,
 * twice, so the strip reads as two pencil passes.
 */
import { RoughGenerator } from 'roughjs/bin/generator.js';
import { TOOLS } from './actions.js';
import type { ToolId } from './actions.js';
import { isClick } from './elements.js';
import { overlaps } from './geometry.js';
import type { Box, Point } from './geometry.js';
import { readRailPlace, writeRailPlace } from './rail-preference.js';
import type { RailPlace } from './rail-preference.js';

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

/** Stored centre fractions and orientation of a floating rail. */
interface StoredPlace {
  readonly x: number;
  readonly y: number;
  readonly orientation: RailOrientation;
}

/** A press on the rail that may still become a live drag of it. */
interface RailDrag {
  readonly pointer: number;
  readonly from: Point;
  at: Point;
  /** Whether the pointer has left the click's slop: past it, the press is a drag. */
  moved: boolean;
  /** Grab fraction along the strip's length (0..1), preserved when turning. */
  readonly along: number;
  /** Grab fraction across the strip's thickness (0..1). */
  readonly across: number;
  /** Current orientation during the drag, fed to `railOrientation` for the hold band. */
  orientation: RailOrientation;
  /** The resting place before the drag started, restored if the drag is called off. */
  readonly before: StoredPlace | null;
}

/** What the Rail needs from its host: supplied measurements and callbacks, with no DOM required. */
export interface RailHost {
  readonly size: () => { readonly width: number; readonly height: number };
  readonly statusChrome: () => Box[];
  readonly outlines: () => RailOutlines;
  readonly setTool: (tool: ToolId) => void;
  readonly refusePointer: (pointerId: number) => void;
  readonly readPlace?: () => RailPlace;
  readonly writePlace?: (place: StoredPlace) => void;
  readonly onOrientation?: (orientation: RailOrientation) => void;
  readonly onDrawArt?: () => boolean;
  readonly onPlace?: (placed: PlacedRail) => void;
  readonly onDragListeners?: (active: boolean) => void;
  readonly onCapture?: (pointerId: number | null) => void;
}

/**
 * The Rail's own state machine, screen placement, and pointer handling.
 * Measurements come in from `RailHost`, so both the browser editor and Node tests
 * drive the same state machine.
 */
export class Rail {
  readonly #host: RailHost;
  readonly #initial: RailPlace;
  #rest: StoredPlace | null = null;
  #placed: PlacedRail | null = null;
  #orientation: RailOrientation;
  #drag: RailDrag | null = null;
  #dragged = false;
  #clickOwed: number | null = null;
  #waiting = false;
  #drawn = false;

  constructor(host: RailHost) {
    this.#host = host;
    this.#initial = host.readPlace ? host.readPlace() : readRailPlace();
    this.#orientation =
      this.#initial.kind === 'at'
        ? this.#initial.orientation
        : this.#initial.side === 'top' || this.#initial.side === 'bottom'
          ? 'lying'
          : 'standing';
    this.#host.onOrientation?.(this.#orientation);
  }

  /** Drop any active drag; the rail's screen position stays put. */
  forget(): void {
    this.#endDrag();
  }

  /** Place the rail at its stored screen position (resolving an initial edge once). */
  place(): void {
    this.#place();
  }

  /** The editor window resized: keep fractions and orientation, then clamp again. */
  resize(): void {
    this.#drawArt();
    this.#reposition();
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
      return;
    }
    this.#reposition();
  }

  /** Draw the strip's pencil outline once the host has a box for it. */
  drawArt(): void {
    this.#drawArt();
  }

  /** Put the rail at the middle of one of the editor's four edges (from the command palette). */
  dock(side: RailSide): void {
    const editor = this.#host.size();
    const outlines = this.#host.outlines();
    const { centre, orientation } = railEdgeMiddle(side, outlines, editor);
    const placed = placeRail(centre, orientation, outlines, editor, this.#host.statusChrome());
    this.#apply(placed);
    this.#save(placed, editor);
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

  /** Kept until 1c removes the Style note's railEdge coupling. */
  edge(): number | null {
    return null;
  }

  /** The orientation the rail currently rests in. */
  orientation(): RailOrientation {
    return this.#orientation;
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
    if (this.#placed === null) {
      this.#place();
    }
    const placed = this.#placed!;
    const outline = this.#host.outlines()[placed.orientation];
    const sw = outline.width - outline.overhang * 2;
    const sh = outline.height - outline.overhang * 2;
    const lying = placed.orientation === 'lying';
    const along = lying
      ? sw > 0
        ? (at.x - placed.x) / sw
        : 0.5
      : sh > 0
        ? (at.y - placed.y) / sh
        : 0.5;
    const across = lying
      ? sh > 0
        ? (at.y - placed.y) / sh
        : 0.5
      : sw > 0
        ? (at.x - placed.x) / sw
        : 0.5;
    this.#drag = {
      pointer,
      from: at,
      at,
      moved: false,
      along,
      across,
      orientation: placed.orientation,
      before: this.#rest,
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
    this.#dragTo(drag, at);
  }

  /** A pointer release while a press on the rail is active. */
  release(pointer: number, at: Point): void {
    const drag = this.#drag;
    if (drag === null || pointer !== drag.pointer) {
      return;
    }
    drag.at = at;
    const moved = drag.moved || !isClick(drag.from, drag.at);
    this.#endDrag();
    if (!moved) {
      this.#settle();
      return;
    }
    this.#dragged = true;
    const placed = this.#dragTo(drag, at);
    this.#save(placed, this.#host.size());
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

  #place(): void {
    this.#waiting = false;
    if (this.#rest === null) {
      if (this.#initial.kind === 'at') {
        this.#rest = {
          x: this.#initial.x,
          y: this.#initial.y,
          orientation: this.#initial.orientation,
        };
      } else {
        const editor = this.#host.size();
        const outlines = this.#host.outlines();
        const { centre, orientation } = railEdgeMiddle(this.#initial.side, outlines, editor);
        const placed = placeRail(centre, orientation, outlines, editor, this.#host.statusChrome());
        this.#rest = this.#fractionsOf(placed, editor);
        this.#apply(placed);
        return;
      }
    }
    this.#reposition();
  }

  #reposition(): void {
    const rest = this.#rest;
    if (rest === null) {
      return;
    }
    const editor = this.#host.size();
    const placed = placeRail(
      { x: rest.x * editor.width, y: rest.y * editor.height },
      rest.orientation,
      this.#host.outlines(),
      editor,
      this.#host.statusChrome(),
    );
    this.#apply(placed);
  }

  #dragTo(drag: RailDrag, at: Point): PlacedRail {
    const editor = this.#host.size();
    const outlines = this.#host.outlines();
    const nextOrientation = railOrientation(at, editor, drag.orientation);
    const outline = outlines[nextOrientation];
    const sw = outline.width - outline.overhang * 2;
    const sh = outline.height - outline.overhang * 2;
    const requestedCentre: Point =
      nextOrientation === 'lying'
        ? { x: at.x + (0.5 - drag.along) * sw, y: at.y + (0.5 - drag.across) * sh }
        : { x: at.x + (0.5 - drag.across) * sw, y: at.y + (0.5 - drag.along) * sh };
    const placed = placeRail(requestedCentre, nextOrientation, outlines, editor, this.#host.statusChrome());
    drag.orientation = placed.orientation;
    this.#apply(placed);
    return placed;
  }

  #apply(placed: PlacedRail): void {
    const orientationChanged = placed.orientation !== this.#orientation;
    if (orientationChanged) {
      this.#orientation = placed.orientation;
      this.#host.onOrientation?.(placed.orientation);
      this.#drawArt();
    }
    const before = this.#placed;
    this.#placed = placed;
    if (
      before !== null &&
      before.x === placed.x &&
      before.y === placed.y &&
      before.orientation === placed.orientation
    ) {
      return;
    }
    this.#host.onPlace?.(placed);
  }

  #fractionsOf(placed: PlacedRail, editor: { readonly width: number; readonly height: number }): StoredPlace {
    const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
    return {
      x: editor.width > 0 ? clamp01(placed.centre.x / editor.width) : 0.5,
      y: editor.height > 0 ? clamp01(placed.centre.y / editor.height) : 0.5,
      orientation: placed.orientation,
    };
  }

  #save(placed: PlacedRail, editor: { readonly width: number; readonly height: number }): void {
    this.#rest = this.#fractionsOf(placed, editor);
    if (this.#host.writePlace) {
      this.#host.writePlace(this.#rest);
    } else {
      writeRailPlace(this.#rest);
    }
  }

  #callOffDrag(): void {
    const drag = this.#drag;
    if (drag === null) {
      return;
    }
    this.#rest = drag.before;
    this.#endDrag();
    this.#host.refusePointer(drag.pointer);
    this.#clickOwed = drag.pointer;
    this.#reposition();
  }

  #settle(): void {
    if (this.#waiting) {
      this.#waiting = false;
      this.#reposition();
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
  }
}

/** Browser DOM host for `mountRail`. */
export interface RailDomHost {
  readonly rail: HTMLElement;
  readonly railArt: SVGSVGElement;
  readonly statusCorners: () => HTMLElement[];
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
  let cachedOutlines: RailOutlines | null = null;

  const outline = (): RailOutline => ({
    width: dom.rail.offsetWidth + RAIL_OUTLINE * 2,
    height: dom.rail.offsetHeight + RAIL_OUTLINE * 2,
    overhang: RAIL_OUTLINE,
  });

  const outlines = (): RailOutlines => {
    if (cachedOutlines !== null) {
      return cachedOutlines;
    }
    const kept = dom.rail.dataset['orientation'] as RailOrientation | undefined;
    const lying = kept !== 'standing';
    const here = outline();
    dom.rail.dataset['orientation'] = lying ? 'standing' : 'lying';
    const there = outline();
    if (kept === undefined) {
      delete dom.rail.dataset['orientation'];
    } else {
      dom.rail.dataset['orientation'] = kept;
    }
    const result = lying ? { lying: here, standing: there } : { lying: there, standing: here };
    if (result.lying.width > 14 && result.standing.height > 14) {
      cachedOutlines = result;
    }
    return result;
  };

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
    size: dom.size,
    statusChrome: dom.statusChrome,
    outlines,
    setTool: dom.setTool,
    refusePointer: dom.refusePointer,
    onOrientation: (orientation) => {
      dom.rail.dataset['orientation'] = orientation;
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
    onPlace: (placed) => {
      dom.rail.style.setProperty('--rail-left', `${placed.x}px`);
      dom.rail.style.setProperty('--rail-top', `${placed.y}px`);
      dom.rail.inert = false;
      dom.rail.dataset['placed'] = '';
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

  const boxWatch = new ResizeObserver(() => {
    if (!rail.holding()) {
      cachedOutlines = null;
    }
    rail.boxResize();
  });

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

/** The four editor edges the palette can place the rail on (and legacy saved words). */
export type RailSide = 'top' | 'bottom' | 'left' | 'right';

/** The orientation the floating rail rests in: horizontal or vertical. */
export type RailOrientation = 'lying' | 'standing';

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

/** The lying and standing pencil outlines of the rail. */
export interface RailOutlines {
  readonly lying: RailOutline;
  readonly standing: RailOutline;
}

/** Where a floating rail rests in the editor's box. */
export interface PlacedRail {
  /** The strip's own box left edge (excluding overhang), in screen pixels. */
  readonly x: number;
  /** The strip's own box top edge (excluding overhang), in screen pixels. */
  readonly y: number;
  /** The strip's centre, in screen pixels. */
  readonly centre: Point;
  /** The orientation the strip rests in after fit fallback. */
  readonly orientation: RailOrientation;
}

/** How far inside the editor's edges the rail stops. */
const RAIL_INSET = 16;

/** Perpendicular distance from a diagonal within which the current orientation holds. */
const RAIL_HOLD_BAND = 16;

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
 * Orientation of a point in the editor's box: the two corner-to-corner diagonals
 * split the box into four spaces; top and bottom lie, left and right stand.
 * When a current orientation is given, it holds while the point is within 16px
 * (perpendicular distance) of either diagonal.
 */
export function railOrientation(
  at: Point,
  editor: { width: number; height: number },
  current?: RailOrientation,
): RailOrientation {
  const diagonal = Math.hypot(editor.width, editor.height);
  if (diagonal === 0) {
    return current ?? 'lying';
  }
  const dx = at.x - editor.width / 2;
  const dy = at.y - editor.height / 2;
  if (current !== undefined) {
    const d1 = Math.abs(editor.height * dx - editor.width * dy) / diagonal;
    const d2 = Math.abs(editor.height * dx + editor.width * dy) / diagonal;
    if (Math.min(d1, d2) <= RAIL_HOLD_BAND) {
      return current;
    }
  }
  return editor.width * Math.abs(dy) >= editor.height * Math.abs(dx) ? 'lying' : 'standing';
}

/** Whether an outline fits inside the editor with `RAIL_INSET` on every side. */
function outlineFits(outline: RailOutline, editor: { width: number; height: number }): boolean {
  return (
    outline.width + RAIL_INSET * 2 <= editor.width &&
    outline.height + RAIL_INSET * 2 <= editor.height
  );
}

/** Clamp a coordinate to `[min, max]`, or centre it when `max < min`. */
function clampCoord(value: number, min: number, max: number, centred: number): number {
  if (max < min) {
    return centred;
  }
  return Math.max(min, Math.min(value, max));
}

/**
 * Where a floating rail rests: fits the orientation (falling back to the other,
 * or lying if neither fits), keeps the pencil outline inside the editor with
 * `RAIL_INSET` from each edge, and moves it off every status chrome box.
 */
export function placeRail(
  requestedCentre: Point,
  requestedOrientation: RailOrientation,
  outlines: RailOutlines,
  editor: { width: number; height: number },
  chrome: readonly Box[],
): PlacedRail {
  const other: RailOrientation = requestedOrientation === 'lying' ? 'standing' : 'lying';
  const orientation: RailOrientation = outlineFits(outlines[requestedOrientation], editor)
    ? requestedOrientation
    : outlineFits(outlines[other], editor)
      ? other
      : 'lying';
  const outline = outlines[orientation];
  const minX = RAIL_INSET;
  const maxX = editor.width - RAIL_INSET - outline.width;
  const minY = RAIL_INSET;
  const maxY = editor.height - RAIL_INSET - outline.height;
  const centreX = (editor.width - outline.width) / 2;
  const centreY = (editor.height - outline.height) / 2;

  const baseX = clampCoord(requestedCentre.x - outline.width / 2, minX, maxX, centreX);
  const baseY = clampCoord(requestedCentre.y - outline.height / 2, minY, maxY, centreY);
  const baseBox: Box = { x: baseX, y: baseY, width: outline.width, height: outline.height };

  let bestX = baseX;
  let bestY = baseY;

  if (chrome.some((box) => overlaps(baseBox, box))) {
    const xs = new Set<number>([baseX]);
    const ys = new Set<number>([baseY]);
    for (const box of chrome) {
      xs.add(clampCoord(box.x - outline.width, minX, maxX, centreX));
      xs.add(clampCoord(box.x + box.width, minX, maxX, centreX));
      ys.add(clampCoord(box.y - outline.height, minY, maxY, centreY));
      ys.add(clampCoord(box.y + box.height, minY, maxY, centreY));
    }

    let bestClearDist = Infinity;
    let bestOverlapArea = Infinity;
    let bestOverlapDist = Infinity;

    for (const x of xs) {
      for (const y of ys) {
        const candidate: Box = { x, y, width: outline.width, height: outline.height };
        const dist = (x - baseX) * (x - baseX) + (y - baseY) * (y - baseY);
        if (chrome.every((box) => !overlaps(candidate, box))) {
          if (dist < bestClearDist) {
            bestClearDist = dist;
            bestX = x;
            bestY = y;
          }
        } else if (bestClearDist === Infinity) {
          const area = covered(candidate, chrome);
          if (area < bestOverlapArea || (area === bestOverlapArea && dist < bestOverlapDist)) {
            bestOverlapArea = area;
            bestOverlapDist = dist;
            bestX = x;
            bestY = y;
          }
        }
      }
    }
  }

  return {
    x: bestX + outline.overhang,
    y: bestY + outline.overhang,
    centre: { x: bestX + outline.width / 2, y: bestY + outline.height / 2 },
    orientation,
  };
}

/**
 * The centre and orientation that put the rail at the middle of an editor edge,
 * `RAIL_INSET` in (top and bottom lie, left and right stand).
 */
export function railEdgeMiddle(
  side: RailSide,
  outlines: RailOutlines,
  editor: { width: number; height: number },
): { centre: Point; orientation: RailOrientation } {
  const orientation: RailOrientation = side === 'top' || side === 'bottom' ? 'lying' : 'standing';
  const outline = outlines[orientation];
  switch (side) {
    case 'top':
      return { centre: { x: editor.width / 2, y: RAIL_INSET + outline.height / 2 }, orientation };
    case 'bottom':
      return {
        centre: { x: editor.width / 2, y: editor.height - RAIL_INSET - outline.height / 2 },
        orientation,
      };
    case 'left':
      return { centre: { x: RAIL_INSET + outline.width / 2, y: editor.height / 2 }, orientation };
    case 'right':
      return {
        centre: { x: editor.width - RAIL_INSET - outline.width / 2, y: editor.height / 2 },
        orientation,
      };
  }
}

export { readRailPlace, writeRailPlace } from './rail-preference.js';
export type { RailPlace } from './rail-preference.js';
