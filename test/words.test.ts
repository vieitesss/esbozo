/**
 * Seam 4: the step between the words a field holds and the words the page draws.
 *
 * A caret's offset is read from the field and drawn on glyphs the Renderer
 * placed from the words the Scene keeps. Between the two sit the blanks a trim
 * drops and whatever the Scene refuses, and the step that maps one to the other
 * is measured here: it is the only place a refused character could carry the
 * caret past the glyph it was typed at.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';

const { wordsShift } = await loadProjectModules();

test('words the page drew whole are a step of nothing', () => {
  const shift = wordsShift('abc', 'abc');
  assert.deepEqual(
    [0, 1, 2, 3].map((offset) => shift.drawn(offset)),
    [0, 1, 2, 3],
    'every offset is its own glyph boundary',
  );
  assert.deepEqual(
    [0, 1, 2, 3].map((offset) => shift.typed(offset)),
    [0, 1, 2, 3],
    'and a boundary read back names its own offset',
  );
});

test('the blanks a trim drops are offsets in the field and no glyph on the page', () => {
  const shift = wordsShift('  abc ', 'abc');
  assert.equal(shift.drawn(2), 0, 'before the first letter the caret draws at the start');
  assert.equal(shift.drawn(3), 1, 'one blank less is one glyph in');
  assert.equal(shift.drawn(6), 3, 'and the trailing blank draws nothing past the words');
  assert.equal(shift.typed(0), 2, 'a press at the start names the offset after the blanks');
  assert.equal(shift.typed(3), 6, 'a press past the words names the end of the field');
});

test('a character the Scene refuses is an offset in the field and no glyph on the page', () => {
  // The words are `a<U+0001>bc`, which the page draws as `abc`: the refusal is
  // one offset further into the field and moves the caret nowhere.
  const shift = wordsShift('a\u0001bc', 'abc');
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((offset) => shift.drawn(offset)),
    [0, 1, 1, 2, 3],
    'the refused character is no glyph: the caret after it is the caret before it',
  );
  assert.equal(shift.typed(1), 2, 'a press after the first letter names the offset past it');
  assert.equal(shift.typed(2), 3, 'a press after the second letter names the one past that');
  for (let offset = 0; offset <= 4; offset += 1) {
    assert.equal(
      shift.drawn(shift.typed(shift.drawn(offset))),
      shift.drawn(offset),
      'read there and back, the caret stands on the same glyph',
    );
  }
});
