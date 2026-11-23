import type { Element } from '../scene.js';
import { moved, unionOf } from './geometry.js';
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

/** Where an Element covers, in Scene units; undefined when it was not measured. */
export type BoundsOf = (element: Element) => Box | undefined;

/** Whether Arrange may move this Element: a Snapped end follows its target by itself. */
function movable(element: Element): boolean {
  if (element.type === 'arrow' || element.type === 'line') {
    return element.points.every((point) => point.snap === undefined);
  }
  return true;
}

/** How many of these Elements Arrange can move at all. */
export function movableCount(elements: readonly Element[]): number {
  return elements.filter(movable).length;
}

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
  // Measured on demand, and only for the Elements the action may move: Order
  // needs no bounds at all.
  const boxes = new Map<string, Box>();
  for (const element of elements) {
    const box = ids.has(element.id) && movable(element) ? boundsOf(element) : undefined;
    if (box !== undefined) {
      boxes.set(element.id, box);
    }
  }
  if (act.startsWith('align-')) {
    return aligned(elements, boxes, act);
  }
  return distributed(elements, boxes, act === 'distribute-horizontal' ? 'x' : 'y');
}

type LayerAct = 'order-back' | 'order-backward' | 'order-forward' | 'order-front';

/**
 * The list reordered. `front` and `back` take the picked Elements past
 * everything else, keeping their own order; `forward` and `backward` move each
 * one a single layer towards the near side, and a pick never steps over another
 * pick: two selected neighbours stay in the order they were in, and a selection
 * already against the near side does not move at all.
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
    if (ids.has(list[target]!.id)) {
      continue;
    }
    const moving = list[index]!;
    list[index] = list[target]!;
    list[target] = moving;
  }
  return list;
}

/** Each measurable Element moved so its bounds line up inside the selection's box. */
function aligned(
  elements: readonly Element[],
  boxes: ReadonlyMap<string, Box>,
  act: ArrangeAct,
): Element[] {
  if (boxes.size < 2) {
    return [...elements];
  }
  const union = unionOf([...boxes.values()]);
  if (union === null) {
    return [...elements];
  }
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
 *
 * The row is sorted by where each box starts, which never reorders it: the two
 * ends stay, and the rest are translated, each keeping its size. A row of boxes
 * too wide for the room they have would take a negative gap, which would run the
 * row backwards, so their centres are spaced evenly instead.
 */
function distributed(
  elements: readonly Element[],
  boxes: ReadonlyMap<string, Box>,
  axis: 'x' | 'y',
): Element[] {
  if (boxes.size < 3) {
    return [...elements];
  }
  const start = (box: Box): number => (axis === 'x' ? box.x : box.y);
  const size = (box: Box): number => (axis === 'x' ? box.width : box.height);
  const order = [...boxes.keys()];
  order.sort((left, right) => start(boxes.get(left)!) - start(boxes.get(right)!));
  const first = boxes.get(order[0]!)!;
  const last = boxes.get(order[order.length - 1]!)!;
  const ends = order.length - 1;
  const span = start(last) + size(last) - start(first);
  const total = order.reduce((sum, id) => sum + size(boxes.get(id)!), 0);
  const gap = (span - total) / ends;

  const shifts = new Map<string, number>();
  if (gap >= 0) {
    let cursor = start(first);
    for (const id of order) {
      const box = boxes.get(id)!;
      shifts.set(id, cursor - start(box));
      cursor += size(box) + gap;
    }
  } else {
    // The boxes need more room than they have, so a gap between their edges
    // cannot be even: their middles are spaced between the outermost two, which
    // keeps the row in the order it was picked in. The two ends are pinned, so
    // when the leading box is wider than the span its middle already sits past
    // the tail's: there is no room to walk forward, and a row that cannot keep
    // its order is left exactly as it was.
    const from = start(first) + size(first) / 2;
    const each = (start(last) + size(last) / 2 - from) / ends;
    if (each <= 0) {
      return [...elements];
    }
    order.forEach((id, index) => {
      const box = boxes.get(id)!;
      const middle = from + each * index;
      shifts.set(id, middle - (start(box) + size(box) / 2));
    });
  }
  return elements.map((element) => {
    const shift = shifts.get(element.id);
    if (shift === undefined) {
      return element;
    }
    return axis === 'x' ? moved(element, shift, 0) : moved(element, 0, shift);
  });
}
