/**
 * The page's frame: the view of the Scene, the drawings it shows, and the
 * overlay it marks them with.
 *
 * One frame costs what a gesture changes, not what the Scene holds. An Element
 * whose canonical JSON — and the outlines a Snapped end resolves against — is
 * the same as the one painted keeps the SVG it already has, so dragging one
 * Element in a Scene of three hundred draws one Element, a move carries the
 * groups it holds with one transform each, and a pan or a zoom draws nothing at
 * all. A frame is asked for once and runs on the next animation frame: a whole
 * page makes a queued words frame redundant, and nothing downgrades one.
 *
 * Everything the page draws is measured, never guessed: the overflow outline is
 * the Layout's own verdict, the handles sit where the Renderer drew the ends,
 * and a Label's cue is the box its ink paints. The overlay draws in screen
 * pixels on a group counter-moved against the view, so a handle stays eight
 * pixels at every zoom.
 *
 * Where the words being typed go is the one thing a frame of its own redraws
 * (`words-layer.ts`): a caret that walks one boundary per key repeat must not
 * cost what a Scene of three hundred Elements costs, nor scan every Label's
 * overflow.
 *
 * What the page may show — which Elements, which selection, which gesture — is
 * the editor's to say, through `PageHost`. Nothing here reads the Scene's own
 * state or decides what an edit is.
 */
import { elementsById, outlineBox, shaftInk, shaftLabel, wordsInkBounds } from '../renderer.js';
import { isOutlined } from '../scene.js';
import type { Corner, Element as SceneElement, Scene } from '../scene.js';
import type { Block, Layout, LineGlyphs } from '../layout.js';
import { cornerOf, shaftDots } from '../geometry.js';
import { HANDLES, boxBetween, boxOf, clearedView, handlePoint, unionOf } from './geometry.js';
import type { Box, Point } from './geometry.js';
import type { Bend, Drag } from './gestures.js';
import { PaintCache, paintedInk } from './paint.js';
import type { Paint, SceneFiles } from './paint.js';
import { isShaft } from './snap.js';
import { drawnBox, drawnGlyphs } from './drawn-glyphs.js';
import type { LineKey, TextSessionState } from './text-session.js';
import type { Typing } from './typing.js';
import { clearWashes, drawWords, rect } from './words-layer.js';
import { shownWords } from './words.js';
import { Viewport } from './viewport.js';
import type { ViewportParts } from './viewport.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SELECTION_PADDING = 5;
const HANDLE_SIZE = 8;
/**
 * The diameter of a segment's halfway dot, in screen pixels: smaller than a
 * handle, so a dot reads as somewhere to pull a bend out of rather than as a
 * point the shaft already has.
 */
const DOT_SIZE = 6;
/** How close a dot's middle may come to a handle's before the dot is left off, in screen pixels. */
const DOT_CLEARANCE = (HANDLE_SIZE + DOT_SIZE) / 2;
/** How far a Snap target's highlight stands off the target's outline, in screen pixels. */
const SNAP_GROW = 4;
/** How far the mark on a selected Label's words stands off the box they paint, in screen pixels. */
const LABEL_CUE_GAP = 2;
/** How far off the drawn words a press is still a press in them, in screen pixels. */
const WORDS_TOLERANCE = 8;
/** Breathing room between the Style menu and the selection it must not cover. */
const MENU_GAP = 16;

/**
 * One drag target of a lone selection: a named handle on an outline or a shaft's
 * end, or a bend standing on a point between the ends.
 */
type HandleMark =
  | { readonly at: Point; readonly kind: 'handle'; readonly name: string }
  | { readonly at: Point; readonly kind: 'bend'; readonly index: number; readonly corner: Corner };

/**
 * The Elements the page draws, and whether they are still a preview: a settled
 * page draws the Scene it holds, so the drawings kept between frames stand.
 */
export interface Shown {
  /** True when these are the Scene's own Elements: no gesture and no words change them. */
  readonly settled: boolean;
  readonly elements: readonly SceneElement[];
}

