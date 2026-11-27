/**
 * Module seam: the listing the save API sends, as the page reads it.
 *
 * The page has no other guard: a server that answers 200 with anything else has
 * to reach the status line, not become a folder the editor shows as writable. So
 * every field is checked here, and a wrong type is no listing at all.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listingOf, problemIn, Refusal } from '../src/scenes-api.ts';

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

test('a refusal reads back as the server worded it, or as the status it came with', () => {
  assert.equal(problemIn('{"error":"the folder is unreadable"}', 500, 'the folder'), 'the folder is unreadable');
  assert.equal(problemIn('not json', 404, 'scene.json'), 'scene.json: 404 not json');
  assert.equal(problemIn('{}', 500, 'the folder'), 'the folder: 500 {}');
  assert.equal(problemIn('{"error":""}', 500, 'the folder'), 'the folder: 500 {"error":""}');
});

test('a refusal carries the status that refused it, so a page can act on it', () => {
  // The status line reads the same words either way; what the editor needs is
  // the number, because a `403` makes the page read-only rather than retry.
  const refused = new Refusal('{"error":"this folder is served read-only"}', 403, 'scene.json');
  assert.equal(refused.message, 'this folder is served read-only');
  assert.equal(refused.status, 403);
  assert.ok(refused instanceof Error);
});
