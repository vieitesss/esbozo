/**
 * Module seam: Layout, the module the editor calls while typing.
 *
 * The CLI can report a Label that overflows, but it cannot grow an Element as
 * its words are typed, and it cannot show the box a Label occupies without
 * reading SVG tag structure. So this seam drives the module the editor loads,
 * with the bundled font, and asserts on what the module returns: the Lines it
 * places, the Block they fill, the box a shaft Label keeps clear of the line,
 * and the Element `grow` gives back.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import opentype from 'opentype.js';
import { fontBytes } from './fonts.ts';
import { loadProjectModules } from './modules.ts';
import type { Block, Box, LineGlyphs, Shaft } from '../src/layout.ts';
import type { Element, Point, TextElement } from '../src/scene.ts';

const { parseScene, createLayout, parseFontFile, KALAM } = await loadProjectModules();

/** The editor measures with the font the host gave it; here that is Kalam. */
const LAYOUT = createLayout(parseFontFile(KALAM));

/** Kalam parsed here, for the vertical metrics a test computes its own way. */
const kalam = opentype.parse(
  KALAM.buffer.slice(KALAM.byteOffset, KALAM.byteOffset + KALAM.byteLength) as ArrayBuffer,
);

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

/** A Text Element, so a test can read the Lines Layout places for it. */
function words(content: string, fontSize = 'M'): TextElement {
  return element({
    version: 1,
    elements: [{ id: 't', type: 'text', x: 10, y: 20, content, fontSize }],
  }) as TextElement;
}

/** An arrow Element between two points. */
function arrow(from: Point, to: Point): Element {
  return element({
    version: 1,
    elements: [{ id: 'a', type: 'arrow', points: [from, to], label: 'a shaft label' }],
  });
}

/**
 * The vertical metrics a font file gives, computed here from its own numbers:
 * the line height is its ascender, descender and line gap, and a line's ink is
 * centred on that same box.
 */
function vertical(bytes: Uint8Array, size: number): { lineHeight: number; inkCentre: number } {
  const font = opentype.parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  const os2 = font.tables.os2 ?? {};
  const unitsPerEm = font.unitsPerEm;
  const ascender = os2.sTypoAscender ?? font.ascender;
  const descender = os2.sTypoDescender ?? font.descender;
  const lineGap = os2.sTypoLineGap ?? 0;
  return {
    lineHeight: (size * (ascender - descender + lineGap)) / unitsPerEm,
    inkCentre: (size * (ascender + descender)) / (2 * unitsPerEm),
  };
}

/** The advance Kalam gives one line, so a test wraps words its own way. */
function kalamAdvance(text: string, size: number): number {
  return kalam.getAdvanceWidth(text, size, { kerning: true });
}

