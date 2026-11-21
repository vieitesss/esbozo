/**
 * Seam 2: the listing the save API sends, as the page reads it.
 *
 * The page has no other guard: a server that answers 200 with anything else has
 * to reach the status line, not become a folder the editor shows as writable. So
 * every field is checked here, and a wrong type is no listing at all.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listingOf } from '../src/scenes-api.ts';

test('a listing reads back as its folder, its Scenes and whether writes are refused', () => {
  const listing = { folder: 'sketches', readOnly: true, scenes: ['a.json', 'b.json'] };
  assert.deepEqual(listingOf(JSON.stringify(listing)), listing);

  const writable = { folder: 'sketches', readOnly: false, scenes: [] };
  assert.deepEqual(listingOf(JSON.stringify(writable)), writable);
});

test('a body that is not a listing is nothing, never a writable folder', () => {
  for (const body of [
    'not json at all',
    '<html>not the save API</html>',
    'null',
    '[]',
    '"a folder"',
    JSON.stringify({ folder: 'f', scenes: [] }),
    JSON.stringify({ folder: 'f', readOnly: 'true', scenes: [] }),
    JSON.stringify({ folder: 'f', readOnly: 1, scenes: [] }),
    JSON.stringify({ folder: 'f', readOnly: null, scenes: [] }),
    JSON.stringify({ readOnly: false, scenes: [] }),
    JSON.stringify({ folder: 3, readOnly: false, scenes: [] }),
    JSON.stringify({ folder: 'f', readOnly: false }),
    JSON.stringify({ folder: 'f', readOnly: false, scenes: 'a.json' }),
    JSON.stringify({ folder: 'f', readOnly: false, scenes: [1] }),
  ]) {
    assert.equal(listingOf(body), null, `${body} is not a listing`);
  }
});
