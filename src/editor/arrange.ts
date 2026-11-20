/**
 * Arrange: layer order, alignment and distribution for the selected Elements.
 *
 * Pure functions over the Element list, so the pointer handlers and the tests
 * share them. Where an Element covers comes from the caller (`boundsOf`),
 * because measuring words is Layout's job: the editor passes the Renderer's own
 * bounds, so an alignment lands where the drawing actually is.
 *
 * Moving an Element is `moved` (`geometry.ts`), the same call a drag makes, so
 * an arrow or line Snapped at both ends is left alone here too: its ends follow
 * their targets and its stored ends must not be rewritten for it.
 */
import type { Element } from '../scene.js';
import { moved } from './geometry.js';
import type { Box } from './geometry.js';

/** One arrange action, as the menu names it. */
export type ArrangeAct =
  | 'order-back'
  | 'order-backward'
  | 'order-forward'
  | 'order-front'
  | 'align-left'
  | 'align-centre'
  | 'align-right'
  | 'align-top'
  | 'align-middle'
  | 'align-bottom'
  | 'distribute-horizontal'
  | 'distribute-vertical';

/** Where an Element covers, in Scene units. */
export type BoundsOf = (element: Element) => Box;

/** The Element list after an arrange action. Layer order is list order. */
export function arranged(
  elements: readonly Element[],
  selected: readonly string[],
  act: ArrangeAct,
  boundsOf: BoundsOf,
): Element[] {
  const ids = new Set(selected);
  if (ids.size === 0) {
    return [...elements];
  }
  if (act.startsWith('order-')) {
    return layered(elements, ids, act as LayerAct);
  }
  const picked = elements.filter((element) => ids.has(element.id));
  if (act.startsWith('align-')) {
    return aligned(elements, picked, act, boundsOf);
  }
  return distributed(elements, picked, act === 'distribute-horizontal' ? 'x' : 'y', boundsOf);
}

type LayerAct = 'order-back' | 'order-backward' | 'order-forward' | 'order-front';

/**
 * The list reordered. `front` and `back` take the picked Elements past
 * everything else, keeping their own order; `forward` and `backward` move each
 * one a single layer towards the near side. Walking from that side keeps two
 * picked neighbours in the order they were in.
 */
function layered(elements: readonly Element[], ids: ReadonlySet<string>, act: LayerAct): Element[] {
  const list = [...elements];
  if (act === 'order-front' || act === 'order-back') {
    const picked = list.filter((element) => ids.has(element.id));
    const rest = list.filter((element) => !ids.has(element.id));
    return act === 'order-front' ? [...rest, ...picked] : [...picked, ...rest];
  }
  const step = act === 'order-forward' ? 1 : -1;
  const order = [...list.keys()];
  if (step === 1) {
    order.reverse();
  }
  for (const index of order) {
    const target = index + step;
    if (!ids.has(list[index]!.id) || target < 0 || target >= list.length) {
      continue;
    }
    const moving = list[index]!;
    list[index] = list[target]!;
    list[target] = moving;
  }
  return list;
}

/** The bounds around every given box, or null when there is none. */
function unionOf(boxes: readonly Box[]): { x: number; y: number; width: number; height: number } {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Each picked Element moved so its bounds line up inside the selection's box. */
function aligned(
  elements: readonly Element[],
  picked: readonly Element[],
  act: ArrangeAct,
  boundsOf: BoundsOf,
): Element[] {
  if (picked.length < 2) {
    return [...elements];
  }
  const boxes = new Map(picked.map((element) => [element.id, boundsOf(element)]));
  const union = unionOf([...boxes.values()]);
  return elements.map((element) => {
    const box = boxes.get(element.id);
    if (box === undefined) {
      return element;
    }
    const dx =
      act === 'align-left'
        ? union.x - box.x
        : act === 'align-centre'
          ? union.x + union.width / 2 - (box.x + box.width / 2)
          : act === 'align-right'
            ? union.x + union.width - (box.x + box.width)
            : 0;
    const dy =
      act === 'align-top'
        ? union.y - box.y
        : act === 'align-middle'
          ? union.y + union.height / 2 - (box.y + box.height / 2)
          : act === 'align-bottom'
            ? union.y + union.height - (box.y + box.height)
            : 0;
    return moved(element, dx, dy);
  });
}

/**
 * Three or more Elements spread along one axis with equal gaps between them,
 * the outermost two staying where they are. Two Elements have one gap, so there
 * is nothing to even out and nothing happens.
 */
function distributed(
  elements: readonly Element[],
  picked: readonly Element[],
  axis: 'x' | 'y',
  boundsOf: BoundsOf,
): Element[] {
  if (picked.length < 3) {
    return [...elements];
  }
  const start = (box: Box): number => (axis === 'x' ? box.x : box.y);
  const size = (box: Box): number => (axis === 'x' ? box.width : box.height);
  const boxes = new Map(picked.map((element) => [element.id, boundsOf(element)]));
  const order = [...picked].sort((left, right) => start(boxes.get(left.id)!) - start(boxes.get(right.id)!));
  const first = boxes.get(order[0]!.id)!;
  const last = boxes.get(order[order.length - 1]!.id)!;
  const span = start(last) + size(last) - start(first);
  const total = order.reduce((sum, element) => sum + size(boxes.get(element.id)!), 0);
  const gap = (span - total) / (order.length - 1);
  const shifts = new Map<string, number>();
  let cursor = start(first);
  for (const element of order) {
    const box = boxes.get(element.id)!;
    shifts.set(element.id, cursor - start(box));
    cursor += size(box) + gap;
  }
  return elements.map((element) => {
    const shift = shifts.get(element.id);
    if (shift === undefined) {
      return element;
    }
    return axis === 'x' ? moved(element, shift, 0) : moved(element, 0, shift);
  });
}
