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
 * What is not here: nudge is a gesture (Shift and the arrows move the selection
 * by 1 or 10, and a held key is one undo step), and an Element's style is a
 * per-value choice the Style note offers, so neither is a row a name could run.
 *
 * Nothing here touches the Scene: an action's `run` asks the host (the editor)
 * to do it, so the registry stays a table and every change still lands through
 * the editor's one path.
 */
import type { Element } from '../scene.js';
import type { Theme } from '../css.js';
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
  /** What a row shows for this key when its own name would mislead: `=` reads as `+`. */
  readonly label?: string;
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
  /** Whether the page has the async Clipboard API: an insecure origin has none. */
  readonly clipboard?: boolean;
  /** Whether the page can export a PNG at all: the bundle cannot, and says so. */
  readonly png?: boolean;
  /** Whether the page can open a folder at all: a served one lists Scenes, a static one needs the picker. */
  readonly folder?: boolean;
}

/** What the editor does, as the actions name it. */
export interface ActionHost {
  pickTool(tool: ToolId): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  copySelection(): Promise<void>;
  cutSelection(): Promise<void>;
  paste(): Promise<void>;
  undo(): void;
  redo(): void;
  arrange(act: ArrangeAct): void;
  toggleGrid(): void;
  toggleTheme(): void;
  stepDefaultRoughness(): void;
  openPalette(): void;
  exportPng(theme: Theme): Promise<void>;
  zoomIn(): void;
  zoomOut(): void;
  zoomToFit(): void;
  resetZoom(): void;
  openFolder(): void;
}

/** The palette's headings, in the order the list is read in. */
export type ActionGroup = 'Tools' | 'Edit' | 'Order' | 'Arrange' | 'Spread' | 'View' | 'Export' | 'Scene';

/** An action as it is written down: its keys are written out from its bindings. */
interface ActionSpec {
  readonly id: string;
  readonly name: string;
  readonly group: ActionGroup;
  readonly bindings: readonly Binding[];
  /**
   * The keys a row shows without binding them. The clipboard's own events carry
   * the data, so Copy, Cut and Paste must not answer a key press as well; the
   * shortcut is still the one a person presses.
   */
  readonly shortcut?: string;
  /** The least Elements the action needs selected: below it the menu leaves its row out. */
  readonly minSelected: number;
  /** Why the action cannot run now, or null when it can. */
  readonly reason: (state: ActionState) => string | null;
  readonly run: (host: ActionHost) => void | Promise<void>;
}

export interface EditorAction extends ActionSpec {
  /** Every key that does it, as the palette shows them: `V · 1` or `⇧⌘Z`. */
  readonly shortcut: string;
  /** The first of them, as the rail's tooltip shows it: `V`. */
  readonly primary: string;
}

/** Always offered: the tools and the things that need nothing selected. */
const always = (): null => null;

/**
 * One row's keys: every binding, in the order the row reads them, each key named
 * once. Two bindings can answer the same key on different keyboards — `+` and
 * `=` are both zoom in — and a row that showed `⌘+ · ⌘+` would read as two.
 */
function shortcutOf(spec: ActionSpec): string {
  if (spec.shortcut !== undefined) {
    return spec.shortcut;
  }
  return [...new Set(spec.bindings.map(keyLabel))].join(' · ');
}

/** One binding, as a person reads it: `⌘Z`, `⇧⌘Z`, `⌫`, `V`. */
function keyLabel(binding: Binding): string {
  if (binding.label !== undefined) {
    return binding.label;
  }
  const shift = binding.shift === true ? '⇧' : '';
  const meta = binding.meta === true ? '⌘' : '';
  return `${shift}${meta}${keyName(binding.key)}`;
}

/** One key's own name, as the keycaps of the machine say it. */
function keyName(key: string): string {
  if (key === 'backspace') {
    return '⌫';
  }
  if (key === 'delete') {
    return 'Del';
  }
  if (key === ' ') {
    return 'Space';
  }
  return key.length === 1 ? key.toUpperCase() : key;
}