/** The greedy wrap the drawing has to make: a line takes words while they fit. */
function wrapped(text: string, width: number, size: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/[ \t]+/).filter((word) => word !== '');
    let line = words[0] ?? '';
    for (const word of words.slice(1)) {
      if (kalamAdvance(`${line} ${word}`, size) <= width) {
        line = `${line} ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** The four sides of `box` as segments, so a test can walk them. */
function sides(box: Box): [Point, Point][] {
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  return corners.map((corner, index) => [corner, corners[(index + 1) % 4]!]);
}

/** Whether two segments cross, allowing for an end that lies on the other. */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const ab1 = cross(a, b, c);
  const ab2 = cross(a, b, d);
  const cd1 = cross(c, d, a);
  const cd2 = cross(c, d, b);
  return ab1 * ab2 <= 0 && cd1 * cd2 <= 0;
}

/** Whether the shaft passes through the Label's box. */
function shaftTouches(box: Box, shaft: Shaft): boolean {
  return sides(box).some(([from, to]) => segmentsCross(shaft.start, shaft.end, from, to));
}

test('the line height and ink centre come from the font, not from Kalam', () => {
  const block = LAYOUT.text(words('one\ntwo'));
  const kalamMetrics = vertical(KALAM, 18);

  assert.equal(block.lines.length, 2);
  const gap = block.lines[1]!.baseline - block.lines[0]!.baseline;
  assert.ok(
    Math.abs(gap - kalamMetrics.lineHeight) < 0.001,
    `${gap}px between baselines, the font asks for ${kalamMetrics.lineHeight}px`,
  );
  assert.ok(
    Math.abs(block.height - 2 * kalamMetrics.lineHeight) < 0.001,
    'the block is as tall as its measured lines',
  );
  const ink = block.lines.map((line) => line.baseline - kalamMetrics.inkCentre);
  assert.ok(
    Math.abs((ink[0]! + ink[1]!) / 2 - (block.y + block.height / 2)) < 0.001,
    'the block is centred on the ink it drew',
  );

  const tallBytes = fontBytes({ ascender: 1800, descender: -200, glyphHeight: 1800 });
  const tall = createLayout(parseFontFile(tallBytes));
  const tallMetrics = vertical(tallBytes, 18);
  assert.ok(tallMetrics.lineHeight > kalamMetrics.lineHeight, 'the tall font asks for taller lines');
  const tallBlock = tall.text(words('one\ntwo'));
  const tallGap = tallBlock.lines[1]!.baseline - tallBlock.lines[0]!.baseline;
  assert.ok(Math.abs(tallGap - tallMetrics.lineHeight) < 0.001, 'the lines follow the tall font');
});

test('a font with tall glyphs overflows a box Kalam fits', () => {
  const box = element(oneElement({ width: 200, height: 50, label: 'Hamburgefonstiv' }));
  const tall = createLayout(parseFontFile(fontBytes({ ascender: 1800, descender: -200, glyphHeight: 1800 })));

  assert.equal(LAYOUT.overflow(box), null, 'Kalam fits its line in this box');
  assert.equal(LAYOUT.label(box)!.lines.length, 1, 'and the Label stays one line');

  const overflow = tall.overflow(box);
  assert.ok(overflow !== null, 'the tall font does not fit the same room');
  assert.match(overflow.message, /needs 36px, the text box is 30px tall/);
});

test('free-standing Text breaks where the author wrote, never at a box edge', () => {
  const long = Array.from({ length: 40 }, () => 'word').join(' ');
  const block = LAYOUT.text(words(`first\n${long}`));

  assert.equal(block.lines.length, 2, 'one newline, one break');
  assert.equal(block.lines[0]!.text, 'first');
  assert.equal(block.lines[1]!.text, long, 'a long line is measured once and kept whole');
  assert.equal(block.width, LAYOUT.text(words(long)).width, 'the long line sets the width');
});

test('a shaft Label breaks on newlines too, and keeps its words whole', () => {
  const long = Array.from({ length: 40 }, () => 'word').join(' ');
  const shaft = { start: { x: 0, y: 0 }, end: { x: 400, y: 0 } };
  const one = LAYOUT.label(element({
    version: 1,
    elements: [{ id: 'a', type: 'line', points: [shaft.start, shaft.end], label: long }],
  }), shaft);

  assert.equal(one!.lines.length, 1, 'a shaft has no box to wrap in');
  assert.equal(one!.lines[0]!.text, long);

  const two = LAYOUT.label(element({
    version: 1,
    elements: [{ id: 'a', type: 'line', points: [shaft.start, shaft.end], label: `first\n${long}` }],
  }), shaft);
  assert.deepEqual(two!.lines.map((line) => line.text), ['first', long]);
});

test('non-breaking and other spaces stay exactly as written', () => {
  const content = 'a\u00a0b\u2003c';
  const block = LAYOUT.text(words(content));

  assert.equal(block.lines.length, 1);
  assert.equal(block.lines[0]!.text, content, 'every space keeps the character the author typed');
});

test('a shaft Label keeps clear of the line at any heading', () => {
  const headings: { name: string; from: Point; to: Point }[] = [
    { name: 'horizontal', from: { x: 100, y: 200 }, to: { x: 300, y: 200 } },
    { name: 'vertical', from: { x: 200, y: 100 }, to: { x: 200, y: 300 } },
    { name: 'steep diagonal', from: { x: 100, y: 300 }, to: { x: 160, y: 100 } },
    { name: 'shallow diagonal', from: { x: 100, y: 100 }, to: { x: 400, y: 160 } },
  ];
  for (const { name, from, to } of headings) {
    const shaft = { start: from, end: to };
    const block = LAYOUT.label(arrow(from, to), shaft)!;

    assert.equal(shaftTouches(block, shaft), false, `the ${name} shaft misses the words`);
    assert.equal(LAYOUT.overflow(arrow(from, to)), null, 'a shaft has no box to overflow');

    // The side is a rule, not a guess: the upper side where the shaft has one,
    // the left where it is vertical, and the same side whichever way it points.
    const reversed = LAYOUT.label(arrow(to, from), { start: to, end: from })!;
    const sideOf = (b: Block): Point => ({
      x: b.x + b.width / 2 - (from.x + to.x) / 2,
      y: b.y + b.height / 2 - (from.y + to.y) / 2,
    });
    const side = sideOf(block);
    const other = sideOf(reversed);
    assert.ok(side.x * other.x >= 0 && side.y * other.y >= 0, `the ${name} Label keeps its side`);
    if (name === 'horizontal') {
      assert.ok(side.y < 0, 'a level shaft carries its words above it');
    }
    if (name === 'vertical') {
      assert.ok(side.x < 0, 'a vertical shaft carries its words on its left');
    }
  }
});

test('a shaft Label is centred on the shaft it is given, after Snap', () => {
  const scene = {
    version: 1,
    elements: [
      { id: 'box', type: 'rectangle', x: 0, y: 0, width: 80, height: 80 },
      {
        id: 'arrow',
        type: 'arrow',
        points: [
          { x: 40, y: 40, snap: 'box' },
          { x: 300, y: 40 },
        ],
        label: 'snapped',
      },
    ],
  };
  const drawn = { start: { x: 80, y: 40 }, end: { x: 300, y: 40 } };
  const block = LAYOUT.label(element(scene, 1), drawn)!;

  assert.equal(block.x + block.width / 2, 190, 'the words follow the shaft Snap drew');
  assert.ok(block.y + block.height < 40, 'and stay above it');
});

test('a shaft Label needs the shaft that is drawn', () => {
  assert.throws(
    () => LAYOUT.label(arrow({ x: 0, y: 0 }, { x: 100, y: 0 })),
    /a shaft Label needs the shaft that is drawn/,
  );
});

test('a Label wraps inside the room its outline leaves', () => {
  // Layout's own rules: a rectangle uses its whole box, an ellipse the largest
  // square inside it, a diamond half of each side, and every side keeps
  // `8px + stroke width` clear.
  const cases = [
    { type: 'rectangle', fraction: 1, width: 160, height: 120 },
    { type: 'rectangle', fraction: 1, width: 100, height: 120 },
    { type: 'ellipse', fraction: Math.SQRT1_2, width: 240, height: 160 },
    { type: 'diamond', fraction: 0.5, width: 240, height: 160 },
  ] as const;
  for (const { type, fraction, width, height } of cases) {
    const box = element(oneElement({ type, width, height, label: 'orders and invoices for the autumn release' }));
    const block = LAYOUT.label(box)!;
    const area = {
      width: width * fraction - 2 * (8 + 2),
      height: height * fraction - 2 * (8 + 2),
    };

    assert.deepEqual(
      block.lines.map((line) => line.text),
      wrapped('orders and invoices for the autumn release', area.width, 18),
      `the ${type} breaks the words where they stop fitting`,
    );
    for (const line of block.lines) {
      assert.ok(
        kalamAdvance(line.text, 18) <= area.width,
        `"${line.text}" fits inside the ${type}`,
      );
    }
    assert.ok(block.width <= area.width + 0.01, `the ${type}'s words fit its width`);
  }
  const narrow = LAYOUT.label(
    element(oneElement({ width: 100, label: 'orders and invoices for the autumn release' })),
  )!;
  const wide = LAYOUT.label(
    element(oneElement({ width: 320, label: 'orders and invoices for the autumn release' })),
  )!;
  assert.ok(narrow.lines.length > wide.lines.length, `${narrow.lines.length} lines narrow, ${wide.lines.length} wide`);
});

