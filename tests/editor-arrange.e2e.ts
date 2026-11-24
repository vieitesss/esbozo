/**
 * Browser seam: Arrange and Spread — the layers an action steps a selection through,
 * the edges and middles it lines them up on, and the gaps it evens out. The
 * answer is the saved geometry, never a path number.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  ARRANGE,
  ARRANGE_SCENE,
  LACED,
  LACED_SCENE,
  PINNED,
  PINNED_SCENE,
  UNEVEN,
  UNEVEN_SCENE,
  SPREAD,
  SPREAD_SCENE,
  TETHER,
  TETHER_SCENE,
  THREE,
  at,
  clickScene,
  drag,
  openEditor,
  savedScene,
} from './helpers.ts';
import type { Ui } from './helpers.ts';
import { THREE_SOURCE, control } from './editor-shared.ts';

const SPREAD_SOURCE = JSON.stringify(SPREAD_SCENE, null, 2);
const TETHER_SOURCE = JSON.stringify(TETHER_SCENE, null, 2);
const ARRANGE_SOURCE = JSON.stringify(ARRANGE_SCENE, null, 2);

const PINNED_SOURCE = JSON.stringify(PINNED_SCENE, null, 2);
const UNEVEN_SOURCE = JSON.stringify(UNEVEN_SCENE, null, 2);
const LACED_SOURCE = JSON.stringify(LACED_SCENE, null, 2);

async function savedLayerOrder(ui: Ui): Promise<string[]> {
  return (await savedScene(ui, 'three.json')).elements.map((element) => element.id);
}

test('Arrange moves the selection through the layers and leaves its geometry alone', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'three.json': THREE_SOURCE } }, 'three.json');

  // Select the middle one by itself.
  await clickScene(ui, { x: 200, y: 220 }, [], THREE);

  await control(ui, 'Order: front').click();
  expect(await savedLayerOrder(ui)).toEqual(['p', 'r', 'q']);

  await control(ui, 'Order: back').click();
  expect(await savedLayerOrder(ui)).toEqual(['q', 'p', 'r']);

  await control(ui, 'Order: forward').click();
  expect(await savedLayerOrder(ui)).toEqual(['p', 'q', 'r']);

  await control(ui, 'Order: backward').click();
  expect(await savedLayerOrder(ui)).toEqual(['q', 'p', 'r']);

  // Layer order is not geometry: every box keeps the box it had.
  const scene = await savedScene(ui, 'three.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(['p', 'q', 'r'].map((id) => [saved.get(id)?.x, saved.get(id)?.y])).toEqual([
    [40, 40],
    [160, 200],
    [400, 100],
  ]);
});

test('Arrange steps two adjacent layers together, and not at all at the boundary', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'three.json': THREE_SOURCE } }, 'three.json');

  // The two front-most layers: `forward` has nowhere to move them past.
  await clickScene(ui, { x: 200, y: 220 }, [], THREE);
  await clickScene(ui, { x: 420, y: 120 }, ['Shift'], THREE);
  await control(ui, 'Order: forward').click();
  expect(await savedLayerOrder(ui)).toEqual(['p', 'q', 'r']);

  // `backward` takes both down one layer and keeps them in the order they had.
  await control(ui, 'Order: backward').click();
  expect(await savedLayerOrder(ui)).toEqual(['q', 'r', 'p']);

  // They are the two back-most now, so `backward` has nowhere to go either.
  await control(ui, 'Order: backward').click();
  expect(await savedLayerOrder(ui)).toEqual(['q', 'r', 'p']);
});

test('Arrange lines the selection up on each edge and in each middle', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'three.json': THREE_SOURCE } }, 'three.json');

  /** Every selected box's top left, as saved. */
  const corners = async () => {
    const scene = await savedScene(ui, 'three.json');
    const saved = new Map(scene.elements.map((element) => [element.id, element]));
    return ['p', 'q', 'r'].map((id) => [saved.get(id)?.x, saved.get(id)?.y]);
  };

  // A box around all three, clear of the rail and the note.
  await drag(ui, at({ x: 10, y: 10 }, THREE), at({ x: 490, y: 270 }, THREE));
  await expect(control(ui, 'Arrange: left')).toBeVisible();

  await control(ui, 'Arrange: left').click();
  expect(await corners()).toEqual([
    [40, 40],
    [40, 200],
    [40, 100],
  ]);

  await control(ui, 'Arrange: right').click();
  expect(await corners()).toEqual([
    [40, 40],
    [60, 200],
    [80, 100],
  ]);

  await control(ui, 'Arrange: top').click();
  expect(await corners()).toEqual([
    [40, 40],
    [60, 40],
    [80, 40],
  ]);

  await control(ui, 'Arrange: bottom').click();
  expect(await corners()).toEqual([
    [40, 40],
    [60, 60],
    [80, 40],
  ]);

  await control(ui, 'Arrange: centre').click();
  expect(await corners()).toEqual([
    [40, 40],
    [50, 60],
    [60, 40],
  ]);

  await control(ui, 'Arrange: middle').click();
  expect(await corners()).toEqual([
    [40, 40],
    [50, 50],
    [60, 40],
  ]);
});

