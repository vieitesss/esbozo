/**
 * Module seam: the Rail exception to rule 4: `rail.ts` owns the Rail's floating
 * placement maths and stored-place preference with supplied measurements, so
 * Node tests can prove them directly.
 *
 * Proves the corner-to-corner diagonal split, the 16px hold band, fit fallback,
 * 16px inset clamping, status chrome clearance, edge middles, and preference
 * round-trip / migration / fallback.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';
import type { Box } from '../src/editor/geometry.ts';

const { railOrientation, placeRail, railEdgeMiddle, readRailPlace, writeRailPlace } =
  await loadProjectModules();

const OUTLINES = {
  lying: { width: 246, height: 63, overhang: 7 },
  standing: { width: 63, height: 246, overhang: 7 },
};

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

function throwingStorage(): Storage {
  const fail = (): never => {
    throw new Error('storage blocked');
  };
  return {
    get length() {
      return 0;
    },
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
}

test('corner-to-corner diagonals split a wide box into lying (top/bottom) and standing (left/right)', () => {
  const wide = { width: 1200, height: 600 };
  assert.equal(railOrientation({ x: 600, y: 100 }, wide), 'lying');
  assert.equal(railOrientation({ x: 600, y: 500 }, wide), 'lying');
  assert.equal(railOrientation({ x: 100, y: 300 }, wide), 'standing');
  assert.equal(railOrientation({ x: 1100, y: 300 }, wide), 'standing');
  // Just above/below the top-left -> bottom-right diagonal (y = 0.5 * x):
  assert.equal(railOrientation({ x: 300, y: 100 }, wide), 'lying');
  assert.equal(railOrientation({ x: 300, y: 200 }, wide), 'standing');
});

test('corner-to-corner diagonals split a tall box into lying (top/bottom) and standing (left/right)', () => {
  const tall = { width: 600, height: 1200 };
  assert.equal(railOrientation({ x: 300, y: 100 }, tall), 'lying');
  assert.equal(railOrientation({ x: 300, y: 1100 }, tall), 'lying');
  assert.equal(railOrientation({ x: 100, y: 600 }, tall), 'standing');
  assert.equal(railOrientation({ x: 500, y: 600 }, tall), 'standing');
  // Steep diagonal (y = 2 * x): (150, 200) is above -> lying; (150, 400) is below -> standing.
  assert.equal(railOrientation({ x: 150, y: 200 }, tall), 'lying');
  assert.equal(railOrientation({ x: 150, y: 400 }, tall), 'standing');
});

test('current orientation holds within 16px perpendicular distance of either diagonal and flips past 16px', () => {
  // 3:4 box (600x800) has diagonal length 1000, so unit normal to (0,0)->(600,800) is (-0.8, 0.6).
  const box = { width: 600, height: 800 };
  // Point on diagonal: (150, 200). Moving by d * (-0.8, 0.6) moves d px into the standing space.
  const at = (d: number) => ({ x: 150 - 0.8 * d, y: 200 + 0.6 * d });

  assert.equal(railOrientation(at(0), box, 'lying'), 'lying');
  assert.equal(railOrientation(at(15.5), box, 'lying'), 'lying');
  assert.equal(railOrientation(at(16.5), box, 'lying'), 'standing');

  // Moving into the lying space from the same diagonal point:
  const intoLying = (d: number) => ({ x: 150 + 0.8 * d, y: 200 - 0.6 * d });
  assert.equal(railOrientation(intoLying(15.5), box, 'standing'), 'standing');
  assert.equal(railOrientation(intoLying(16.5), box, 'standing'), 'lying');
});

test('placeRail falls back to the other orientation when the requested one does not fit, and lies when neither fits', () => {
  // Short editor: standing (246 + 32 = 278) does not fit height 200; lying (63 + 32 = 95) fits.
  const shortEditor = { width: 800, height: 200 };
  const onShort = placeRail({ x: 100, y: 100 }, 'standing', OUTLINES, shortEditor, []);
  assert.equal(onShort.orientation, 'lying');

  // Narrow editor: lying (246 + 32 = 278) does not fit width 200; standing (63 + 32 = 95) fits.
  const narrowEditor = { width: 200, height: 800 };
  const onNarrow = placeRail({ x: 100, y: 100 }, 'lying', OUTLINES, narrowEditor, []);
  assert.equal(onNarrow.orientation, 'standing');

  // Tiny editor: neither fits -> falls back to lying.
  const tinyEditor = { width: 200, height: 200 };
  const onTiny = placeRail({ x: 100, y: 100 }, 'standing', OUTLINES, tinyEditor, []);
  assert.equal(onTiny.orientation, 'lying');
});

test('placeRail clamps the pencil outline 16px inside all four corners', () => {
  const editor = { width: 1000, height: 700 };
  const { width, height, overhang } = OUTLINES.lying;

  const topLeft = placeRail({ x: 0, y: 0 }, 'lying', OUTLINES, editor, []);
  assert.equal(topLeft.x - overhang, 16);
  assert.equal(topLeft.y - overhang, 16);
  assert.deepEqual(topLeft.centre, { x: 16 + width / 2, y: 16 + height / 2 });

  const bottomRight = placeRail({ x: 1000, y: 700 }, 'lying', OUTLINES, editor, []);
  assert.equal(bottomRight.x - overhang + width, editor.width - 16);
  assert.equal(bottomRight.y - overhang + height, editor.height - 16);
  assert.deepEqual(bottomRight.centre, {
    x: editor.width - 16 - width / 2,
    y: editor.height - 16 - height / 2,
  });
});

test('placeRail moves the strip clear of status chrome boxes while staying inside the inset', () => {
  const editor = { width: 1000, height: 700 };
  const chrome: Box[] = [
    { x: 0, y: 0, width: 180, height: 48 },
    { x: 820, y: 650, width: 180, height: 50 },
  ];
  const placed = placeRail({ x: 80, y: 30 }, 'lying', OUTLINES, editor, chrome);
  const outline: Box = {
    x: placed.x - OUTLINES.lying.overhang,
    y: placed.y - OUTLINES.lying.overhang,
    width: OUTLINES.lying.width,
    height: OUTLINES.lying.height,
  };
  assert.ok(outline.x >= 16 && outline.y >= 16);
  assert.ok(outline.x + outline.width <= editor.width - 16);
  assert.ok(outline.y + outline.height <= editor.height - 16);
  for (const box of chrome) {
    const overlaps =
      outline.x < box.x + box.width &&
      outline.x + outline.width > box.x &&
      outline.y < box.y + box.height &&
      outline.y + outline.height > box.y;
    assert.equal(overlaps, false);
  }
});

test('railEdgeMiddle returns the middle of each edge, 16px in, with the matching orientation', () => {
  const editor = { width: 1000, height: 700 };

  const top = railEdgeMiddle('top', OUTLINES, editor);
  assert.equal(top.orientation, 'lying');
  assert.deepEqual(top.centre, { x: 500, y: 16 + OUTLINES.lying.height / 2 });

  const bottom = railEdgeMiddle('bottom', OUTLINES, editor);
  assert.equal(bottom.orientation, 'lying');
  assert.deepEqual(bottom.centre, { x: 500, y: 700 - 16 - OUTLINES.lying.height / 2 });

  const left = railEdgeMiddle('left', OUTLINES, editor);
  assert.equal(left.orientation, 'standing');
  assert.deepEqual(left.centre, { x: 16 + OUTLINES.standing.width / 2, y: 350 });

  const right = railEdgeMiddle('right', OUTLINES, editor);
  assert.equal(right.orientation, 'standing');
  assert.deepEqual(right.centre, { x: 1000 - 16 - OUTLINES.standing.width / 2, y: 350 });
});

test('readRailPlace and writeRailPlace round-trip fractions + orientation, migrate old side words, and fall back on garbage', () => {
  const storage = memoryStorage();
  assert.deepEqual(readRailPlace(storage), { kind: 'edge', side: 'top' });

  writeRailPlace({ x: 0.25, y: 0.75, orientation: 'standing' }, storage);
  assert.deepEqual(readRailPlace(storage), {
    kind: 'at',
    x: 0.25,
    y: 0.75,
    orientation: 'standing',
  });

  // Old bare side words map to that edge's middle.
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    storage.setItem('esbozo.rail', side);
    assert.deepEqual(readRailPlace(storage), { kind: 'edge', side });
  }

  // Garbage, out-of-range fractions, bad orientation, or throwing storage fall back to top edge.
  for (const bad of [
    '',
    'nowhere',
    '{not json',
    JSON.stringify({ x: -0.1, y: 0.5, orientation: 'lying' }),
    JSON.stringify({ x: 0.5, y: 1.2, orientation: 'lying' }),
    JSON.stringify({ x: 0.5, y: 0.5, orientation: 'diagonal' }),
    JSON.stringify({ x: '0.5', y: 0.5, orientation: 'lying' }),
  ]) {
    storage.setItem('esbozo.rail', bad);
    assert.deepEqual(readRailPlace(storage), { kind: 'edge', side: 'top' });
  }

  assert.deepEqual(readRailPlace(null), { kind: 'edge', side: 'top' });
  assert.deepEqual(readRailPlace(throwingStorage()), { kind: 'edge', side: 'top' });
  assert.doesNotThrow(() =>
    writeRailPlace({ x: 0.5, y: 0.5, orientation: 'lying' }, throwingStorage()),
  );
});