test('a line is measured once, as the candidate the wrap fitted it from', () => {
  const parsed = parseFontFile(KALAM);
  const measured: string[] = [];
  const counted = createLayout({
    ...parsed,
    metrics: {
      ...parsed.metrics,
      advance: (text, size) => {
        measured.push(text);
        return parsed.metrics.advance(text, size);
      },
    },
  });

  // The wrap measures the candidate line it is fitting words onto, and the line
  // that candidate becomes keeps that width: measuring it again for its own
  // width would measure the same words twice.
  const wide = counted.label(element(oneElement({ width: 200, label: 'one two three' })))!;
  assert.deepEqual(wide.lines.map((line) => line.text), ['one two three']);
  assert.deepEqual(measured, ['one two', 'one two three'], 'each candidate measured once');

  measured.length = 0;
  const narrow = counted.label(element(oneElement({ width: 120, label: 'one two three' })))!;
  assert.deepEqual(narrow.lines.map((line) => line.text), ['one two', 'three']);
  // A line the wrap never fitted — the last one, or the only one — is measured
  // here, once, for its own width; the line that broke before it was measured
  // as the candidate it became.
  assert.deepEqual(measured, ['one two', 'one two three', 'three'], 'every line measured once');
  assert.ok(
    Math.abs(narrow.width - kalamAdvance('one two', 18)) < 0.01,
    'a line is as wide as the words it was measured with',
  );
});

