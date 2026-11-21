/**
 * The one owner of the palette a written SVG may paint with.
 *
 * `render.test.ts` reads one named Scene and `elements.test.ts` reads the
 * kitchen sink of every Element and style value, but both ask the same two
 * questions of what `ez render` wrote: is every fill and stroke a theme
 * variable or an ink-into-paper mix, and does the document spell out no colour
 * besides a variable's own fallback? The fallbacks, the patterns and the two
 * checks live here so the suites cannot drift apart, and a fourth colour would
 * fail both at once.
 *
 * The literals are the light theme `src/editor/editor.css` declares, which is
 * what a browser with no stylesheet at all paints a saved SVG with: ink
 * `#1b1a17`, paper `#fbf8f1`, muted that ink at 52% in that paper (`#878580`),
 * and Kalam first in the hand's font stack.
 */
import assert from 'node:assert/strict';

/** The Renderer's ink, muted, paper and font, fallbacks and all. */
export const INK = 'var(--ink, #1b1a17)';
export const MUTED = 'var(--muted, #878580)';
export const PAPER = 'var(--paper, #fbf8f1)';
export const FONT = "var(--font-hand, 'Kalam', 'Bradley Hand', 'Segoe Print', cursive)";

/** One colour variable, as its fallback leaves it in a written SVG. */
const THEME_VARIABLE = /^var\(--(?:ink|muted|paper), #[0-9a-f]{6}\)$/;

/** A regex that matches `text` literally, so a fallback's punctuation escapes once. */
const literal = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A grey step: ink mixed into paper, with the percentage in the first group. */
const MIX = new RegExp(
  `^color-mix\\(in srgb, ${literal(INK)} (\\d{1,3})%, ${literal(PAPER)}\\)$`,
);

/** A colour a fill or stroke may paint with: a theme variable or a mix of two. */
export function isThemeColour(colour: string): boolean {
  return THEME_VARIABLE.test(colour) || MIX.test(colour);
}

/** The ink percentage a fill colour paints: paper is 0 and ink is 100. */
export function inkPercent(colour: string): number {
  if (colour === PAPER) {
    return 0;
  }
  if (colour === INK) {
    return 100;
  }
  const match = MIX.exec(colour);
  assert.ok(match, `not a grey colour: ${colour}`);
  return Number(match[1]);
}

/**
 * Strip every variable's fallback and nothing literal may be left, so an
 * inlined drawing always paints the host's ink, paper and muted instead of a
 * colour of its own.
 */
export function assertOnlyThemeColours(svg: string): void {
  const inlined = svg.replace(/var\(--[\w-]+, ?[^()]*\)/g, 'var()');
  assert.doesNotMatch(inlined, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
}
