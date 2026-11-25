/**
 * Module seam: verifies that `systemDarkRules` mirrors every `[data-theme="dark"]`
 * rule in `editor.css` under `@media (prefers-color-scheme: dark)` so a selector
 * or syntax change in `editor.css` fails loudly instead of silently losing dark mode.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProjectModules } from './modules.ts';

const { systemDarkRules, EDITOR_CSS } = await loadProjectModules();

test('systemDarkRules mirrors every [data-theme="dark"] rule in editor.css', () => {
  const darkRuleCount = (EDITOR_CSS.match(/\[data-theme=["']?dark["']?\]/g) ?? []).length;
  assert.ok(darkRuleCount > 0, 'editor.css must define at least one [data-theme="dark"] rule');

  const mirrored = systemDarkRules(EDITOR_CSS);
  assert.ok(
    mirrored.startsWith('@media (prefers-color-scheme: dark){') && mirrored.endsWith('}'),
    'output must be wrapped in a prefers-color-scheme: dark media query',
  );

  const mirroredCount = (mirrored.match(/html:not\(\[data-theme\]\)/g) ?? []).length;
  assert.equal(
    mirroredCount,
    darkRuleCount,
    `expected ${darkRuleCount} mirrored dark rules, got ${mirroredCount}`,
  );
});

test('systemDarkRules returns empty string when no dark rules are present', () => {
  assert.equal(systemDarkRules('esbozo-editor { color: black; }'), '');
});
