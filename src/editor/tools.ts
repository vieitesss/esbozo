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
  /** The rail's icon for it. */
  readonly icon: string;
}

export const TOOLS: readonly Tool[] = [
  { id: 'select', name: 'Select', shortcut: 'V', icon: 'select' },
  { id: 'rectangle', name: 'Rectangle', shortcut: 'R', icon: 'rect' },
  { id: 'ellipse', name: 'Ellipse', shortcut: 'E', icon: 'ellipse' },
  { id: 'diamond', name: 'Diamond', shortcut: 'D', icon: 'diamond' },
  { id: 'arrow', name: 'Arrow', shortcut: 'A', icon: 'arrow' },
  { id: 'line', name: 'Line', shortcut: 'S', icon: 'line' },
  { id: 'text', name: 'Text', shortcut: 'T', icon: 'text' },
];

export type ToolId = Tool['id'];

/** The tool a letter picks, or null when no tool holds that key. */
export function toolForLetter(letter: string): ToolId | null {
  const key = letter.toLowerCase();
  return TOOLS.find((tool) => tool.shortcut.toLowerCase() === key)?.id ?? null;
}

/** The tool a rail position picks: 1 is the first tool on the rail. */
export function toolAt(position: number): ToolId | null {
  return TOOLS[position - 1]?.id ?? null;
}