/** What the page may show, and the measurement it lays everything out with. */
interface PageHost {
  layout(): Layout;
  /** The Scene's own Elements, in the Scene's order. */
  scene(): Scene;
  /** The Scene as the page shows it: committed Elements, the gesture and the words. */
  shown(): Shown;
  /** The selection the overlay marks. */
  selected(): readonly string[];
  /** The one bend point that selection holds, and no other. */
  bend(): Bend | null;
  /** The gesture in flight, as the drawing and the overlay read it. */
  drag(): Drag | null;
  /** True when this page may change the Scene at all: a page that may only read marks no ink a press could pull out. */
  writable(): boolean;
  /** The preview Element and the field whose caret the page draws. */
  readonly typing: Pick<Typing, 'editingId' | 'words'>;
}

/** The nodes a frame draws into. */
interface PageParts extends ViewportParts {
  /** The group every Element's drawing goes into. */
  readonly painted: SVGGElement;
  /** The docked Style note, which must never sit on what it edits. */
  readonly note: HTMLElement;
}

export class Page {
  readonly viewport: Viewport;
  readonly #host: PageHost;
  readonly #overlay: SVGGElement;
  readonly #paintedLayer: SVGGElement;
  /** The Style note, which `clearOfNote` keeps the view clear of. */
  readonly #note: HTMLElement;
  /** What the next frame owes the page: nothing yet, the words' own layer, or the whole page. */
  #queued: 'none' | 'words' | 'page' = 'none';
  /** The settled Scene last drawn, or null when a preview or new measurement invalidates it. */
  #paintedScene: Scene | null = null;
  /**
   * The words being typed that the last frame of the page drew. A caret that
   * moves asks for the words' layer alone, so the Scene is drawn again only when
   * the words it would draw are not the ones already on it.
   */
  #drawnWords: SceneElement | null = null;
  /** What the page shows now: the drawings, and the boxes the pointer reads. */
  #painted: Paint | null = null;
  /** The Element groups on the page, by id, with the key each was drawn from. */
  #groups = new Map<string, { key: string; node: SVGGElement }>();
  /** The id order the Element groups are in, so a reorder is one write. */
  #order: readonly string[] = [];
  /** The Elements a move has moved with a transform, so they can be put back. */
  #moved = new Set<string>();
  /** The Scene's own `svg`, inside `.painted`; every Element is one group under it. */
  #layer: SVGSVGElement | null = null;
  /** The drawings and the drawing of one Element at a time, kept between frames. */
  #paintables: PaintCache | null = null;
  /**
   * The measurement the Element groups on the page were drawn with. A font the
   * page names late moves the PaintCache's generation, and everything drawn
   * before it stops being the drawing this page makes.
   */
  #drawnMeasurement = -1;
  /**
   * The washes behind the words being typed, in the group that drew them: over
   * the Element's fill and under its glyphs, so a filled Element cannot cover
   * them and they cannot lift the ink of what was written.
   */
  #washes: SVGRectElement[] = [];
  /**
   * The caret and the preedit's rule, in a layer of their own inside the overlay:
   * a caret that moves redraws these and leaves the boxes, the handles and the
   * overflow outline where the last frame put them.
   */
  #wordsLayer: SVGGElement | null = null;

  constructor(parts: PageParts, host: PageHost) {
    this.#host = host;
    this.#overlay = parts.overlay;
    this.#paintedLayer = parts.painted;
    this.#note = parts.note;
    this.viewport = new Viewport(parts);
  }

  /**
   * Pan, zoom and the Grid follow the pointer at once, because they are only
   * numbers the view layer already carries. Repainting the Scene is what costs,
   * so that waits for the next frame.
   */
  paint(): void {
    this.viewport.apply();
    this.#frame('page');
  }

