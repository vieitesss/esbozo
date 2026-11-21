/**
 * Every action the editor can do: its name, its shortcut and when it is offered.
 *
 * One list. The rail draws its tools from it, the palette lists it, the key
 * handler matches keys against it and the Style menu draws its Arrange rows from
 * it, so no shortcut can point at an action nothing offers, and no action can be
 * reachable by name but not by key.
 *
 * An action that cannot run says why (`reason`) instead of going missing: the
 * palette shows it disabled with that reason beside it, and the menu greys the
 * same button. `minSelected` is the least a row is worth drawing at all, which
 * is why Arrange stays out of the menu until two Elements are selected while the
 * palette still lists it, disabled, saying what it is waiting for.
 *
 * Nothing here touches the Scene: an action's `run` asks the host (the editor)
 * to do it, so the registry stays a table and every change still lands through
 * the editor's one path.
 */
import type { Element } from '../scene.js';
import type { ArrangeAct } from './arrange.js';

/** The Element types a tool draws. */
export type DrawableType = Element['type'];

/** The Element types a tool draws, plus Select. */
export type ToolId = 'select' | DrawableType;

/** One key, as a person presses it: `meta` is ⌘ or Ctrl, and takes either. */
export interface Binding {
  readonly key: string;
  readonly meta?: boolean;
  /** Left out when the key means the same with Shift held; `false` means it must not be. */
  readonly shift?: boolean;
}

/** What an action answers, and reads, about the editor it acts on. */
export interface ActionState {
  /** How many Elements are selected. */
  readonly selected: number;
  /** How many of them Arrange can move: a Snapped end follows its target by itself. */
  readonly movable: number;
  /** Only the palette knows the history; the menu passes the selection alone. */
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
}

/** What the editor does, as the actions name it. */
export interface ActionHost {
  pickTool(tool: ToolId): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  copySelection(): Promise<void>;
  paste(): Promise<void>;
  undo(): void;
  redo(): void;
  arrange(act: ArrangeAct): void;
  toggleGrid(): void;
  toggleTheme(): void;
  stepDefaultRoughness(): void;
  openPalette(): void;
}

/** The palette's headings, in the order the list is read in. */
export type ActionGroup = 'Tools' | 'Edit' | 'Order' | 'Arrange' | 'Spread' | 'View' | 'Export';

export interface EditorAction {
  readonly id: string;
  readonly name: string;
  readonly group: ActionGroup;
  /** What the palette and the rail show, e.g. `G` or `⇧⌘Z`; empty when nothing picks it. */
  readonly shortcut: string;
  readonly bindings: readonly Binding[];
  /** The least Elements the action needs selected: below it the menu leaves its row out. */
  readonly minSelected: number;
  /** Why the action cannot run now, or null when it can. */
  readonly reason: (state: ActionState) => string | null;
  readonly run: (host: ActionHost) => void | Promise<void>;
}

/** Always offered: the tools and the things that need nothing selected. */
const always = (): null => null;

/** The rail's order, which the digits follow: built once, above the tools it places. */
const TOOL_ORDER: readonly ToolId[] = [
  'select',
  'rectangle',
  'ellipse',
  'diamond',
  'arrow',
  'line',
  'text',
];

/** The tools, in rail order: each draws one Element type, and Select draws nothing. */
const TOOL_ACTIONS = [
  tool('select', 'Select', 'V'),
  tool('rectangle', 'Rectangle', 'R'),
  tool('ellipse', 'Ellipse', 'E'),
  tool('diamond', 'Diamond', 'D'),
  tool('arrow', 'Arrow', 'A'),
  tool('line', 'Line', 'S'),
  tool('text', 'Text', 'T'),
] as const satisfies readonly EditorAction[];

/**
 * One tool: its letter, and the digit that picks it by its place on the rail.
 * Both are bindings of the same action, so the tool list and the keys cannot
 * drift apart.
 */
function tool(id: ToolId, name: string, letter: string): EditorAction {
  const position = TOOL_ORDER.indexOf(id) + 1;
  return {
    id,
    name,
    group: 'Tools',
    shortcut: letter,
    bindings: [{ key: letter }, { key: String(position) }],
    minSelected: 0,
    reason: always,
    run: (host) => host.pickTool(id),
  };
}

/** Two Elements on the page are the least an alignment means anything for. */
function needsTwoMovable(state: ActionState): string | null {
  return state.movable < 2 ? 'select two Elements Arrange can move' : null;
}

function needsThreeMovable(state: ActionState): string | null {
  return state.movable < 3 ? 'select three Elements Arrange can move' : null;
}

function needsSelection(state: ActionState): string | null {
  return state.selected === 0 ? 'select an Element first' : null;
}

/** One Arrange button: the menu's row, the palette's name, and the act it runs. */
function arrange(
  act: ArrangeAct,
  row: 'Order' | 'Arrange' | 'Spread',
  label: string,
  minSelected: number,
  reason: (state: ActionState) => string | null,
): EditorAction {
  return {
    id: act,
    name: `${row}: ${label}`,
    group: row,
    shortcut: '',
    bindings: [],
    minSelected,
    reason,
    run: (host) => host.arrange(act),
  };
}