test('Arrange spreads the selection with equal gaps on each axis', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'three.json': THREE_SOURCE } }, 'three.json');
  // A box around all three: Arrange needs two, Spread needs three.
  await drag(ui, at({ x: 10, y: 10 }, THREE), at({ x: 490, y: 270 }, THREE));

  // Left to right: 40, 400 and 40 wide 100, 80, 60. The outer two stay put and
  // the gaps even out at 90, so the middle one moves from 160 to 230.
  await control(ui, 'Spread: horizontal').click();
  // Top to bottom: 40, 100 and 200 tall 60, 60, 40; the gaps even out at 20, so
  // the middle of the three moves from 100 to 120.
  await control(ui, 'Spread: vertical').click();

  const scene = await savedScene(ui, 'three.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(['p', 'q', 'r'].map((id) => [saved.get(id)?.x, saved.get(id)?.y])).toEqual([
    [40, 40],
    [230, 200],
    [400, 120],
  ]);
});

test('Spread spaces boxes too wide for their gaps by their centres, never backwards', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'spread.json': SPREAD_SOURCE } }, 'spread.json');

  await clickScene(ui, { x: 5, y: 70 }, [], SPREAD);
  await clickScene(ui, { x: 40, y: 50 }, ['Shift'], SPREAD);
  await clickScene(ui, { x: 65, y: 90 }, ['Shift'], SPREAD);
  await control(ui, 'Spread: horizontal').click();

  // The middle box is 100 wide in a 70-wide span, so equal edge gaps would be
  // -25 and the starts would run backwards. The two outermost keep 0 and 60,
  // and the centres even out instead: 5, 35, 65, so the wide box lands on -15.
  const scene = await savedScene(ui, 'spread.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(['lead', 'wide', 'tail'].map((id) => saved.get(id)?.x)).toEqual([0, -15, 60]);
  expect(['lead', 'wide', 'tail'].map((id) => saved.get(id)?.width)).toEqual([10, 100, 10]);
});

test('Spread leaves a row alone when its pinned outer centres leave no room to walk forward', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'pinned.json': PINNED_SOURCE } }, 'pinned.json');

  // (0,200), (35,10), (70,10): the leading box is wider than the span, so its
  // middle is at 100 and the tail's at 75. Even middles would run the row
  // backwards, and spreading through the edges would cross them: nothing moves.
  await clickScene(ui, { x: 100, y: 60 }, [], PINNED);
  await clickScene(ui, { x: 40, y: 70 }, ['Shift'], PINNED);
  await clickScene(ui, { x: 75, y: 70 }, ['Shift'], PINNED);
  await control(ui, 'Spread: horizontal').click();

  const scene = await savedScene(ui, 'pinned.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(['lead', 'mid', 'tail'].map((id) => saved.get(id)?.x)).toEqual([0, 35, 70]);
  expect(scene.elements.map((element) => element.id)).toEqual(['lead', 'mid', 'tail']);
});

