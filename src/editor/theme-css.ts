/**
 * Mirror every `[data-theme="dark"]` rule in `css` under
 * `@media (prefers-color-scheme: dark)` for hosts that leave `data-theme` off
 * `<html>`, so the dark palette has one source of truth (`editor.css`).
 */
export function systemDarkRules(css: string): string {
  const rules: string[] = [];
  for (const match of css.matchAll(/\[data-theme=["']?dark["']?\]([^{]+\{[^}]+\})/g)) {
    const rule = match[1];
    if (rule !== undefined) {
      rules.push(`html:not([data-theme])${rule}`);
    }
  }
  return rules.length > 0 ? `@media (prefers-color-scheme: dark){${rules.join('')}}` : '';
}