const OTHER_ACTIONS = [
  {
    id: 'palette',
    name: 'Open command palette',
    group: 'View',
    shortcut: 'Q · ⌘K',
    bindings: [{ key: 'q' }, { key: 'k', meta: true }],
    minSelected: 0,
    reason: always,
    run: (host) => host.openPalette(),
  },
  {
    id: 'undo',
    name: 'Undo',
    group: 'Edit',
    shortcut: '⌘Z',
    bindings: [{ key: 'z', meta: true, shift: false }],
    minSelected: 0,
    reason: (state: ActionState) => (state.canUndo === true ? null : 'nothing to undo'),
    run: (host) => host.undo(),
  },
  {
    id: 'redo',
    name: 'Redo',
    group: 'Edit',
    shortcut: '⇧⌘Z',
    bindings: [{ key: 'z', meta: true, shift: true }],
    minSelected: 0,
    reason: (state: ActionState) => (state.canRedo === true ? null : 'nothing to redo'),
    run: (host) => host.redo(),
  },
  {
    // The copy event carries the Scene text, so the browser's own ⌘C is the key
    // that copies: a key binding here would race the event that follows it.
    id: 'copy',
    name: 'Copy',
    group: 'Edit',
    shortcut: '⌘C',
    bindings: [],
    minSelected: 1,
    reason: needsSelection,
    run: (host) => host.copySelection(),
  },
  {
    // Like Copy: the paste event is the browser's, and reads the data it carries.
    id: 'paste',
    name: 'Paste',
    group: 'Edit',
    shortcut: '⌘V',
    bindings: [],
    minSelected: 0,
    reason: always,
    run: (host) => host.paste(),
  },
  {
    id: 'duplicate',
    name: 'Duplicate',
    group: 'Edit',
    shortcut: 'C · ⌘D',
    bindings: [{ key: 'c' }, { key: 'd', meta: true }],
    minSelected: 1,
    reason: needsSelection,
    run: (host) => host.duplicateSelection(),
  },
  {
    id: 'delete',
    name: 'Delete',
    group: 'Edit',
    shortcut: 'X',
    bindings: [{ key: 'x' }, { key: 'backspace' }, { key: 'delete' }],
    minSelected: 1,
    reason: needsSelection,
    run: (host) => host.deleteSelection(),
  },
  arrange('order-back', 'Order', 'back', 1, always),
  arrange('order-backward', 'Order', 'backward', 1, always),
  arrange('order-forward', 'Order', 'forward', 1, always),
  arrange('order-front', 'Order', 'front', 1, always),
  arrange('align-left', 'Arrange', 'left', 2, needsTwoMovable),
  arrange('align-centre', 'Arrange', 'centre', 2, needsTwoMovable),
  arrange('align-right', 'Arrange', 'right', 2, needsTwoMovable),
  arrange('align-top', 'Arrange', 'top', 2, needsTwoMovable),
  arrange('align-middle', 'Arrange', 'middle', 2, needsTwoMovable),
  arrange('align-bottom', 'Arrange', 'bottom', 2, needsTwoMovable),
  arrange('distribute-horizontal', 'Spread', 'horizontal', 3, needsThreeMovable),
  arrange('distribute-vertical', 'Spread', 'vertical', 3, needsThreeMovable),
  {
    id: 'grid',
    name: 'Toggle Grid',
    group: 'View',
    shortcut: 'G',
    bindings: [{ key: 'g' }],
    minSelected: 0,
    reason: always,
    run: (host) => host.toggleGrid(),
  },
  {
    id: 'theme',
    name: 'Toggle theme',
    group: 'View',
    shortcut: '',
    bindings: [],
    minSelected: 0,
    reason: always,
    run: (host) => host.toggleTheme(),
  },
  {
    id: 'roughness',
    name: 'Default roughness',
    group: 'View',
    shortcut: '',
    bindings: [],
    minSelected: 0,
    reason: always,
    run: (host) => host.stepDefaultRoughness(),
  },
] as const satisfies readonly EditorAction[];

/** Every action, in the order the palette lists them. */
export const ACTIONS: readonly EditorAction[] = [...TOOL_ACTIONS, ...OTHER_ACTIONS];

/** The tools in rail order, each knowing the tool it picks. */
export const TOOLS = TOOL_ACTIONS as readonly (EditorAction & { readonly id: ToolId })[];

/** The action a key press picks, or null when it picks none. */
export function actionFor(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): EditorAction | null {
  const key = event.key.toLowerCase();
  const meta = event.metaKey || event.ctrlKey;
  for (const action of ACTIONS) {
    for (const binding of action.bindings) {
      if (binding.key.toLowerCase() !== key) {
        continue;
      }
      if ((binding.meta === true) !== meta) {
        continue;
      }
      if (binding.shift !== undefined && binding.shift !== event.shiftKey) {
        continue;
      }
      return action;
    }
  }
  return null;
}

/** The action with this id, for a row the palette drew. */
export function actionById(id: string): EditorAction | null {
  return ACTIONS.find((action) => action.id === id) ?? null;
}