  /**
   * The ink the page painted for an Element: the box a press answers to, read
   * from the drawing already made instead of made again, so a pick measures
   * nothing. Only the frame drawn for this very Scene answers, and only for the
   * very Element it drew: a Scene edited since — a nudge, a move, an undo,
   * another Scene under the same ids — holds Elements the page has not drawn
   * yet, and a press on those measures.
   */
  ink(element: SceneElement): Box | null {
    return paintedInk(this.#painted, this.#paintedScene, this.#host.scene(), element);
  }

  /**
   * The caret, the selection or an input method's preedit moved, and nothing
   * else did: the words' own layer is drawn again, and the Scene is not asked
   * anything.
   */
  paintWords(): void {
    this.#frame('words');
  }

  /** Opening a Scene starts a new drawing cache, even when its Element ids match. */
  resetDrawings(): void {
    this.#paintables?.clear();
    this.#paintedScene = null;
  }

  /** A new measurement: every drawing keyed on the last one has to be made again. */
  measure(): void {
    this.#paintables?.measure(this.#host.layout());
    this.#paintedScene = null;
  }

  /**
   * A Scene's file and its SVG, out of the JSON and the drawings in hand. The
   * paint in flight is settled first — the frame that was about to run is this
   * one — so an edit draws each Element once and writes the same bytes
   * `ez render` writes.
   */
  files(scene: Scene): Promise<SceneFiles> {
    this.#drawScene();
    return (this.#paintables ??= new PaintCache(this.#host.layout())).files(scene);
  }

  /**
   * The note is docked to the right edge and must never sit on what it edits.
   * One rectangle policy does it: the view pans left just far enough, and zooms
   * out just far enough when a pan cannot clear a wide selection. Panning waits
   * for the end of a drag, because moving the view out from under the pointer
   * mid-drag would make the Element chase it. The rectangle is measured from
   * what the page shows, so a box grown by the words being typed is cleared too.
   */
  clearOfNote(): void {
    if (this.#host.drag() !== null) {
      return;
    }
    const box = this.#noteBox();
    if (box === null) {
      return;
    }
    const { elements: shown } = this.#host.shown();
    const selected = new Set(this.#host.selected());
    this.viewport.view = clearedView(this.viewport.view, {
      selection: boxOf(
        shown.filter((element) => selected.has(element.id)),
        elementsById(shown),
        this.#host.layout(),
      ),
      note: box,
      // The rail is not a limit: it lies along the top edge, out of the way of a
      // selection the note would cover, so the editor's own left edge is.
      left: MENU_GAP,
      gap: MENU_GAP,
    });
  }

  /**
   * The Block the page is drawing for the words being typed: the Renderer's own
   * placement of the Element the ink came from, canonical geometry included, so
   * the caret sits on the glyphs and nowhere else. An emptied Label keeps its
   * empty line here, the slot the words would start on, or they would have no
   * place for a caret at all.
   */
  #block(): Block | null {
    const element = this.#host.typing.words()?.element ?? null;
    if (element === null) {
      return null;
    }
    // The frame the words belong to is drawn before they are asked about: the
    // block is the drawn one, and the drawn Element is the canonical one. A
    // frame that already drew these very words is that frame, and a caret that
    // moved asks for no Scene at all.
    if (this.#drawnWords !== element) {
      this.#drawScene();
    }
    // The Block is the one the drawing placed: a caret that moved is drawn on
    // the words without measuring them again.
    return this.#painted?.elements.get(element.id)?.words ?? null;
  }

  /**
   * Where the drawn glyphs of the words being typed are, as the SVG that draws
   * them laid them out. The call to `block` has drawn the frame they belong to,
   * so the group asked here is the one holding their ink.
   */
  #glyphs(words: Block): LineGlyphs {
    return drawnGlyphs(this.#wordsGroup(), words);
  }

  /**
   * Where Up, Down, Home and End put the caret in the words being typed: the
   * drawn line above or below at the same column, or the start or end of the
   * line the caret is on — which is the line's first or last boundary, at
   * whichever end the words begin and stop.
   */
  wordsLine(key: LineKey, state: TextSessionState): number | null {
    const shift = this.#host.typing.words()?.shift;
    const block = this.#block();
    if (shift === undefined || block === null) {
      return null;
    }
    const glyphs = this.#glyphs(block);
    const layout = this.#host.layout();
    const caret = layout.caret(block, shift.drawn(state.caret), glyphs);
    const middle = caret.y + caret.height / 2;
    const { boundaries: xs } = glyphs(block.lines[caret.line]!);
    // The lines are the Layout's own boxes, one line height each: half a line
    // above or below the caret's middle is the middle of its neighbour. Home
    // and End ask from the line's own first and last glyph boundary, so which
    // end of the line each is cannot depend on the direction the words run in.
    const point =
      key === 'up'
        ? { x: caret.x, y: caret.y - caret.height / 2 }
        : key === 'down'
          ? { x: caret.x, y: caret.y + caret.height * 1.5 }
          : key === 'home'
            ? { x: xs[0]!, y: middle }
            : { x: xs[xs.length - 1]!, y: middle };
    return shift.typed(layout.offsetAt(block, point, glyphs));
  }

  /**
   * Where a press lands in the words being typed: the drawn offset of the glyph
   * boundary nearest the pointer, or null when the press is off the words.
   */
  wordsOffset(point: Point): number | null {
    const block = this.#block();
    if (block === null) {
      return null;
    }
    const glyphs = this.#glyphs(block);
    // The words reach as far as their glyphs: a fallback font draws them in a
    // width of its own, and a press on the paper beyond them is no press on them.
    const words = drawnBox(block, glyphs);
    const reach = WORDS_TOLERANCE / this.viewport.view.zoom;
    const inside =
      point.x >= words.x - reach &&
      point.x <= words.x + words.width + reach &&
      point.y >= words.y - reach &&
      point.y <= words.y + words.height + reach;
    return inside ? this.#host.layout().offsetAt(block, point, glyphs) : null;
  }

  /** The nearest glyph boundary of the words, wherever the pointer went: a drag carries the caret. */
  wordsNearest(point: Point): number | null {
    const block = this.#block();
    if (block === null) {
      return null;
    }
    return this.#host.layout().offsetAt(block, point, this.#glyphs(block));
  }

  /**
   * One frame, asking for what the page owes it. A whole page makes an already
   * queued words frame redundant, so it takes its place; nothing downgrades one.
   */
  #frame(what: 'words' | 'page'): void {
    const queued = this.#queued;
    if (queued === 'page' || queued === what) {
      return;
    }
    this.#queued = what;
    if (queued !== 'none') {
      return;
    }
    requestAnimationFrame(() => {
      const owed = this.#queued;
      this.#queued = 'none';
      if (owed === 'page') {
        this.#drawScene();
        this.#drawOverlay();
      } else {
        this.#drawWords();
      }
    });
  }

  /** The Style note's own page box, while it is on the page. */
  #noteBox(): Box | null {
    const note = this.#note;
    if (note.hidden) {
      return null;
    }
    const canvas = this.viewport.box();
    const box = note.getBoundingClientRect();
    return {
      x: box.left - canvas.left,
      y: box.top - canvas.top,
      width: box.width,
      height: box.height,
    };
  }

