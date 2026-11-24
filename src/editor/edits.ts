import { elementBounds, elementsById } from '../renderer.js';
import { parseFragment } from '../scene.js';
import type { Element as SceneElement, Scene } from '../scene.js';
import type { Layout } from '../layout.js';
import { arranged } from './arrange.js';
import type { ArrangeAct } from './arrange.js';
import { copies, fragmentOf, idsOf, replaced, without } from './elements.js';
import { boxOf, landingOffset, moved } from './geometry.js';
import type { Point, View } from './geometry.js';
import { freedEnd, isShaft } from './snap.js';
import type { End } from './snap.js';
import { styled } from './style.js';
import type { StyleKey } from './style.js';

/** How far a copy, a pasted Element or a duplicate lands from what it copies, in Scene units. */
const COPY_OFFSET = { x: 16, y: 16 };

/** The next Scene an edit makes, and the selection that goes with it. */
export interface Edited {
  readonly scene: Scene;
  /**
   * The selection the edit leaves, so no caller filters or extends it itself.
   * `null` where the edit leaves the selection as it was — the same Elements and
   * the same bend point a press may hold.
   */
  readonly selection: readonly string[] | null;
}

/**
 * What a paste or a duplicate needs of the page: the measurement its landing is
 * measured with, and the view a copy is nudged into, so a fragment carried far
 * off the page lands where a person can see it rather than out of sight.
 */
export interface Landing {
  readonly layout: Layout;
  readonly view: View;
  readonly viewport: { readonly width: number; readonly height: number };
}

/** Change the selected Elements' style, every pick arriving here. */
export function restyled(
  scene: Scene,
  selection: readonly string[],
  key: StyleKey,
  value: string,
): Edited {
  return {
    scene: {
      ...scene,
      elements: replaced(scene.elements, new Set(selection), (element) =>
        styled(element, key, value),
      ),
    },
    selection: null,
  };
}

/**
 * Reorder, align or spread the selected Elements. Arrange asks for the bounds of
 * what it can move as it needs them, so Order measures nothing and the id index
 * is built only when something is measured at all. The bounds are the Renderer's
 * own, so an alignment lands where the drawing is rather than where a stored box
 * says: a Snapped end and a Label are measured, not guessed.
 */
export function rearranged(
  scene: Scene,
  selection: readonly string[],
  act: ArrangeAct,
  layout: Layout,
): Edited {
  const elements = scene.elements;
  let byId: ReadonlyMap<string, SceneElement> | undefined;
  return {
    scene: {
      ...scene,
      elements: arranged(elements, selection, act, (element) => {
        byId ??= elementsById(elements);
        return elementBounds(element, byId, layout);
      }),
    },
    selection: null,
  };
}

/**
 * Move the selected Elements by a step: a Snapped end of a two-point shaft stays
 * on its target's outline, so the step moves that shaft's free end, its bends,
 * and nothing of the end that follows an Element. A nudge with nothing selected
 * asks for nothing.
 */
export function nudged(
  scene: Scene,
  selection: readonly string[],
  dx: number,
  dy: number,
): Edited | null {
  if (selection.length === 0) {
    return null;
  }
  return {
    scene: {
      ...scene,
      elements: replaced(scene.elements, new Set(selection), (element) =>
        moved(element, dx, dy),
      ),
    },
    selection: null,
  };
}

/**
 * Free one end of the selected arrow or line, where it draws now: the end stops
 * following its Element but does not move. An end that already follows nothing,
 * and a selection that holds no shaft, ask for nothing.
 *
 * The caller hands over the Elements it selects as the page shows them, so an end
 * dragged along its target is read where the preview has slid it rather than
 * where the last save left it: a Detach pressed with the drag still in the hand
 * frees the end at the outline point the drag is showing.
 */
export function detached(
  scene: Scene,
  elements: readonly SceneElement[],
  end: End,
): Edited | null {
  const element = elements[0];
  if (element === undefined || !isShaft(element)) {
    return null;
  }
  const freed = freedEnd(element, end, elementsById(scene.elements));
  if (freed === element) {
    return null;
  }
  return {
    scene: { ...scene, elements: replaced(scene.elements, new Set([element.id]), () => freed) },
    selection: null,
  };
}

/**
 * Delete the Elements with these ids, as one step. Only the ids given go: a cut
 * that copied one Element deletes that Element, whatever the selection has
 * become while the clipboard took the copy. The selection keeps what it still
 * holds, so nothing names an Element the Scene no longer has.
 */
export function deleted(
  scene: Scene,
  selection: readonly string[],
  ids: ReadonlySet<string>,
): Edited | null {
  if (ids.size === 0) {
    return null;
  }
  return {
    scene: { ...scene, elements: without(scene.elements, ids) },
    selection: selection.filter((id) => !ids.has(id)),
  };
}

/** Where a fragment of these Elements lands, so a copy reads as a copy and stays on the page. */
function landingOf(elements: readonly SceneElement[], landing: Landing): Point {
  const box = boxOf(elements, elementsById(elements), landing.layout);
  return box === null
    ? COPY_OFFSET
    : landingOffset(box, landing.view, landing.viewport, COPY_OFFSET);
}

/**
 * Paste these Elements as one step, selected, so a paste can be moved at once.
 * A fragment of none asks for nothing.
 */
export function pasted(
  scene: Scene,
  elements: readonly SceneElement[],
  landing: Landing,
): Edited | null {
  if (elements.length === 0) {
    return null;
  }
  const added = copies(elements, idsOf(scene.elements), landingOf(elements, landing));
  return {
    scene: { ...scene, elements: [...scene.elements, ...added] },
    selection: added.map((element) => element.id),
  };
}

/**
 * A duplicate is a copy pasted in place, offset so the copy reads as a copy: one
 * step. It goes through the fragment Copy writes and Paste reads, so a Snap to
 * an Element outside the selection is dropped and the end is stored where it
 * drew, and a Snap to an Element inside the selection follows its copy.
 *
 * The caller hands over the Elements it selects as the page shows them, as a
 * Copy does, so a duplicate made during a drag copies what the page draws.
 */
export function duplicated(
  scene: Scene,
  elements: readonly SceneElement[],
  landing: Landing,
): Edited | null {
  const fragment = parseFragment(fragmentOf(scene, elements), scene.defaults);
  return pasted(scene, fragment ?? [], landing);
}
