/**
 * Copy and paste between Scenes: the Elements travel as Scene JSON text, which
 * is what the clipboard is good at and what another tab can read.
 *
 * What is copied is a Scene fragment — `{ "version": 1, "elements": [...] }` —
 * so every Element is exactly the object a Scene file holds, and a paste is
 * checked by the same parser a file is. A bare array is accepted on the way in
 * too, because a fragment lifted out of a Scene file by hand is still a
 * fragment. Nothing else rides along: no title, no selection, no editor state.
 */
import { parseScene, serialiseScene } from '../scene.js';
import type { Element, Scene, SceneStyle } from '../scene.js';

/** The given Elements as clipboard text: a Scene fragment in the current Scene's style. */
export function copyText(scene: Scene, elements: readonly Element[]): string {
  const written = JSON.parse(serialiseScene({ ...scene, elements: [...elements] })) as {
    version: number;
    elements: unknown[];
  };
  return JSON.stringify({ version: written.version, elements: written.elements }, null, 2);
}

/**
 * The Elements a paste carries, or null when the text is not a Scene fragment
 * this Scene can hold. The Elements are resolved against `defaults`, the Scene
 * being pasted into, so a fragment that carries no style still lands styled.
 */
export function parseFragment(text: string, defaults: SceneStyle): Element[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const elements = Array.isArray(raw) ? raw : recordField(raw, 'elements');
  if (!Array.isArray(elements)) {
    return null;
  }
  const parsed = parseScene(
    JSON.stringify({ version: 1, title: 'Pasted', defaults, elements: localised(elements) }),
  );
  return parsed.ok ? parsed.scene.elements : null;
}

/**
 * A fragment's Snaps only mean something inside the fragment. A Snap to an
 * Element the fragment does not carry is dropped here, so a Scene can take part
 * of a drawing without being told about Elements it has never seen.
 */
function localised(elements: readonly unknown[]): unknown[] {
  const ids = new Set(
    elements.map((element) => recordField(element, 'id')).filter((id) => typeof id === 'string'),
  );
  return elements.map((element) => {
    const points = recordField(element, 'points');
    if (!Array.isArray(points) || typeof element !== 'object' || element === null) {
      return element;
    }
    return {
      ...(element as Record<string, unknown>),
      points: points.map((point) => freeUnlessLocal(point, ids)),
    };
  });
}

function freeUnlessLocal(point: unknown, ids: ReadonlySet<unknown>): unknown {
  const snap = recordField(point, 'snap');
  if (typeof snap !== 'string' || ids.has(snap) || typeof point !== 'object' || point === null) {
    return point;
  }
  const { snap: _dropped, ...rest } = point as Record<string, unknown>;
  return rest;
}

function recordField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}