test('a Label that does not fit is placed anyway, past its box', () => {
  const box = element(oneElement({ width: 100, height: 40, label: 'this box is far too small for these words' }));
  const block = LAYOUT.label(box)!;
  const overflow = LAYOUT.overflow(box);

  assert.ok(block.lines.length > 0, 'the words are placed where the author put them');
  assert.ok(overflow !== null, 'and check is what says they do not fit');
  assert.ok(overflow.message.startsWith('label does not fit: '));
  assert.ok(block.width > 80 || block.height > 20, 'the words run past the box');
});

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
    const gem = element(
      oneElement({ type, width: 180, height: 110, label: 'the very middle of the diamond' }),
    );
    assert.ok(LAYOUT.overflow(gem) !== null, `the ${type}'s middle is too small`);

    const grown = LAYOUT.grow(gem);

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
  const text = element({ version: 1, elements: [{ id: 't', type: 'text', x: 10, y: 10, content: 'Words' }] });
  const line = element(
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
  assert.deepEqual(LAYOUT.grow(text), text);
  assert.deepEqual(LAYOUT.grow(line), line, 'a shaft has no box to grow');
});

/**
 * Where a line's own left edge is, from the anchor its Block draws with: the
 * x a caret at the start of that line sits on, plus the ink before the caret.
 */
/**
 * Where the glyph boundaries of a Block's lines are, as this test's own text
 * engine lays them out: the font's advance for the prefix, from the line's own
 * left edge. A browser answers with the same numbers for the element it drew —
 * a fallback font and the words' direction included — and Layout reads that
 * answer rather than measuring glyphs of its own. Each glyph's box is the room
 * between the two boundaries that name it.
 */
function glyphs(block: Block): LineGlyphs {
  return (line) => {
    const width = kalamAdvance(line.text, block.size);
    const left =
      block.anchor === 'start' ? line.x : block.anchor === 'middle' ? line.x - width / 2 : line.x - width;
    const boundaries = Array.from({ length: line.text.length + 1 }, (_, column) =>
      left + kalamAdvance(line.text.slice(0, column), block.size),
    );
    const boxes = boundaries.slice(0, -1).map((one, index) => {
      const other = boundaries[index + 1]!;
      return { left: Math.min(one, other), right: Math.max(one, other) };
    });
    return { boundaries, glyphs: boxes };
  };
}

function caretX(block: Block, line: number, prefix: string): number {
  const placed = block.lines[line]!;
  const width = kalamAdvance(placed.text, block.size);
  const left =
    block.anchor === 'start' ? placed.x : block.anchor === 'middle' ? placed.x - width / 2 : placed.x - width;
  return left + kalamAdvance(prefix, block.size);
}