test('Spread spaces a negative gap by its centres even when the outer widths differ', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'uneven.json': UNEVEN_SOURCE } }, 'uneven.json');

  await clickScene(ui, { x: 20, y: 70 }, [], UNEVEN);
  await clickScene(ui, { x: 65, y: 50 }, ['Shift'], UNEVEN);
  await clickScene(ui, { x: 100, y: 90 }, ['Shift'], UNEVEN);
  await control(ui, 'Spread: horizontal').click();

  // 40, 70 and 20 wide across a 110 span, so equal edge gaps would be -10. The
  // outer two keep 0 and 90 and their middles 20 and 100 anchor the row: the
  // middle box's middle lands on 60, which moves it from 30 to 25.
  const scene = await savedScene(ui, 'uneven.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(['lead', 'broad', 'tail'].map((id) => saved.get(id)?.x)).toEqual([0, 25, 90]);
  expect(['lead', 'broad', 'tail'].map((id) => saved.get(id)?.width)).toEqual([40, 70, 20]);
});

test('Spread evens boxes and moves a Snapped line’s free end', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'laced.json': LACED_SOURCE } }, 'laced.json');

  // Three boxes 60 wide at 40, 180 and 420, plus a line Snapped at its left end.
  await clickScene(ui, { x: 70, y: 70 }, [], LACED);
  await clickScene(ui, { x: 210, y: 70 }, ['Shift'], LACED);
  await clickScene(ui, { x: 450, y: 70 }, ['Shift'], LACED);
  await clickScene(ui, { x: 140, y: 70 }, ['Shift'], LACED);
  await control(ui, 'Spread: horizontal').click();

  // The line's free end moves, as the body drag moves it, so its drawn 80-unit
  // run is one of the four boxes Spread evens out: the outer two keep 40 and
  // 420 and the gaps even out at 60, which moves the middle box from 180 to 300
  // and the line's free end from 180 to 240. The line's Snapped end stays where
  // it draws on the box it holds.
  const scene = await savedScene(ui, 'laced.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(['frame', 'post', 'beam'].map((id) => saved.get(id)?.x)).toEqual([40, 300, 420]);
  expect(saved.get('tie')?.points).toEqual([
    { x: 100, y: 70, snap: 'frame' },
    { x: 240, y: 70 },
  ]);
  expect(scene.elements.map((element) => element.id)).toEqual(['frame', 'post', 'beam', 'tie']);
});

test('Arrange moves a Snapped line’s free end and leaves its Snaps where they draw', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'tether.json': TETHER_SOURCE } }, 'tether.json');

  // All four: the two rectangles and the line with a free end can be lined up,
  // and the line Snapped at both ends cannot.
  await clickScene(ui, { x: 110, y: 70 }, [], TETHER);
  await clickScene(ui, { x: 310, y: 70 }, ['Shift'], TETHER);
  await clickScene(ui, { x: 390, y: 70 }, ['Shift'], TETHER);
  await clickScene(ui, { x: 210, y: 70 }, ['Shift'], TETHER);
  await control(ui, 'Arrange: left').click();

  const scene = await savedScene(ui, 'tether.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect([saved.get('frame')?.x, saved.get('post')?.x]).toEqual([60, 60]);
  // The line Snapped at one end follows the body drag's rule: its free end moves
  // with the line-up and its Snapped end stays where it draws, so the Snap and
  // the target it names are the Scene's still. The line Snapped at both ends has
  // no end Arrange may move, so it is left exactly as it was.
  expect(saved.get('tether')?.points).toEqual([
    { x: 260, y: 70, snap: 'post' },
    { x: 120, y: 70 },
  ]);
  expect(saved.get('weft')?.points).toEqual([
    { x: 160, y: 70, snap: 'frame' },
    { x: 260, y: 70, snap: 'post' },
  ]);
});

test('Arrange offers a disabled action when nothing it can move is selected', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'tether.json': TETHER_SOURCE } }, 'tether.json');

  // The line Snapped at both ends has no end Arrange could move, and the one
  // Snapped at one end has only its free end: that one is not two Elements, so
  // its buttons are offered but disabled. Order still applies, because a layer
  // is a position in the list and not a place on the page.
  await clickScene(ui, { x: 390, y: 70 }, [], TETHER);
  await clickScene(ui, { x: 210, y: 70 }, ['Shift'], TETHER);
  await expect(control(ui, 'Arrange: left')).toBeDisabled();
  await expect(control(ui, 'Arrange: middle')).toBeDisabled();
  await expect(control(ui, 'Order: front')).toBeEnabled();
});