/** A spec with the keys a row shows worked out from the keys it answers. */
function withKeys(spec: ActionSpec): EditorAction {
  const shortcut = shortcutOf(spec);
  return { ...spec, shortcut, primary: shortcut.split(' · ')[0] ?? '' };
}

/** The rail's tools in the order the rail draws them: the digits follow this one list. */
const TOOL_NAMES: readonly { readonly id: ToolId; readonly name: string; readonly letter: string }[] = [
  { id: 'select', name: 'Select', letter: 'V' },
  { id: 'rectangle', name: 'Rectangle', letter: 'R' },
  { id: 'ellipse', name: 'Ellipse', letter: 'E' },
  { id: 'diamond', name: 'Diamond', letter: 'D' },
  { id: 'arrow', name: 'Arrow', letter: 'A' },
  { id: 'line', name: 'Line', letter: 'S' },
  { id: 'text', name: 'Text', letter: 'T' },
];

/** One tool: its letter, and the digit its place on the rail gives it. */
const TOOL_ACTIONS: readonly EditorAction[] = TOOL_NAMES.map((tool, index) =>
  withKeys({
    id: tool.id,
    name: tool.name,
    group: 'Tools',
    bindings: [{ key: tool.letter }, { key: String(index + 1) }],
    minSelected: 0,
    reason: always,
    run: (host) => host.pickTool(tool.id),
  }),
);

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

/**
 * Copy, Cut and Paste name a key the browser owns: the clipboard event carries
 * the Scene text, so the row is offered only where the async API exists to run
 * the same thing by name.
 */
function needsClipboard(state: ActionState): string | null {
  return state.clipboard === false ? 'use ⌘C / ⌘V' : null;
}

/**
 * A PNG is the page's drawing: the font's outlines for its words and the page's
 * own paper and ink. An embedded editor has neither the outlines nor the page,
 * so its rows stay in the list, greyed out, saying where a PNG comes from.
 */
function needsPngPage(state: ActionState): string | null {
  return state.png === false
    ? 'PNG export is not available in the embedded editor; use ez png'
    : null;
}

/** One Arrange button: the menu's row, the palette's name, and the act it runs. */
function arrange(
  act: ArrangeAct,
  row: 'Order' | 'Arrange' | 'Spread',
  label: string,
  minSelected: number,
  reason: (state: ActionState) => string | null,
): ActionSpec {
  return {
    id: act,
    name: `${row}: ${label}`,
    group: row,
    bindings: [],
    minSelected,
    reason,
    run: (host) => host.arrange(act),
  };
}

