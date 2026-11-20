/**
 * Seam 3: Layout, the module the editor calls while typing.
 *
 * `grow` is the one thing `ez` cannot reach: the editor grows an Element as its
 * Label is typed, and the CLI only reports what does not fit. So this seam
 * drives the module the editor loads, with the bundled font, and checks the
 * two things the editor relies on: the Element ends up big enough for its
 * words, and an Element without words is left exactly as it was.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';
import type { Element } from '../src/scene.ts';

const { parseScene, createLayout, measureFont, KALAM } = await loadProjectModules();

/** The editor measures with the font the host gave it; here that is Kalam. */
const LAYOUT = createLayout(measureFont(KALAM));

function element(scene: unknown, index = 0): Element {
  const result = parseScene(JSON.stringify(scene));
  if (!result.ok) {
    throw new Error(`Scene did not parse: ${result.problems.map((p) => p.message).join('; ')}`);
  }
  return result.scene.elements[index]!;
}

function oneElement(element: Record<string, unknown>): unknown {
  return { version: 1, elements: [{ id: 'a', type: 'rectangle', x: 40, y: 40, width: 120, height: 60, ...element }] };
}

test('growing a rectangle ends with a Label that fits', () => {
  const box = element(oneElement({ label: 'orders and invoices for the autumn release' }));
  assert.ok(LAYOUT.overflow(box) !== null, 'the Label does not fit the box the author drew');

  const grown = LAYOUT.grow(box);

  assert.equal(grown.type, 'rectangle');
  assert.equal(LAYOUT.overflow(grown), null, 'the grown Element holds its Label');
  assert.ok(grown.type === 'rectangle');
  assert.ok(grown.height > 60, `the Element grew taller: ${grown.height}`);
  assert.equal(grown.width, 120, 'full lines only needed height');
  assert.equal(grown.x, 40, 'growth never moves the Element');
  assert.equal(grown.y, 40);
  assert.equal(grown.label, 'orders and invoices for the autumn release', 'the words are untouched');
});

test('a word wider than the Element grows it wider', () => {
  const box = element(oneElement({ width: 100, height: 200, label: 'Donaudampfschifffahrtsgesellschaft' }));
  const grown = LAYOUT.grow(box);

  assert.ok(grown.type === 'rectangle');
  assert.ok(grown.width > 100, `the Element grew wider: ${grown.width}`);
  assert.equal(grown.height, 200, 'one long word only needed width');
  assert.equal(LAYOUT.overflow(grown), null);
  assert.equal(LAYOUT.overflow(box)?.message.includes('the longest line needs'), true);
});

test('an ellipse and a diamond grow until the words fit their middle', () => {
  for (const type of ['ellipse', 'diamond'] as const) {
    const shape = element(
      oneElement({ type, width: 180, height: 110, label: 'the very middle of a round shape' }),
    );
    assert.ok(LAYOUT.overflow(shape) !== null, `the ${type}'s middle is too small`);

    const grown = LAYOUT.grow(shape);

    assert.equal(LAYOUT.overflow(grown), null, `the grown ${type} holds its Label`);
    assert.ok(grown.type === type);
    assert.ok(grown.width >= 180 && grown.height > 110, `the ${type} grew into its Label`);
  }
});

test('growing the same Element twice changes nothing the second time', () => {
  const box = element(oneElement({ label: 'orders and invoices for the autumn release' }));
  const once = LAYOUT.grow(box);
  const twice = LAYOUT.grow(once);

  assert.deepEqual(twice, once, 'an Element that fits is already as small as growth makes it');
});

test('an Element without a Label, a Text and an arrow come back unchanged', () => {
  const bare = element(oneElement({}));
  const words = element({ version: 1, elements: [{ id: 't', type: 'text', x: 10, y: 10, content: 'Words' }] });
  const arrow = element(
    {
      version: 1,
      elements: [
        { id: 'b', type: 'rectangle', x: 0, y: 0, width: 40, height: 40 },
        {
          id: 'arrow',
          type: 'arrow',
          points: [
            { x: 40, y: 20, snap: 'b' },
            { x: 200, y: 20 },
          ],
          label: 'and then',
        },
      ],
    },
    1,
  );

  assert.deepEqual(LAYOUT.grow(bare), bare);
  assert.deepEqual(LAYOUT.grow(words), words);
  assert.deepEqual(LAYOUT.grow(arrow), arrow, 'a shaft has no box to grow');
});
