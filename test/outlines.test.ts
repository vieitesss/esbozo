/**
 * Seam 1: the words of a drawing, as the font's own outlines.
 *
 * `ez render` keeps a line as `<text>`; a PNG must not, because the browser and
 * resvg would each lay the line out their own way. This seam asks the pass that
 * turns one into the other what it promises: every line becomes curves, a blank
 * line disappears, each anchor keeps the line where Layout placed it, and a
 * drawing with a `<text>` it cannot read is a problem rather than a silent
 * fallback to another typeface.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';

const { createLayout, measureFont, renderScene, glyphsOf, outlineText, parseScene, KALAM } =
  await loadProjectModules();
const layout = createLayout(measureFont(KALAM));

/** A Scene with one free-standing Text and, when given, one labelled box. */
function sceneWith(content: string, label?: string): Parameters<typeof renderScene>[0] {
  const elements: unknown[] = [
    { id: 'words', type: 'text', x: 40, y: 40, content, fontSize: 'M' },
  ];
  if (label !== undefined) {
    elements.push({ id: 'box', type: 'rectangle', x: 40, y: 160, width: 200, height: 100, label });
  }
  const parsed = parseScene(
    JSON.stringify({ version: 1, title: 'Words', defaults: { roughness: 1 }, elements }),
  );
  if (!parsed.ok) {
    throw new Error('the fixture did not parse');
  }
  return parsed.scene;
}

/** How many `<path>` elements a drawing holds. */
function paths(svg: string): number {
  return svg.match(/<path /g)?.length ?? 0;
}

test('every line of words becomes glyph outlines, and no text is left', () => {
  const svg = renderScene(sceneWith('one line\ntwo lines', 'a label'), layout);
  assert.equal(svg.includes('<text'), true);
  const strokes = paths(svg);

  const outlined = outlineText(svg, glyphsOf(KALAM));
  assert.equal(outlined.ok, true);
  if (!outlined.ok) {
    return;
  }
  assert.equal(outlined.svg.includes('<text'), false);
  // Three lines of words, three more paths: the Text's two and the box's label.
  assert.equal(paths(outlined.svg), strokes + 3);
  assert.equal(outlined.svg.includes('fill="var(--ink)"'), true);
});

test('a line with no ink takes its space and draws nothing', () => {
  const svg = renderScene(sceneWith('top\n\ntail'), layout);
  const outlined = outlineText(svg, glyphsOf(KALAM));
  assert.equal(outlined.ok, true);
  if (!outlined.ok) {
    return;
  }
  assert.equal(paths(outlined.svg), 2);
});

test('an anchor moves the outlines, not just the attribute they were placed by', () => {
  const glyphs = glyphsOf(KALAM);
  const start = glyphs.path('aligned', 18, 300, 100, 'start');
  const end = glyphs.path('aligned', 18, 300, 100, 'end');
  const middle = glyphs.path('aligned', 18, 300, 100, 'middle');
  assert.notEqual(start, end);
  assert.notEqual(start, middle);
  // Outlining the same line twice is the same bytes, so an export is stable.
  assert.equal(start, glyphs.path('aligned', 18, 300, 100, 'start'));
});

test('a drawing with a line the pass cannot place is a problem, not a fallback', () => {
  const broken = '<svg><text>no place</text></svg>';
  const outlined = outlineText(broken, glyphsOf(KALAM));
  assert.equal(outlined.ok, false);
});
