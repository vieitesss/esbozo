/**
 * The tool rail's list: one tool per Element type a person can draw, plus
 * Select.
 *
 * The order is the rail's, and each tool's shortcut is the left-hand key that
 * picks it, so the mouse stays where it is. The numbers 1–7 pick the rail's
 * tools in this same order, which is why the list is the one place both the
 * buttons and the keyboard read.
 */
import type { Element } from '../scene.js';

/** The Element types a tool draws. */
export type DrawableType = Element['type'];

interface Tool {
  readonly id: 'select' | DrawableType;
  readonly name: string;
  /** The single key that picks the tool. */
  readonly shortcut: string;
}

export const TOOLS: readonly Tool[] = [
  { id: 'select', name: 'Select', shortcut: 'V' },
  { id: 'rectangle', name: 'Rectangle', shortcut: 'R' },
  { id: 'ellipse', name: 'Ellipse', shortcut: 'E' },
  { id: 'diamond', name: 'Diamond', shortcut: 'D' },
  { id: 'arrow', name: 'Arrow', shortcut: 'A' },
  { id: 'line', name: 'Line', shortcut: 'S' },
  { id: 'text', name: 'Text', shortcut: 'T' },
];

export type ToolId = Tool['id'];

/** The tool a letter picks, or null when no tool holds that key. */
export function toolForLetter(letter: string): ToolId | null {
  const key = letter.toLowerCase();
  return TOOLS.find((tool) => tool.shortcut.toLowerCase() === key)?.id ?? null;
}

/** The tool a digit picks: `1` is the first tool on the rail, and past its end there is none. */
export function toolAt(key: string): ToolId | null {
  const position = Number(key);
  if (!Number.isInteger(position) || position < 1 || position > TOOLS.length) {
    return null;
  }
  return TOOLS[position - 1]?.id ?? null;
}