/**
 * `TETHER_SCENE`'s frame and a line whose end writes `"snap": false`: a free end
 * that remembers it carries no Snap, drawn exactly like one that says nothing.
 */
const LOOSE_SCENE = {
  version: 1,
  title: 'Loose',
  defaults: { roughness: 1 },
  elements: [
    { id: 'frame', type: 'rectangle', x: 60, y: 40, width: 100, height: 60 },
    {
      id: 'tether',
      type: 'line',
      points: [
        { x: 260, y: 70, snap: false },
        { x: 420, y: 70 },
      ],
      heads: { start: 'none', end: 'none' },
    },
  ],
};
const LOOSE_SOURCE = JSON.stringify(LOOSE_SCENE, null, 2);

test('Arrange moves a line whose end writes "snap": false, as it moves a free one', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'loose.json': LOOSE_SOURCE } }, 'loose.json');

  // The box and the line: an end that draws like no Snap at all follows nothing,
  // so the line is an Element Arrange may move and the action is offered.
  await clickScene(ui, { x: 110, y: 70 }, [], TETHER);
  await clickScene(ui, { x: 340, y: 70 }, ['Shift'], TETHER);
  await expect(control(ui, 'Arrange: left')).toBeEnabled();
  await control(ui, 'Arrange: left').click();

  const scene = await savedScene(ui, 'loose.json');
  const saved = new Map(scene.elements.map((element) => [element.id, element]));
  expect(saved.get('frame')?.x).toBe(60);
  expect(saved.get('tether')?.points).toEqual([
    { x: 60, y: 70, snap: false },
    { x: 220, y: 70 },
  ]);
});

test('Arrange lines mixed types up, and spreads them without reordering them', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  const open = () => openEditor(ui, { A: { 'arrange.json': ARRANGE_SOURCE } }, 'arrange.json');
  /** All four: a Text, two rectangles and a free arrow. */
  const selectAll = async () => {
    await clickScene(ui, { x: 45, y: 50 }, [], ARRANGE);
    await clickScene(ui, { x: 250, y: 70 }, ['Shift'], ARRANGE);
    await clickScene(ui, { x: 370, y: 70 }, ['Shift'], ARRANGE);
    await clickScene(ui, { x: 490, y: 70 }, ['Shift'], ARRANGE);
  };

  await open();
  await selectAll();
  await control(ui, 'Arrange: left').click();
  let saved = new Map((await savedScene(ui, 'arrange.json')).elements.map((e) => [e.id, e]));
  // The Text's own left edge is the selection's left, so it stays and the rest
  // come to it: the arrow moves by the left end of its shaft.
  expect(['words', 'row-a', 'row-b'].map((id) => saved.get(id)?.x)).toEqual([40, 40, 40]);
  expect(saved.get('tail')?.points).toEqual([
    { x: 40, y: 70 },
    { x: 180, y: 70 },
  ]);

  // Spread keeps the Text and the arrow where they are, and evens the gaps
  // between what is left. The Text's width is Layout's to measure, so the gaps
  // between the boxes are compared with each other, from the saved bytes.
  await open();
  await selectAll();
  await control(ui, 'Spread: horizontal').click();
  const scene = await savedScene(ui, 'arrange.json');
  saved = new Map(scene.elements.map((e) => [e.id, e]));
  expect(saved.get('words')?.x).toBe(40);
  expect(saved.get('tail')?.points).toEqual([
    { x: 420, y: 70 },
    { x: 560, y: 70 },
  ]);
  const rowA = saved.get('row-a')?.x ?? 0;
  const rowB = saved.get('row-b')?.x ?? 0;
  expect(rowA).toBeGreaterThan(40);
  expect(rowB).toBeGreaterThan(rowA);
  expect(Math.abs(rowB - (rowA + 100) - (420 - (rowB + 100)))).toBeLessThanOrEqual(1);
  // Layer order is not Spread's to change.
  expect(scene.elements.map((element) => element.id)).toEqual([
    'words',
    'row-a',
    'row-b',
    'tail',
  ]);
});