const OTHER_ACTIONS: readonly ActionSpec[] = [
  {
    id: 'palette',
    name: 'Open command palette',
    group: 'View',
    bindings: [{ key: 'q' }, { key: 'k', meta: true }],
    minSelected: 0,
    reason: always,
    run: (host) => host.openPalette(),
  },
  {
    id: 'undo',
    name: 'Undo',
    group: 'Edit',
    bindings: [{ key: 'z', meta: true, shift: false }],
    minSelected: 0,
    reason: (state) => (state.canUndo === true ? null : 'nothing to undo'),
    run: (host) => host.undo(),
  },
  {
    id: 'redo',
    name: 'Redo',
    group: 'Edit',
    bindings: [{ key: 'z', meta: true, shift: true }],
    minSelected: 0,
    reason: (state) => (state.canRedo === true ? null : 'nothing to redo'),
    run: (host) => host.redo(),
  },
  {
    // The copy event carries the Scene text, so the browser's own ⌘C is the key
    // that copies: a key binding here would race the event that follows it.
    id: 'copy',
    name: 'Copy',
    group: 'Edit',
    bindings: [],
    shortcut: '⌘C',
    minSelected: 1,
    reason: (state) => needsSelection(state) ?? needsClipboard(state),
    run: (host) => host.copySelection(),
  },
  {
    // Like Copy, and the cut event deletes what it copied.
    id: 'cut',
    name: 'Cut',
    group: 'Edit',
    bindings: [],
    shortcut: '⌘X',
    minSelected: 1,
    reason: (state) => needsSelection(state) ?? needsClipboard(state),
    run: (host) => host.cutSelection(),
  },
  {
    // And the paste event reads the data it carries.
    id: 'paste',
    name: 'Paste',
    group: 'Edit',
    bindings: [],
    shortcut: '⌘V',
    minSelected: 0,
    reason: needsClipboard,
    run: (host) => host.paste(),
  },
  {
    id: 'duplicate',
    name: 'Duplicate',
    group: 'Edit',
    bindings: [{ key: 'c' }, { key: 'd', meta: true }],
    minSelected: 1,
    reason: needsSelection,
    run: (host) => host.duplicateSelection(),
  },
  {
    id: 'delete',
    name: 'Delete',
    group: 'Edit',
    bindings: [{ key: 'x' }, { key: 'backspace' }, { key: 'delete' }],
    minSelected: 1,
    reason: needsSelection,
    run: (host) => host.deleteSelection(),
  },
  arrange('order-back', 'Order', 'back', 1, needsSelection),
  arrange('order-backward', 'Order', 'backward', 1, needsSelection),
  arrange('order-forward', 'Order', 'forward', 1, needsSelection),
  arrange('order-front', 'Order', 'front', 1, needsSelection),
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
    bindings: [{ key: 'g' }],
    minSelected: 0,
    reason: always,
    run: (host) => host.toggleGrid(),
  },
  {
    id: 'zoom-in',
    name: 'Zoom in',
    group: 'View',
    // `⌘=` is the same request on a keyboard where `+` needs Shift.
    bindings: [{ key: '+', meta: true }, { key: '=', meta: true, label: '⌘+' }],
    minSelected: 0,
    reason: always,
    run: (host) => host.zoomIn(),
  },
  {
    id: 'zoom-out',
    name: 'Zoom out',
    group: 'View',
    bindings: [{ key: '-', meta: true, label: '⌘−' }, { key: '_', meta: true, label: '⌘−' }],
    minSelected: 0,
    reason: always,
    run: (host) => host.zoomOut(),
  },
  {
    id: 'zoom-fit',
    name: 'Zoom to fit',
    group: 'View',
    bindings: [{ key: '0', meta: true }],
    minSelected: 0,
    reason: always,
    run: (host) => host.zoomToFit(),
  },
  {
    // Back to one pixel per Scene unit, around the middle of the page.
    id: 'zoom-reset',
    name: 'Reset zoom',
    group: 'View',
    bindings: [],
    minSelected: 0,
    reason: always,
    run: (host) => host.resetZoom(),
  },
  {
    id: 'theme',
    name: 'Toggle theme',
    group: 'View',
    bindings: [],
    minSelected: 0,
    reason: always,
    run: (host) => host.toggleTheme(),
  },
  {
    id: 'roughness',
    name: 'Default roughness',
    group: 'View',
    bindings: [],
    minSelected: 0,
    reason: always,
    run: (host) => host.stepDefaultRoughness(),
  },
  {
    id: 'export-light',
    name: 'Export PNG (light)',
    group: 'Export',
    bindings: [],
    minSelected: 0,
    reason: needsPngPage,
    run: (host) => host.exportPng('light'),
  },
  {
    id: 'export-dark',
    name: 'Export PNG (dark)',
    group: 'Export',
    bindings: [],
    minSelected: 0,
    reason: needsPngPage,
    run: (host) => host.exportPng('dark'),
  },
  {
    // The status bar's own button, by name: a served page lists its Scenes here.
    id: 'open-folder',
    name: 'Open folder…',
    group: 'Scene',
    bindings: [],
    minSelected: 0,
    // Offered where the page can do it: a served page lists its Scenes, and a
    // static one needs the browser's directory picker.
    reason: (state) => (state.folder === false ? 'this page cannot open a folder' : null),
    run: (host) => host.openFolder(),
  },
];

/** The tools in rail order, each knowing the tool it picks. */
export const TOOLS = TOOL_ACTIONS as readonly (EditorAction & { readonly id: ToolId })[];

/** Every action, in the order the palette lists them. */
export const ACTIONS: readonly EditorAction[] = [...TOOL_ACTIONS, ...OTHER_ACTIONS.map(withKeys)];

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