test('the caret sits at the glyph boundary its offset names, on the line that holds it', () => {
  const content = 'first\nsecond';
  const block = LAYOUT.text(words(content));
  const lineHeight = block.lines[1]!.baseline - block.lines[0]!.baseline;

  for (let offset = 0; offset <= content.length; offset += 1) {
    // The newline itself is the end of the line it closes, not a third line.
    const line = offset <= 'first'.length ? 0 : 1;
    const prefix = line === 0 ? content.slice(0, offset) : content.slice('first\n'.length, offset);
    const caret = LAYOUT.caret(block, offset, glyphs(block));

    assert.equal(caret.line, line, `offset ${offset} is on line ${line}`);
    assert.ok(
      Math.abs(caret.x - caretX(block, line, prefix)) < 0.001,
      `offset ${offset} draws its caret after "${prefix}"`,
    );
    assert.ok(Math.abs(caret.y - (block.y + line * lineHeight)) < 0.001, 'the caret is on its line');
    assert.ok(Math.abs(caret.height - lineHeight) < 0.001, 'one line tall');
  }

  // Every character moves the caret rightwards, so no two offsets share a slot.
  const xs = Array.from({ length: 6 }, (_, offset) => LAYOUT.caret(block, offset, glyphs(block)).x);
  assert.deepEqual([...xs].sort((a, b) => a - b), xs);
});

test('empty words still have a caret, at the edge they would start on', () => {
  // A Label emptied while it is typed keeps its words as words: one empty line,
  // centred in the Element, so the caret has a place to sit in.
  // The parser refuses empty words, so the Element is placed with them by hand:
  // the page draws that while a Label is being emptied.
  const empty = LAYOUT.label({
    ...element(oneElement({ width: 120, height: 60, label: 'x' })),
    label: '',
  } as Element)!;
  const caret = LAYOUT.caret(empty, 0, glyphs(empty));

  assert.equal(caret.line, 0);
  assert.equal(empty.width, 0, 'empty words are no ink wide');
  assert.equal(caret.x, empty.x, 'the caret is where the words would start');
  assert.equal(caret.y, empty.y);
  assert.ok(Math.abs(caret.height - empty.height) < 0.001, 'the caret is as tall as the empty line');
  assert.deepEqual(LAYOUT.selection(empty, 0, 0, glyphs(empty)), [], 'nothing is selected');
  assert.equal(
    LAYOUT.offsetAt(empty, { x: empty.x + 40, y: empty.y + 4 }, glyphs(empty)),
    0,
    'a press on it is offset 0',
  );

  // A left-aligned Text starts the caret where its x is.
  const left = LAYOUT.text(words('one'));
  assert.equal(LAYOUT.caret(left, 0, glyphs(left)).x, left.x);
});

test('a caret on a wrapped Label lands on the line its words broke onto', () => {
  const label = 'orders and invoices for the autumn release';
  const block = LAYOUT.label(element(oneElement({ width: 130, height: 200, label })))!;
  assert.ok(block.lines.length >= 3, `the Label wraps: ${block.lines.length} lines`);

  let at = 0;
  block.lines.forEach((placed, line) => {
    const start = label.indexOf(placed.text, at);
    assert.ok(start >= 0, `line ${line} is drawn from the words`);
    at = start + placed.text.length;
    const caret = LAYOUT.caret(block, start, glyphs(block));
    assert.equal(caret.line, line, `"${placed.text}" starts on line ${line}`);
    assert.ok(Math.abs(caret.x - caretX(block, line, '')) < 0.001, 'a caret at its start is at its edge');
  });

  // A centred Label keeps its lines centred: each line's caret follows it.
  assert.equal(block.anchor, 'middle');
  assert.ok(block.lines.every((placed) => Math.abs(placed.x - block.lines[0]!.x) < 0.001));
});