  /**
   * Paint what the Scene shows now.
   *
   * Each Element keeps the drawing it already had while the canonical JSON it
   * was drawn from is unchanged, so a frame costs what the gesture changes: a
   * resize or a dragged end draws one Element, a move moves the groups it
   * carries, and a pan or a zoom draws nothing at all.
   */
  #drawScene(): void {
    const drag = this.#host.drag();
    if (drag !== null && drag.kind === 'move') {
      if (this.#paintables !== null && this.#paintables.generation !== this.#drawnMeasurement) {
        // A font landed while the pointer was down: every Label may break
        // differently, so the drawings this gesture carries are made again —
        // once, here, before the transforms go back on. A move frame that
        // changed no measurement draws nothing.
        this.#drawElements(this.#host.scene().elements);
      }
      this.#moveGroups(drag);
      this.#followSnaps(drag);
      if (drag.shown.size > 0) {
        // A preview is not the Scene: the frame after the gesture has to draw
        // what the Scene holds, however the gesture ended — a release that
        // changed nothing, a cancelled pointer or a lost focus included.
        this.#paintedScene = null;
      }
      return;
    }
    const { settled, elements: shown } = this.#host.shown();
    const scene = this.#host.scene();
    if (settled && this.#paintedScene === scene) {
      return;
    }
    this.#drawElements(shown);
    this.#paintedScene = settled ? scene : null;
  }

  /** One frame of the page: a group redrawn for each Element whose drawing changed. */
  #drawElements(shown: readonly SceneElement[]): void {
    const paintables = (this.#paintables ??= new PaintCache(this.#host.layout()));
    // The words drawn for an emptied Label are its empty line, the slot the
    // next letter would go in: only the Element being typed in is drawn with
    // them. An Element nobody is editing keeps the words the Scene holds, so an
    // unlabeled arrow draws no words — and no paper for them either.
    const typing = this.#host.typing;
    const editingId = typing.editingId();
    const paint = paintables.paint(
      editingId === null
        ? shown
        : shown.map((element) => (element.id === editingId ? shownWords(element) : element)),
    );
    this.#painted = paint;
    this.#drawnWords = typing.words()?.element ?? null;
    this.#drawnMeasurement = paintables.generation;
    // A group moved by a drag carries a transform the Scene never holds: every
    // group starts a frame where its Element is.
    for (const id of this.#moved) {
      this.#groups.get(id)?.node.removeAttribute('transform');
    }
    this.#moved.clear();

    const layer = this.#layerOf();
    const groups = new Map<string, { key: string; node: SVGGElement }>();
    for (const id of paint.order) {
      const painted = paint.elements.get(id)!;
      const held = this.#groups.get(id);
      if (held !== undefined && held.key === painted.key) {
        groups.set(id, held);
        continue;
      }
      // New or changed: one Element's SVG, parsed on its own, in the group the
      // pointer moves and the overlay measures.
      const node = groupOf(id, painted.svg);
      if (held === undefined) {
        layer.append(node);
      } else {
        held.node.replaceWith(node);
      }
      groups.set(id, { key: painted.key, node });
    }
    this.#groups = groups;
    // Stacking is the Scene's order and nothing else: what a frame reused, and
    // which of the reused groups were replaced in place, says nothing about
    // which Element is drawn on top. One comparison, one write when it changed.
    const order = paint.order;
    if (order.length !== this.#order.length || order.some((id, index) => this.#order[index] !== id)) {
      layer.replaceChildren(...order.map((id) => groups.get(id)!.node));
    }
    this.#order = order;
  }

  /** The Scene's own `svg` inside `.painted`, made once, so each Element is one group under it. */
  #layerOf(): SVGSVGElement {
    if (this.#layer === null) {
      const layer = document.createElementNS(SVG_NS, 'svg');
      layer.setAttribute('overflow', 'visible');
      // The drawing's colours and face are CSS variables, as in the saved SVG:
      // a theme change is a repaint the page already knows how to do.
      layer.setAttribute('font-family', 'var(--font-hand)');
      this.#paintedLayer.append(layer);
      this.#layer = layer;
    }
    return this.#layer;
  }

  /**
   * A move in flight: the groups the pointer carries are moved by a transform,
   * so the gesture draws nothing at all. The release settles the Scene, and the
   * painting that follows draws the moved Elements where they landed.
   */
  #moveGroups(drag: Extract<Drag, { kind: 'move' }>): void {
    const moved = new Set<string>();
    for (const id of drag.shown.keys()) {
      const group = this.#groups.get(id);
      if (group === undefined) {
        continue;
      }
      group.node.setAttribute('transform', `translate(${drag.by.x} ${drag.by.y})`);
      moved.add(id);
    }
    for (const id of this.#moved) {
      if (!moved.has(id)) {
        this.#groups.get(id)?.node.removeAttribute('transform');
      }
    }
    this.#moved = moved;
  }

  /**
   * The ends that ride what a move carries: an arrow or line the drag does not
   * hold, but whose end is Snapped to an Element it does, is drawn again against
   * the Scene as the drag shows it. So a shaft follows its target under the
   * pointer instead of waiting for the release, and only those shafts are drawn:
   * everything else keeps the drawing it already had.
   *
   * The drawing it makes is keyed on the preview geometry, so the frame the
   * gesture ends on draws it again — or keeps it, when the release left the
   * Scene exactly as it was.
   */
  #followSnaps(drag: Extract<Drag, { kind: 'move' }>): void {
    if (drag.shown.size === 0) {
      return;
    }
    const scene = this.#host.scene();
    const byId = new Map<string, SceneElement>();
    for (const element of scene.elements) {
      byId.set(element.id, drag.shown.get(element.id) ?? element);
    }
    const paintables = (this.#paintables ??= new PaintCache(this.#host.layout()));
    for (const element of scene.elements) {
      if (drag.shown.has(element.id) || !isShaft(element)) {
        continue;
      }
      if (!element.points.some((point) => point.snap !== undefined && drag.shown.has(point.snap))) {
        continue;
      }
      const held = this.#groups.get(element.id);
      if (held === undefined) {
        continue;
      }
      const painted = paintables.element(element, byId);
      if (painted.key === held.key) {
        continue;
      }
      const node = groupOf(element.id, painted.svg);
      held.node.replaceWith(node);
      this.#groups.set(element.id, { key: painted.key, node });
    }
  }

  /**
   * The overlay draws in screen pixels, on a group counter-moved against the
   * view: a handle stays eight pixels at every zoom, and the boxes it marks are
   * read from what the page painted rather than measured again.
   */
  #drawOverlay(): void {
    const overlay = this.#overlay;
    // The words' own layer is the one thing a frame of its own may keep: it is
    // put back by `#drawWords`, and it is nobody else's.
    overlay.replaceChildren();
    this.#wordsLayer = null;
    const layout = this.#host.layout();
    // A Label that does not fit its Element is outlined in red, on the rule
    // `ez check` reports: one function, so the page and the CLI cannot disagree.
    for (const element of this.#host.shown().elements) {
      if (layout.overflow(element) === null) {
        continue;
      }
      const words = layout.label(element);
      if (words !== null) {
        this.#appendRect(overlay, { ...this.viewport.pageBox(words), class: 'overflow' });
      }
    }
    const drag = this.#host.drag();
    const selected = this.#host.selected();
    const boxes: Box[] = [];
    for (const id of selected) {
      const box = this.#shownBounds(id);
      if (box !== null) {
        boxes.push(this.viewport.pageBox(box));
      }
    }
    const box = unionOf(boxes);
    const first = selected[0];
    if (box !== null) {
      this.#appendRect(overlay, {
        x: box.x - SELECTION_PADDING,
        y: box.y - SELECTION_PADDING,
        width: box.width + SELECTION_PADDING * 2,
        height: box.height + SELECTION_PADDING * 2,
        class: 'selection',
      });
      if (selected.length === 1 && first !== undefined) {
        this.#drawHandles(overlay, first);
        this.#drawLabelCue(overlay, first);
      }
    }
    if (drag !== null && drag.kind === 'box') {
      this.#appendRect(overlay, {
        ...this.viewport.pageBox(boxBetween(drag.from, drag.to)),
        class: 'sweep',
      });
    }
    if (drag !== null && (drag.kind === 'draw' || drag.kind === 'end') && drag.target !== null) {
      const target = this.#host.scene().elements.find((element) => element.id === drag.target);
      if (target !== undefined && isOutlined(target)) {
        // The Element the dragged end would attach to, so a drop is no surprise.
        const outline = this.viewport.pageBox(outlineBox(target));
        this.#appendRect(overlay, {
          x: outline.x - SNAP_GROW,
          y: outline.y - SNAP_GROW,
          width: outline.width + SNAP_GROW * 2,
          height: outline.height + SNAP_GROW * 2,
          class: 'snap',
        });
      }
    }
    this.#drawWords();
  }

  /**
   * The caret, the selection and an input method's preedit, drawn where the
   * Renderer put the glyphs. Nothing of the frame before is left behind: the
   * washes go with the caret that replaced them.
   */
  #drawWords(): void {
    this.#wordsLayer?.remove();
    this.#wordsLayer = null;
    clearWashes(this.#washes);
    this.#washes = [];
    const typing = this.#host.typing.words();
    const block = this.#block();
    if (typing === null || block === null) {
      return;
    }
    const group = this.#wordsGroup();
    const drawn = drawWords(this.#overlay, {
      layout: this.#host.layout(),
      block,
      glyphs: drawnGlyphs(group, block),
      shift: typing.shift,
      state: typing.text.state(),
      group,
      pageBox: (box) => this.viewport.pageBox(box),
      spot: (slot) => typing.text.spot(slot),
    });
    this.#wordsLayer = drawn.layer;
    this.#washes = [...drawn.washes];
  }

  /** The group the page drew the words being typed in: where their wash goes. */
  #wordsGroup(): SVGGElement | null {
    const id = this.#host.typing.words()?.element.id;
    return id === undefined ? null : (this.#groups.get(id)?.node ?? null);
  }

  /** Where an Element draws on the page now: what was painted for it, moved by a drag in flight. */
  #shownBounds(id: string): Box | null {
    const painted = this.#painted?.elements.get(id);
    if (painted === undefined) {
      return null;
    }
    const drag = this.#host.drag();
    if (drag !== null && drag.kind === 'move' && drag.shown.has(id)) {
      return {
        ...painted.bounds,
        x: painted.bounds.x + drag.by.x,
        y: painted.bounds.y + drag.by.y,
      };
    }
    return painted.bounds;
  }

  /** The Element as the page shows it: the gesture's own version while one is in flight. */
  #shownElement(id: string): SceneElement | undefined {
    const drag = this.#host.drag();
    if (drag !== null && drag.kind === 'move') {
      return drag.shown.get(id) ?? this.#painted?.byId.get(id);
    }
    return this.#painted?.byId.get(id);
  }

  /**
   * The drag targets of a lone selection: eight around a box's outline, the two
   * ends of an arrow or line where they draw — a Snapped end rides its target's
   * outline, so its handle is there too — one on every bend between them, and a
   * smaller dot halfway along every segment of the ink.
   */
  #drawHandles(overlay: SVGGElement, id: string): void {
    const element = this.#shownElement(id);
    if (element === undefined) {
      return;
    }
    const handles: HandleMark[] = [];
    if (isOutlined(element)) {
      const outline = this.viewport.pageBox(outlineBox(element));
      for (const handle of HANDLES) {
        handles.push({ at: handlePoint(outline, handle), kind: 'handle', name: handle });
      }
    } else if (isShaft(element)) {
      const byId = this.#painted?.byId ?? elementsById(this.#host.scene().elements);
      const path = shaftInk(element, byId).path;
      handles.push(
        { at: this.viewport.pagePoint(path.start), kind: 'handle', name: 'start' },
        { at: this.viewport.pagePoint(path.end), kind: 'handle', name: 'end' },
      );
      for (let index = 1; index < element.points.length - 1; index += 1) {
        const point = element.points[index]!;
        handles.push({
          at: this.viewport.pagePoint(point),
          kind: 'bend',
          index,
          corner: cornerOf(point, element.corners),
        });
      }
      // A dot stands on the ink between the handles, and a press on a handle is
      // a press on the point it holds: a dot that would land on one is left off
      // rather than drawn where a press could never take it.
      // A page that may only read draws none at all: a mark that promises a
      // bend out of the ink is a promise only a page that can change the Scene
      // keeps.
      if (this.#host.writable()) {
        for (const dot of shaftDots(path)) {
          const at = this.viewport.pagePoint(dot.at);
          if (handles.every((handle) => distance(handle.at, at) >= DOT_CLEARANCE)) {
            this.#appendDot(overlay, at, dot.index, id);
          }
        }
      }
    }
    for (const handle of handles) {
      const node =
        handle.kind === 'bend'
          ? this.#appendBend(
              overlay,
              handle.at,
              handle.corner,
              this.#isBend(id, handle.index),
            )
          : this.#appendRect(overlay, {
              x: handle.at.x - HANDLE_SIZE / 2,
              y: handle.at.y - HANDLE_SIZE / 2,
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              class: `handle handle-${handle.name}`,
            });
      node.setAttribute('data-handle', handle.kind === 'bend' ? 'bend' : handle.name);
      if (handle.kind === 'bend') {
        node.setAttribute('data-point', String(handle.index));
      }
      node.setAttribute('data-element', id);
    }
  }

  /**
   * Whether this is the one bend point the selection holds: the mark a person
   * picked, filled with the selection's colour and nothing else about it changed.
   */
  #isBend(id: string, index: number): boolean {
    const bend = this.#host.bend();
    return bend !== null && bend.id === id && bend.index === index;
  }

  /**
   * One bend point's handle: a square where the point turns `sharp`, a circle
   * where it turns `round`, at the size and in the pixels every other handle
   * is, so a zoom changes neither its size nor its colours.
   */
  #appendBend(
    parent: SVGGElement,
    at: Point,
    corner: Corner,
    picked: boolean,
  ): SVGCircleElement | SVGRectElement {
    const radius = HANDLE_SIZE / 2;
    const className = picked ? 'handle handle-bend selected' : 'handle handle-bend';
    if (corner === 'round') {
      const node = document.createElementNS(SVG_NS, 'circle');
      node.setAttribute('cx', String(at.x));
      node.setAttribute('cy', String(at.y));
      node.setAttribute('r', String(radius));
      node.setAttribute('class', className);
      parent.append(node);
      return node;
    }
    return this.#appendRect(parent, {
      x: at.x - radius,
      y: at.y - radius,
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
      class: className,
    });
  }

  /**
   * One segment's dot: a small translucent disc, at the size and in the pixels
   * every other handle is, so a zoom changes neither its size nor its colours.
   * A press on it pulls a new bend point out of the shaft at the index it keeps.
   */
  #appendDot(parent: SVGGElement, at: Point, index: number, id: string): void {
    const node = document.createElementNS(SVG_NS, 'circle');
    node.setAttribute('cx', String(at.x));
    node.setAttribute('cy', String(at.y));
    node.setAttribute('r', String(DOT_SIZE / 2));
    node.setAttribute('class', 'handle-dot');
    node.setAttribute('data-dot', 'bend');
    node.setAttribute('data-point', String(index));
    node.setAttribute('data-element', id);
    parent.append(node);
  }

  /**
   * A lone shaft's Label, marked as something a press can carry. The selection's
   * own outline is the Element's, and its hands resize it; the words are taken
   * on their own, by a press on them, so the selection says which box that is.
   */
  #drawLabelCue(overlay: SVGGElement, id: string): void {
    const element = this.#shownElement(id);
    if (element === undefined || !isShaft(element)) {
      return;
    }
    const byId = this.#painted?.byId ?? elementsById(this.#host.scene().elements);
    const words = shaftLabel(element, byId, this.#host.layout());
    if (words === null) {
      return;
    }
    const box = this.viewport.pageBox(wordsInkBounds(words));
    // The dashes stand a little outside the words and are the selection's: no
    // press lands on them. The box the words paint is what a press takes, so it
    // is the one that says what a press there does.
    this.#appendRect(overlay, {
      x: box.x - LABEL_CUE_GAP,
      y: box.y - LABEL_CUE_GAP,
      width: box.width + LABEL_CUE_GAP * 2,
      height: box.height + LABEL_CUE_GAP * 2,
      class: 'label-cue',
    });
    this.#appendRect(overlay, { ...box, class: 'label-grab' });
  }

  #appendRect(
    parent: SVGGElement,
    attributes: { x: number; y: number; width: number; height: number; class: string },
  ): SVGRectElement {
    const node = rect(attributes);
    parent.append(node);
    return node;
  }
}

/** How far apart two places on the page are, in screen pixels. */
function distance(one: Point, other: Point): number {
  return Math.hypot(one.x - other.x, one.y - other.y);
}

/**
 * One Element's drawing as the group the page holds: the unit a move moves with
 * a transform, and the unit a redraw replaces. The Renderer writes the same
 * nodes into the saved SVG, so what the page shows is the file it saves.
 */
function groupOf(id: string, svg: string): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('data-element', id);
  const parsed = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}">${svg}</svg>`,
    'image/svg+xml',
  );
  for (const child of Array.from(parsed.documentElement.childNodes)) {
    group.append(document.importNode(child, true));
  }
  return group;
}
