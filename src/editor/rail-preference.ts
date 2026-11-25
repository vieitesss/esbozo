/**
 * The place the tool rail was last dropped at, kept for every Scene on the origin.
 *
 * A move is the page's chrome, not the Scene's, so the place outlives the Scene
 * and the tab: `localStorage` holds the centre fractions and orientation (or an
 * older bare side word). Each editor reads it once when it starts, so there is
 * no live sync between editors or tabs, and the last move wins at the next load.
 * A storage that throws or holds unknown text starts at the top edge's middle.
 */
import type { RailOrientation, RailSide } from './rail.js';

/** The key the place is kept under, and the four legacy side words it may hold. */
const KEY = 'esbozo.rail';
const SIDES: readonly RailSide[] = ['top', 'bottom', 'left', 'right'];

/** The stored rail place: either centre fractions with orientation, or an edge side. */
export type RailPlace =
  | { readonly kind: 'at'; readonly x: number; readonly y: number; readonly orientation: RailOrientation }
  | { readonly kind: 'edge'; readonly side: RailSide };

/**
 * The page's own storage, or null when the browser will not even hand it over: a
 * blocked origin throws as the property is read, before any call on it.
 */
function pageStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * The place to start at: stored centre fractions + orientation, an old bare side
 * word mapped to that edge's middle, or the top edge's middle for no value,
 * unknown text, or a throwing storage.
 */
export function readRailPlace(from: Storage | null = pageStorage()): RailPlace {
  try {
    const kept = from?.getItem(KEY) ?? null;
    if (kept === null) {
      return { kind: 'edge', side: 'top' };
    }
    const side = SIDES.find((word) => word === kept);
    if (side !== undefined) {
      return { kind: 'edge', side };
    }
    const parsed: unknown = JSON.parse(kept);
    if (typeof parsed === 'object' && parsed !== null) {
      const { x, y, orientation } = parsed as Record<string, unknown>;
      if (
        typeof x === 'number' &&
        Number.isFinite(x) &&
        x >= 0 &&
        x <= 1 &&
        typeof y === 'number' &&
        Number.isFinite(y) &&
        y >= 0 &&
        y <= 1 &&
        (orientation === 'lying' || orientation === 'standing')
      ) {
        return { kind: 'at', x, y, orientation };
      }
    }
    return { kind: 'edge', side: 'top' };
  } catch {
    return { kind: 'edge', side: 'top' };
  }
}

/** Keep a committed drop's centre fractions and orientation for the next start. */
export function writeRailPlace(
  place: { readonly x: number; readonly y: number; readonly orientation: RailOrientation },
  into: Storage | null = pageStorage(),
): void {
  try {
    into?.setItem(
      KEY,
      JSON.stringify({ x: place.x, y: place.y, orientation: place.orientation }),
    );
  } catch {
    // A blocked or full storage keeps no place of this drop; this visit still moves.
  }
}