test('a press in the words names the glyph boundary nearest it', () => {
  const content = 'words';
  const block = LAYOUT.text(words(content));
  const left = block.x;
  const middle = block.y + block.height / 2;
  const glyph = kalamAdvance('w', block.size);

  assert.equal(
    LAYOUT.offsetAt(block, { x: left + glyph * 0.25, y: middle }, glyphs(block)),
    0,
    'the left of a glyph is before it',
  );
  assert.equal(
    LAYOUT.offsetAt(block, { x: left + glyph * 0.75, y: middle }, glyphs(block)),
    1,
    'the right of it is after it',
  );
  assert.equal(
    LAYOUT.offsetAt(
      block,
      { x: left + kalamAdvance(content, block.size) + 300, y: middle },
      glyphs(block),
    ),
    content.length,
    'past the words is the end of the line',
  );
  assert.equal(
    LAYOUT.offsetAt(block, { x: left - 300, y: block.y - 300 }, glyphs(block)),
    0,
    'above and left is the start',
  );
  assert.equal(
    LAYOUT.offsetAt(block, { x: left + 300, y: block.y + block.height + 300 }, glyphs(block)),
    content.length,
    'below and right is the end',
  );
});

test('a press on a wrapped Label picks the line it landed on, not the nearest ink', () => {
  const label = 'orders and invoices for the autumn release';
  const block = LAYOUT.label(element(oneElement({ width: 130, height: 200, label })))!;
  const lineHeight = block.lines[1]!.baseline - block.lines[0]!.baseline;
  const first = block.lines[0]!;
  const second = block.lines[1]!;

  // Lines are as wide as their own words: the far right of line one is its end,
  // even where line two's ink runs past it.
  const end = block.anchor === 'middle' ? first.x + kalamAdvance(first.text, block.size) / 2 : first.x;
  // Where the words themselves say the line stops: the word the wrap moved down
  // begins after the space that broke the line.
  const secondStarts = label.indexOf(second.text);
  const offset = LAYOUT.offsetAt(block, { x: end + 500, y: block.y + lineHeight / 2 }, glyphs(block));
  assert.equal(offset, secondStarts - 1, 'the end of the first line');

  const secondOffset = LAYOUT.offsetAt(
    block,
    { x: 0, y: block.y + lineHeight + lineHeight / 2 },
    glyphs(block),
  );
  assert.equal(secondOffset, secondStarts, 'the start of the second line');
});

test('a selection is one box per line, behind the glyphs it covers', () => {
  const content = 'first\nsecond';
  const block = LAYOUT.text(words(content));
  const lineHeight = block.lines[1]!.baseline - block.lines[0]!.baseline;
  const boxes = LAYOUT.selection(block, 2, 8, glyphs(block));

  assert.equal(boxes.length, 2, 'two lines');
  assert.ok(
    Math.abs(boxes[0]!.x - (block.x + kalamAdvance('fi', block.size))) < 0.001,
    'the first line starts the highlight after "fi"',
  );
  assert.ok(
    Math.abs(boxes[0]!.x + boxes[0]!.width - (block.x + kalamAdvance('first', block.size))) < 0.001,
    'and carries it to the end of the line',
  );
  assert.ok(Math.abs(boxes[1]!.x - block.x) < 0.001, 'the second line starts the highlight at its edge');
  assert.ok(Math.abs(boxes[1]!.width - kalamAdvance('se', block.size)) < 0.001, 'up to the offset it ends at');
  assert.ok(Math.abs(boxes[0]!.height - lineHeight) < 0.001, 'one line tall');
  assert.ok(Math.abs(boxes[1]!.y - (boxes[0]!.y + lineHeight)) < 0.001, 'each on its own line');

  // The same run read from the other end is the same highlight.
  const backwards = LAYOUT.selection(block, 8, 2, glyphs(block));
  assert.deepEqual(backwards, boxes);
  assert.deepEqual(LAYOUT.selection(block, 4, 4, glyphs(block)), [], 'an empty selection draws nothing');
});

