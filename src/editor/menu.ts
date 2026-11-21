/**
 * The Style menu: a note taped to the right edge of the page.
 *
 * One function returns the note's markup for a selection, and the editor swaps
 * it in when the selection or its style changes. Buttons carry what they do in
 * their dataset: `data-style` and `data-value` pick a style (see `style.ts`),
 * `data-act` names an Arrange action in the registry (see `actions.ts`). Each button also names itself, the
 * row and the value together, so a control is known by what it says rather than
 * by the markup around it. Nothing here reads or writes the Scene, so the menu
 * can be rebuilt at any time without losing an edit.
 *
 * The note is shorter than the prototype's: rows are grouped into the Element's
 * look, its words and Arrange, so a whole selection's controls fit a 768px-high
 * window. A group only shows the controls every selected Element can use, and a
 * row whose Elements share no value says `mixed`. An Arrange button whose
 * action has nothing it can move is offered disabled, rather than silently
 * saving nothing.
 */
import { greyColour } from '../renderer.js';
import type { Element } from '../scene.js';
import { ACTIONS } from './actions.js';
import type { ActionGroup, ActionState } from './actions.js';
import { movableCount } from './arrange.js';
import { controlsFor, roughnessLabel, sharedValue } from './style.js';
import type { StyleControl } from './style.js';

const TYPE_NAMES: Record<Element['type'], string> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  arrow: 'Arrow',
  line: 'Line',
  text: 'Text',
};

/** What the note shows for this selection, as markup. */
export function styleNote(elements: readonly Element[]): string {
  if (elements.length === 0) {
    return '';
  }
  const first = elements[0]!;
  const head =
    elements.length === 1
      ? `<div class="head"><b>${TYPE_NAMES[first.type]}</b><span>${escapeHtml(first.id)}</span></div>`
      : `<div class="head"><b>${elements.length} Elements</b><span>multiple</span></div>`;
  return `${head}${styleRows(elements)}${arrangeRows(elements)}`;
}

/**
 * A rebuild key for the note: the fields the note renders, and nothing else.
 * Moving or resizing an Element leaves every one of them alone, so a drag that
 * changes no style leaves the markup as it is.
 */
export function menuSignature(elements: readonly Element[]): string {
  const first = elements[0];
  if (first === undefined) {
    return '';
  }
  const head = elements.length === 1 ? `${first.type}:${first.id}` : `${elements.length}`;
  const styles = controlsFor(elements).map(
    (control) => `${control.key}=${sharedValue(elements, control.key) ?? 'mixed'}`,
  );
  return `${head}|${movableCount(elements)}|${styles.join(',')}`;
}

/** The status bar's Scene-wide default, in the hand: `rough · artist`. */
export function roughnessNote(roughness: number): string {
  return `rough · ${roughnessLabel(roughness)}`;
}

function styleRows(elements: readonly Element[]): string {
  const rows = controlsFor(elements).map((control) => controlRow(control, elements));
  // #8 adds the Snap end status and detach here, beside the head rows: one row
  // per end, saying "attached to <id>" or "free", plus a detach button.
  return rows.length === 0 ? '' : `<div class="group">${rows.join('')}</div>`;
}

function controlRow(control: StyleControl, elements: readonly Element[]): string {
  const shared = sharedValue(elements, control.key);
  const buttons = control.choices
    .map((choice) => choiceButton(control, choice.value, choice.label, choice.value === shared))
    .join('');
  const mixed = shared === null ? '<span class="mix">mixed</span>' : '';
  const kind = `seg${control.swatches === true ? ' greys' : ''}`;
  return (
    `<div class="row"><span class="row-label">${control.label}</span>` +
    `<div class="${kind}" role="group" aria-label="${control.label}">${buttons}${mixed}</div></div>`
  );
}

/** One button, named by its row and its value: `Grey: grey 6`. */
function buttonName(label: string, choice: string): string {
  return `${label}: ${choice}`;
}

function choiceButton(
  control: StyleControl,
  value: string,
  label: string,
  pressed: boolean,
): string {
  const state =
    ` data-style="${control.key}" data-value="${value}" aria-pressed="${pressed}"` +
    ` aria-label="${buttonName(control.label, label)}"`;
  if (control.swatches === true) {
    const colour = greyColour(Number(value));
    return `<button type="button"${state} title="${label}" style="background: ${colour}"></button>`;
  }
  return `<button type="button"${state}>${label}</button>`;
}

/**
 * The Arrange rows, read from the action registry: Order always shows, aligning
 * needs two Elements selected and spreading three (`minSelected`), and a button
 * is disabled when the action's own rule says it has nothing it can move. So
 * the note and the palette cannot offer different things.
 */
function arrangeRows(elements: readonly Element[]): string {
  const state: ActionState = { selected: elements.length, movable: movableCount(elements) };
  const rows = (['Order', 'Arrange', 'Spread'] satisfies ActionGroup[])
    .map((group) => actRow(group, state))
    .filter((row) => row !== '');
  return `<div class="group">${rows.join('')}</div>`;
}

function actRow(group: ActionGroup, state: ActionState): string {
  const actions = ACTIONS.filter(
    (action) => action.group === group && state.selected >= action.minSelected,
  );
  if (actions.length === 0) {
    return '';
  }
  const markup = actions
    .map(
      (action) =>
        `<button type="button" data-act="${action.id}"` +
        `${action.reason(state) === null ? '' : ' disabled'} aria-label="${action.name}">` +
        `${action.name.slice(action.name.indexOf(': ') + 2)}</button>`,
    )
    .join('');
  return (
    `<div class="row"><span class="row-label">${group}</span>` +
    `<div class="acts" role="group" aria-label="${group}">${markup}</div></div>`
  );
}

/** An Element id, escaped: the note shows it, and an id is the author's text. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
