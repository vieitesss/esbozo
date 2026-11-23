/**
 * The side the tool rail was last moved to, kept for every Scene on the origin.
 *
 * A move is the page's chrome, not the Scene's (D9), so the side outlives the
 * Scene and the tab: `localStorage` holds that one word and nothing else (D10).
 * Each editor reads it once when it starts, so there is no live sync between
 * editors or tabs, and the last move wins at the next load. A storage that
 * throws or holds an unknown word is no side at all: the rail starts at the top
 * and still moves for that visit.
 */
import type { RailSide } from './geometry.js';

/** The key the side is kept under, and the four words it may hold (I8). */
const KEY = 'esbozo.rail';
const SIDES: readonly RailSide[] = ['top', 'bottom', 'left', 'right'];

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

/** The side to start on: the one kept, or the top for no word, an unknown one or a storage that throws. */
export function readRailSide(from: Storage | null = pageStorage()): RailSide {
  try {
    const kept = from?.getItem(KEY) ?? null;
    return SIDES.find((side) => side === kept) ?? 'top';
  } catch {
    return 'top';
  }
}

/** Keep a committed move's side for the next start, and stay quiet when the storage will not take it. */
export function writeRailSide(side: RailSide, into: Storage | null = pageStorage()): void {
  try {
    into?.setItem(KEY, side);
  } catch {
    // A blocked or full storage keeps no side: this visit still moves, and the
    // next one starts at the top (D10).
  }
}
