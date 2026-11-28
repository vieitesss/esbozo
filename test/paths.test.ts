/** Module seam: the Scene file rules `src/paths.ts` owns. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  listedAsScene,
  pngFileName,
  sceneListing,
  sceneNameProblem,
  svgFileName,
} from '../src/paths.ts';

test('a name that is no Scene name says why, in the served folder\u2019s words', () => {
  assert.equal(sceneNameProblem(''), 'the Scene name is missing');
  assert.equal(
    sceneNameProblem('sketches/sketch.esbozo'),
    'sketches/sketch.esbozo: name a Scene in the folder, not a path',
  );
  assert.equal(
    sceneNameProblem('sketches\\sketch.esbozo'),
    'sketches\\sketch.esbozo: name a Scene in the folder, not a path',
  );
  for (const name of ['.', '..', '.hidden.esbozo']) {
    assert.equal(
      sceneNameProblem(name),
      `${name}: name a Scene file, not a hidden or relative one`,
    );
  }
  assert.equal(
    sceneNameProblem('sketch'),
    'sketch: a Scene file ends in .esbozo or .json',
  );
  assert.equal(
    sceneNameProblem('sketch.png'),
    'sketch.png: a Scene file ends in .esbozo or .json',
  );
});

test('a name that is a Scene name has no problem, whatever its case', () => {
  for (const name of ['sketch.esbozo', 'sketch.json', 'SKETCH.ESBOZO', 'a b.json']) {
    assert.equal(sceneNameProblem(name), null, name);
  }
});

test('a Scene is listed by its name alone, or by reading it too', () => {
  assert.equal(sceneListing('sketch.esbozo'), 'always');
  assert.equal(sceneListing('SKETCH.ESBOZO'), 'always');
  assert.equal(sceneListing('sketch.json'), 'if-scene');
  assert.equal(sceneListing('sketch.txt'), 'never');
  assert.equal(sceneListing('sketch'), 'never');
});

test('only a .json name has the folder read the file it lists', async () => {
  const read: string[] = [];
  const reads = async (name: string): Promise<boolean> => {
    read.push(name);
    return true;
  };
  assert.equal(await listedAsScene('sketch.esbozo', reads), true);
  assert.equal(await listedAsScene('sketch.txt', reads), false);
  assert.deepEqual(read, [], 'neither name has the file read');
  assert.equal(await listedAsScene('sketch.json', reads), true);
  assert.deepEqual(read, ['sketch.json']);
});

test('a PNG is the Scene\u2019s stem, its theme and .png', () => {
  assert.equal(pngFileName('sketch.esbozo', 'light'), 'sketch.light.png');
  assert.equal(pngFileName('sketch.json', 'dark'), 'sketch.dark.png');
  assert.equal(pngFileName('sketch', 'light'), 'sketch.light.png');
  assert.equal(svgFileName('sketch.json'), 'sketch.svg');
});
