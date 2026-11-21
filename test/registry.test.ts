/**
 * Seam 1: the action registry, read as data.
 *
 * The registry is the one list the rail, the palette, the Style menu and the
 * key handler read, so this seam asks the questions those four would otherwise
 * answer differently: does one key pick two actions, do the digits follow the
 * rail, does a row say what it is waiting for, and does the shortcut a person
 * reads name every key that does it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS, TOOLS, actionById, actionFor } from '../src/editor/actions.ts';
import type { ActionState, EditorAction } from '../src/editor/actions.ts';

/** A state with nothing selected, no history and the Clipboard API present. */
const IDLE: ActionState = { selected: 0, movable: 0, canUndo: false, canRedo: false, clipboard: true };

/** The key a binding answers, as one string, so two bindings can be compared. */
function bindingKey(action: EditorAction, index: number): string {
  const binding = action.bindings[index]!;
  return `${binding.key}|${binding.meta === true}|${binding.shift === true}`;
}

test('every key in the registry picks one action, and no action picks a key twice', () => {
  const seen = new Map<string, string>();
  for (const action of ACTIONS) {
    action.bindings.forEach((_, index) => {
      const key = bindingKey(action, index);
      const other = seen.get(key);
      assert.equal(other, undefined, `${key} is claimed by ${action.id} and ${other}`);
      seen.set(key, action.id);
    });
  }
  // The digit of the first tool is a binding like any other, so it is here.
  assert.equal(actionFor({ key: '1', metaKey: false, ctrlKey: false, shiftKey: false })?.id, 'select');
});

test('the digits follow the rail order, one list for the tools and the keys', () => {
  const railOrder = TOOLS.map((tool) => tool.id);
  assert.deepEqual(railOrder, [
    'select',
    'rectangle',
    'ellipse',
    'diamond',
    'arrow',
    'line',
    'text',
  ]);
  TOOLS.forEach((tool, index) => {
    const digit = String(index + 1);
    const answers = actionFor({ key: digit, metaKey: false, ctrlKey: false, shiftKey: false });
    assert.equal(answers?.id, tool.id, `digit ${digit} picks ${tool.id}`);
    assert.equal(tool.primary, tool.shortcut.split(' · ')[0], `${tool.id} names its letter first`);
  });
});

test('zoom, fit and Open folder are actions, with the keys that do them', () => {
  assert.equal(actionById('zoom-in')?.shortcut, '⌘+');
  assert.equal(actionById('zoom-out')?.shortcut, '⌘−');
  assert.equal(actionById('zoom-fit')?.shortcut, '⌘0');
  assert.equal(actionById('zoom-reset')?.name, 'Reset zoom');
  assert.equal(actionById('open-folder')?.name, 'Open folder…');

  // The keys the editor used to answer on its own now come from the registry.
  const pressed = (key: string) => actionFor({ key, metaKey: true, ctrlKey: false, shiftKey: false })?.id;
  assert.equal(pressed('+'), 'zoom-in');
  assert.equal(pressed('='), 'zoom-in');
  assert.equal(pressed('-'), 'zoom-out');
  assert.equal(pressed('0'), 'zoom-fit');
});

test('a row that needs a selection says so, Order included', () => {
  for (const id of ['order-back', 'order-backward', 'order-forward', 'order-front', 'delete']) {
    const action = actionById(id);
    assert.equal(action?.reason(IDLE), 'select an Element first', `${id} says why it cannot run`);
  }
  const selected: ActionState = { ...IDLE, selected: 1, movable: 1 };
  assert.equal(actionById('order-front')?.reason(selected), null);
});

test('Copy, Cut and Paste say how to use the keys when the page has no clipboard', () => {
  const noClipboard: ActionState = { ...IDLE, selected: 1, clipboard: false };
  for (const id of ['copy', 'cut', 'paste']) {
    assert.equal(actionById(id)?.reason(noClipboard), 'use ⌘C / ⌘V', `${id} explains the limit`);
  }
  assert.equal(actionById('copy')?.reason({ ...noClipboard, clipboard: true }), null);
  assert.equal(actionById('cut')?.reason({ ...noClipboard, clipboard: true }), null);
  assert.equal(actionById('paste')?.reason({ ...noClipboard, clipboard: true }), null);
});

test('a row names its digit, its Backspace and its Delete beside the primary key', () => {
  assert.equal(TOOLS[0]?.shortcut, 'V · 1');
  assert.equal(TOOLS[6]?.shortcut, 'T · 7');
  assert.equal(actionById('delete')?.shortcut, 'X · ⌫ · Del');
  assert.equal(actionById('undo')?.shortcut, '⌘Z');
  assert.equal(actionById('redo')?.shortcut, '⇧⌘Z');
  // A clipboard action is the browser's own event, so it names its keys without
  // binding them: a key binding would race the event that carries the data.
  assert.equal(actionById('copy')?.shortcut, '⌘C');
  assert.deepEqual(actionById('copy')?.bindings, []);
});

test('the registry holds no gesture and no per-value style choice', () => {
  const ids = ACTIONS.map((action) => action.id);
  assert.deepEqual(ids.filter((id) => id.includes('nudge')), []);
  assert.deepEqual(ids.filter((id) => id.includes('style')), []);
  assert.deepEqual(ACTIONS.filter((action) => /nudge|style/i.test(action.name)).map((a) => a.name), []);
});
