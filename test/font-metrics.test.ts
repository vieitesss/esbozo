/**
 * The font reader the bundle measures with, held against the one the CLI does.
 *
 * The browser bundle cannot afford a full OpenType parser: `opentype.js` alone
 * is bigger than the whole size budget. So the bundle reads the few tables
 * Layout needs itself (`src/font-metrics.ts`), and this suite says it measures
 * exactly what `ez render` measures — the reference is the CLI's own reader,
 * `measureFont`, so a drawing the editor saves and a drawing the CLI saves
 * cannot disagree about where a word ends.
 *
 * Exact equality is the claim, not a tolerance: the Renderer rounds to hundredths
 * either way, but an accumulator that drifts would eventually round a
 * hundredth differently.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureFontBytes } from '../src/font-metrics.ts';
import { fontBytes } from './fonts.ts';
import { loadProjectModules } from './modules.ts';

const { measureFont, KALAM } = await loadProjectModules();

/** The words a Label or Text draws with, at the sizes a Scene names. */
const LONG = 'Trembling words that wrap, and punctuation.';
const SIZES = [14, 18, 24, 32];

test('Kalam measures the same in the bundle as in the CLI', () => {
  const cli = measureFont(KALAM);
  const bundle = measureFontBytes(KALAM);

  for (const size of SIZES) {
    assert.equal(bundle.advance(LONG, size), cli.advance(LONG, size));
    assert.equal(bundle.advance('i', size), cli.advance('i', size));
    assert.equal(bundle.advance('', size), cli.advance('', size));
    assert.equal(bundle.lineHeight(size), cli.lineHeight(size));
    assert.equal(bundle.inkCentre(size), cli.inkCentre(size));
  }
});

test('a font this project builds measures the same both ways, glyphs and vertical metrics alike', () => {
  const designs = [
    {},
    { advance: 500, ascender: 1800, descender: -200 },
    { advance: 1234, ascender: 900, descender: -300, glyphHeight: 1200 },
  ];
  for (const design of designs) {
    const bytes = fontBytes(design);
    const cli = measureFont(bytes);
    const bundle = measureFontBytes(bytes);
    for (const size of SIZES) {
      assert.equal(bundle.advance(LONG, size), cli.advance(LONG, size), JSON.stringify(design));
      assert.equal(bundle.lineHeight(size), cli.lineHeight(size), JSON.stringify(design));
      assert.equal(bundle.inkCentre(size), cli.inkCentre(size), JSON.stringify(design));
    }
  }
});

test('bytes that are not a font are refused, so the page can say why it has no words', () => {
  assert.throws(() => measureFontBytes(new Uint8Array(0)));
  assert.throws(() => measureFontBytes(new TextEncoder().encode('<html>not a font</html>')));
});