test('words that read right to left put their boundaries the other way', () => {
  // A browser lays a Hebrew run right to left and answers with its own glyphs:
  // the first boundary is the line's right edge, and each one steps left. That
  // is the whole of what Layout reads, so nothing here assumes a direction.
  const content = 'abcd';
  const block = LAYOUT.text(words(content));
  const middle = block.y + block.height / 2;
  const width = kalamAdvance(content, block.size);
  const rightToLeft: LineGlyphs = () => {
    const boundaries = Array.from(
      { length: content.length + 1 },
      (_, column) => block.x + width - kalamAdvance(content.slice(0, column), block.size),
    );
    const boxes = boundaries.slice(0, -1).map((one, index) => {
      const other = boundaries[index + 1]!;
      return { left: Math.min(one, other), right: Math.max(one, other) };
    });
    return { boundaries, glyphs: boxes };
  };

  assert.equal(LAYOUT.caret(block, 0, rightToLeft).x, block.x + width, 'the caret starts at the right edge');
  assert.equal(LAYOUT.caret(block, content.length, rightToLeft).x, block.x, 'and ends at the left one');

  // The highlight of the first two letters is the run between their boundaries,
  // given as the box it is: a left edge and a width, whichever way it runs.
  const [box] = LAYOUT.selection(block, 0, 2, rightToLeft);
  assert.ok(box !== undefined);
  assert.ok(Math.abs(box.x - (block.x + width - kalamAdvance('ab', block.size))) < 0.001, 'its left edge');
  assert.ok(Math.abs(box.width - kalamAdvance('ab', block.size)) < 0.001, 'and its width');

  // A press names the boundary nearest it, so the far left of the line is the
  // end of the words and the far right is where they start.
  assert.equal(
    LAYOUT.offsetAt(block, { x: block.x - 50, y: middle }, rightToLeft),
    content.length,
    'the left of right-to-left words is their end',
  );
  assert.equal(
    LAYOUT.offsetAt(block, { x: block.x + width + 50, y: middle }, rightToLeft),
    0,
    'and their right is their start',
  );
});

test('a run that reads the other way is drawn as its own box, and a press on it lands at its end', () => {
  // A mixed line as a browser lays it out: `abc ` from the left, the Hebrew run
  // right to left in the room after it, then ` xyz` again from the left. The
  // boundary after the Hebrew run and the boundary before it stand at the same
  // x, which is the whole of why two logical endpoints are no box.
  const content = 'abc אבג xyz';
  const block = LAYOUT.text(words(content));
  const x = block.x;
  const mixed: LineGlyphs = () => ({
    boundaries: [0, 10, 20, 30, 70, 60, 50, 70, 80, 90, 100, 110].map((at) => x + at),
    glyphs: [
      { left: x + 0, right: x + 10 },
      { left: x + 10, right: x + 20 },
      { left: x + 20, right: x + 30 },
      { left: x + 30, right: x + 40 },
      { left: x + 60, right: x + 70 },
      { left: x + 50, right: x + 60 },
      { left: x + 40, right: x + 50 },
      { left: x + 70, right: x + 80 },
      { left: x + 80, right: x + 90 },
      { left: x + 90, right: x + 100 },
      { left: x + 100, right: x + 110 },
    ],
  });
  const middle = block.y + block.height / 2;

  // The Hebrew word is one box of its own: the ink its glyphs cover, not the
  // span between the boundary before it and the boundary after it.
  assert.deepEqual(LAYOUT.selection(block, 4, 7, mixed), [
    { x: x + 40, y: block.y, width: 30, height: block.height },
  ]);

  // A selection that reaches across a gap is one box per run of ink, so the
  // space before the Hebrew run is not drawn as if it reached the run's start.
  const across = LAYOUT.selection(block, 3, 5, mixed);
  assert.deepEqual(
    across.map((box) => [box.x - x, box.width]),
    [
      [30, 10],
      [60, 10],
    ],
    'the space and the letter after it, each in its own place',
  );

  // A press on the left end of that run names the offset after its last letter,
  // and a press on the right end names the offset before its first one.
  assert.equal(LAYOUT.offsetAt(block, { x: x + 41, y: middle }, mixed), 7, 'left is after the run');
  assert.equal(LAYOUT.offsetAt(block, { x: x + 69, y: middle }, mixed), 4, 'right is before it');
  // The caret for either of those offsets stands at the run's right edge, where
  // the boundary between the two runs is drawn.
  assert.equal(LAYOUT.caret(block, 7, mixed).x, x + 70);
  assert.equal(LAYOUT.caret(block, 4, mixed).x, x + 70);
});
