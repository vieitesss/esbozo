/**
 * Seam 3: undo and redo over whole Scenes.
 *
 * A step is the Scene as autosave writes it, so this seam drives the history
 * with strings and checks what it keeps: 200 steps, and a total size a long
 * session cannot grow past.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';

const { History } = await loadProjectModules();

/** A Scene-like step of the given size in bytes. */
function step(kilobytes: number): string {
  return 'x'.repeat(kilobytes * 1024);
}

test('the history keeps the last 200 steps', () => {
  const history = new History(step(1));
  for (let index = 1; index <= 250; index += 1) {
    assert.equal(history.record(step(1) + index), true);
  }
  let undone = 0;
  while (history.undo() !== null) {
    undone += 1;
  }
  assert.equal(undone, 200);
});

test('the history drops its oldest steps when the total size passes 4 MiB', () => {
  const history = new History(step(1024));
  for (let index = 1; index <= 6; index += 1) {
    history.record(`${step(1024)}${index}`);
  }
  let undone = 0;
  while (history.undo() !== null) {
    undone += 1;
  }
  // Seven 1 MiB Scenes would be 7 MiB: only three steps fit in 4 MiB, so two
  // of them can be undone.
  assert.equal(undone, 2);
});

test('a change that leaves the Scene as it was records nothing', () => {
  const present = step(1);
  const history = new History(present);
  assert.equal(history.record(present), false);
  assert.equal(history.undo(), null);
});
