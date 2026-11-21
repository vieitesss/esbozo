/**
 * The command palette: every action by name, from the keyboard.
 *
 * `Q` or ⌘K opens it; typing filters it; the arrows walk it, Enter runs the row
 * it is on, Escape closes it. The rows are the registry's (`actions.ts`), so the
 * list of names, the shortcuts beside them and the reasons a row is greyed out
 * are written once, for the palette, the rail and the keys alike.
 *
 * An action that cannot run is still listed: it says why it cannot, and the
 * arrows and Enter step over it. Ties to the editor are callbacks only, so the
 * palette knows nothing about the Scene and cannot change it by itself.
 */
import { ACTIONS } from './actions.js';
import type { ActionState, EditorAction } from './actions.js';

export interface PaletteOptions {
  /** The dialog the page's shell already holds. */
  readonly root: HTMLElement;
  /** What the actions may look at, asked afresh on every open and every keystroke. */
  readonly state: () => ActionState;
  readonly run: (action: EditorAction) => void;
  /** Told when the palette closes itself, so the editor can drop its focus. */
  readonly closed?: () => void;
}

export class CommandPalette {
  readonly #input: HTMLInputElement;
  readonly #list: HTMLElement;
  readonly #nothing: HTMLElement;
  readonly #options: PaletteOptions;
  /** The rows the current query shows, in the order the page shows them. */
  #rows: EditorAction[] = [];
  /** Which row Enter would run. */
  #active = -1;

  constructor(options: PaletteOptions) {
    this.#options = options;
    this.#input = options.root.querySelector('input')!;
    this.#list = options.root.querySelector('[role="listbox"]')!;
    this.#nothing = options.root.querySelector('.palette-nothing')!;
    this.#input.addEventListener('input', () => this.#show());
    this.#input.addEventListener('keydown', this.#onKeyDown);
    this.#list.addEventListener('click', this.#onClick);
    options.root.addEventListener('pointerdown', (event) => {
      // A press on the paper behind the list is a press on nothing: it closes.
      if (event.target === options.root) {
        this.close();
      }
    });
  }

  get open(): boolean {
    return !this.#options.root.hidden;
  }

  /** Open with an empty query, every action listed, and the caret ready to filter. */
  show(): void {
    this.#options.root.hidden = false;
    this.#input.value = '';
    this.#show();
    this.#input.focus();
  }

  close(): void {
    if (!this.open) {
      return;
    }
    this.#options.root.hidden = true;
    this.#input.blur();
    this.#options.closed?.();
  }

  /** Draw the rows the query keeps, and put the active one on the first it can run. */
  #show(): void {
    const state = this.#options.state();
    const query = this.#input.value.trim().toLowerCase();
    this.#rows = ACTIONS.filter((action) => matches(action.name, query));
    this.#list.replaceChildren(
      ...this.#rows.map((action) => row(action, state)),
    );
    this.#nothing.hidden = this.#rows.length > 0;
    this.#active = this.#rows.findIndex((action) => action.reason(state) === null);
    this.#mark();
    this.#input.setAttribute('aria-expanded', 'true');
  }

  /** Mark the active row, and keep it in sight. */
  #mark(): void {
    const active = this.#rows[this.#active];
    for (const node of this.#list.querySelectorAll('[data-command]')) {
      node.setAttribute('aria-selected', String(node.id === idOf(active)));
    }
    if (active === undefined) {
      this.#input.removeAttribute('aria-activedescendant');
      return;
    }
    this.#input.setAttribute('aria-activedescendant', idOf(active));
    this.#list.querySelector(`#${idOf(active)}`)?.scrollIntoView({ block: 'nearest' });
  }

  /** Walk to the next row Enter could run, skipping the ones that say they cannot. */
  #step(by: number): void {
    const state = this.#options.state();
    for (let index = this.#active + by; index >= 0 && index < this.#rows.length; index += by) {
      if (this.#rows[index]!.reason(state) === null) {
        this.#active = index;
        this.#mark();
        return;
      }
    }
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.#step(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.#step(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.#runActive();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  };

  #onClick = (event: Event): void => {
    const node = (event.target as Element | null)?.closest('[data-command]');
    const id = node?.getAttribute('data-command');
    if (id === null || id === undefined) {
      return;
    }
    const index = this.#rows.findIndex((action) => action.id === id);
    if (index >= 0) {
      this.#active = index;
      this.#mark();
      this.#runActive();
    }
  };

  #runActive(): void {
    const action = this.#rows[this.#active];
    if (action === undefined || action.reason(this.#options.state()) !== null) {
      return;
    }
    this.close();
    this.#options.run(action);
  }
}

/**
 * Whether a query keeps an action: every word of the query has to appear in the
 * name, in any order and in any case, so `png dark` finds `Export PNG (dark)`.
 */
export function matches(name: string, query: string): boolean {
  if (query === '') {
    return true;
  }
  const haystack = name.toLowerCase();
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

/** One row: what it does, the key that does it, or why it cannot right now. */
function row(action: EditorAction, state: ActionState): HTMLElement {
  const reason = action.reason(state);
  const item = document.createElement('li');
  item.id = idOf(action);
  item.setAttribute('role', 'option');
  item.dataset['command'] = action.id;
  item.setAttribute('aria-selected', 'false');
  // The name a screen reader reads is the row a person sees: what it does and
  // the key that does it, so a test can ask for the row by name.
  item.setAttribute('aria-label', labelOf(action));
  if (reason === null) {
    item.setAttribute('aria-disabled', 'false');
  } else {
    item.setAttribute('aria-disabled', 'true');
  }
  const name = document.createElement('span');
  name.className = 'say';
  name.textContent = action.name;
  item.append(name);
  if (reason !== null) {
    const why = document.createElement('span');
    why.className = 'why';
    why.textContent = reason;
    item.append(why);
  }
  if (action.shortcut !== '') {
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = action.shortcut;
    item.append(key);
  }
  return item;
}

/** What the row says, as one name: `Export PNG (light)` or `Toggle Grid · G`. */
function labelOf(action: EditorAction): string {
  return action.shortcut === '' ? action.name : `${action.name} · ${action.shortcut}`;
}

function idOf(action: EditorAction | undefined): string {
  return action === undefined ? '' : `command-${action.id}`;
}
